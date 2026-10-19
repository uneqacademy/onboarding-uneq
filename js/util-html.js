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

/* --- Sanear HTML con formato (notas de bitácora, textos formateados) ---
   Deja pasar solo etiquetas de formato básico y enlaces http(s), sin
   atributos de estilo ni eventos. Lo demás se quita (script/style/etc.)
   o se reemplaza por su texto. Usa DOMParser: el documento es inerte,
   no ejecuta scripts ni carga imágenes mientras se limpia. */
const TAGS_PERMITIDAS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'P', 'BR', 'DIV', 'SPAN',
  'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'A'
]);
const TAGS_A_ELIMINAR = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG',
  'MATH', 'TEMPLATE', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'
]);

function limpiarNodo(nodo) {
  Array.from(nodo.childNodes).forEach(hijo => {
    if (hijo.nodeType === 3) return;
    if (hijo.nodeType !== 1) { hijo.remove(); return; }
    limpiarNodo(hijo);
    if (TAGS_A_ELIMINAR.has(hijo.tagName)) { hijo.remove(); return; }
    if (!TAGS_PERMITIDAS.has(hijo.tagName)) { hijo.replaceWith(...Array.from(hijo.childNodes)); return; }
    const href = hijo.tagName === 'A' ? hijo.getAttribute('href') : null;
    Array.from(hijo.attributes).forEach(a => hijo.removeAttribute(a.name));
    if (hijo.tagName === 'A') {
      if (href && /^https?:\/\//i.test(href.trim())) {
        hijo.setAttribute('href', href.trim());
        hijo.setAttribute('target', '_blank');
        hijo.setAttribute('rel', 'noopener');
      } else {
        hijo.replaceWith(...Array.from(hijo.childNodes));
      }
    }
  });
}

export function sanearHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  limpiarNodo(doc.body);
  return doc.body.innerHTML;
}

// Notas de bitácora: las antiguas son texto plano; las nuevas, HTML del editor.
export function notaAHtml(notas) {
  if (!notas) return '';
  if (!/<[a-z][\s\S]*>/i.test(notas)) {
    return escaparHtml(notas)
      .split(/\n{2,}/)
      .map(parrafo => `<p>${parrafo.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }
  return sanearHtml(notas);
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
