/* ============================================================
   panel-sesiones.js
   Piezas compartidas para ver evaluaciones NPS de una sesión
   (anónimas: puntaje + fecha + comentario) y el panel del
   Director con todas las sesiones de la Coach de Cabecera
   (BEGIN): estado, NPS, comentarios y eliminar.
   Eliminar borra SOLO la sesión: sus evaluaciones NPS y
   preguntas se conservan y siguen visibles en "eliminadas".
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

export function escaparHtml(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderEntradasNps(entradas) {
  const lista = [...entradas].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!lista.length) return '<p class="text-soft" style="font-size:13px; margin:0;">Aún no hay evaluaciones.</p>';
  return lista.map(e => {
    const fecha = e.createdAt ? new Date(e.createdAt).toLocaleDateString('es-CL') : '';
    return `
      <div style="padding:8px 0; border-bottom:0.5px solid var(--border); font-size:13px;">
        <strong>${typeof e.puntaje === 'number' ? e.puntaje : '—'} / 10</strong>
        <span class="text-soft" style="font-size:11px; margin-left:8px;">${fecha}</span>
        ${e.comentario ? `<p style="margin:4px 0 0; white-space:pre-wrap;">${escaparHtml(e.comentario)}</p>` : ''}
      </div>`;
  }).join('');
}

function formatFecha(fechaStr) {
  if (!fechaStr) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(fechaStr + 'T00:00:00'));
}
function formatHora(s) {
  if (s.inicioTimestamp) {
    return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s.inicioTimestamp)) + ' 🇨🇱';
  }
  return s.hora || '—';
}

export async function renderPanelSesionesDirector(coachUid, contenedor) {
  const [sesionesSnap, npsSnap] = await Promise.all([
    get(ref(db, `sesionesBegin/${coachUid}`)),
    get(ref(db, `npsSesionesBegin/${coachUid}`))
  ]);
  const sesiones = sesionesSnap.exists() ? sesionesSnap.val() : {};
  const nps = npsSnap.exists() ? npsSnap.val() : {};

  const promedioDe = (entradas) => {
    const p = entradas.map(e => e.puntaje).filter(x => typeof x === 'number');
    return p.length ? `${(p.reduce((a, b) => a + b, 0) / p.length).toFixed(1)} ★ (${p.length})` : '—';
  };
  const etiquetaEstado = (s) => s.estado === 'dictada'
    ? '<span class="badge badge--activo" style="font-size:10px;">✓ Dictada</span>'
    : (s.estado === 'no_dictada'
      ? '<span class="badge badge--impaga" style="font-size:10px;">✓ No Dictada</span>'
      : '<span class="text-soft" style="font-size:11px;">Pendiente</span>');

  const activas = Object.entries(sesiones).sort((a, b) => (b[1].fecha || '').localeCompare(a[1].fecha || ''));
  const eliminadas = Object.entries(nps)
    .filter(([sesionId]) => !sesiones[sesionId])
    .map(([sesionId, resp]) => ({ sesionId, entradas: Object.values(resp || {}) }))
    .filter(x => x.entradas.length)
    .sort((a, b) => Math.max(...b.entradas.map(e => e.createdAt || 0)) - Math.max(...a.entradas.map(e => e.createdAt || 0)));

  const fila = (id, titulo, extraHtml, entradas, puedeEliminar) => `
    <div class="sesion-director-item" data-sesion-id="${id}" style="padding:10px 0; border-bottom:0.5px solid var(--border); font-size:13px;">
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <div style="flex:1; min-width:200px;">${titulo}</div>
        <div>${extraHtml}</div>
        <div>NPS: <strong>${promedioDe(entradas)}</strong></div>
        <button type="button" class="btn btn--ghost btn-ver-coment-sesion" style="font-size:11px; padding:3px 8px;" ${entradas.length ? '' : 'disabled'}>Ver comentarios</button>
        ${puedeEliminar ? '<button type="button" class="btn btn--ghost btn-eliminar-sesion-dir" style="font-size:11px; padding:3px 8px; color:#C0392B;">Eliminar</button>' : ''}
      </div>
      <div class="coment-sesion hidden" style="margin-top:8px; padding:4px 12px; background:#fff; border-radius:8px;">${renderEntradasNps(entradas)}</div>
    </div>`;

  contenedor.innerHTML = `
    <strong style="font-size:13px;">Sesiones Grupales BEGIN y OPEN</strong>
    ${activas.length ? activas.map(([id, s]) => fila(
      id,
      `${formatFecha(s.fecha)} · ${formatHora(s)}${s.audiencia === 'open' ? ' <span class="badge badge--activo" style="font-size:9px;">OPEN</span>' : (s.audiencia === 'ambos' ? ' <span class="badge badge--activo" style="font-size:9px;">BEGIN + OPEN</span>' : '')}`,
      etiquetaEstado(s),
      nps[id] ? Object.values(nps[id]) : [],
      true
    )).join('') : '<p class="text-soft" style="font-size:13px; margin:6px 0 0;">Aún no hay sesiones.</p>'}
    ${eliminadas.length ? `
      <strong style="font-size:13px; display:block; margin-top:16px;">Sesiones eliminadas (evaluaciones conservadas)</strong>
      ${eliminadas.map(x => {
        const ts = x.entradas.map(e => e.createdAt || 0).filter(Boolean);
        const rango = ts.length ? `respuestas del ${new Date(Math.min(...ts)).toLocaleDateString('es-CL')} al ${new Date(Math.max(...ts)).toLocaleDateString('es-CL')}` : 'sin fecha';
        return fila(x.sesionId, `Sesión eliminada · ${rango}`, '<span class="text-soft" style="font-size:11px;">Eliminada</span>', x.entradas, false);
      }).join('')}` : ''}`;

  contenedor.querySelectorAll('.sesion-director-item').forEach(item => {
    const id = item.dataset.sesionId;
    const btnComent = item.querySelector('.btn-ver-coment-sesion');
    const cajaComent = item.querySelector('.coment-sesion');
    if (btnComent) btnComent.addEventListener('click', () => cajaComent.classList.toggle('hidden'));
    const btnEliminar = item.querySelector('.btn-eliminar-sesion-dir');
    if (btnEliminar) btnEliminar.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta sesión? Se borra solo la sesión; sus evaluaciones NPS y preguntas se conservan. Esta acción no se puede deshacer.')) return;
      btnEliminar.disabled = true;
      try {
        await set(ref(db, `sesionesBegin/${coachUid}/${id}`), null);
        await renderPanelSesionesDirector(coachUid, contenedor);
      } catch (err) {
        console.error('No se pudo eliminar la sesión:', err);
        alert('No se pudo eliminar. Revisa que las reglas nuevas estén publicadas e intenta de nuevo.');
        btnEliminar.disabled = false;
      }
    });
  });
}
