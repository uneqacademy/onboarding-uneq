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
  document.getElementById('bitacora-titulo').value = '';
  document.getElementById('bitacora-notas').value = '';

  const snap = await get(ref(db, `bitacora/${cicloId}`));
  const listadoEl = document.getElementById('bitacora-listado');
  const contadorEl = document.getElementById('bitacora-contador');
  listadoEl.innerHTML = '';

  if (!snap.exists()) {
    listadoEl.innerHTML = '<p class="text-soft">Aún no hay entradas registradas.</p>';
    if (contadorEl) contadorEl.textContent = '(0 entradas)';
    return;
  }

  const entradas = Object.values(snap.val()).sort((a, b) => b.createdAt - a.createdAt);
  if (contadorEl) contadorEl.textContent = `(${entradas.length} ${entradas.length === 1 ? 'entrada' : 'entradas'})`;

  entradas.forEach(entrada => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:12px 0; border-bottom:0.5px solid var(--border);';
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <strong>${entrada.titulo || '(sin título)'}</strong>
          <span class="text-soft" style="font-size:12px;">${entrada.autorNombre || ''}</span>
        </div>
        <div class="text-soft" style="font-size:12px; margin-bottom:6px;">${formatFecha(entrada.fecha)} · ${entrada.canal || ''}</div>
        <p style="margin:0;">${entrada.notas || ''}</p>`;
      listadoEl.appendChild(div);
    });
}

const btnGuardarBitacora = document.getElementById('btn-guardar-bitacora');
if (btnGuardarBitacora) {
  btnGuardarBitacora.addEventListener('click', async () => {
    if (!cicloIdActual) return;
    const titulo = document.getElementById('bitacora-titulo').value.trim();
    const fecha = document.getElementById('bitacora-fecha').value;
    const canal = document.getElementById('bitacora-canal').value;
    const notas = document.getElementById('bitacora-notas').value.trim();

    if (!titulo || !notas) {
      alert('Completa el título y las notas antes de guardar.');
      return;
    }

    btnGuardarBitacora.disabled = true;
    try {
      const entradaRef = push(ref(db, `bitacora/${cicloIdActual}`));
      await set(entradaRef, {
        titulo,
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

/* --- Descargar Word (.doc) con la bitácora completa —
       formato HTML-a-Word, el truco clásico y liviano que Word
       abre sin problema, sin necesitar ninguna librería externa.
       Pensado para subir manualmente a Drive y reemplazar la
       versión anterior cada vez. --- */
const btnDescargarWord = document.getElementById('btn-descargar-bitacora-word');
if (btnDescargarWord) {
  btnDescargarWord.addEventListener('click', async () => {
    if (!cicloIdActual) return;
    btnDescargarWord.disabled = true;
    btnDescargarWord.textContent = 'Generando...';
    try {
      const snap = await get(ref(db, `bitacora/${cicloIdActual}`));
      const entradas = snap.exists()
        ? Object.values(snap.val()).sort((a, b) => a.createdAt - b.createdAt)
        : [];

      const nombreAlumno = document.getElementById('ficha-nombre-alumno').textContent.trim() || 'Alumno';
      const programaTexto = document.getElementById('ficha-programa').textContent.trim() || '';

      const bloques = entradas.map(e => `
        <p style="font-family:Arial; font-weight:bold; font-size:18px; margin:0 0 2px 0;">${e.titulo || ''}</p>
        <p style="font-family:Arial; font-size:12px; margin:0;">${formatFecha(e.fecha)}</p>
        <p style="font-family:Arial; font-size:12px; margin:0 0 12px 0;">${e.canal || ''}</p>
        <p style="font-family:Arial; font-size:12px; margin:0 0 20px 0;">${(e.notas || '').replace(/\n/g, '<br>')}</p>
        <hr style="border:none; border-top:1px solid #999; margin:0 0 20px 0;">`
      ).join('');

      const html = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset="utf-8"><title>Bitácora</title></head>
        <body style="font-family:Arial, sans-serif;">
          <p style="font-family:Arial; font-weight:bold; font-size:20px; margin:0;">BITÁCORA "${nombreAlumno.toUpperCase()}"</p>
          <p style="font-family:Arial; font-size:14px; margin:0 0 28px 0;">ALUMNO "${programaTexto.toUpperCase()}"</p>
          ${bloques || '<p style="font-family:Arial; font-size:12px;">Sin entradas registradas.</p>'}
        </body>
        </html>`;

      const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Bitacora - ${nombreAlumno}.doc`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      btnDescargarWord.disabled = false;
      btnDescargarWord.textContent = 'Descargar Word';
    }
  });
}
