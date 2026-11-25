/* ============================================================
   laboratorio-ia.js — "Laboratorio IA"
   ALUMNO: bienvenida personalizada, su ficha (voz, Cliente Soñado,
   producto: la IA propone un borrador y él/ella lo aprueba o edita) y un
   botón por etapa del funnel (Atracción, Conexión, Encuentro, Venta)
   que genera Reels, carruseles, DMs y WhatsApp con su propia voz.
   DIRECTOR y COPILOTO: ven la ficha y los contenidos de los alumnos
   (solo lectura). Lo que se configura (preguntas, prompts, etapas) vive
   en laboratorio-ia-config.js.

   Toda la IA corre en el servidor (functions laboratorio*): el navegador
   nunca manda un id de alumno ni puede abrir una etapa que aún no le
   corresponde. Todo texto que viene de la base o de la IA se escapa.
   ============================================================ */

import { db, auth, app } from './firebase-config.js';
import { escaparHtml } from './util-html.js';
import { ref, get, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";
import { EMOJIS_POR_CATEGORIA } from './emojis-todos.js';
import { getCurrentRole, esModoDemo } from './main.js';
import { getFaseDemo, getH2F4Demo } from './demo.js';
import { htmlPiezas, conectarPiezas, fijarContextoVista, fijarWhatsappVenta, fijarImagenesVista, enlazarAcordeon, cerrarOtrasPeticiones, hayEdicionesSinGuardar, descartarEdiciones } from './laboratorio-ia-vista.js';

const functions = getFunctions(app);
const abrirLaboratorio = httpsCallable(functions, 'laboratorioAbrir', { timeout: 120000 });
const pedirBorradorFicha = httpsCallable(functions, 'laboratorioBorradorFicha', { timeout: 120000 });
const guardarFichaServidor = httpsCallable(functions, 'laboratorioGuardarFicha', { timeout: 60000 });
const generarContenidos = httpsCallable(functions, 'laboratorioGenerar', { timeout: 175000 });
const estrategiaServidor = httpsCallable(functions, 'laboratorioEstrategia', { timeout: 120000 });

// En modo demo se manda la fase que la barra del Demo dice simular y, si activó «Simular H2F4», el texto del H2F4 de prueba
// (ese control vive en la barra de arriba, no en esta pantalla); el servidor solo lo acepta si la cuenta es el demo.
const conFase = (datos) => {
  if (!esModoDemo()) return datos;
  const h = getH2F4Demo();
  return { ...datos, faseDemo: getFaseDemo(), ...(h.activo ? { h2f4Demo: h.texto } : {}) };
};

const esc = escaparHtml;
const rootEl = () => document.getElementById('lab-contenido');

function mensajeError(err, porDefecto) {
  const m = err && err.message ? String(err.message) : '';
  return m && !/^internal$/i.test(m) ? m : (porDefecto || 'Algo salió mal. Intenta de nuevo.');
}

function fechaLegible(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
}

/* ---------------- Imágenes genéricas de las vistas previas (las sube el Director) ---------------- */

async function cargarImagenesVista() {
  try {
    const snap = await get(ref(db, 'laboratorioIA/vistaPrevia/imagenes'));
    fijarImagenesVista(snap.exists() ? Object.values(snap.val()).map(x => x && x.url) : []);
  } catch (err) {
    fijarImagenesVista([]); // sin imágenes se usa un fondo de color
  }
}

/* ---------------- Historial (alumno y staff) ---------------- */

// Guarda en la base los textos editados de UNA propuesta (las reglas solo dejan tocar los textos, no el formato ni el título).
function guardarEdicion(alumnoId, genId, i, cambios) {
  return update(ref(db, `laboratorioIA/generaciones/${alumnoId}/${genId}/piezas/${i}`), { ...cambios, editadoEn: Date.now() });
}

async function cargarHistorial(alumnoId, contenedor, nombresFormato, editable) {
  contenedor.innerHTML = '<p class="text-soft">Cargando…</p>';
  let lista = [];
  try {
    const snap = await get(ref(db, `laboratorioIA/generaciones/${alumnoId}`));
    lista = snap.exists() ? Object.entries(snap.val()).map(([id, g]) => ({ id, ...g })) : [];
  } catch (err) {
    contenedor.innerHTML = '<p class="text-soft">No se pudo cargar el historial.</p>';
    return;
  }
  lista.sort((a, b) => (b.creadoEn || 0) - (a.creadoEn || 0));
  lista = lista.slice(0, 20);
  if (!lista.length) { contenedor.innerHTML = '<p class="text-soft">Aún no hay contenidos generados.</p>'; return; }
  contenedor.innerHTML = lista.map((g, n) => `
    <details class="lab-historial__item lab-acordeon">
      <summary><strong>${esc(g.etapaNombre || g.etapa || '')}${g.flujoNombre ? ` · Flujo: ${esc(g.flujoNombre)}` : g.tipoContenido === 'ideas' ? ' · Ideas para tu grupo' : ''}</strong> · ${esc(fechaLegible(g.creadoEn))} · ${(g.piezas || []).length} ${g.flujoNombre ? 'mensajes' : g.tipoContenido === 'ideas' ? 'ideas' : 'propuestas'}</summary>
      <div class="lab-historial__cuerpo" data-g="${n}">${htmlPiezas(g.piezas, nombresFormato, { editable, flujo: g.flujoNombre || '' })}</div>
    </details>`).join('');
  contenedor.querySelectorAll('[data-g]').forEach(div => {
    const gen = lista[Number(div.dataset.g)];
    conectarPiezas(div, gen.piezas || [], { editable, guardar: (i, cambios) => guardarEdicion(alumnoId, gen.id, i, cambios) });
  });
  enlazarAcordeon(rootEl());
}

/* ============================================================
   ALUMNO
   ============================================================ */

let datos = null;       // respuesta de laboratorioAbrir
let alumnoIdActual = null;

function htmlCabeceraAlumno() {
  const nombre = datos.primerNombre ? `, ${esc(datos.primerNombre)}` : '';
  return `
    <div class="lab-hero">
      <div class="lab-hero__saludo">Hola${nombre} 👋</div>
      ${datos.frase ? `<p class="lab-hero__frase">${esc(datos.frase)}</p>` : ''}
    </div>`;
}

function htmlFichas() {
  if (!datos.seccionesAbiertas.length) return '';
  return `
    <section class="lab-bloque">
      <h3>Tu ficha</h3>
      <p class="text-soft lab-bloque__sub">Esto es lo que la IA sabe de ti. Lo armó con lo que ya compartiste en tus hitos; revísalo, corrígelo si hace falta y apruébalo. Con eso, los contenidos sonarán a ti.</p>
      ${datos.seccionesAbiertas.map(s => {
        const p = datos.preguntas[s];
        const f = datos.fichas[s];
        const aprobada = !!(f && f.aprobada);
        return `
        <div class="lab-ficha" data-seccion="${s}">
          <div class="lab-ficha__cab">
            <div class="lab-ficha__txt">
              <strong>${esc(p.titulo)}</strong>
              ${p.descripcion ? `<p class="text-soft">${esc(p.descripcion)}</p>` : ''}
            </div>
            <span class="lab-badge ${aprobada ? 'lab-badge--ok' : 'lab-badge--pend'}">${aprobada ? 'Aprobada ✓' : 'Por revisar'}</span>
            <button type="button" class="btn ${aprobada ? 'btn--ghost' : 'btn--primary'}" data-abrir-ficha="${s}">${aprobada ? 'Ver / editar' : 'Revisar y aprobar'}</button>
          </div>
          <div class="lab-ficha__editor hidden" data-editor="${s}"></div>
        </div>`;
      }).join('')}
    </section>`;
}

function textoEstadoEtapa(id) {
  const e = datos.estadoEtapas[id];
  const info = datos.etapas[id];
  if (e.abierta) return '';
  if (e.motivo === 'desactivada') return 'Disponible pronto.';
  if (e.motivo === 'fase') return `Se activa en la Fase ${info.desdeFase}.`;
  if (e.motivo === 'hito') return `Se activa cuando compartas tu hito ${info.hitoActivador || ''}.`.replace(' .', '.');
  return 'Primero aprueba tu ficha.';
}

/* --- Estrategia de Encuentro (técnica de la SDV, tipo de contenido, palabra clave, link y fecha) --- */

const resumenEstrategia = (e) => {
  const t = (datos.tecnicas[e.tecnica] || {}).nombre || e.tecnica;
  return `
    <div class="lab-estrategia__resumen">
      <div><strong>Tu SDV:</strong> ${e.fecha ? esc(e.fecha) : '<span class="text-soft">completa la fecha en tu ficha de la SDV</span>'}</div>
      <div><strong>Técnica:</strong> ${esc(t)}</div>
      <div><strong>Contenido:</strong> ${esc((datos.tipos || {})[e.tipo] || e.tipo)}</div>
      ${e.tipo === 'pagado' ? '' : `<div><strong>Palabra clave:</strong> ${esc(e.palabra)}</div>`}
      <div><strong>Link:</strong> ${e.link ? esc(e.link) : '<span class="text-soft">sin link (los textos llevarán [TU LINK])</span>'}</div>
    </div>`;
};

function htmlEstrategiaPanel(e) {
  const tec = e ? e.tecnica : '';
  const tipo = e ? e.tipo : '';
  return `
    <div class="lab-estrategia" id="lab-estrategia-panel">
      <h4>Tu estrategia de Encuentro</h4>
      <p class="text-soft">Esto le da contexto a tus contenidos y define cómo se escriben los llamados a la acción. Puedes cambiarlo cuando quieras.</p>
      <p class="text-soft">La fecha y la hora de tu SDV salen de tu ficha «${esc(((datos.preguntas || {}).fase4 || {}).titulo || '¡Mi SDV lista para despegar!')}».</p>
      <p class="lab-estrategia__estado text-soft ${e ? 'hidden' : ''}" id="lab-estrategia-estado"><span class="lab-spinner"></span> Leyendo tu hito ${esc(((datos.etapas.encuentro || {}).hitoActivador) || 'H2F4')} para proponerte una palabra clave…</p>
      <fieldset class="lab-estrategia__campo"><legend>¿Qué técnica usarás?</legend>
        ${Object.entries(datos.tecnicas).map(([k, t]) => `<label class="lab-estrategia__opcion"><input type="radio" name="lab-est-tecnica" value="${esc(k)}" ${tec === k ? 'checked' : ''}> ${esc(t.nombre)}</label>`).join('')}
      </fieldset>
      <fieldset class="lab-estrategia__campo"><legend>¿Tu contenido es orgánico o pagado?</legend>
        ${Object.entries(datos.tipos).map(([k, n]) => `<label class="lab-estrategia__opcion"><input type="radio" name="lab-est-tipo" value="${esc(k)}" ${tipo === k ? 'checked' : ''}> ${esc(n)}</label>`).join('')}
      </fieldset>
      <label class="lab-estrategia__campo"><span>Palabra clave para comentar</span>
        <input type="text" id="lab-est-palabra" maxlength="30" value="${esc(e ? e.palabra : '')}" placeholder="Ej: VALIDA">
        <small class="text-soft">Quien comente esta palabra en tus reels y carruseles recibirá tu invitación por DM. Es una sola para toda tu estrategia.</small></label>
      <label class="lab-estrategia__campo"><span id="lab-est-link-etiqueta">Link</span>
        <input type="url" id="lab-est-link" maxlength="500" value="${esc(e ? e.link : '')}" placeholder="https://…">
        <small class="text-soft">Opcional. Si lo dejas vacío, los textos llevarán [TU LINK] para que lo completes.</small></label>
      <p class="lab-error hidden" id="lab-est-error"></p>
      <div class="lab-acciones-pieza">
        <button type="button" class="btn btn--primary" id="lab-est-guardar">Guardar estrategia</button>
        <button type="button" class="btn btn--ghost" id="lab-est-cancelar">Cancelar</button>
      </div>
    </div>`;
}

async function abrirEstrategia() {
  const cont = document.getElementById('lab-estrategia');
  if (!cont) return;
  if (!alternarPanel('est-encuentro')) return;
  const e = datos.estrategia || null;
  cont.innerHTML = htmlEstrategiaPanel(e);
  cont.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const q = (id) => document.getElementById(id);
  const actualizarEtiquetaLink = () => {
    const sel = cont.querySelector('input[name="lab-est-tecnica"]:checked');
    const destino = sel ? (datos.tecnicas[sel.value] || {}).destino : '';
    q('lab-est-link-etiqueta').textContent = destino ? `Link de tu ${destino}` : 'Link';
  };
  cont.querySelectorAll('input[name="lab-est-tecnica"]').forEach(r => r.addEventListener('change', actualizarEtiquetaLink));
  actualizarEtiquetaLink();
  q('lab-est-cancelar').addEventListener('click', cerrarPaneles);
  q('lab-est-guardar').addEventListener('click', async () => {
    const err = q('lab-est-error');
    err.classList.add('hidden');
    const tecnica = (cont.querySelector('input[name="lab-est-tecnica"]:checked') || {}).value || '';
    const tipo = (cont.querySelector('input[name="lab-est-tipo"]:checked') || {}).value || '';
    const btn = q('lab-est-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const r = await estrategiaServidor(conFase({ accion: 'guardar', tecnica, tipo, palabra: q('lab-est-palabra').value, link: q('lab-est-link').value }));
      datos.estrategia = r.data.estrategia;
      pintarAlumno();
    } catch (ex) {
      err.textContent = mensajeError(ex, 'No se pudo guardar tu estrategia. Intenta de nuevo.');
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Guardar estrategia';
    }
  });
  // Primera vez: la IA propone una palabra clave (leída del hito). Solo rellena si sigue vacía.
  if (!e) {
    try {
      const r = await estrategiaServidor(conFase({ accion: 'proponer' }));
      if (!document.getElementById('lab-est-palabra')) return;
      if (!q('lab-est-palabra').value.trim() && r.data.palabra) q('lab-est-palabra').value = r.data.palabra;
    } catch (ex) { /* la propuesta es un extra: puede completarlo a mano */ }
    const est = document.getElementById('lab-estrategia-estado');
    if (est) est.classList.add('hidden');
  }
}

/* --- Estrategia de VENTA: tipo de contenido y a dónde dirige a las personas --- */

const NOMBRES_DESTINO_PAGADO = { pagina: 'Venta directo a página de venta', whatsapp: 'Venta con clic a WhatsApp' };
const nombreDestinoVenta = (e) => (e.tipo === 'pagado' ? NOMBRES_DESTINO_PAGADO[e.destino] : (datos.destinosVenta || {})[e.destino]) || e.destino;

const resumenEstrategiaVenta = (e) => `
  <div class="lab-estrategia__resumen">
    <div><strong>Contenido:</strong> ${esc((datos.tipos || {})[e.tipo] || e.tipo)}</div>
    <div><strong>Dirige a:</strong> ${esc(nombreDestinoVenta(e))}</div>
    ${e.tipo === 'organico' ? `<div><strong>Palabra clave:</strong> ${esc(e.palabra)}</div>` : ''}
    ${e.destino === 'pagina' ? `<div><strong>Página de venta:</strong> ${e.link ? esc(e.link) : '<span class="text-soft">sin link (los textos llevarán [TU LINK])</span>'}</div>` : ''}
    ${e.destino === 'whatsapp' ? `<div><strong>WhatsApp:</strong> ${e.whatsapp ? esc('+' + e.whatsapp) : '<span class="text-soft">sin número (los textos llevarán [TU LINK DE WHATSAPP])</span>'}</div>` : ''}
  </div>`;

async function abrirEstrategiaVenta() {
  const cont = document.getElementById('lab-estrategia');
  if (!cont) return;
  if (!alternarPanel('est-venta')) return;
  const e = datos.estrategiaVenta || null;
  cont.innerHTML = `
    <div class="lab-estrategia" id="lab-estrategia-panel">
      <h4>Tu estrategia de Venta</h4>
      <p class="text-soft">El nombre, la promesa y el precio de tu producto salen de tu ficha. Aquí eliges el tipo de contenido y a dónde llevas a las personas. Puedes cambiarlo cuando quieras.</p>
      <fieldset class="lab-estrategia__campo"><legend>¿Tu contenido es orgánico o pagado?</legend>
        ${Object.entries(datos.tipos).map(([k, n]) => `<label class="lab-estrategia__opcion"><input type="radio" name="lab-ven-tipo" value="${esc(k)}" ${e && e.tipo === k ? 'checked' : ''}> ${esc(n)}</label>`).join('')}
      </fieldset>
      <fieldset class="lab-estrategia__campo" id="lab-ven-destinos"></fieldset>
      <label class="lab-estrategia__campo" id="lab-ven-palabra-caja"><span>Palabra clave para comentar</span>
        <input type="text" id="lab-ven-palabra" maxlength="30" value="${esc(e ? e.palabra : '')}" placeholder="Ej: QUIERO">
        <small class="text-soft">Quien comente esta palabra en tus reels y carruseles recibirá tu mensaje por DM. Es una sola para toda tu estrategia de Venta.</small></label>
      <label class="lab-estrategia__campo" id="lab-ven-link-caja"><span>Link de tu página de venta</span>
        <input type="url" id="lab-ven-link" maxlength="500" value="${esc(e ? e.link : '')}" placeholder="https://…">
        <small class="text-soft">Opcional. Si lo dejas vacío, los textos llevarán [TU LINK] para que lo completes.</small></label>
      <label class="lab-estrategia__campo" id="lab-ven-wa-caja"><span>Tu número de WhatsApp</span>
        <input type="text" id="lab-ven-wa" maxlength="30" inputmode="tel" value="${esc(e ? e.whatsapp : '')}" placeholder="Con código de país, solo números. Ej: 56912345678">
        <small class="text-soft">Con él armamos tu link directo a WhatsApp. Opcional: si lo dejas vacío, los textos llevarán [TU LINK DE WHATSAPP].</small></label>
      <p class="lab-error hidden" id="lab-ven-error"></p>
      <div class="lab-acciones-pieza">
        <button type="button" class="btn btn--primary" id="lab-ven-guardar">Guardar estrategia</button>
        <button type="button" class="btn btn--ghost" id="lab-ven-cancelar">Cancelar</button>
      </div>
    </div>`;
  cont.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const q = (id) => document.getElementById(id);
  const tipoActual = () => (cont.querySelector('input[name="lab-ven-tipo"]:checked') || {}).value || '';
  const destinoActual = () => (cont.querySelector('input[name="lab-ven-destino"]:checked') || {}).value || '';
  const pintarDestinos = () => {
    const tipo = tipoActual();
    const previo = destinoActual() || (e ? e.destino : '');
    const claves = tipo === 'pagado' ? (datos.destinosVentaPagado || Object.keys(NOMBRES_DESTINO_PAGADO)) : Object.keys(datos.destinosVenta || {});
    q('lab-ven-destinos').innerHTML = tipo
      ? `<legend>${tipo === 'pagado' ? '¿Cómo vendes con tus anuncios?' : '¿Dónde diriges a las personas?'}</legend>` +
        claves.map(k => `<label class="lab-estrategia__opcion"><input type="radio" name="lab-ven-destino" value="${esc(k)}" ${previo === k ? 'checked' : ''}> ${esc(tipo === 'pagado' ? NOMBRES_DESTINO_PAGADO[k] : datos.destinosVenta[k])}</label>`).join('')
      : '<legend>¿Dónde diriges a las personas?</legend><p class="text-soft">Primero elige si tu contenido es orgánico o pagado.</p>';
    cont.querySelectorAll('input[name="lab-ven-destino"]').forEach(r => r.addEventListener('change', actualizarCampos));
  };
  const actualizarCampos = () => {
    q('lab-ven-palabra-caja').classList.toggle('hidden', tipoActual() !== 'organico');
    q('lab-ven-link-caja').classList.toggle('hidden', destinoActual() !== 'pagina');
    q('lab-ven-wa-caja').classList.toggle('hidden', destinoActual() !== 'whatsapp');
  };
  cont.querySelectorAll('input[name="lab-ven-tipo"]').forEach(r => r.addEventListener('change', () => { pintarDestinos(); actualizarCampos(); }));
  pintarDestinos();
  actualizarCampos();
  q('lab-ven-cancelar').addEventListener('click', cerrarPaneles);
  q('lab-ven-guardar').addEventListener('click', async () => {
    const err = q('lab-ven-error');
    err.classList.add('hidden');
    const btn = q('lab-ven-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const r = await estrategiaServidor(conFase({ etapa: 'venta', accion: 'guardar', tipo: tipoActual(), destino: destinoActual(), palabra: q('lab-ven-palabra').value, link: q('lab-ven-link').value, whatsapp: q('lab-ven-wa').value }));
      datos.estrategiaVenta = r.data.estrategia;
      fijarWhatsappVenta(datos.estrategiaVenta.whatsapp);
      pintarAlumno();
    } catch (ex) {
      err.textContent = mensajeError(ex, 'No se pudo guardar tu estrategia. Intenta de nuevo.');
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Guardar estrategia';
    }
  });
  // Primera vez: la IA propone una palabra clave a partir del producto. Solo rellena si sigue vacía.
  if (!e) {
    try {
      const r = await estrategiaServidor(conFase({ etapa: 'venta', accion: 'proponer' }));
      if (q('lab-ven-palabra') && !q('lab-ven-palabra').value.trim() && r.data.palabra) q('lab-ven-palabra').value = r.data.palabra;
    } catch (ex) { /* la propuesta es un extra: puede escribirla a mano */ }
  }
}

/* --- Estrategia de ENCUENTRO en OPEN: la comunidad gratuita de WhatsApp a la que invitas a tu audiencia --- */

const resumenEstrategiaOpen = (e) => `
  <div class="lab-estrategia__resumen">
    <div><strong>Tu comunidad:</strong> ${esc(e.comunidad)}</div>
    ${e.queRecibiran ? `<div><strong>Qué recibirán:</strong> ${esc(e.queRecibiran)}</div>` : ''}
    <div><strong>Contenido:</strong> ${esc((datos.tipos || {})[e.tipo] || e.tipo)}</div>
    ${e.tipo === 'pagado'
      ? `<div><strong>Llegan al grupo:</strong> ${esc((datos.destinosOpenPagado || {})[e.destino] || e.destino)}</div>`
      : `<div><strong>Palabra clave:</strong> ${esc(e.palabra)}</div>`}
    <div><strong>Link del grupo:</strong> ${e.linkGrupo ? esc(e.linkGrupo) : '<span class="text-soft">sin link (los textos llevarán [LINK DEL GRUPO])</span>'}</div>
    ${e.tipo === 'pagado' && e.destino === 'puente' ? `<div><strong>Página puente:</strong> ${e.linkPuente ? esc(e.linkPuente) : '<span class="text-soft">sin link (los textos llevarán [LINK DE TU PÁGINA PUENTE])</span>'}</div>` : ''}
  </div>`;

async function abrirEstrategiaOpen() {
  const cont = document.getElementById('lab-estrategia');
  if (!cont) return;
  if (!alternarPanel('est-open')) return;
  const e = datos.estrategiaOpen || null;
  const destinos = datos.destinosOpenPagado || {};
  cont.innerHTML = `
    <div class="lab-estrategia" id="lab-estrategia-panel">
      <h4>Tu estrategia de Encuentro</h4>
      <p class="text-soft">Aquí invitas a tu audiencia a una <strong>comunidad gratuita de WhatsApp</strong>: un grupo donde se encuentran con personas como ellas y reciben contenido de valor de tu parte, una y otra vez. Define tu comunidad y cómo llegan a ella. Puedes cambiarlo cuando quieras.</p>
      <p class="lab-estrategia__estado text-soft ${e ? 'hidden' : ''}" id="lab-open-estado"><span class="lab-spinner"></span> Leyendo lo que compartiste para proponerte el nombre de tu comunidad y una palabra clave…</p>
      <label class="lab-estrategia__campo"><span>Nombre de tu comunidad</span>
        <input type="text" id="lab-open-comunidad" maxlength="100" value="${esc(e ? e.comunidad : '')}" placeholder="Ej: Mamás Tranquilas">
        <small class="text-soft">Con este nombre invitarás a las personas. Puedes cambiar lo que te propone la IA.</small></label>
      <label class="lab-estrategia__campo"><span>¿Qué recibirán las personas al sumarse?</span>
        <textarea id="lab-open-recibiran" rows="3" maxlength="400" placeholder="Ej: Tips semanales, respuestas a tus dudas e invitaciones a actividades">${esc(e ? e.queRecibiran : '')}</textarea>
        <small class="text-soft">Es la razón para sumarse: contenido de valor, gratis y recurrente.</small></label>
      <fieldset class="lab-estrategia__campo"><legend>¿Tu contenido es orgánico o pagado?</legend>
        ${Object.entries(datos.tipos).map(([k, n]) => `<label class="lab-estrategia__opcion"><input type="radio" name="lab-open-tipo" value="${esc(k)}" ${e && e.tipo === k ? 'checked' : ''}> ${esc(n)}</label>`).join('')}
      </fieldset>
      <fieldset class="lab-estrategia__campo" id="lab-open-destinos">
        <legend>¿Cómo llegan las personas al grupo?</legend>
        ${Object.entries(destinos).map(([k, n]) => `<label class="lab-estrategia__opcion"><input type="radio" name="lab-open-destino" value="${esc(k)}" ${(e ? e.destino : 'grupo') === k ? 'checked' : ''}> ${esc(n)}</label>`).join('')}
      </fieldset>
      <label class="lab-estrategia__campo" id="lab-open-palabra-caja"><span>Palabra clave para comentar</span>
        <input type="text" id="lab-open-palabra" maxlength="30" value="${esc(e ? e.palabra : '')}" placeholder="Ej: COMUNIDAD">
        <small class="text-soft">Quien comente esta palabra en tus reels y carruseles recibirá por DM la invitación a tu grupo. Es una sola para toda tu estrategia.</small></label>
      <label class="lab-estrategia__campo"><span>Link de tu grupo de WhatsApp</span>
        <input type="url" id="lab-open-grupo" maxlength="500" value="${esc(e ? e.linkGrupo : '')}" placeholder="https://chat.whatsapp.com/…">
        <small class="text-soft">Opcional. Si lo dejas vacío, los textos llevarán [LINK DEL GRUPO] para que lo completes.</small></label>
      <label class="lab-estrategia__campo" id="lab-open-puente-caja"><span>Link de tu página puente</span>
        <input type="url" id="lab-open-puente" maxlength="500" value="${esc(e ? e.linkPuente : '')}" placeholder="https://…">
        <small class="text-soft">Opcional. La página puente explica tu comunidad y desde ahí se entra al grupo.</small></label>
      <p class="lab-error hidden" id="lab-open-error"></p>
      <div class="lab-acciones-pieza">
        <button type="button" class="btn btn--primary" id="lab-open-guardar">Guardar estrategia</button>
        <button type="button" class="btn btn--ghost" id="lab-open-cancelar">Cancelar</button>
      </div>
    </div>`;
  cont.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const q = (id) => document.getElementById(id);
  const tipoActual = () => (cont.querySelector('input[name="lab-open-tipo"]:checked') || {}).value || '';
  const destinoActual = () => (cont.querySelector('input[name="lab-open-destino"]:checked') || {}).value || 'grupo';
  const actualizarCampos = () => {
    const pagado = tipoActual() === 'pagado';
    q('lab-open-destinos').classList.toggle('hidden', !pagado);
    q('lab-open-palabra-caja').classList.toggle('hidden', pagado);
    q('lab-open-puente-caja').classList.toggle('hidden', !(pagado && destinoActual() === 'puente'));
  };
  cont.querySelectorAll('input[name="lab-open-tipo"], input[name="lab-open-destino"]').forEach(r => r.addEventListener('change', actualizarCampos));
  actualizarCampos();
  q('lab-open-cancelar').addEventListener('click', cerrarPaneles);
  q('lab-open-guardar').addEventListener('click', async () => {
    const err = q('lab-open-error');
    err.classList.add('hidden');
    const btn = q('lab-open-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const pagado = tipoActual() === 'pagado';
      const r = await estrategiaServidor(conFase({ accion: 'guardar', tipo: tipoActual(), destino: pagado ? destinoActual() : 'grupo', palabra: q('lab-open-palabra').value, comunidad: q('lab-open-comunidad').value, queRecibiran: q('lab-open-recibiran').value, linkGrupo: q('lab-open-grupo').value, linkPuente: q('lab-open-puente').value }));
      datos.estrategiaOpen = r.data.estrategia;
      pintarAlumno();
    } catch (ex) {
      err.textContent = mensajeError(ex, 'No se pudo guardar tu estrategia. Intenta de nuevo.');
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Guardar estrategia';
    }
  });
  // Primera vez: la IA propone la palabra clave, el nombre de la comunidad y qué recibirán. Solo rellena lo que siga vacío.
  if (!e) {
    try {
      const r = await estrategiaServidor(conFase({ accion: 'proponer' }));
      if (q('lab-open-palabra') && !q('lab-open-palabra').value.trim() && r.data.palabra) q('lab-open-palabra').value = r.data.palabra;
      if (q('lab-open-comunidad') && !q('lab-open-comunidad').value.trim() && r.data.comunidad) q('lab-open-comunidad').value = r.data.comunidad;
      if (q('lab-open-recibiran') && !q('lab-open-recibiran').value.trim() && r.data.queRecibiran) q('lab-open-recibiran').value = r.data.queRecibiran;
    } catch (ex) { /* la propuesta es un extra: puede completarlo a mano */ }
    const est = document.getElementById('lab-open-estado');
    if (est) est.classList.add('hidden');
  }
}

// Botones de cada tarjeta de etapa cuando está abierta. Siempre en el mismo orden: primero los secundarios
// (editar estrategia, flujo de mensajes) y al final el principal, así queda a la misma altura en todas las tarjetas.
function botonesEtapa(id, e) {
  const etapaFlujo = id === 'venta' ? 'venta' : 'encuentro';
  const hayFlujos = (datos.flujos || []).some(f => f.etapa === etapaFlujo);
  const btnFlujo = hayFlujos ? `<button type="button" class="btn btn--ghost" data-flujo="${etapaFlujo}">Flujo de mensajes para tu grupo</button>` : '';
  if (datos.programa === 'open' && id === 'encuentro') {   // Encuentro en OPEN: la comunidad gratuita de WhatsApp
    const o = datos.estrategiaOpen;
    if (!o) return `<div class="lab-etapa__acciones"><p class="lab-etapa__estado">Primero define tu estrategia.</p><button type="button" class="btn btn--primary" data-estrategia-open>Definir mi estrategia</button></div>`;
    const btnIdeas = (datos.ideas || []).length ? '<button type="button" class="btn btn--ghost" data-ideas-open data-generar-pagado>Ideas para tu grupo</button>' : '';
    return `${resumenEstrategiaOpen(o)}<div class="lab-etapa__acciones"><button type="button" class="btn btn--ghost" data-estrategia-open>Editar estrategia</button>${btnIdeas}${o.tipo === 'pagado'
      ? '<button type="button" class="btn btn--primary" data-pagado>Mis ángulos y contenidos</button>'
      : '<button type="button" class="btn btn--primary" data-organico>Elegir y generar contenidos</button>'}</div>`;
  }
  if (e.hitoActivador) {   // Encuentro
    if (!datos.estrategia) return `<div class="lab-etapa__acciones"><p class="lab-etapa__estado">Primero define tu estrategia.</p>${btnFlujo}<button type="button" class="btn btn--primary" data-estrategia>Definir mi estrategia</button></div>`;
    return `${resumenEstrategia(datos.estrategia)}<div class="lab-etapa__acciones"><button type="button" class="btn btn--ghost" data-estrategia>Editar estrategia</button>${btnFlujo}${datos.estrategia.tipo === 'pagado'
      ? '<button type="button" class="btn btn--primary" data-pagado>Mis ángulos y contenidos</button>'
      : '<button type="button" class="btn btn--primary" data-organico>Elegir y generar contenidos</button>'}</div>`;
  }
  if (id === 'venta') {
    const v = datos.estrategiaVenta;
    if (!v) return `<div class="lab-etapa__acciones"><p class="lab-etapa__estado">Primero define tu estrategia de Venta.</p>${btnFlujo}<button type="button" class="btn btn--primary" data-estrategia-venta>Definir mi estrategia</button></div>`;
    return `${resumenEstrategiaVenta(v)}<div class="lab-etapa__acciones"><button type="button" class="btn btn--ghost" data-estrategia-venta>Editar estrategia</button>${btnFlujo}${v.tipo === 'pagado'
      ? '<button type="button" class="btn btn--primary" data-pagado-venta>Mis ángulos y contenidos</button>'
      : '<button type="button" class="btn btn--primary" data-organico-venta>Elegir y generar contenidos</button>'}</div>`;
  }
  return `<div class="lab-etapa__acciones"><button type="button" class="btn btn--primary" data-generar="${id}">Generar contenidos</button></div>`;
}

/* --- Paneles que se despliegan bajo las tarjetas (estrategia, ángulos, opciones, flujo) ---
   Solo hay uno abierto a la vez. Se minimizan al terminar su acción (guardar o generar) y vuelven a aparecer al pulsar
   de nuevo su botón; pulsar el botón con el panel abierto lo cierra. */

let panelAbierto = '';

function cerrarPaneles() {
  panelAbierto = '';
  ['lab-estrategia', 'lab-pagado'].forEach(id => { const c = document.getElementById(id); if (c) c.innerHTML = ''; });
}
// Devuelve false si el panel ya estaba abierto (y lo cierra); true si hay que abrirlo (cerrando el que hubiera).
function alternarPanel(clave) {
  if (panelAbierto === clave) { cerrarPaneles(); return false; }
  cerrarPaneles();
  panelAbierto = clave;
  return true;
}
function conectarCerrarPanel(cont) {
  cont.querySelectorAll('[data-cerrar-panel]').forEach(b => b.addEventListener('click', cerrarPaneles));
}
const BOTON_CERRAR_PANEL = '<button type="button" class="btn btn--ghost" data-cerrar-panel>Cerrar</button>';

/* --- Flujo de mensajes para el grupo de WhatsApp donde llegaron los leads ---
   Encuentro: ANTES de la SDV (conectar, recordar fecha y hora, aumentar la asistencia en vivo).
   Venta: DESPUÉS de la SDV (comunicar la oferta). Todo sale de la ficha «¡Mi SDV lista para despegar!»:
   al pulsar el botón se genera de inmediato (si hay varios flujos, antes se elige cuál). El Director define los flujos. */

let flujoElegido = '';

const ficha4Aprobada = () => !!(datos.fichas && datos.fichas.fase4 && datos.fichas.fase4.aprobada);
const tituloFicha4 = () => ((datos.preguntas || {}).fase4 || {}).titulo || '¡Mi SDV lista para despegar!';

function iniciarFlujo(etapa, btn) {
  etapaPanel = etapa === 'venta' ? 'venta' : 'encuentro';
  const esVenta = etapaPanel === 'venta';
  const cont = document.getElementById('lab-pagado');
  if (!cont) return;
  const flujos = (datos.flujos || []).filter(f => f.etapa === etapaPanel);
  const titulo = esVenta ? 'Flujo de mensajes para tu grupo: después de tu SDV' : 'Flujo de mensajes para tu grupo: antes de tu SDV';

  // Sin la ficha de la SDV aprobada no hay fecha ni datos: se guía al alumno hacia ella.
  if (!ficha4Aprobada()) {
    if (!alternarPanel('flujo-' + etapaPanel)) return;
    cont.innerHTML = `
      <div class="lab-estrategia lab-pagado">
        <h4>${titulo}</h4>
        <p>Para armar tu flujo necesito tu ficha <strong>«${esc(tituloFicha4())}»</strong> revisada y aprobada: de ahí salen la fecha, la hora y los datos de tu SDV.</p>
        <div class="lab-acciones-pieza"><button type="button" class="btn btn--primary" id="lab-flujo-ficha">Ir a mi ficha</button>${BOTON_CERRAR_PANEL}</div>
      </div>`;
    conectarCerrarPanel(cont);
    document.getElementById('lab-flujo-ficha').addEventListener('click', () => {
      cerrarPaneles();
      const tarjeta = document.querySelector('[data-seccion="fase4"]');
      if (tarjeta) { tarjeta.scrollIntoView({ behavior: 'smooth', block: 'center' }); abrirEditorFicha('fase4', false); }
    });
    return;
  }

  // Un solo flujo: se genera al instante, sin pasos intermedios.
  if (flujos.length === 1) {
    cerrarPaneles();
    generarEtapa(etapaPanel, btn, { flujo: flujos[0].id });
    return;
  }

  // Varios flujos: se elige cuál (el panel se minimiza al generar).
  if (!alternarPanel('flujo-' + etapaPanel)) return;
  if (!flujos.some(f => f.id === flujoElegido)) flujoElegido = (flujos[0] || {}).id || '';
  const sdv = datos.sdv || {};
  cont.innerHTML = `
    <div class="lab-estrategia lab-pagado">
      <h4>${titulo}</h4>
      ${sdv.textoFecha ? `<p class="text-soft">Tu SDV: <strong>${esc(sdv.textoFecha)}</strong>. Cada mensaje sale con su día y su hora exactos.</p>` : ''}
      <h5>¿Qué flujo quieres crear?</h5>
      ${flujos.map(f => `<label class="lab-estrategia__opcion"><input type="radio" name="lab-flujo" value="${esc(f.id)}" ${f.id === flujoElegido ? 'checked' : ''}> <span><strong>${esc(f.nombre)}</strong> <span class="text-soft">· ${esc(f.mensajes)} ${f.mensajes === 1 ? 'mensaje' : 'mensajes'} en ${esc(f.hasta - f.desde + 1)} ${f.hasta - f.desde === 0 ? 'día' : 'días'}</span></span></label>`).join('') || '<p class="text-soft">No hay flujos activos por ahora.</p>'}
      <div class="lab-acciones-pieza"><button type="button" class="btn btn--primary" id="lab-flujo-generar" data-generar-pagado ${flujos.length ? '' : 'disabled'}>Generar flujo de mensajes</button>${BOTON_CERRAR_PANEL}</div>
    </div>`;
  conectarCerrarPanel(cont);
  cont.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  cont.querySelectorAll('input[name="lab-flujo"]').forEach(x => x.addEventListener('change', () => { flujoElegido = x.value; }));
  const generar = document.getElementById('lab-flujo-generar');
  generar.addEventListener('click', () => {
    const id = (cont.querySelector('input[name="lab-flujo"]:checked') || {}).value || '';
    if (id) generarEtapa(etapaPanel, generar, { flujo: id });
  });
}

/* --- Contenido pagado: ángulos comunicacionales (de 3 en 3) y creación de los contenidos --- */

let angulos = [];                 // lista actual de ángulos del alumno
const angulosElegidos = new Set(); // ids de los ángulos marcados para crear contenidos
let etapaPanel = 'encuentro';      // etapa del panel de ángulos / opciones que está abierto: 'encuentro' o 'venta'

const llamarAngulos = async (accion, extra) => {
  const r = await estrategiaServidor(conFase({ accion, ...(etapaPanel === 'venta' ? { etapa: 'venta' } : {}), ...(extra || {}) }));
  angulos = (r.data && r.data.angulos) || [];
  [...angulosElegidos].forEach(id => { const a = angulos.find(x => x.id === id); if (!a || !a.aprobado) angulosElegidos.delete(id); });
};

function htmlAngulo(a, editando) {
  if (editando) {
    return `
      <div class="lab-angulo lab-angulo--edicion" data-id="${esc(a.id)}">
        <div class="lab-angulo__cab"><span class="lab-angulo__num">Ángulo ${esc(a.numero)}</span></div>
        <label class="lab-estrategia__campo"><span>Título</span><input type="text" data-ang="titulo" maxlength="120" value="${esc(a.titulo)}"></label>
        <label class="lab-estrategia__campo"><span>Explicación</span><textarea data-ang="descripcion" rows="3" maxlength="600">${esc(a.descripcion)}</textarea></label>
        <p class="lab-error hidden" data-ang-error></p>
        <div class="lab-acciones-pieza">
          <button type="button" class="btn btn--primary" data-ang-act="guardar">Guardar cambios</button>
          <button type="button" class="btn btn--ghost" data-ang-act="cancelar">Cancelar</button>
        </div>
      </div>`;
  }
  return `
    <div class="lab-angulo ${a.aprobado ? 'lab-angulo--ok' : ''}" data-id="${esc(a.id)}">
      <div class="lab-angulo__cab"><span class="lab-angulo__num">Ángulo ${esc(a.numero)}</span>${a.aprobado ? '<span class="lab-angulo__ok">Aprobado ✓</span>' : '<span class="lab-angulo__pend">Por aprobar</span>'}</div>
      <div class="lab-angulo__titulo">${esc(a.titulo)}</div>
      ${a.descripcion ? `<p class="lab-angulo__desc">${esc(a.descripcion)}</p>` : ''}
      <div class="lab-acciones-pieza">
        <button type="button" class="btn ${a.aprobado ? 'btn--ghost' : 'btn--primary'}" data-ang-act="aprobar">${a.aprobado ? 'Quitar aprobación' : 'Aprobar'}</button>
        <button type="button" class="btn btn--ghost" data-ang-act="editar">Editar</button>
        <button type="button" class="btn btn--ghost" data-ang-act="borrar">Borrar</button>
      </div>
    </div>`;
}

function pintarAngulos(editandoId) {
  const lista = document.getElementById('lab-angulos-lista');
  if (!lista) return;
  lista.innerHTML = angulos.length
    ? angulos.map(a => htmlAngulo(a, a.id === editandoId)).join('')
    : '<p class="text-soft">Aún no tienes ángulos. Crea los primeros 3 y revísalos: puedes editarlos, borrarlos y aprobarlos antes de generar contenidos.</p>';
  pintarOpcionesPagado();
}

function pintarOpcionesPagado() {
  const cont = document.getElementById('lab-pagado-opciones');
  if (!cont) return;
  const recetas = recetasDisponibles('pagado');
  const aprobados = angulos.filter(a => a.aprobado);
  const recetaPrevia = (cont.querySelector('input[name="lab-receta"]:checked') || {}).value || (recetas[0] || [])[0];
  cont.innerHTML = `
    <h5>¿Qué quieres crear?</h5>
    ${recetas.map(([id, r]) => `<label class="lab-estrategia__opcion"><input type="radio" name="lab-receta" value="${esc(id)}" ${id === recetaPrevia ? 'checked' : ''}> <span><strong>${esc(r.nombre)}</strong>${r.descripcion ? ` <span class="text-soft">· ${esc(r.descripcion)}</span>` : ''}</span></label>`).join('') || '<p class="text-soft">No hay opciones activas por ahora.</p>'}
    <h5>¿Con qué ángulos?</h5>
    ${aprobados.length
      ? aprobados.map(a => `<label class="lab-estrategia__opcion"><input type="checkbox" data-ang-sel value="${esc(a.id)}" ${angulosElegidos.has(a.id) ? 'checked' : ''}> <span><strong>Ángulo ${esc(a.numero)}:</strong> ${esc(a.titulo)}</span></label>`).join('')
      : '<p class="text-soft">Aprueba al menos un ángulo para poder elegirlo aquí.</p>'}
    <p class="text-soft lab-pagado__nota">Si eliges más de un ángulo, los contenidos se reparten lo más parejo posible entre ellos.</p>
    <button type="button" class="btn btn--primary" id="lab-pagado-generar" data-generar-pagado ${recetas.length && aprobados.length ? '' : 'disabled'}>Generar contenidos</button>`;
  cont.querySelectorAll('[data-ang-sel]').forEach(c => c.addEventListener('change', () => { if (c.checked) angulosElegidos.add(c.value); else angulosElegidos.delete(c.value); }));
  const btn = cont.querySelector('#lab-pagado-generar');
  btn.addEventListener('click', () => {
    const receta = (cont.querySelector('input[name="lab-receta"]:checked') || {}).value || '';
    if (!angulosElegidos.size) { alert('Elige al menos un ángulo aprobado.'); return; }
    generarEtapa(etapaPanel, btn, { receta, angulos: [...angulosElegidos] });
  });
}

// Las opciones (recetas) que se ofrecen: las de la etapa abierta y, en Venta, solo las del destino que eligió el alumno.
function recetasDisponibles(tipo) {
  return Object.entries(datos.recetas || {}).filter(([, r]) => {
    if (r.tipo !== tipo) return false;
    if (etapaPanel === 'venta') return r.etapa === 'venta' && datos.estrategiaVenta && r.destino === datos.estrategiaVenta.destino;
    if (datos.programa === 'open') return r.etapa === 'open';   // en OPEN, Encuentro tiene sus propias opciones
    return (r.etapa || 'encuentro') === 'encuentro';
  });
}

async function abrirPagado(etapa) {
  etapaPanel = etapa === 'venta' ? 'venta' : 'encuentro';
  angulosElegidos.clear();
  angulos = [];
  const cont = document.getElementById('lab-pagado');
  if (!cont) return;
  if (!alternarPanel('pagado-' + etapaPanel)) return;
  const esVenta = etapaPanel === 'venta';
  cont.innerHTML = `
    <div class="lab-estrategia lab-pagado">
      <h4>${esVenta ? 'Contenido pagado de Venta: tus ángulos' : 'Contenido pagado: tus ángulos'}</h4>
      <p class="text-soft">${esVenta
        ? 'Un ángulo es un enfoque para vender tu producto: una forma distinta de mostrar su promesa y su valor a tu Cliente Soñado. La IA los crea de a 3 a partir de tu producto, y se numeran seguidos. Son distintos de los de Encuentro. Revísalos, edítalos o bórralos, y aprueba los que quieras usar.'
        : datos.programa === 'open'
          ? 'Un ángulo es un enfoque para que quieran sumarse a tu comunidad de WhatsApp: una forma distinta de mostrar el valor de pertenecer a ella. La IA los crea de a 3 con lo que compartiste sobre tu Cliente Soñado, y se numeran seguidos. Revísalos, edítalos o bórralos, y aprueba los que quieras usar.'
          : 'Un ángulo es un enfoque comunicacional para conectar con tu Cliente Soñado. La IA los crea de a 3 con lo que compartiste sobre él, y se numeran seguidos. Revísalos, edítalos o bórralos, y aprueba los que quieras usar.'}</p>
      <div id="lab-angulos-lista"><p class="text-soft"><span class="lab-spinner"></span> Cargando tus ángulos…</p></div>
      <p class="lab-error hidden" id="lab-ang-error"></p>
      <div class="lab-acciones-pieza"><button type="button" class="btn btn--primary" id="lab-ang-generar">Crear 3 ángulos nuevos</button>${BOTON_CERRAR_PANEL}</div>
      <div id="lab-pagado-opciones"></div>
    </div>`;
  cont.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  conectarCerrarPanel(cont);
  const errorEl = () => document.getElementById('lab-ang-error');
  const mostrarError = (ex, msg) => { const e = errorEl(); if (e) { e.textContent = mensajeError(ex, msg); e.classList.remove('hidden'); } };
  const limpiarError = () => { const e = errorEl(); if (e) e.classList.add('hidden'); };

  document.getElementById('lab-ang-generar').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    limpiarError();
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Creando ángulos…';
    try { await llamarAngulos('angulosGenerar'); pintarAngulos(); } catch (ex) { mostrarError(ex, 'No se pudieron crear los ángulos. Intenta de nuevo.'); }
    btn.disabled = false;
    btn.textContent = original;
  });

  document.getElementById('lab-angulos-lista').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-ang-act]');
    if (!b) return;
    const card = b.closest('.lab-angulo');
    const id = card.dataset.id;
    const act = b.dataset.angAct;
    limpiarError();
    try {
      if (act === 'editar') { pintarAngulos(id); return; }
      if (act === 'cancelar') { pintarAngulos(); return; }
      b.disabled = true;
      if (act === 'aprobar') {
        const a = angulos.find(x => x.id === id);
        const aprobando = !(a && a.aprobado);
        await llamarAngulos('anguloAprobar', { id, aprobado: aprobando });
        if (aprobando) angulosElegidos.add(id);
      } else if (act === 'borrar') {
        if (!confirm('¿Borrar este ángulo? Los demás conservan su número.')) { b.disabled = false; return; }
        await llamarAngulos('anguloBorrar', { id });
      } else if (act === 'guardar') {
        const titulo = card.querySelector('[data-ang="titulo"]').value.trim();
        const descripcion = card.querySelector('[data-ang="descripcion"]').value.trim();
        if (!titulo) { const e = card.querySelector('[data-ang-error]'); e.textContent = 'El ángulo necesita un título.'; e.classList.remove('hidden'); b.disabled = false; return; }
        await llamarAngulos('anguloEditar', { id, titulo, descripcion });
      }
      pintarAngulos();
    } catch (ex) {
      b.disabled = false;
      mostrarError(ex, 'No se pudo completar la acción. Intenta de nuevo.');
    }
  });

  try { await llamarAngulos('angulosListar'); } catch (ex) { angulos = []; mostrarError(ex, 'No se pudieron cargar tus ángulos.'); }
  pintarAngulos();
}

