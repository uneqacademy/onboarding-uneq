/* ============================================================
   util-html.js — helper único para escapar texto antes de pintarlo
   con innerHTML. Úsalo con TODO dato que venga de la base de datos
   o del usuario (nombres, correos, nombres de archivo, comentarios).
   Sirve tanto para contenido como para valores de atributos.
   ============================================================ */

export function escaparHtml(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
