/* ============================================================
   pre-onboarding.js — pestaña "Pre-Onboarding" (solo Director):
   leads que un closer marcó como "Cierre" en el sistema de
   agendamiento (agendamiento/recienCerrados), listos para que el
   Director los tome y siga el proceso normal de creación de alumno.

   Es el único punto donde esta app lee datos del módulo de
   agendamiento — mismo proyecto de Firebase, nodo aparte.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole } from './main.js';
import { abrirCrearAlumnoDesdePreOnboarding } from './alumnos.js';

const ETIQUETA_PROGRAMA = { begin: 'Begin', next: 'Next', exit: 'eXIT' };

async function cargarPreOnboarding() {
  if (getCurrentRole() !== 'director') return;
  const tbody = document.getElementById('tabla-pre-onboarding');
  const vacioEl = document.getElementById('pre-onboarding-vacio');
  if (!tbody) return;

  let snap;
  try {
    snap = await get(ref(db, 'agendamiento/recienCerrados'));
  } catch (err) {
    console.error('No se pudo cargar Pre-Onboarding:', err);
    tbody.innerHTML = '';
    vacioEl.textContent = 'No se pudo cargar la lista. Intenta de nuevo.';
    vacioEl.classList.remove('hidden');
    return;
  }

  const lista = snap.exists()
    ? Object.entries(snap.val()).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0))
    : [];

  vacioEl.classList.toggle('hidden', lista.length > 0);
  tbody.innerHTML = lista.map(([id, lead]) => `
    <tr data-id="${id}">
      <td>${lead.nombre || ''}</td>
      <td>${lead.telefono || ''}</td>
      <td>${lead.correo || ''}</td>
      <td>${ETIQUETA_PROGRAMA[lead.programa] || lead.programa || ''}</td>
      <td><button type="button" class="btn btn--accent btn-agregar-pre-onboarding" style="font-size:12px; padding:6px 14px;">+ Agregar</button></td>
    </tr>`).join('');

  tbody.querySelectorAll('.btn-agregar-pre-onboarding').forEach(btn => {
    btn.addEventListener('click', () => {
      const fila = btn.closest('tr');
      const id = fila.dataset.id;
      const lead = lista.find(([leadId]) => leadId === id)?.[1];
      if (!lead) return;
      abrirCrearAlumnoDesdePreOnboarding({ id, nombre: lead.nombre, telefono: lead.telefono, correo: lead.correo, programa: lead.programa });
    });
  });
}

document.querySelectorAll('.nav-item[data-nav="pre-onboarding"]').forEach(item => {
  item.addEventListener('click', cargarPreOnboarding);
});
