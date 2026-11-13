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
import { ref, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";
import { getCurrentRole, esModoDemo } from './main.js';
import { getFaseDemo } from './demo.js';

const functions = getFunctions(app);
const abrirLaboratorio = httpsCallable(functions, 'laboratorioAbrir', { timeout: 120000 });
const pedirBorradorFicha = httpsCallable(functions, 'laboratorioBorradorFicha', { timeout: 120000 });
const guardarFichaServidor = httpsCallable(functions, 'laboratorioGuardarFicha', { timeout: 60000 });
const generarContenidos = httpsCallable(functions, 'laboratorioGenerar', { timeout: 175000 });

// En modo demo se manda la fase que el banner dice simular; el servidor solo la acepta si la cuenta es el demo.
const conFase = (datos) => (esModoDemo() ? { ...datos, faseDemo: getFaseDemo() } : datos);

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

/* ---------------- Piezas de contenido (compartido alumno / staff) ---------------- */

function textoParaCopiar(pieza) {
  return [pieza.titulo, ...(pieza.secciones || []).map(s => `${s.etiqueta ? s.etiqueta + ':\n' : ''}${s.texto}`)].join('\n\n');
}

async function copiarAlPortapapeles(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.cssText = 'position:fixed; opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* sin permiso */ }
    ta.remove();
    return ok;
  }
}

export function htmlPiezas(piezas, nombresFormato) {
  const porFormato = {};
  (piezas || []).forEach((p, i) => { (porFormato[p.formato] = porFormato[p.formato] || []).push({ p, i }); });
  return Object.keys(porFormato).map(f => `
    <div class="lab-formato">
      <h4 class="lab-formato__titulo">${esc((nombresFormato && nombresFormato[f] && nombresFormato[f].nombre) || f)}</h4>
      ${porFormato[f].map(({ p, i }) => `
        <article class="lab-pieza" data-pieza="${i}">
          <div class="lab-pieza__cab">
            <strong>${esc(p.titulo)}</strong>
            <button type="button" class="btn btn--ghost lab-btn-copiar" data-copiar="${i}">Copiar</button>
          </div>
          ${(p.secciones || []).map(s => `
            <div class="lab-seccion">
              ${s.etiqueta ? `<div class="lab-seccion__etiqueta">${esc(s.etiqueta)}</div>` : ''}
              <div class="lab-seccion__texto">${esc(s.texto)}</div>
            </div>`).join('')}
        </article>`).join('')}
    </div>`).join('');
}

export function conectarCopiar(contenedor, piezas) {
  contenedor.querySelectorAll('[data-copiar]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await copiarAlPortapapeles(textoParaCopiar(piezas[Number(btn.dataset.copiar)]));
      btn.textContent = ok ? 'Copiado ✓' : 'No se pudo copiar';
      setTimeout(() => { btn.textContent = 'Copiar'; }, 1800);
    });
  });
}

/* ---------------- Historial (alumno y staff) ---------------- */

