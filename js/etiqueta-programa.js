/* ============================================================
   etiqueta-programa.js
   Logo del programa + distintivo de OPEN Vitalicio (un ∞ pequeño junto al logo).
   Solo OPEN puede ser Vitalicio (ciclo.vitalicio === true).
   ============================================================ */

const PROGRAMAS_CON_LOGO = ['open', 'begin', 'next', 'exit'];

export function esVitalicioDe(programa, vitalicio) {
  return programa === 'open' && vitalicio === true;
}

// ∞ en una pastilla oscura pequeña (se lee igual sobre fondos claros y oscuros).
export function distintivoVitalicio(clase = '') {
  const svg = '<svg viewBox="0 0 24 12" width="20" height="10" aria-hidden="true" focusable="false"><path d="M12 6c-2-3.2-3.6-4.5-5.6-4.5C3.9 1.5 2 3.4 2 6s1.9 4.5 4.4 4.5C8.4 10.5 10 9.2 12 6s3.6-4.5 5.6-4.5C20.1 1.5 22 3.4 22 6s-1.9 4.5-4.4 4.5C15.6 10.5 14 9.2 12 6z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return `<span class="vit-infinito ${clase}" title="Vitalicio" aria-label="Vitalicio">${svg}</span>`;
}

// Píldora con el wordmark del programa (+ ∞ si es Vitalicio). Sin programa conocido, no muestra nada.
export function etiquetaProgramaHtml(programa, titulo, vitalicio = false) {
  if (!PROGRAMAS_CON_LOGO.includes(programa)) return '';
  const vit = esVitalicioDe(programa, vitalicio);
  return `<span class="hito-etiqueta-programa" title="${titulo}${vit ? ' · Vitalicio' : ''}"><img src="assets/logos/wordmark-${programa}.png" alt="${titulo}">${vit ? distintivoVitalicio() : ''}</span>`;
}

// Texto "Open ∞" para tablas y fichas.
export function textoPrograma(etiqueta, ciclo) {
  return ciclo && esVitalicioDe(ciclo.programa, ciclo.vitalicio) ? `${etiqueta} ∞` : etiqueta;
}
