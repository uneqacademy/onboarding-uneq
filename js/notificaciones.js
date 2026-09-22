/* ============================================================
   notificaciones.js — campanita del alumno (comentarios, reacciones
   y respuestas a sus comentarios en Hitos). Solo para alumnos; el
   staff no tiene campanita en esta primera versión.
   ============================================================ */

import { db, auth } from './firebase-config.js';
import { ref, get, onValue, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole } from './main.js';

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
      await update(ref(db, `notificaciones/${alumnoIdActual}/${notifId}`), { leida: true });
      panelEl.classList.add('hidden');
      if (hitoId) {
        document.querySelector('.nav-item[data-nav="comunidad-uneq"]')?.click();
        setTimeout(() => { window.location.hash = `#hito-${hitoId}`; document.getElementById(`hito-${hitoId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 500);
      }
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
    notificacionesActuales = snap.exists() ? Object.entries(snap.val()).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 30) : [];
    renderLista();
    actualizarBadge();
  });
}

btnCampana?.addEventListener('click', () => panelEl.classList.toggle('hidden'));
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#notif-contenedor')) panelEl?.classList.add('hidden');
});

export { iniciarNotificaciones };