/* --- Contenido orgánico: elegir la opción (receta) y, si corresponde, si WhatsApp es grupo o privado --- */

let recetaOrganicaElegida = '';
let wspElegido = '';

function abrirOrganico(etapa) {
  etapaPanel = etapa === 'venta' ? 'venta' : 'encuentro';
  const cont = document.getElementById('lab-pagado');
  if (!cont) return;
  if (!alternarPanel('organico-' + etapaPanel)) return;
  const esVenta = etapaPanel === 'venta';
  const recetas = recetasDisponibles('organico');
  if (!recetas.some(([id]) => id === recetaOrganicaElegida)) recetaOrganicaElegida = (recetas[0] || [])[0] || '';
  cont.innerHTML = `
    <div class="lab-estrategia lab-pagado">
      <h4>${esVenta ? 'Contenido orgánico de Venta: ¿qué quieres crear?' : 'Contenido orgánico: ¿qué quieres crear?'}</h4>
      <p class="text-soft">${esVenta
        ? 'Elige una opción. Todos los contenidos venden tu producto (su nombre y su promesa salen de tu ficha) y llevan a las personas al destino que elegiste.'
        : datos.programa === 'open'
          ? 'Elige una opción. Todos los contenidos invitan a sumarse a tu comunidad gratuita de WhatsApp y usan tu estrategia: el nombre de tu comunidad, tu palabra clave y el link de tu grupo.'
          : 'Elige una opción. Todos los contenidos usan tu estrategia: tu técnica, tu palabra clave, tu link y la fecha de tu SDV.'}</p>
      ${recetas.map(([id, r]) => `<label class="lab-estrategia__opcion"><input type="radio" name="lab-receta-org" value="${esc(id)}" ${id === recetaOrganicaElegida ? 'checked' : ''}> <span><strong>${esc(r.nombre)}</strong>${r.descripcion ? `<br><span class="text-soft">${esc(r.descripcion)}</span>` : ''}</span></label>`).join('') || '<p class="text-soft">No hay opciones activas por ahora.</p>'}
      <div id="lab-org-wsp" class="hidden">
        <h5>¿Tu WhatsApp es para grupos o es un mensaje privado?</h5>
        <label class="lab-estrategia__opcion"><input type="radio" name="lab-wsp" value="grupo" ${wspElegido === 'grupo' ? 'checked' : ''}> Para grupos</label>
        <label class="lab-estrategia__opcion"><input type="radio" name="lab-wsp" value="privado" ${wspElegido === 'privado' ? 'checked' : ''}> Mensaje privado</label>
      </div>
      <p class="lab-error hidden" id="lab-org-error"></p>
      <div class="lab-acciones-pieza"><button type="button" class="btn btn--primary" id="lab-org-generar" data-generar-pagado ${recetas.length ? '' : 'disabled'}>Generar contenidos</button>${BOTON_CERRAR_PANEL}</div>
    </div>`;
  cont.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  conectarCerrarPanel(cont);
  const actualizar = () => {
    recetaOrganicaElegida = (cont.querySelector('input[name="lab-receta-org"]:checked') || {}).value || '';
    const r = (datos.recetas || {})[recetaOrganicaElegida];
    cont.querySelector('#lab-org-wsp').classList.toggle('hidden', !(r && r.preguntaWsp));
  };
  cont.querySelectorAll('input[name="lab-receta-org"]').forEach(x => x.addEventListener('change', actualizar));
  cont.querySelectorAll('input[name="lab-wsp"]').forEach(x => x.addEventListener('change', () => { wspElegido = x.value; }));
  actualizar();
  cont.querySelector('#lab-org-generar').addEventListener('click', (ev) => {
    const r = (datos.recetas || {})[recetaOrganicaElegida];
    const err = cont.querySelector('#lab-org-error');
    err.classList.add('hidden');
    if (!r) return;
    if (r.preguntaWsp && !wspElegido) { err.textContent = 'Elige si tu WhatsApp es para grupos o es un mensaje privado.'; err.classList.remove('hidden'); return; }
    generarEtapa(etapaPanel, ev.currentTarget, { receta: recetaOrganicaElegida, wsp: r.preguntaWsp ? wspElegido : '' });
  });
}

