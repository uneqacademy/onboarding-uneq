/* ============================================================
   laboratorio-uneq.js — "Laboratorio UNEQ"
   ============================================================
   La tecnología del Laboratorio IA, pero para el contenido de la propia marca UNEQ (@somosuneq).
   La ven la Directora Académica (y la Sub-directora) y las personas del equipo a las que ella les da acceso
   (laboratorioUneq/acceso/{uid}). Todas trabajan sobre la MISMA ficha de marca, el MISMO historial y la MISMA cuenta de
   Instagram. Sin fases, sin ficha por aprobar: se elige la etapa del funnel, los formatos y de qué trata el contenido.

   La IA corre en el servidor (functions/laboratorio-uneq.js): aquí se deja una solicitud en
   laboratorioUneqSolicitudes/{uid}/{id} y el servidor responde en .../respuesta. Todo texto que viene de la base o de la IA
   se escapa antes de mostrarse. */

import { db, auth } from './firebase-config.js';
import { ref, get, set, update, push, remove, onValue, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { escaparHtml } from './util-html.js';
import { getCurrentRole, getCurrentUserNombre } from './main.js';
import { cargarPanelInstagram } from './instagram-panel.js';
import { usarCuentaInstagram } from './instagram-carrusel.js';
import { htmlPiezas, conectarPiezas, fijarContextoVista, fijarImagenesVista, enlazarAcordeon, cerrarOtrasPeticiones, hayEdicionesSinGuardar, descartarEdiciones } from './laboratorio-ia-vista.js';

const esc = escaparHtml;
const raizEl = () => document.getElementById('luneq-contenido');

const ETAPAS = [
  { id: 'atraccion', nombre: 'Atracción', texto: 'Llegar a personas que aún no nos conocen.' },
  { id: 'conexion', nombre: 'Conexión', texto: 'Generar confianza con quienes ya nos siguen.' },
  { id: 'encuentro', nombre: 'Encuentro', texto: 'Invitar a una sesión, evento o conversación.' },
  { id: 'venta', nombre: 'Venta', texto: 'Llevar a decidir por un programa de UNEQ.' }
];
const FORMATOS = [
  { id: 'reel', nombre: 'Reels' },
  { id: 'carrusel', nombre: 'Carruseles' },
  { id: 'imagen', nombre: 'Imágenes y anuncios' },
  { id: 'historia', nombre: 'Historias' },
  { id: 'dm', nombre: 'Mensajes directos (DM)' },
  { id: 'whatsapp', nombre: 'WhatsApp' },
  { id: 'email', nombre: 'Emails' }
];
const NOMBRES_FORMATO = Object.fromEntries(FORMATOS.map(f => [f.id, { nombre: f.nombre }]));
const CAMPOS_MARCA = [
  ['esencia', 'Quiénes somos y para qué existimos', 'Qué es UNEQ, qué transformación logra y por qué existe.'],
  ['voz', 'Voz y tono de la marca', 'Cómo suena UNEQ: cercana, directa, profesional… Palabras que sí usamos.'],
  ['publico', 'A quién le hablamos (Cliente Soñado de UNEQ)', 'Quién es, qué le duele, qué desea y qué le impide avanzar.'],
  ['ofertas', 'Programas y ofertas que promovemos', 'Nombre, para quién es, qué incluye y a dónde se invita (link, sesión, WhatsApp).'],
  ['metodologia', 'Metodología y conceptos propios', 'Ej. Efecto 2E, las fases, el funnel. Cómo los explicamos en simple.'],
  ['pruebas', 'Resultados, casos y testimonios que podemos mencionar', 'Solo lo que tenemos permiso de contar.'],
  ['evitar', 'Qué evitar', 'Palabras, promesas, temas o formas de decir que no queremos.']
];
const NIVELES_EMOJIS = ['Sin emojis', 'Muy pocos', 'Moderados', 'Bastantes', 'Todos los que quieras'];
const CLAVE_EMOJIS = 'uneq_luneq_emojis';
const CLAVE_EMOJIS_FAV = 'uneq_luneq_emojis_fav';

let acceso = false;          // ¿puede usar el Laboratorio UNEQ?
let puedeAsignar = false;    // ¿puede decidir quién tiene acceso? (Directora Académica y Sub-directora)

function mensajeError(err, porDefecto) {
  const m = err && err.message ? String(err.message) : '';
  return m && !/^internal$/i.test(m) ? m : (porDefecto || 'Algo salió mal. Intenta de nuevo.');
}
function fechaLegible(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
}
function guardado(clave, porDefecto) { try { const v = localStorage.getItem(clave); return v === null ? porDefecto : v; } catch (err) { return porDefecto; } }
function guardar(clave, valor) { try { localStorage.setItem(clave, valor); } catch (err) { /* sin almacenamiento: no pasa nada */ } }

/* ---------------- Quién ve la sección (menú) ---------------- */

window.addEventListener('uneq:rol-aplicado', async (e) => {
  const role = e.detail && e.detail.role;
  const nav = document.querySelector('.nav-item[data-nav="laboratorio-uneq"]');
  acceso = false; puedeAsignar = false;
  if (role === 'director') { acceso = true; puedeAsignar = true; }
  else if ((role === 'coach' || role === 'mentor') && auth.currentUser) {
    try { acceso = (await get(ref(db, `laboratorioUneq/acceso/${auth.currentUser.uid}`))).val() === true; } catch (err) { acceso = false; }
  }
  if (nav) nav.classList.toggle('hidden', !acceso);
});

/* ---------------- Pedidos al servidor (solicitud en la base + respuesta) ---------------- */

function pedir(accion, datos, esperaMs = 200000) {
  const u = auth.currentUser;
  if (!u) return Promise.reject(new Error('Tu sesión se cerró. Vuelve a entrar.'));
  const nodo = push(ref(db, `laboratorioUneqSolicitudes/${u.uid}`));
  const ruta = `laboratorioUneqSolicitudes/${u.uid}/${nodo.key}`;
  return new Promise((resolve, reject) => {
    let cerrado = false, dejarDeEscuchar = () => {};
    const cierre = setTimeout(() => fin(new Error('La IA tardó demasiado en responder. Revisa el historial o intenta de nuevo.')), esperaMs);
    function fin(err, respuesta) {
      if (cerrado) return;
      cerrado = true; clearTimeout(cierre); dejarDeEscuchar();
      remove(ref(db, ruta)).catch(() => {});
      if (err) reject(err); else resolve(respuesta);
    }
    set(nodo, { accion, datos: datos || {}, creada: Date.now() }).then(() => {
      dejarDeEscuchar = onValue(ref(db, `${ruta}/respuesta`), snap => {
        const r = snap.val();
        if (!r) return;
        if (r.ok) fin(null, r.datos || {}); else fin(new Error(r.mensaje || 'No se pudo completar la acción.'));
      });
      if (cerrado) dejarDeEscuchar();
    }).catch(err => fin(err));
  });
}

/* ---------------- Pantalla ---------------- */

async function cargarImagenesVista() {
  try {
    const snap = await get(ref(db, 'laboratorioIA/vistaPrevia/imagenes'));
    fijarImagenesVista(snap.exists() ? Object.values(snap.val()).map(x => x && x.url) : []);
  } catch (err) { fijarImagenesVista([]); }
}

function htmlEtapas() {
  return ETAPAS.map((e, n) => `
    <label class="luneq-etapa">
      <input type="radio" name="luneq-etapa" value="${e.id}"${n === 0 ? ' checked' : ''}>
      <span class="luneq-etapa__caja"><strong>${esc(e.nombre)}</strong><span>${esc(e.texto)}</span></span>
    </label>`).join('');
}
function htmlFormatos() {
  return FORMATOS.map(f => `
    <div class="luneq-formato">
      <label class="luneq-formato__check"><input type="checkbox" data-formato="${f.id}"${f.id === 'carrusel' ? ' checked' : ''}> ${esc(f.nombre)}</label>
      <label class="luneq-formato__cant">Cantidad
        <select data-cantidad="${f.id}">${[1, 2, 3, 4].map(n => `<option value="${n}"${n === 2 ? ' selected' : ''}>${n}</option>`).join('')}</select>
      </label>
    </div>`).join('');
}

function pintarBase() {
  const nivel = Math.min(4, Math.max(0, Number(guardado(CLAVE_EMOJIS, '2')) || 2));
  raizEl().innerHTML = `
    <p class="text-soft luneq-intro">Aquí el equipo crea el contenido de <strong>UNEQ (@somosuneq)</strong> con la misma tecnología del Laboratorio IA. Todo lo que se crea queda en el historial compartido y se publica en la cuenta de UNEQ.</p>

    <section class="lab-bloque luneq-crear">
      <h3>Crear contenido</h3>
      <p class="luneq-paso"><span>1</span> ¿En qué etapa del funnel está este contenido?</p>
      <div class="luneq-etapas">${htmlEtapas()}</div>
      <p class="luneq-paso"><span>2</span> ¿Qué formatos quieres? <em class="text-soft">(puedes elegir varios)</em></p>
      <div class="luneq-formatos">${htmlFormatos()}</div>
      <p class="luneq-paso"><span>3</span> ¿De qué trata?</p>
      <label class="luneq-campo">Tema o idea
        <textarea id="luneq-tema" rows="4" maxlength="1500" placeholder="Ej. Por qué la mayoría de los emprendedores no vende aunque tenga buen producto"></textarea>
      </label>
      <label class="luneq-campo">Objetivo <span class="text-soft">(opcional)</span>
        <input type="text" id="luneq-objetivo" maxlength="500" placeholder="Ej. Que reserven un lugar en la sesión del jueves">
      </label>
      <div class="luneq-emojis">
        <label class="luneq-campo">Nivel de emojis: <strong id="luneq-emojis-nombre">${esc(NIVELES_EMOJIS[nivel])}</strong>
          <input type="range" id="luneq-emojis" min="0" max="4" step="1" value="${nivel}" aria-label="Nivel de emojis">
        </label>
        <label class="luneq-campo">Emojis favoritos de UNEQ <span class="text-soft">(opcional)</span>
          <input type="text" id="luneq-emojis-fav" maxlength="60" autocomplete="off" placeholder="Ej. 🔥 💛 🚀" value="${esc(guardado(CLAVE_EMOJIS_FAV, ''))}">
        </label>
        <p class="text-soft lab-emojis__nota">Los guiones de los videos nunca llevan emojis: se leen en voz alta.</p>
      </div>
      <div class="luneq-acciones"><button type="button" class="btn btn--primary" id="luneq-crear">Crear contenido</button></div>
      <div id="luneq-resultado"></div>
    </section>

    <section class="lab-bloque">
      <h3>Historial del equipo</h3>
      <p class="text-soft lab-bloque__sub">Lo último que creó cualquier persona del equipo. Puedes editarlo, copiarlo o diseñarlo y publicarlo.</p>
      <div id="luneq-historial"></div>
    </section>

    <details class="lab-bloque luneq-det" id="luneq-marca-det">
      <summary><strong>Ficha de marca de UNEQ</strong> <span class="text-soft">Lo que la IA sabe de nosotros</span></summary>
      <div id="luneq-marca"><p class="text-soft">Cargando…</p></div>
    </details>

    ${puedeAsignar ? `<details class="lab-bloque luneq-det" id="luneq-equipo-det">
      <summary><strong>Equipo con acceso</strong> <span class="text-soft">Quién puede usar el Laboratorio UNEQ</span></summary>
      <div id="luneq-equipo"><p class="text-soft">Cargando…</p></div>
    </details>` : ''}`;

  const rango = document.getElementById('luneq-emojis');
  rango.addEventListener('input', () => {
    document.getElementById('luneq-emojis-nombre').textContent = NIVELES_EMOJIS[Number(rango.value)];
    guardar(CLAVE_EMOJIS, rango.value);
  });
  document.getElementById('luneq-emojis-fav').addEventListener('change', (e) => guardar(CLAVE_EMOJIS_FAV, e.target.value.trim().slice(0, 60)));
  document.getElementById('luneq-crear').addEventListener('click', crear);
}

/* ---------------- Crear ---------------- */

function guardarEdicion(genId, i, cambios) {
  return update(ref(db, `laboratorioUneq/generaciones/${genId}/piezas/${i}`), { ...cambios, editadoEn: Date.now() });
}

function leerPedido() {
  const marcados = [...document.querySelectorAll('[data-formato]:checked')].map(c => c.dataset.formato);
  const cantidades = {};
  marcados.forEach(f => { cantidades[f] = Number(document.querySelector(`[data-cantidad="${f}"]`).value); });
  const etapa = (document.querySelector('input[name="luneq-etapa"]:checked') || {}).value || '';
  return {
    etapa, formatos: marcados, cantidades,
    tema: document.getElementById('luneq-tema').value.trim(),
    objetivo: document.getElementById('luneq-objetivo').value.trim(),
    emojis: Number(document.getElementById('luneq-emojis').value),
    emojisFavoritos: document.getElementById('luneq-emojis-fav').value.trim()
  };
}

function htmlAcordeon(g, nuevo) {
  const autor = g.autorNombre ? ` · ${esc(g.autorNombre)}` : '';
  return `
    <details class="lab-historial__item lab-acordeon${nuevo ? ' lab-acordeon--nuevo' : ''}"${nuevo ? ' open' : ''}>
      <summary><strong>${esc(g.etapaNombre || g.etapa || '')}</strong> · ${esc(fechaLegible(g.creadoEn))}${autor} · ${(g.piezas || []).length} propuestas${nuevo ? '<span class="lab-acordeon__nuevo">Nuevo</span>' : ''}</summary>
      <div class="lab-historial__cuerpo" data-gen="${esc(g.id)}">
        ${g.tema ? `<p class="luneq-tema"><strong>Tema:</strong> ${esc(g.tema)}${g.objetivo ? ` · <strong>Objetivo:</strong> ${esc(g.objetivo)}` : ''}</p>` : ''}
        ${g.incompleta ? '<p class="lab-aviso">Uno de los formatos no se pudo generar esta vez. Puedes volver a intentarlo.</p>' : ''}
        ${htmlPiezas(g.piezas, NOMBRES_FORMATO, { editable: true })}
      </div>
    </details>`;
}

async function crear() {
  const btn = document.getElementById('luneq-crear');
  const resultado = document.getElementById('luneq-resultado');
  const raiz = raizEl();
  const p = leerPedido();
  if (!p.formatos.length) { resultado.innerHTML = '<p class="lab-error">Elige al menos un formato.</p>'; return; }
  if (p.tema.length < 5) { resultado.innerHTML = '<p class="lab-error">Cuéntanos de qué trata el contenido (el tema o la idea).</p>'; return; }
  if (hayEdicionesSinGuardar(raiz)) {
    if (!confirm('Tienes cambios sin guardar en una propuesta. Si creas contenido nuevo se perderán. ¿Continuar?')) return;
    descartarEdiciones(raiz);
  }
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Creando…';
  resultado.innerHTML = '<div class="lab-cargando"><span class="lab-spinner"></span> Creando el contenido de UNEQ… (puede tardar hasta un minuto)</div>';
  resultado.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const g = await pedir('generar', p);
    resultado.innerHTML = htmlAcordeon(g, true);
    conectarPiezas(resultado, g.piezas || [], { editable: true, guardar: (i, cambios) => guardarEdicion(g.id, i, cambios) });
    enlazarAcordeon(raiz);
    cerrarOtrasPeticiones(raiz, resultado.querySelector('details'));
    cargarHistorial();
  } catch (err) {
    resultado.innerHTML = `<p class="lab-error">${esc(mensajeError(err, 'No se pudo crear el contenido. Intenta de nuevo.'))}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ---------------- Historial compartido ---------------- */

async function cargarHistorial() {
  const cont = document.getElementById('luneq-historial');
  if (!cont) return;
  cont.innerHTML = '<p class="text-soft">Cargando…</p>';
  let lista = [];
  try {
    const snap = await get(query(ref(db, 'laboratorioUneq/generaciones'), orderByChild('creadoEn'), limitToLast(20)));
    lista = snap.exists() ? Object.entries(snap.val()).map(([id, g]) => ({ id, ...g })) : [];
  } catch (err) {
    console.error('Laboratorio UNEQ: no se pudo cargar el historial:', err);
    cont.innerHTML = '<p class="text-soft">No se pudo cargar el historial.</p>';
    return;
  }
  lista.sort((a, b) => (b.creadoEn || 0) - (a.creadoEn || 0));
  if (!lista.length) { cont.innerHTML = '<p class="text-soft">Aún no hay contenidos creados.</p>'; return; }
  cont.innerHTML = lista.map(g => htmlAcordeon(g, false)).join('');
  cont.querySelectorAll('[data-gen]').forEach(div => {
    const g = lista.find(x => x.id === div.dataset.gen);
    if (g) conectarPiezas(div, g.piezas || [], { editable: true, guardar: (i, cambios) => guardarEdicion(g.id, i, cambios) });
  });
  enlazarAcordeon(raizEl());
}

/* ---------------- Ficha de marca ---------------- */

async function cargarMarca() {
  const cont = document.getElementById('luneq-marca');
  if (!cont) return;
  let m = {};
  try { const s = await get(ref(db, 'laboratorioUneq/marca')); m = s.val() || {}; } catch (err) { console.error('Laboratorio UNEQ: no se pudo leer la ficha de marca:', err); }
  cont.innerHTML = `
    <p class="text-soft lab-bloque__sub">Escríbela una vez y la IA la usa en todo lo que cree. Cualquier persona del equipo con acceso puede completarla o mejorarla.</p>
    ${CAMPOS_MARCA.map(([k, titulo, ayuda]) => `
      <label class="luneq-campo">${esc(titulo)}
        <span class="text-soft luneq-ayuda">${esc(ayuda)}</span>
        <textarea data-marca="${k}" rows="4" maxlength="2500">${esc(m[k] || '')}</textarea>
      </label>`).join('')}
    <div class="luneq-acciones">
      <button type="button" class="btn btn--primary" id="luneq-marca-guardar">Guardar ficha de marca</button>
      <span class="text-soft" id="luneq-marca-estado">${m.actualizadoEn ? `Última edición: ${esc(fechaLegible(m.actualizadoEn))}${m.actualizadoPor ? ` por ${esc(m.actualizadoPor)}` : ''}` : ''}</span>
    </div>`;
  document.getElementById('luneq-marca-guardar').addEventListener('click', async (e) => {
    const b = e.currentTarget, estado = document.getElementById('luneq-marca-estado');
    const cambios = {};
    cont.querySelectorAll('[data-marca]').forEach(t => { cambios[t.dataset.marca] = t.value.trim(); });
    b.disabled = true; estado.textContent = 'Guardando…';
    try {
      await update(ref(db, 'laboratorioUneq/marca'), { ...cambios, actualizadoEn: Date.now(), actualizadoPor: String(getCurrentUserNombre() || '').slice(0, 80) });
      estado.textContent = 'Guardada ✓';
    } catch (err) { estado.textContent = 'No se pudo guardar. Intenta de nuevo.'; console.error(err); }
    b.disabled = false;
  });
}

/* ---------------- Equipo con acceso (solo Directora Académica y Sub-directora) ---------------- */

const ETIQUETA_ROL = { coach: 'Copiloto', mentor: 'Mentor/a' };

async function cargarEquipo() {
  const cont = document.getElementById('luneq-equipo');
  if (!cont) return;
  let usuarios = {}, asignados = {};
  try {
    const [u, a] = await Promise.all([get(ref(db, 'usuarios')), get(ref(db, 'laboratorioUneq/acceso'))]);
    usuarios = u.val() || {}; asignados = a.val() || {};
  } catch (err) {
    console.error('Laboratorio UNEQ: no se pudo leer el equipo:', err);
    cont.innerHTML = '<p class="text-soft">No se pudo cargar el equipo.</p>';
    return;
  }
  // Solo personas que usan la app como Copiloto o Mentor/a (son quienes pueden entrar a esta sección).
  const gente = Object.entries(usuarios)
    .filter(([, u]) => u && u.activo !== false && ['coach', 'mentor'].some(r => (u.roles && u.roles[r] === true) || u.rol === r))
    .sort((a, b) => String(a[1].nombre || a[1].email || '').localeCompare(String(b[1].nombre || b[1].email || ''), 'es'));
  cont.innerHTML = `
    <p class="text-soft lab-bloque__sub">La Directora Académica y la Sub-directora siempre tienen acceso. Marca a las personas que también podrán crear y publicar el contenido de UNEQ.</p>
    ${gente.length ? `<ul class="luneq-equipo">${gente.map(([uid, u]) => `
      <li><label><input type="checkbox" data-acceso="${esc(uid)}"${asignados[uid] === true ? ' checked' : ''}>
        <span><strong>${esc(u.nombre || u.email || uid)}</strong> <span class="text-soft">${esc(u.email || '')}</span>
        ${Object.keys(ETIQUETA_ROL).filter(r => (u.roles && u.roles[r] === true) || u.rol === r).map(r => `<span class="badge">${esc(ETIQUETA_ROL[r])}</span>`).join(' ')}</span></label></li>`).join('')}</ul>`
      : '<p class="text-soft">No hay Copilotos ni Mentores activos para asignar.</p>'}
    <p class="text-soft luneq-ayuda" id="luneq-equipo-estado"></p>`;
  cont.querySelectorAll('[data-acceso]').forEach(chk => {
    chk.addEventListener('change', async () => {
      const estado = document.getElementById('luneq-equipo-estado');
      chk.disabled = true;
      try {
        await set(ref(db, `laboratorioUneq/acceso/${chk.dataset.acceso}`), chk.checked ? true : null);
        estado.textContent = chk.checked ? 'Acceso dado ✓ (la persona lo verá la próxima vez que entre a la app).' : 'Acceso quitado ✓';
      } catch (err) {
        chk.checked = !chk.checked;
        estado.textContent = 'No se pudo cambiar el acceso. Intenta de nuevo.';
        console.error(err);
      }
      chk.disabled = false;
    });
  });
}

/* ---------------- Entrada ---------------- */

export async function cargarLaboratorioUneq() {
  const el = raizEl();
  if (!el) return;
  if (!acceso || !auth.currentUser) { el.innerHTML = '<p class="text-soft">No tienes acceso al Laboratorio UNEQ.</p>'; return; }
  // Esta pantalla la comparte el Laboratorio IA de alumnos: aquí se apaga su bloque y se muestra el de UNEQ.
  const titulo = document.getElementById('lab-titulo'); if (titulo) titulo.textContent = 'Laboratorio UNEQ';
  ['lab-contenido', 'lab-instagram'].forEach(id => { const x = document.getElementById(id); if (x) { x.classList.add('hidden'); x.innerHTML = ''; } });
  el.classList.remove('hidden');
  usarCuentaInstagram('uneq');                           // aquí todo el equipo publica en la cuenta compartida
  fijarContextoVista({ nombre: 'somosuneq' });
  cargarPanelInstagram({ cuenta: 'uneq', raizId: 'luneq-instagram' });
  cargarImagenesVista();
  pintarBase();
  cargarHistorial();
  cargarMarca();
  if (puedeAsignar) cargarEquipo();
}

document.querySelectorAll('.nav-item[data-nav="laboratorio-uneq"]').forEach(item => {
  item.addEventListener('click', cargarLaboratorioUneq);
});
