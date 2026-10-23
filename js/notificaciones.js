/* ============================================================
   notificaciones.js — campanita del alumno. Junta dos tipos de aviso:
   - Los que se guardan en la base (comentarios, reacciones y respuestas
     a sus comentarios en Hitos): notificaciones/{alumnoId}.
   - Los que se calculan al abrir la app, sin guardar nada: un pago
     marcado como impago y respuestas del BOX que aún no ha abierto.
   Solo para alumnos; el staff no tiene campanita.
   ============================================================ */

import { db, auth } from './firebase-config.js';
import { escaparHtml } from './util-html.js';
import { ref, get, onValue, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole, setNav } from './main.js';
import { irAHitoDesdeNotificacion, irAPreguntaLibre } from './comunidad-uneq.js';
import { irARanking, nombreDeMes } from './ranking.js';

const TEXTOS_TIPO = {
  comentario: (n) => `${n} comentó tu hito`,
  reaccion: (n) => `${n} reaccionó a tu hito`,
  respuesta: (n) => `${n} respondió tu comentario`,
  pregunta: (n) => `${n} respondió tu pregunta`
};

// Solo se avisan las respuestas del BOX de la última semana, y se revisan las
// últimas 30 preguntas, para no inundar la campanita con respuestas antiguas.
const DIAS_AVISO_BOX = 7;
const MAX_PREGUNTAS_REVISADAS = 30;
const SEGUNDOS_ENTRE_REVISIONES = 60;

const btnCampana = document.getElementById('notif-btn-campana');
const badgeEl = document.getElementById('notif-badge');
const panelEl = document.getElementById('notif-panel');
const listaEl = document.getElementById('notif-lista');
const backdropEl = document.getElementById('notif-backdrop');
const btnCerrarPanel = document.getElementById('notif-btn-cerrar');
let notificacionesActuales = [];
let avisosCalculados = [];
let alumnoIdActual = null;
let ultimaRevision = 0;
let modoDemo = false;

/* --- Respuestas del BOX ya abiertas: se recuerdan en este dispositivo.
       (Las reglas no dejan al alumno escribir en las preguntas del BOX.) --- */
function claveBoxVistas() { return `uneq.boxRespuestasVistas.${alumnoIdActual}`; }

function leerBoxVistas() {
  try { return new Set(JSON.parse(localStorage.getItem(claveBoxVistas()) || '[]')); } catch (err) { return new Set(); }
}

function guardarBoxVista(preguntaId) {
  try {
    const vistas = leerBoxVistas();
    vistas.add(preguntaId);
    localStorage.setItem(claveBoxVistas(), JSON.stringify([...vistas].slice(-300)));
  } catch (err) { /* sin almacenamiento local: el aviso reaparece al recargar */ }
}

/* --- Avisos calculados --- */
// "Pago pendiente" = alguna cuota del acuerdo marcada como impaga.
async function avisoPagoImpago() {
  const cicloSnap = await get(ref(db, `alumnos/${alumnoIdActual}/cicloActualId`));
  const cicloId = cicloSnap.exists() ? cicloSnap.val() : null;
  if (!cicloId) return [];
  const cuotasSnap = await get(ref(db, `acuerdosPago/${cicloId}/cuotas`));
  const hayImpaga = cuotasSnap.exists() && Object.values(cuotasSnap.val()).some(c => c && c.estado === 'impaga');
  return hayImpaga ? [['calculada-pago', { tipo: 'pago', createdAt: Date.now() }]] : [];
}

async function avisosRespuestasBox() {
  const indiceSnap = await get(ref(db, `boxIndice/${alumnoIdActual}`));
  if (!indiceSnap.exists()) return [];
  const vistas = leerBoxVistas();
  const desde = Date.now() - DIAS_AVISO_BOX * 24 * 60 * 60 * 1000;
  // Los ids de Firebase crecen con el tiempo: ordenados de mayor a menor quedan las más nuevas primero.
  const recientes = Object.entries(indiceSnap.val())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, MAX_PREGUNTAS_REVISADAS);
  const preguntas = await Promise.all(recientes.map(async ([preguntaId, mentorId]) => {
    const snap = await get(ref(db, `box/${mentorId}/${preguntaId}`)).catch(() => null);
    return snap && snap.exists() ? [preguntaId, snap.val()] : null;
  }));
  return preguntas
    .filter(Boolean)
    .map(([preguntaId, p]) => [preguntaId, p, (p.respuesta && (p.respuesta.createdAt || p.respuesta.revisadoEn)) || p.createdAt || 0])
    .filter(([preguntaId, p, fecha]) => p.respuesta && !vistas.has(preguntaId) && fecha >= desde)
    .map(([preguntaId, , fecha]) => [`calculada-box-${preguntaId}`, { tipo: 'box', preguntaId, createdAt: fecha }]);
}