/* --- Nivel de emojis (barra deslizable: se arrastra con el dedo o con el mouse) --- */

const NIVELES_EMOJIS = [
  { nombre: 'Sin emojis', muestra: '' },
  { nombre: 'Pocos', muestra: '🙂' },
  { nombre: 'Algunos', muestra: '🙂✨' },
  { nombre: 'Bastantes', muestra: '😊✨💛🙌' },
  { nombre: 'Todos los que quieras', muestra: '😍🔥✨💛🙌🚀💪' }
];
const NIVEL_EMOJIS_INICIAL = 2;
const claveEmojis = () => `uneq_lab_emojis_${alumnoIdActual || 'x'}`;

function nivelEmojisGuardado() {
  try {
    const n = parseInt(localStorage.getItem(claveEmojis()), 10);
    if (n >= 0 && n < NIVELES_EMOJIS.length) return n;
  } catch (e) { /* sin almacenamiento: se usa el nivel inicial */ }
  return NIVEL_EMOJIS_INICIAL;
}
function nivelEmojisActual() {
  const inp = document.getElementById('lab-emojis-rango');
  const n = inp ? parseInt(inp.value, 10) : NaN;
  return n >= 0 && n < NIVELES_EMOJIS.length ? n : nivelEmojisGuardado();
}

