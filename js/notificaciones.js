/* ============================================================
   notificaciones.js — campanita del alumno (comentarios, reacciones
   y respuestas a sus comentarios en Hitos). Solo para alumnos; el
   staff no tiene campanita en esta primera versión.
   ============================================================ */

import { db, auth } from './firebase-config.js';
import { ref, get, onValue, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole } from './main.js';
import { irAHitoDesdeNotificacion } from './comunidad-uneq.js';

const TEXTOS_TIPO = {
  comentario: (n) => `${n} comentó tu hito`,
  reaccion: (n) => `${n} reaccionó a tu hito`,
  respuesta: (n) => `${n} respondió tu comentario`
};

const btnCampana = document.getElementById('notif-btn-campana');
const badgeEl = document.getElementById('notif-badge');
const panelEl = document.getElementById('notif-panel');
const listaEl = document.getElementById('notif-lista');
let notificacionesActuales = [];

function renderLista() {
  if (!notificacionesActuales.length) {
    listaEl.innerHTML = '<p class="notif-vacio">Sin notificaciones por ahora.</p>';
    return;
  }
  listaEl.innerHTML = notificacionesActuales.map(([id, n]) => `
    <button type="button" class="notif-item ${n.leida ? '' : 'no-leida'}" data-notif-id="${id}" data-hito-id="${n.hitoId || ''}">
      ${TEXTOS_TIPO[n.tipo] ? TEXTOS_TIPO[n.tipo](n.autorNombre || 'Alguien') : 'Novedad en tu hito'}${n.tituloHito ? `: "${n.tituloHito}"` : ''}
      <time>${new Date(n.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
    </button>`).join('');

  listaEl.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', async () => {
      const { notifId, hitoId } = item.dataset;
      try {
        await update(ref(db, `notificaciones/${alumnoIdActual}/${notifId}`), { leida: true });
      } catch (err) {
        console.error('No se pudo marcar la notificación como leída:', err);
      }
      cerrarPanel();
      if (hitoId) await irAHitoDesdeNotificacion(hitoId);
    });
  });
}

function actualizarBadge() {
  const noLeidas = notificacionesActuales.filter(([, n]) => !n.leida).length;
  badgeEl.textContent = noLeidas > 9 ? '9+' : String(noLeidas);
  badgeEl.classList.toggle('hidden', noLeidas === 0);
}

let alumnoIdActual = null;

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
    // Las leídas ya no se muestran — el clic las "borra" de la lista
    // que ve el alumno (quedan igual en la base, por si hace falta
    // revisar historial más adelante).
    notificacionesActuales = todas.filter(([, n]) => !n.leida).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 30);
    renderLista();
    actualizarBadge();
  });
}

// Marca como leídas TODAS las que se alcanzaron a ver en el panel —
// no hace falta tocar cada una por separado. Se llama al cerrar el
// panel (de cualquier forma), no al abrirlo, para no hacerlas
// desaparecer de golpe mientras el alumno todavía las está leyendo.
async function marcarTodasComoLeidas() {
  if (!alumnoIdActual || !notificacionesActuales.length) return;
  const cambios = {};
  notificacionesActuales.forEach(([id]) => { cambios[`${id}/leida`] = true; });
  try {
    await update(ref(db, `notificaciones/${alumnoIdActual}`), cambios);
  } catch (err) {
    console.error('No se pudieron marcar las notificaciones como leídas:', err);
  }
}

function cerrarPanel() {
  if (panelEl.classList.contains('hidden')) return; // ya estaba cerrado, nada que marcar
  panelEl.classList.add('hidden');
  marcarTodasComoLeidas();
}

btnCampana?.addEventListener('click', () => {
  if (panelEl.classList.contains('hidden')) {
    panelEl.classList.remove('hidden');
  } else {
    cerrarPanel();
  }
});
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#notif-contenedor')) cerrarPanel();
});

export { iniciarNotificaciones };