async function refrescarAvisos() {
  if (!alumnoIdActual) return;
  ultimaRevision = Date.now();
  const resultados = await Promise.all([avisoPagoImpago(), avisosRespuestasBox()].map(p => p.catch(err => {
    console.error('No se pudo calcular un aviso de la campanita:', err);
    return [];
  })));
  avisosCalculados = resultados.flat();
  renderLista();
  actualizarBadge();
}

/* --- Lista y contador --- */
function todasLasNotificaciones() {
  return [...avisosCalculados, ...notificacionesActuales].sort((a, b) => b[1].createdAt - a[1].createdAt);
}

function textoNotificacion(n) {
  let texto;
  if (n.tipo === 'pago') texto = 'Tienes un pago pendiente. Contacta a <strong>Soporte Alumnos</strong> para resolverlo.';
  else if (n.tipo === 'box') texto = 'Tienes una respuesta nueva en el <strong>BOX Inteligente</strong>';
  else if (n.tipo === 'ranking') texto = `🏆 Quedaste en el <strong>${Number(n.lugar) || ''}° lugar</strong> del ranking de ${escaparHtml(nombreDeMes(String(n.mes || '')))}${n.premio ? `. Premio: ${escaparHtml(n.premio)}` : ''}`;
  else {
    texto = (TEXTOS_TIPO[n.tipo] ? TEXTOS_TIPO[n.tipo](escaparHtml(n.autorNombre || 'Alguien')) : 'Novedad en tu hito')
      + (n.tituloHito ? `: "${escaparHtml(n.tituloHito)}"` : '')
      + (n.tituloPregunta ? `: "${escaparHtml(n.tituloPregunta)}"` : '');
  }
  return n.ejemplo ? `${texto} <em>(ejemplo)</em>` : texto;
}

function renderLista() {
  const todas = todasLasNotificaciones();
  if (!todas.length) {
    listaEl.innerHTML = '<p class="notif-vacio">Sin notificaciones por ahora.</p>';
    return;
  }
  listaEl.innerHTML = todas.map(([id, n]) => {
    const calculada = id.startsWith('calculada-');
    return `
    <button type="button" class="notif-item ${n.leida ? '' : 'no-leida'}" data-notif-id="${escaparHtml(id)}" data-tipo="${escaparHtml(n.tipo || '')}" data-hito-id="${escaparHtml(n.hitoId || '')}" data-pregunta-id="${escaparHtml(n.preguntaId || '')}">
      ${textoNotificacion(n)}
      ${calculada && n.tipo === 'pago' ? '' : `<time>${new Date(n.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>`}
    </button>`;
  }).join('');

  listaEl.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', async () => {
      const { notifId, hitoId, preguntaId, tipo } = item.dataset;
      if (notifId.startsWith('calculada-')) {
        // Estos avisos se van solos: el de pago al regularizarse, el del BOX al abrir "Ver Respuesta".
        cerrarPanel();
        setNav(tipo === 'pago' ? 'soporte-alumnos' : 'box-consultas');
        return;
      }
      if (modoDemo) {
        // Ejemplo: no hay un hito real, pero se abre la Comunidad para ver el recorrido.
        cerrarPanel();
        await irAHitoDesdeNotificacion('demo');
        return;
      }
      try {
        await update(ref(db, `notificaciones/${alumnoIdActual}/${notifId}`), { leida: true });
      } catch (err) {
        console.error('No se pudo marcar la notificación como leída:', err);
      }
      cerrarPanel();
      if (tipo === 'ranking') { irARanking(); return; }
      if (preguntaId) await irAPreguntaLibre(preguntaId);
      else if (hitoId) await irAHitoDesdeNotificacion(hitoId);
    });
  });
}

function actualizarBadge() {
  const total = avisosCalculados.length + notificacionesActuales.filter(([, n]) => !n.leida).length;
  badgeEl.textContent = total > 9 ? '9+' : String(total);
  badgeEl.classList.toggle('hidden', total === 0);
}

