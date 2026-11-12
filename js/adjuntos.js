/* ============================================================
   adjuntos.js — archivos que los alumnos adjuntan a sus preguntas
   (BOX y sesiones en vivo), tal como los ve el mentor/copiloto:
   - imágenes: se ven en miniatura, se AMPLÍAN al tocarlas y se pueden DESCARGAR;
   - PDF, Word y otros: tarjeta con botón de descarga.
   Compatible con datos viejos (imagenes: ["url", ...]) y nuevos
   (archivos: [{url, nombre, tipo}, ...]).
   ============================================================ */
import { escaparHtml } from './util-html.js';

function nombreSeguro(nombre, url) {
  if (nombre && nombre !== 'Imagen' && nombre !== 'Archivo') return nombre;
  try {
    const ruta = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    const limpio = ruta.replace(/^\d+_\d+_/, '');
    if (limpio) return limpio;
  } catch (e) { /* usa el nombre genérico */ }
  return nombre || 'archivo';
}

export function renderAdjuntosMentor(archivos, imagenesLegado) {
  const items = [];
  (archivos || []).forEach(a => a && a.url && items.push(a));
  (imagenesLegado || []).forEach(url => url && items.push({ url, nombre: 'Imagen', tipo: 'imagen' }));
  if (!items.length) return '';
  return `<div class="adjuntos-mentor">${items.map(a => {
    const url = escaparHtml(a.url);
    const nombre = escaparHtml(nombreSeguro(a.nombre, a.url));
    if (a.tipo === 'imagen') {
      return `<div class="adjunto-mentor adjunto-mentor--imagen">
        <img src="${url}" alt="${nombre}" class="adj-ampliar" data-src="${url}" data-nombre="${nombre}" title="Ampliar">
        <button type="button" class="adj-descargar" data-src="${url}" data-nombre="${nombre}" title="Descargar">⬇ Descargar</button>
      </div>`;
    }
    const icono = a.tipo === 'pdf' ? '📄' : a.tipo === 'word' ? '📝' : '📎';
    return `<div class="adjunto-mentor adjunto-mentor--archivo">
      <a href="${url}" target="_blank" rel="noopener" title="Abrir">${icono} ${nombre}</a>
      <button type="button" class="adj-descargar" data-src="${url}" data-nombre="${nombre}" title="Descargar">⬇ Descargar</button>
    </div>`;
  }).join('')}</div>`;
}

// Descarga real del archivo; si el navegador no deja leerlo (CORS), lo abre en otra pestaña.
export async function descargarAdjunto(url, nombre) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(blob);
    enlace.download = nombre || 'archivo';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 5000);
  } catch (err) {
    window.open(url, '_blank', 'noopener');
  }
}

document.addEventListener('click', (ev) => {
  const imagen = ev.target.closest('.adj-ampliar');
  if (imagen) {
    const lightbox = document.getElementById('hito-lightbox-imagen');
    if (!lightbox) return;
    document.getElementById('hito-lightbox-imagen-img').src = imagen.dataset.src;
    const btn = document.getElementById('lightbox-descargar');
    if (btn) { btn.dataset.src = imagen.dataset.src; btn.dataset.nombre = imagen.dataset.nombre || 'imagen'; btn.classList.remove('hidden'); }
    lightbox.classList.remove('hidden');
    return;
  }
  const boton = ev.target.closest('.adj-descargar, #lightbox-descargar');
  if (boton) { ev.stopPropagation(); descargarAdjunto(boton.dataset.src, boton.dataset.nombre); }
});

// El visor de imágenes de los hitos no tiene descarga: el botón solo aparece cuando se abre desde un adjunto.
document.addEventListener('click', (ev) => {
  if (ev.target.closest('.btn-ampliar-foto-hito')) document.getElementById('lightbox-descargar')?.classList.add('hidden');
}, true);