/* --- Emojis favoritos: la persona escribe (o elige) los emojis que ella usa; la IA los usa de preferencia --- */
const claveEmojisFavoritos = () => `uneq_lab_emojis_fav_${alumnoIdActual || 'x'}`;
function emojisFavoritosGuardados() {
  try { return localStorage.getItem(claveEmojisFavoritos()) || ''; } catch (e) { return ''; }
}
// Solo cuenta lo que la persona GUARDÓ (botón Guardar); lo que está a medio escribir no se usa.
function emojisFavoritosActual() {
  return emojisFavoritosGuardados().trim().slice(0, 60);
}

function htmlBarraEmojis() {
  const n = nivelEmojisGuardado();
  return `
    <div class="lab-emojis">
      <div class="lab-emojis__cab">
        <label for="lab-emojis-rango"><strong>Nivel de emojis</strong></label>
        <span class="lab-emojis__valor"><span id="lab-emojis-nombre">${esc(NIVELES_EMOJIS[n].nombre)}</span> <span id="lab-emojis-muestra" aria-hidden="true">${NIVELES_EMOJIS[n].muestra}</span></span>
      </div>
      <input type="range" id="lab-emojis-rango" class="lab-emojis__rango" min="0" max="${NIVELES_EMOJIS.length - 1}" step="1" value="${n}"
        aria-label="Nivel de emojis" aria-valuetext="${esc(NIVELES_EMOJIS[n].nombre)}" style="--lab-pos:${(n / (NIVELES_EMOJIS.length - 1)) * 100}%">
      <div class="lab-emojis__extremos"><span>Sin emojis</span><span>Todos los que quieras</span></div>
      <div class="lab-emojis__favoritos">
        <label for="lab-emojis-favoritos"><strong>Tus emojis favoritos</strong> <span class="text-soft">(opcional)</span></label>
        <div class="lab-emojis__fila">
          <input type="text" id="lab-emojis-favoritos" maxlength="60" autocomplete="off" placeholder="Ej. 🔥 💛 🚀 ✨" value="${esc(emojisFavoritosGuardados())}" aria-describedby="lab-emojis-favoritos-nota">
          <button type="button" class="btn btn--primary" id="lab-emojis-guardar">Guardar</button>
          <button type="button" class="btn btn--ghost" id="lab-emojis-editar">Editar</button>
          <button type="button" class="btn btn--ghost lab-emoji-elegir" id="lab-emojis-elegir" aria-expanded="false" aria-controls="lab-emojis-panel">😊 Elegir</button>
        </div>
        <div class="lab-emoji-panel hidden" id="lab-emojis-panel"></div>
        <p class="text-soft lab-emojis__nota" id="lab-emojis-favoritos-nota"></p>
      </div>
      <p class="text-soft lab-emojis__nota">Los guiones de los videos nunca llevan emojis: se leen en voz alta.</p>
    </div>`;
}

