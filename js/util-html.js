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

// Escapa el texto y convierte las URLs http(s) en enlaces. Se escapa ANTES
// de buscar URLs, así una comilla dentro de la URL no puede romper el href.
export function linkificarSeguro(texto, conSaltos = false) {
  if (!texto) return '';
  const html = escaparHtml(texto).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:#2563EB;">$1</a>'
  );
  return conSaltos ? html.replace(/\n/g, '<br>') : html;
}