async function iniciarNotificaciones() {
  if (getCurrentRole() !== 'alumno') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;
  const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
  alumnoIdActual = mapaSnap.exists() ? mapaSnap.val() : null;
  if (!alumnoIdActual) return;

  btnCampana?.classList.remove('hidden');
  onValue(ref(db, `notificaciones/${alumnoIdActual}`), (snap) => {
    const todas = snap.exists() ? Object.entries(snap.val()) : [];
    // Se muestran las últimas 30, leídas y no leídas (las leídas se ven atenuadas).
    notificacionesActuales = todas.sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 30);
    renderLista();
    actualizarBadge();
  });
  await refrescarAvisos();
}

// Marca como leídas TODAS las que se alcanzaron a ver en el panel —
// no hace falta tocar cada una por separado. Se llama al cerrar el
// panel (de cualquier forma), no al abrirlo, para no hacerlas
// desaparecer de golpe mientras el alumno todavía las está leyendo.
async function marcarTodasComoLeidas() {
  const sinLeer = notificacionesActuales.filter(([, n]) => !n.leida);
  if (modoDemo || !alumnoIdActual || !sinLeer.length) return;
  const cambios = {};
  sinLeer.forEach(([id]) => { cambios[`${id}/leida`] = true; });
  try {
    await update(ref(db, `notificaciones/${alumnoIdActual}`), cambios);
  } catch (err) {
    console.error('No se pudieron marcar las notificaciones como leídas:', err);
  }
}

function cerrarPanel() {
  if (panelEl.classList.contains('hidden')) return; // ya estaba cerrado, nada que marcar
  panelEl.classList.add('hidden');
  backdropEl?.classList.add('hidden');
  marcarTodasComoLeidas();
}

function abrirPanel() {
  panelEl.classList.remove('hidden');
  backdropEl?.classList.remove('hidden');
  listaEl.scrollTop = 0;
  if (Date.now() - ultimaRevision > SEGUNDOS_ENTRE_REVISIONES * 1000) refrescarAvisos();
}

btnCampana?.addEventListener('click', () => {
  if (panelEl.classList.contains('hidden')) abrirPanel();
  else cerrarPanel();
});
// Formas de salir sin tocar ningún aviso: la ✕, tocar fuera (el fondo transparente
// también funciona en el celular, donde tocar "el vacío" no siempre genera un clic) y Escape.
btnCerrarPanel?.addEventListener('click', cerrarPanel);
backdropEl?.addEventListener('click', cerrarPanel);
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#notif-contenedor')) cerrarPanel();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') cerrarPanel();
});

// alumno-portal.js avisa cuando el alumno abre "Ver Respuesta" de una consulta del BOX.
document.addEventListener('box-respuesta-vista', (ev) => {
  const preguntaId = ev.detail && ev.detail.preguntaId;
  if (!preguntaId || !alumnoIdActual) return;
  guardarBoxVista(preguntaId);
  avisosCalculados = avisosCalculados.filter(([id]) => id !== `calculada-box-${preguntaId}`);
  renderLista();
  actualizarBadge();
});

// "Ver como Alumno (Demo)" del director (alumnos.js): se muestra la campanita con
// avisos de ejemplo para ver cómo la ve un alumno. No lee ni escribe notificaciones.
document.addEventListener('modo-demo-alumno', (ev) => {
  const activo = !!(ev.detail && ev.detail.activo);
  modoDemo = activo;
  avisosCalculados = [];
  notificacionesActuales = [];
  if (activo) {
    const ahora = Date.now();
    alumnoIdActual = ev.detail.alumnoId;
    avisosCalculados = [
      ['calculada-pago', { tipo: 'pago', createdAt: ahora, ejemplo: true }],
      ['calculada-box-demo', { tipo: 'box', createdAt: ahora - 3600000, ejemplo: true }]
    ];
    notificacionesActuales = [['demo-comentario', { tipo: 'respuesta', autorNombre: 'Carolina', tituloHito: 'Mi primer cliente', createdAt: ahora - 7200000, leida: false, ejemplo: true }]];
    btnCampana?.classList.remove('hidden');
  } else {
    alumnoIdActual = null;
    btnCampana?.classList.add('hidden');
    panelEl.classList.add('hidden');
    backdropEl?.classList.add('hidden');
  }
  renderLista();
  actualizarBadge();
});

export { iniciarNotificaciones };