// Campo de emojis favoritos: escribir → Guardar (queda bloqueado) → Editar para cambiarlo.
// «Elegir» (selector con todos los emojis) solo aparece en PC; en celular se usa el teclado.
function conectarEmojisFavoritos(el) {
  const campo = el.querySelector('#lab-emojis-favoritos');
  if (!campo) return;
  const btnGuardar = el.querySelector('#lab-emojis-guardar');
  const btnEditar = el.querySelector('#lab-emojis-editar');
  const btnElegir = el.querySelector('#lab-emojis-elegir');
  const panel = el.querySelector('#lab-emojis-panel');
  const nota = el.querySelector('#lab-emojis-favoritos-nota');
  const NOTA_EDITAR = 'Escribe los emojis que tú usas y presiona Guardar. La IA los usará de preferencia, respetando el nivel de arriba.';
  const NOTA_GUARDADO = 'Guardado ✓ La IA usará estos emojis en tus próximos contenidos. Presiona Editar si quieres cambiarlos.';
  let guardado = !!emojisFavoritosGuardados().trim();

  const cerrarPanel = () => { panel.classList.add('hidden'); btnElegir.setAttribute('aria-expanded', 'false'); };
  const pintar = () => {
    const hayTexto = !!campo.value.trim();
    campo.readOnly = guardado;
    el.querySelector('.lab-emojis__favoritos').classList.toggle('is-guardado', guardado);
    btnGuardar.classList.toggle('hidden', guardado);
    btnGuardar.disabled = !hayTexto;
    btnEditar.classList.toggle('hidden', !guardado);
    btnElegir.classList.toggle('hidden', guardado);
    nota.textContent = guardado ? NOTA_GUARDADO : NOTA_EDITAR;
    if (guardado) cerrarPanel();
  };
  campo.addEventListener('input', () => { btnGuardar.disabled = !campo.value.trim(); });
  campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); btnGuardar.click(); } });
  btnGuardar.addEventListener('click', () => {
    const valor = campo.value.trim().slice(0, 60);
    if (!valor) return;
    campo.value = valor;
    try { localStorage.setItem(claveEmojisFavoritos(), valor); } catch (e) { /* opcional */ }
    guardado = true;
    pintar();
  });
  btnEditar.addEventListener('click', () => {
    guardado = false;
    pintar();
    campo.focus();
    campo.setSelectionRange(campo.value.length, campo.value.length);
  });

  // Selector con todos los emojis (PC)
  let construido = false;
  const construirPanel = () => {
    panel.innerHTML = `
      <div class="lab-emoji-panel__tabs" role="tablist">${EMOJIS_POR_CATEGORIA.map((c, i) => `<button type="button" class="lab-emoji-panel__tab${i === 0 ? ' is-activa' : ''}" data-cat="${i}" role="tab" aria-selected="${i === 0}">${esc(c.nombre)}</button>`).join('')}</div>
      <div class="lab-emoji-panel__grid" role="listbox"></div>`;
    construido = true;
    pintarCategoria(0);
  };
  const pintarCategoria = (i) => {
    panel.querySelectorAll('.lab-emoji-panel__tab').forEach((t) => {
      const activa = Number(t.dataset.cat) === i;
      t.classList.toggle('is-activa', activa);
      t.setAttribute('aria-selected', String(activa));
    });
    panel.querySelector('.lab-emoji-panel__grid').innerHTML = EMOJIS_POR_CATEGORIA[i].emojis.map((e) => `<button type="button" class="lab-emoji-panel__emoji">${e}</button>`).join('');
  };
  btnElegir.addEventListener('click', () => {
    if (!panel.classList.contains('hidden')) { cerrarPanel(); return; }
    if (!construido) construirPanel();
    panel.classList.remove('hidden');
    btnElegir.setAttribute('aria-expanded', 'true');
  });
  panel.addEventListener('click', (ev) => {
    const tab = ev.target.closest('.lab-emoji-panel__tab');
    if (tab) { pintarCategoria(Number(tab.dataset.cat)); return; }
    const op = ev.target.closest('.lab-emoji-panel__emoji');
    if (!op || guardado) return;
    const ini = campo.selectionStart ?? campo.value.length;
    const fin = campo.selectionEnd ?? campo.value.length;
    const nuevo = campo.value.slice(0, ini) + op.textContent + campo.value.slice(fin);
    if (nuevo.length > campo.maxLength) return;
    campo.value = nuevo;
    campo.focus();
    campo.setSelectionRange(ini + op.textContent.length, ini + op.textContent.length);
    btnGuardar.disabled = !campo.value.trim();
  });
  pintar();
}

