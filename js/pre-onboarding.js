/* ============================================================
   pre-onboarding.js
   Lista los leads que los closers del agendamiento marcaron como
   "Cerrado" (agendamiento/recienCerrados), a la espera de que el
   director les cree la ficha de Alumno. El director puede sacarlos
   de la lista una vez que ya les creó la ficha ("Marcar como listo").
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole } from './main.js';

let leadsCerrados = [];

function escapeHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto || '';
  return div.innerHTML;
}

function renderTablaPreOnboarding() {
  const tbody = document.getElementById('tabla-pre-onboarding-body');
  if (!tbody) return;

  const filtro = (document.getElementById('filtro-pre-onboarding-nombre').value || '').trim().toLowerCase();
  const filtrados = leadsCerrados.filter(l => !filtro || (l.nombre || '').toLowerCase().includes(filtro));

  if (!filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-soft" style="text-align:center; padding:24px;">No hay leads cerrados por ahora.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(l => `
    <tr data-id="${l.id}">
      <td>${escapeHtml(l.nombre)}</td>
      <td>${escapeHtml(l.telefono)}</td>
      <td>${escapeHtml(l.programa)}</td>
      <td>${escapeHtml(l.correo)}</td>
      <td>${l.createdAt ? new Date(l.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}</td>
      <td><button type="button" class="btn btn--ghost" data-accion="listo" style="padding:6px 12px; font-size:12.5px;">✓ Marcar como listo</button></td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-accion="listo"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      const id = tr.dataset.id;
      const lead = leadsCerrados.find(l => l.id === id);
      if (!confirm(`¿Ya le creaste la ficha de Alumno a ${lead ? lead.nombre : 'este lead'}? Se va a sacar de esta lista.`)) return;
      btn.disabled = true;
      try {
        await remove(ref(db, `agendamiento/recienCerrados/${id}`));
        leadsCerrados = leadsCerrados.filter(l => l.id !== id);
        renderTablaPreOnboarding();
      } catch (err) {
        alert('No se pudo actualizar. Intenta de nuevo.');
        btn.disabled = false;
      }
    });
  });
}

export async function cargarPreOnboarding() {
  const snap = await get(ref(db, 'agendamiento/recienCerrados'));
  leadsCerrados = snap.exists()
    ? Object.entries(snap.val()).map(([id, l]) => ({ id, ...l })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    : [];
  renderTablaPreOnboarding();
}

const inputFiltro = document.getElementById('filtro-pre-onboarding-nombre');
if (inputFiltro) inputFiltro.addEventListener('input', renderTablaPreOnboarding);

// Si la cuenta tiene más de un rol y cambia hacia Director sin recargar
// la página (selector de rol en la sidebar), carga los datos recién ahí.
document.addEventListener('rolCambiado', () => {
  if (getCurrentRole() === 'director') cargarPreOnboarding();
});