async function cargarHistorial(alumnoId, contenedor, nombresFormato) {
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
    <details class="lab-historial__item">
      <summary><strong>${esc(g.etapaNombre || g.etapa || '')}</strong> · ${esc(fechaLegible(g.creadoEn))} · ${(g.piezas || []).length} propuestas</summary>
      <div class="lab-historial__cuerpo" data-g="${n}">${htmlPiezas(g.piezas, nombresFormato)}</div>
    </details>`).join('');
  contenedor.querySelectorAll('[data-g]').forEach(div => conectarCopiar(div, lista[Number(div.dataset.g)].piezas || []));
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
  return 'Primero aprueba tu ficha.';
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
      <div class="lab-etapas">
        ${orden.map((id, n) => {
          const e = datos.etapas[id];
          const abierta = datos.estadoEtapas[id].abierta;
          return `
          <div class="lab-etapa ${abierta ? '' : 'lab-etapa--bloqueada'}">
            <div class="lab-etapa__num">${n + 1}</div>
            <strong>${esc(e.nombre)}</strong>
            <p class="text-soft">${esc(e.descripcion)}</p>
            <div class="lab-chips">${e.formatos.map(f => `<span class="lab-chip">${esc((datos.formatos[f] || {}).nombre || f)}</span>`).join('')}</div>
            ${abierta
              ? `<button type="button" class="btn btn--primary" data-generar="${id}">Generar contenidos</button>`
              : `<p class="lab-etapa__estado">🔒 ${esc(textoEstadoEtapa(id))}</p>`}
          </div>`;
        }).join('')}
      </div>
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
  el.innerHTML = htmlCabeceraAlumno() + (datos.seccionesAbiertas.length ? htmlFichas() + htmlEtapas() : htmlBloqueado());
  conectarAlumno(el);
  const hist = document.getElementById('lab-historial');
  if (hist && alumnoIdActual) cargarHistorial(alumnoIdActual, hist, datos.formatos);
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
        <textarea id="lab-r-${seccion}-${esc(i.id)}" data-id="${esc(i.id)}" rows="4" maxlength="2500">${esc(respuestas[i.id] || '')}</textarea>
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
    editor.querySelectorAll('textarea[data-id]').forEach(t => { respuestas[t.dataset.id] = t.value.trim(); });
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

async function generarEtapa(etapaId, btn) {
  const resultado = document.getElementById('lab-resultado');
  document.querySelectorAll('[data-generar]').forEach(b => { b.disabled = true; });
  const textoOriginal = btn.textContent;
  btn.textContent = 'Creando…';
  resultado.innerHTML = '<div class="lab-cargando"><span class="lab-spinner"></span> Creando tus contenidos con tu voz y tu Cliente Soñado… (puede tardar hasta un minuto)</div>';
  resultado.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const r = await generarContenidos(conFase({ etapa: etapaId }));
    const g = r.data;
    datos.usosHoy += 1;
    const contador = document.getElementById('lab-contador');
    if (contador) contador.textContent = `Generaciones de hoy: ${datos.usosHoy}/${datos.limiteDia}`;
    resultado.innerHTML = `
      <div class="lab-resultado__cab"><h3>${esc(g.etapaNombre)}: tus propuestas</h3><span class="text-soft">Edítalas con tu estilo o llévalas a tus mentores para pulirlas.</span></div>
      ${g.incompleta ? '<p class="lab-aviso">Uno de los formatos no se pudo generar esta vez. Puedes volver a intentarlo.</p>' : ''}
      ${htmlPiezas(g.piezas, datos.formatos)}`;
    conectarCopiar(resultado, g.piezas);
    const hist = document.getElementById('lab-historial');
    if (hist && alumnoIdActual) cargarHistorial(alumnoIdActual, hist, datos.formatos);
  } catch (err) {
    resultado.innerHTML = `<p class="lab-error">${esc(mensajeError(err, 'No se pudieron generar los contenidos. Intenta de nuevo.'))}</p>`;
  } finally {
    document.querySelectorAll('[data-generar]').forEach(b => { b.disabled = false; });
    btn.textContent = textoOriginal;
  }
}

function conectarAlumno(el) {
  el.querySelectorAll('[data-abrir-ficha]').forEach(b => b.addEventListener('click', () => {
    const editor = el.querySelector(`[data-editor="${b.dataset.abrirFicha}"]`);
    if (editor && !editor.classList.contains('hidden')) { editor.classList.add('hidden'); editor.innerHTML = ''; return; }
    abrirEditorFicha(b.dataset.abrirFicha, false);
  }));
  el.querySelectorAll('[data-generar]').forEach(b => b.addEventListener('click', () => generarEtapa(b.dataset.generar, b)));
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
    pintarAlumno();
  } catch (err) {
    el.innerHTML = `<div class="panel"><p class="lab-error">${esc(mensajeError(err, 'No se pudo abrir el Laboratorio. Intenta de nuevo.'))}</p></div>`;
  }
}

/* ============================================================
   DIRECTOR Y COPILOTO (solo lectura)
   ============================================================ */

let listaStaff = [];
const FORMATOS_STAFF = { reel: { nombre: 'Reels' }, carrusel: { nombre: 'Carruseles' }, dm: { nombre: 'DMs' }, whatsapp: { nombre: 'WhatsApp' } };

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
  const secciones = ['fase1', 'fase2', 'fase3'].filter(s => fichas[s]);
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