function conectarBarraEmojis(el) {
  const inp = el.querySelector('#lab-emojis-rango');
  if (!inp) return;
  const mostrar = () => {
    const n = parseInt(inp.value, 10);
    const nivel = NIVELES_EMOJIS[n] || NIVELES_EMOJIS[NIVEL_EMOJIS_INICIAL];
    document.getElementById('lab-emojis-nombre').textContent = nivel.nombre;
    document.getElementById('lab-emojis-muestra').textContent = nivel.muestra;
    inp.setAttribute('aria-valuetext', nivel.nombre);
    inp.style.setProperty('--lab-pos', `${(n / (NIVELES_EMOJIS.length - 1)) * 100}%`);
  };
  conectarEmojisFavoritos(el);
  inp.addEventListener('input', mostrar);
  inp.addEventListener('change', () => { try { localStorage.setItem(claveEmojis(), String(nivelEmojisActual())); } catch (e) { /* opcional */ } });
  mostrar();
}

function htmlEtapas() {
  if (!datos.seccionesAbiertas.length) return '';
  const orden = Object.keys(datos.etapas);
  return `
    <section class="lab-bloque">
      <div class="lab-bloque__cab">
        <h3>Crea tus contenidos</h3>
        <span class="text-soft" id="lab-contador">Generaciones de hoy: ${datos.usosHoy}/${datos.limiteDia}</span>
      </div>
      <p class="text-soft lab-bloque__sub">Un clic por etapa y recibes propuestas listas para editar con tu voz.</p>
      ${htmlBarraEmojis()}
      <div class="lab-etapas">
        ${orden.map((id, n) => {
          const e = datos.etapas[id];
          const abierta = datos.estadoEtapas[id].abierta;
          return `
          <div class="lab-etapa ${abierta ? '' : 'lab-etapa--bloqueada'}" data-etapa="${id}">
            <div class="lab-etapa__num">${n + 1}</div>
            <strong>${esc(e.nombre)}</strong>
            <p class="text-soft">${esc(e.descripcion)}</p>
            <div class="lab-chips">${e.formatos.map(f => `<span class="lab-chip">${esc((datos.formatos[f] || {}).nombre || f)}</span>`).join('')}</div>
            ${!abierta ? `<p class="lab-etapa__estado">🔒 ${esc(textoEstadoEtapa(id))}</p>` : botonesEtapa(id, e)}
          </div>`;
        }).join('')}
      </div>
      <div id="lab-estrategia"></div>
      <div id="lab-pagado"></div>
      <div id="lab-resultado"></div>
    </section>
    <section class="lab-bloque">
      <h3>Mis contenidos anteriores</h3>
      <div id="lab-historial"></div>
    </section>`;
}

