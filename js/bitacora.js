/* ============================================================
   bitacora.js
   Entradas de bitácora (/bitacora/{cicloId}/{entradaId}).
   Habilitada solo si ciclo.estadoProceso === "matricula_finalizada".
   Cualquiera de los dos roles (director o coach) puede agregar
   entradas — es un registro de seguimiento compartido, no editable
   ni borrable una vez guardado (bitácora = historial, no se toca).
   ============================================================ */

import { db, auth } from './firebase-config.js';
import { ref, get, push, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentUserNombre } from './main.js';

let cicloIdActual = null;

function formatFecha(fechaStr) {
  if (!fechaStr) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(fechaStr + 'T00:00:00'));
}

/* --- Llamada desde alumnos.js cada vez que se abre una ficha --- */
export async function cargarBitacoraParaCiclo(cicloId, habilitada) {
  cicloIdActual = cicloId;
  const banner = document.getElementById('bitacora-bloqueada');
  const contenido = document.getElementById('bitacora-contenido');
  if (!banner || !contenido) return;

  if (!habilitada || !cicloId) {
    banner.classList.remove('hidden');
    contenido.classList.add('hidden');
    return;
  }

  banner.classList.add('hidden');
  contenido.classList.remove('hidden');
  document.getElementById('bitacora-fecha').value = new Date().toISOString().slice(0, 10);
  document.getElementById('bitacora-notas').value = '';

  const snap = await get(ref(db, `bitacora/${cicloId}`));
  const listadoEl = document.getElementById('bitacora-listado');
  listadoEl.innerHTML = '';

  if (!snap.exists()) {
    listadoEl.innerHTML = '<p class="text-soft">Aún no hay entradas registradas.</p>';
    return;
  }

  Object.values(snap.val())
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach(entrada => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:12px 0; border-bottom:0.5px solid var(--border);';
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <strong>${formatFecha(entrada.fecha)} · ${entrada.canal || ''}</strong>
          <span class="text-soft" style="font-size:12px;">${entrada.autorNombre || ''}</span>
        </div>
        <p style="margin:0;">${entrada.notas || ''}</p>`;
      listadoEl.appendChild(div);
    });
}

const btnGuardarBitacora = document.getElementById('btn-guardar-bitacora');
if (btnGuardarBitacora) {
  btnGuardarBitacora.addEventListener('click', async () => {
    if (!cicloIdActual) return;
    const fecha = document.getElementById('bitacora-fecha').value;
    const canal = document.getElementById('bitacora-canal').value;
    const notas = document.getElementById('bitacora-notas').value.trim();

    if (!notas) {
      alert('Escribe algo en las notas antes de guardar.');
      return;
    }

    btnGuardarBitacora.disabled = true;
    try {
      const entradaRef = push(ref(db, `bitacora/${cicloIdActual}`));
      await set(entradaRef, {
        fecha,
        canal,
        notas,
        autorUid: auth.currentUser ? auth.currentUser.uid : null,
        autorNombre: getCurrentUserNombre(),
        createdAt: Date.now()
      });
      await cargarBitacoraParaCiclo(cicloIdActual, true);
    } finally {
      btnGuardarBitacora.disabled = false;
    }
  });
}
