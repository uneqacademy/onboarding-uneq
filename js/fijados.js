/* ============================================================
   fijados.js — publicaciones fijadas arriba en Comunidad UNEQ.
   Solo las fija el director; hasta MAX_FIJADOS por sección (Hitos,
   Preguntas de la Comunidad, Preguntas BOX, Presentación, Historias).
   Cada publicación guarda "fijadaEn" (fecha en que se fijó); las
   fijadas van primero, la más recién fijada arriba.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

export const MAX_FIJADOS = 3;

const fijadasPorSeccion = {};

// Se llama al pintar cada lista, con la lista completa (sin filtros), para saber cuántas hay fijadas.
export function registrarFijadas(seccion, lista, fijadaEn) {
  fijadasPorSeccion[seccion] = lista.filter(item => fijadaEn(item)).length;
}

// Fijadas primero (la más reciente arriba); el resto conserva su orden.
export function ordenarFijadasPrimero(lista, fijadaEn) {
  return [...lista].sort((a, b) => (fijadaEn(b) || 0) - (fijadaEn(a) || 0));
}

export function etiquetaFijada(fijadaEn) {
  return fijadaEn ? '<span class="badge badge--activo" style="font-size:9px; margin-left:6px;">📌 Fijada</span>' : '';
}

// Botón para el director. "ruta" es el lugar de la base de datos de esa publicación.
export function botonFijar(seccion, ruta, fijadaEn) {
  return `<button type="button" class="btn btn--ghost btn-fijar" data-seccion="${seccion}" data-ruta="${ruta}" data-fijada="${fijadaEn ? '1' : '0'}" style="font-size:12px; padding:4px 10px;">📌 ${fijadaEn ? 'Quitar fijado' : 'Fijar'}</button>`;
}

document.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('.btn-fijar');
  if (!btn) return;
  const { seccion, ruta, fijada } = btn.dataset;
  const fijar = fijada !== '1';
  if (fijar && (fijadasPorSeccion[seccion] || 0) >= MAX_FIJADOS) {
    alert(`Ya hay ${MAX_FIJADOS} publicaciones fijadas en esta sección. Quita una para fijar otra.`);
    return;
  }
  btn.disabled = true;
  try {
    await update(ref(db, ruta), { fijadaEn: fijar ? Date.now() : null });
    document.dispatchEvent(new CustomEvent('fijado-cambiado'));
  } catch (err) {
    console.error('No se pudo cambiar el fijado:', err);
    alert('No se pudo cambiar el fijado. Intenta de nuevo.');
    btn.disabled = false;
  }
});