function htmlBloqueado() {
  const desde = Math.min(...Object.values(datos.etapas).map(e => e.desdeFase));
  return `
    <section class="lab-bloque lab-bloqueado">
      <div class="lab-bloqueado__icono">🔒</div>
      <h3>Tu Laboratorio IA se activa en la Fase ${desde}</h3>
      <p class="text-soft">Cuando tu copiloto te lleve a esa fase, aquí podrás crear tus contenidos con un clic. Mientras tanto, publica tus hitos: mientras más cuentes de tu proceso, más a tu medida será todo.</p>
    </section>`;
}

function pintarAlumno() {
  const el = rootEl();
  panelAbierto = '';
  el.innerHTML = htmlCabeceraAlumno() + (datos.seccionesAbiertas.length ? htmlFichas() + htmlEtapas() : htmlBloqueado());
  conectarAlumno(el);
  const hist = document.getElementById('lab-historial');
  if (hist && alumnoIdActual) cargarHistorial(alumnoIdActual, hist, datos.formatos, true);
}

/* --- Editor de la ficha --- */

function htmlEditorFicha(seccion, respuestas, vacias) {
  const p = datos.preguntas[seccion];
  return `
    ${vacias.length ? `<p class="lab-aviso">La IA no tenía información suficiente para ${vacias.length === 1 ? 'una pregunta' : vacias.length + ' preguntas'}: complétalas tú (están marcadas).</p>` : ''}
    ${p.items.map(i => `
      <div class="field lab-campo ${vacias.includes(i.id) ? 'lab-campo--vacio' : ''}">
        <label for="lab-r-${seccion}-${esc(i.id)}">${esc(i.pregunta)}${i.opcional ? ' <span class="text-soft">(opcional)</span>' : ''}</label>
        ${i.ayuda ? `<div class="lab-campo__ayuda text-soft">${esc(i.ayuda)}</div>` : ''}
        ${i.tipo === 'fecha' || i.tipo === 'hora'
          ? `<input type="${i.tipo === 'fecha' ? 'date' : 'time'}" id="lab-r-${seccion}-${esc(i.id)}" data-id="${esc(i.id)}" value="${esc(respuestas[i.id] || '')}" style="max-width:220px;">`
          : `<textarea id="lab-r-${seccion}-${esc(i.id)}" data-id="${esc(i.id)}" rows="4" maxlength="2500">${esc(respuestas[i.id] || '')}</textarea>`}
      </div>`).join('')}
    <p class="lab-error hidden" data-error></p>
    <div class="lab-ficha__acciones">
      <button type="button" class="btn btn--primary" data-guardar-ficha="${seccion}">Guardar y aprobar</button>
      <button type="button" class="btn btn--ghost" data-rehacer-ficha="${seccion}">Rehacer borrador con IA</button>
      <button type="button" class="btn btn--ghost" data-cerrar-ficha="${seccion}">Cerrar</button>
    </div>`;
}

async function abrirEditorFicha(seccion, forzarBorrador) {
  const editor = document.querySelector(`[data-editor="${seccion}"]`);
  if (!editor) return;
  editor.classList.remove('hidden');
  const guardada = datos.fichas[seccion];
  let respuestas = {};
  let vacias = [];
  if (guardada && guardada.aprobada && !forzarBorrador) {
    (guardada.items || []).forEach(i => { respuestas[i.id] = i.respuesta; });
    // Preguntas nuevas que el Director agregó después de aprobar
    vacias = datos.preguntas[seccion].items.filter(i => !i.opcional && !respuestas[i.id]).map(i => i.id);
  } else {
    editor.innerHTML = '<div class="lab-cargando"><span class="lab-spinner"></span> Armando tu borrador con lo que ya compartiste… (puede tardar unos segundos)</div>';
    try {
      const r = await pedirBorradorFicha(conFase({ seccion }));
      respuestas = r.data.respuestas || {};
      vacias = datos.preguntas[seccion].items.filter(i => !i.opcional && !respuestas[i.id]).map(i => i.id);
    } catch (err) {
      respuestas = {};
      vacias = [];
      editor.innerHTML = `<p class="lab-aviso">${esc(mensajeError(err, 'No se pudo armar el borrador.'))} Puedes completar la ficha a mano.</p>`;
      editor.insertAdjacentHTML('beforeend', htmlEditorFicha(seccion, respuestas, vacias));
      conectarEditor(editor, seccion);
      return;
    }
  }
  editor.innerHTML = htmlEditorFicha(seccion, respuestas, vacias);
  conectarEditor(editor, seccion);
}

function conectarEditor(editor, seccion) {
  const errorEl = editor.querySelector('[data-error]');
  editor.querySelector('[data-cerrar-ficha]').addEventListener('click', () => { editor.classList.add('hidden'); editor.innerHTML = ''; });
  editor.querySelector('[data-rehacer-ficha]').addEventListener('click', () => {
    if (confirm('Se reemplazarán los textos de esta ficha por un borrador nuevo de la IA. ¿Continuar?')) abrirEditorFicha(seccion, true);
  });
  const btnGuardar = editor.querySelector('[data-guardar-ficha]');
  btnGuardar.addEventListener('click', async () => {
    errorEl.classList.add('hidden');
    const respuestas = {};
    editor.querySelectorAll('textarea[data-id], input[data-id]').forEach(t => { respuestas[t.dataset.id] = t.value.trim(); });
    const falta = datos.preguntas[seccion].items.find(i => !i.opcional && !respuestas[i.id]);
    if (falta) {
      errorEl.textContent = `Falta responder: «${falta.pregunta}»`;
      errorEl.classList.remove('hidden');
      return;
    }
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando…';
    try {
      await guardarFichaServidor(conFase({ seccion, respuestas }));
      await recargar();
      const aviso = document.createElement('div');
      aviso.className = 'lab-toast';
      aviso.textContent = 'Ficha aprobada ✓ Ya puedes generar contenidos.';
      rootEl().prepend(aviso);
      setTimeout(() => aviso.remove(), 3500);
    } catch (err) {
      errorEl.textContent = mensajeError(err, 'No se pudo guardar. Intenta de nuevo.');
      errorEl.classList.remove('hidden');
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Guardar y aprobar';
    }
  });
}

/* --- Generar --- */

async function generarEtapa(etapaId, btn, extra) {
  const raiz = rootEl();
  if (hayEdicionesSinGuardar(raiz)) {
    if (!confirm('Tienes cambios sin guardar en una propuesta. Si generas ahora se perderán. ¿Continuar?')) return;
    descartarEdiciones(raiz);
  }
  const resultado = document.getElementById('lab-resultado');
  document.querySelectorAll('[data-generar], [data-generar-pagado]').forEach(b => { b.disabled = true; });
  const textoOriginal = btn.textContent;
  btn.textContent = 'Creando…';
  resultado.innerHTML = '<div class="lab-cargando"><span class="lab-spinner"></span> Creando tus contenidos con tu voz y tu Cliente Soñado… (puede tardar hasta un minuto)</div>';
  resultado.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const r = await generarContenidos(conFase({ etapa: etapaId, emojis: nivelEmojisActual(), emojisFavoritos: emojisFavoritosActual(), ...(extra || {}) }));
    const g = r.data;
    cerrarPaneles();   // el panel desde el que se generó se minimiza; queda solo el resultado
    datos.usosHoy += 1;
    const contador = document.getElementById('lab-contador');
    if (contador) contador.textContent = `Generaciones de hoy: ${datos.usosHoy}/${datos.limiteDia}`;
    resultado.innerHTML = `
      <details class="lab-historial__item lab-acordeon lab-acordeon--nuevo" open>
        <summary><strong>${esc(g.etapaNombre)}${g.flujoNombre ? ` · Flujo: ${esc(g.flujoNombre)}` : g.tipoContenido === 'ideas' ? ': ideas para tu grupo' : ': tus propuestas'}</strong><span class="lab-acordeon__nuevo">Nuevo</span></summary>
        <div class="lab-historial__cuerpo">
          <p class="lab-acordeon__sub">Edítalas con tu estilo o llévalas a tus mentores para pulirlas.</p>
          ${g.incompleta ? '<p class="lab-aviso">Uno de los formatos no se pudo generar esta vez. Puedes volver a intentarlo.</p>' : ''}
          ${htmlPiezas(g.piezas, datos.formatos, { editable: true, flujo: g.flujoNombre || '' })}
        </div>
      </details>`;
    conectarPiezas(resultado, g.piezas, { editable: true, guardar: (i, cambios) => guardarEdicion(alumnoIdActual, g.id, i, cambios) });
    enlazarAcordeon(raiz);
    cerrarOtrasPeticiones(raiz, resultado.querySelector('details'));   // el nuevo queda abierto y los demás se cierran
    const hist = document.getElementById('lab-historial');
    if (hist && alumnoIdActual) cargarHistorial(alumnoIdActual, hist, datos.formatos, true);
  } catch (err) {
    resultado.innerHTML = `<p class="lab-error">${esc(mensajeError(err, 'No se pudieron generar los contenidos. Intenta de nuevo.'))}</p>`;
  } finally {
    document.querySelectorAll('[data-generar], [data-generar-pagado]').forEach(b => { b.disabled = false; });
    btn.textContent = textoOriginal;
  }
}

function conectarAlumno(el) {
  conectarBarraEmojis(el);
  el.querySelectorAll('[data-abrir-ficha]').forEach(b => b.addEventListener('click', () => {
    const editor = el.querySelector(`[data-editor="${b.dataset.abrirFicha}"]`);
    if (editor && !editor.classList.contains('hidden')) { editor.classList.add('hidden'); editor.innerHTML = ''; return; }
    abrirEditorFicha(b.dataset.abrirFicha, false);
  }));
  el.querySelectorAll('[data-generar]').forEach(b => b.addEventListener('click', () => generarEtapa(b.dataset.generar, b)));
  el.querySelectorAll('[data-estrategia]').forEach(b => b.addEventListener('click', () => abrirEstrategia()));
  el.querySelectorAll('[data-pagado]').forEach(b => b.addEventListener('click', () => abrirPagado()));
  el.querySelectorAll('[data-organico]').forEach(b => b.addEventListener('click', () => abrirOrganico('encuentro')));
  el.querySelectorAll('[data-flujo]').forEach(b => b.addEventListener('click', () => iniciarFlujo(b.dataset.flujo, b)));
  el.querySelectorAll('[data-estrategia-open]').forEach(b => b.addEventListener('click', () => abrirEstrategiaOpen()));
  el.querySelectorAll('[data-ideas-open]').forEach(b => b.addEventListener('click', () => { cerrarPaneles(); generarEtapa('encuentro', b, { ideas: true }); }));
  el.querySelectorAll('[data-estrategia-venta]').forEach(b => b.addEventListener('click', () => abrirEstrategiaVenta()));
  el.querySelectorAll('[data-pagado-venta]').forEach(b => b.addEventListener('click', () => abrirPagado('venta')));
  el.querySelectorAll('[data-organico-venta]').forEach(b => b.addEventListener('click', () => abrirOrganico('venta')));
}

async function recargar() {
  const r = await abrirLaboratorio(conFase({}));
  datos = r.data;
  pintarAlumno();
}

async function cargarComoAlumno() {
  const el = rootEl();
  el.innerHTML = '<div class="lab-cargando"><span class="lab-spinner"></span> Abriendo tu Laboratorio…</div>';
  try {
    const mapa = await get(ref(db, `alumnoPorAuthUid/${auth.currentUser.uid}`));
    alumnoIdActual = mapa.exists() ? String(mapa.val()) : null;
    const r = await abrirLaboratorio(conFase({}));
    datos = r.data;
    const perfil = datos.perfil || {};
    fijarContextoVista({ nombre: perfil.nombre || datos.primerNombre || '', fotoUrl: perfil.fotoUrl || '' });
    fijarWhatsappVenta((datos.estrategiaVenta || {}).whatsapp);
    await cargarImagenesVista();
    pintarAlumno();
  } catch (err) {
    el.innerHTML = `<div class="panel"><p class="lab-error">${esc(mensajeError(err, 'No se pudo abrir el Laboratorio. Intenta de nuevo.'))}</p></div>`;
  }
}

/* ============================================================
   DIRECTOR Y COPILOTO (solo lectura)
   ============================================================ */

let listaStaff = [];
const FORMATOS_STAFF = { reel: { nombre: 'Reels' }, carrusel: { nombre: 'Carruseles' }, dm: { nombre: 'DMs' }, whatsapp: { nombre: 'WhatsApp' }, imagen: { nombre: 'Imágenes estáticas' }, historia: { nombre: 'Historias' }, email: { nombre: 'Emails' }, idea: { nombre: 'Ideas para el grupo' } };

function faseDe(ciclo) {
  if (!ciclo) return 0;
  if (ciclo.estadoAlumno === 'egresado') return 4;
  const m = String(ciclo.faseMetodologia || '').match(/\d/);
  return m ? Math.min(4, parseInt(m[0], 10)) : 0;
}

async function cargarComoStaff(role) {
  const el = rootEl();
  el.innerHTML = '<p class="text-soft">Cargando alumnos…</p>';
  try {
    const uid = auth.currentUser.uid;
    const [alumnosSnap, ciclosSnap, perfilSnap] = await Promise.all([
      get(ref(db, 'alumnos')), get(ref(db, 'ciclos')), get(ref(db, `usuarios/${uid}/coachCabeceraBegin`))
    ]);
    const alumnos = alumnosSnap.exists() ? alumnosSnap.val() : {};
    const ciclos = ciclosSnap.exists() ? ciclosSnap.val() : {};
    const cabecera = perfilSnap.exists() && perfilSnap.val() === true;
    listaStaff = [];
    Object.entries(alumnos).forEach(([id, a]) => {
      if (!a || a.esDemo || id.startsWith('demo-')) return;
      const c = a.cicloActualId ? ciclos[a.cicloActualId] : null;
      if (!c || c.esDemo) return;
      const esMio = c.coachId === uid || (cabecera && !c.coachId && ['begin', 'open'].includes(c.programa));
      if (role === 'coach' && !esMio) return;
      listaStaff.push({ id, nombre: `${a.nombre || ''} ${a.apellido || ''}`.trim() || id, programa: c.programa || '', fase: faseDe(c) });
    });
    listaStaff.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    pintarStaff();
  } catch (err) {
    console.error('Laboratorio: no se pudo cargar la lista de alumnos:', err);
    el.innerHTML = '<div class="panel"><p class="lab-error">No se pudo cargar la lista de alumnos.</p></div>';
  }
}

function pintarStaff() {
  const el = rootEl();
  el.innerHTML = `
    <div class="lab-staff">
      <aside class="lab-staff__lista panel">
        <input type="search" id="lab-buscar" placeholder="Buscar alumno…" autocomplete="off">
        <div id="lab-lista"></div>
      </aside>
      <div class="lab-staff__detalle" id="lab-detalle"><p class="text-soft">Elige un alumno para ver su ficha y los contenidos que ha generado.</p></div>
    </div>`;
  const pintarLista = () => {
    const q = (document.getElementById('lab-buscar').value || '').toLowerCase();
    const filas = listaStaff.filter(a => !q || a.nombre.toLowerCase().includes(q));
    document.getElementById('lab-lista').innerHTML = filas.length
      ? filas.map(a => `<button type="button" class="lab-fila" data-id="${esc(a.id)}"><span>${esc(a.nombre)}</span><span class="text-soft">${esc(a.programa.toUpperCase())} · Fase ${a.fase || '—'}</span></button>`).join('')
      : '<p class="text-soft">Sin resultados.</p>';
    document.querySelectorAll('.lab-fila').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.lab-fila').forEach(x => x.classList.toggle('is-activa', x === b));
      verAlumno(b.dataset.id);
    }));
  };
  document.getElementById('lab-buscar').addEventListener('input', pintarLista);
  pintarLista();
}

async function verAlumno(alumnoId) {
  const det = document.getElementById('lab-detalle');
  const a = listaStaff.find(x => x.id === alumnoId);
  det.innerHTML = '<p class="text-soft">Cargando…</p>';
  let fichas = {};
  try {
    const snap = await get(ref(db, `laboratorioIA/fichas/${alumnoId}`));
    fichas = snap.exists() ? snap.val() : {};
  } catch (err) { /* se muestra vacío */ }
  const secciones = ['fase1', 'fase2', 'fase3', 'fase4'].filter(s => fichas[s]);
  det.innerHTML = `
    <h3>${esc(a ? a.nombre : '')}</h3>
    <section class="lab-bloque">
      <h4>Ficha</h4>
      ${secciones.length ? secciones.map(s => `
        <div class="lab-ficha lab-ficha--lectura">
          <div class="lab-ficha__cab"><strong>${esc(fichas[s].titulo || s)}</strong><span class="lab-badge ${fichas[s].aprobada ? 'lab-badge--ok' : 'lab-badge--pend'}">${fichas[s].aprobada ? 'Aprobada ✓' : 'Sin aprobar'}</span></div>
          ${(fichas[s].items || []).map(i => `<div class="lab-lectura"><div class="lab-seccion__etiqueta">${esc(i.pregunta)}</div><div class="lab-seccion__texto">${esc(i.respuesta || '—')}</div></div>`).join('')}
        </div>`).join('') : '<p class="text-soft">Todavía no ha aprobado su ficha.</p>'}
    </section>
    <section class="lab-bloque">
      <h4>Contenidos generados</h4>
      <div id="lab-historial-staff"></div>
    </section>`;
  let fotoUrl = '';
  try {
    const f = await get(ref(db, `alumnos/${alumnoId}/fotoUrl`));
    fotoUrl = f.exists() ? f.val() : '';
  } catch (err) { /* sin foto: se muestran las iniciales */ }
  await cargarImagenesVista();
  fijarContextoVista({ nombre: a ? a.nombre : '', fotoUrl });
  cargarHistorial(alumnoId, document.getElementById('lab-historial-staff'), FORMATOS_STAFF);
}

/* ============================================================
   Punto de entrada
   ============================================================ */

export async function cargarLaboratorio() {
  const role = getCurrentRole();
  const el = rootEl();
  if (!el) return;
  if (role === 'alumno') return cargarComoAlumno();
  if (role === 'director' || role === 'coach') return cargarComoStaff(role);
  el.innerHTML = '';
}

document.querySelectorAll('.nav-item[data-nav="laboratorio-ia"]').forEach(item => {
  item.addEventListener('click', cargarLaboratorio);
});
