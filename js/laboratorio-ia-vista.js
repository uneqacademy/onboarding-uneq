/* ============================================================
   laboratorio-ia-vista.js — Cómo se ven las propuestas del Laboratorio IA
   Cada propuesta se muestra como se vería ya publicada, para que la persona
   vea más real lo que va a hacer, con un botón Copiar que entrega el texto
   exacto para pegar y compartir (sin etiquetas técnicas como Gancho o CTA):
   - Carrusel: post de Instagram con láminas que se deslizan y la descripción.
   - Reel: marco vertical con una imagen fija y un play, la descripción y el guion.
   - WhatsApp: chat con burbujas verdes. DM: chat con el estilo de Instagram.
   Las imágenes son genéricas (las sube el Director); sin ellas, un fondo de color.
   Las propuestas antiguas (con secciones) se siguen viendo como antes.
   Este archivo solo arma HTML (todo texto se escapa) y enlaza los botones.
   ============================================================ */

import { escaparHtml } from './util-html.js';

const esc = escaparHtml;

let ctx = { nombre: '', fotoUrl: '' };
let imagenes = [];

/** Nombre y foto que aparecen en el encabezado de las vistas previas. */
export function fijarContextoVista(c) { ctx = { nombre: '', fotoUrl: '', ...(c || {}) }; }
/** Imágenes genéricas (URLs) que subió el Director. */
export function fijarImagenesVista(lista) {
  imagenes = (Array.isArray(lista) ? lista : []).filter(u => typeof u === 'string' && /^https:\/\/[^\s"'()<>]+$/.test(u));
}

/* ---------------- Utilidades ---------------- */

function hash(texto) {
  let h = 0;
  for (const c of String(texto)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h;
}

// Fondo genérico estable por propuesta (no cambia al repintar). Sin imágenes: degradado.
const DEGRADADOS = [
  'linear-gradient(160deg,#1B2A4A 0%,#2F9E8F 100%)',
  'linear-gradient(160deg,#2A3B63 0%,#6c5ce7 100%)',
  'linear-gradient(160deg,#134e5e 0%,#71b280 100%)',
  'linear-gradient(160deg,#3a1c71 0%,#d76d77 100%)'
];
function fondo(semilla, desplazamiento) {
  const n = hash(semilla) + (desplazamiento || 0);
  if (imagenes.length) return `background-image:url('${esc(imagenes[n % imagenes.length])}');`;
  return `background-image:${DEGRADADOS[n % DEGRADADOS.length]};`;
}

function iniciales(nombre) {
  const p = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
}
function avatar(clase) {
  if (ctx.fotoUrl && /^https:\/\/[^\s"'()<>]+$/.test(ctx.fotoUrl)) return `<img class="lab-avatar ${clase || ''}" src="${esc(ctx.fotoUrl)}" alt="">`;
  return `<span class="lab-avatar ${clase || ''}">${esc(iniciales(ctx.nombre))}</span>`;
}
const nombreVista = () => ctx.nombre || 'Tu nombre';

// Texto con saltos de línea y #hashtags resaltados en azul (el texto se escapa primero).
export function conHashtags(texto) {
  return esc(texto).replace(/(^|[\s(])(#[\p{L}\p{N}_]+)/gu, '$1<span class="lab-ig__hash">$2</span>');
}

const ICONO = {
  corazon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.4 4.8 6.6 4.8c1.9 0 3.5 1 5.4 3.2 1.9-2.2 3.5-3.2 5.4-3.2 3.2 0 5.1 3.2 3.9 6.5-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>',
  comentario: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20.7 12a8.7 8.7 0 1 1-3.4-6.9l1.3.9-.4 4.4L20.7 12z" transform="rotate(-12 12 12)"/></svg>',
  enviar: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21.5 3 2.8 10.4l6.6 2.5 2.5 6.6L21.5 3zM9.4 12.9 21.5 3"/></svg>',
  guardar: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3.5h12v17l-6-4.6-6 4.6v-17z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="30" height="30" fill="#fff"><path d="M8 5.5v13l11-6.5L8 5.5z"/></svg>',
  flecha: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>'
};

const botonCopiar = (tipo, i, texto, extra) =>
  `<button type="button" class="btn btn--ghost lab-btn-copiar" data-copiar="${tipo}" data-pieza="${i}"${extra !== undefined ? ` data-m="${extra}"` : ''}>${esc(texto)}</button>`;

/* ---------------- Qué se copia ---------------- */

export function textoACopiar(pieza, tipo, m) {
  if (!pieza) return '';
  if (tipo === 'descripcion') return pieza.descripcion || '';
  if (tipo === 'guion') return pieza.guion || '';
  if (tipo === 'laminas') return (pieza.laminas || []).join('\n\n');
  if (tipo === 'mensaje') return ((pieza.mensajes || [])[Number(m)] || {}).texto || '';
  // Propuestas antiguas (con secciones)
  return [pieza.titulo, ...(pieza.secciones || []).map(s => `${s.etiqueta ? s.etiqueta + ':\n' : ''}${s.texto}`)].join('\n\n');
}

async function copiarAlPortapapeles(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.cssText = 'position:fixed; opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* sin permiso */ }
    ta.remove();
    return ok;
  }
}

/* ---------------- Vistas ---------------- */

function htmlCarrusel(p, i) {
  const laminas = p.laminas || [];
  const slides = laminas.map((texto, n) => `
      <div class="lab-ig__slide" style="${fondo(p.titulo, n)}"><div class="lab-ig__slide-texto">${esc(texto)}</div></div>`).join('');
  const puntos = laminas.length > 1 ? `<div class="lab-ig__puntos">${laminas.map((_, n) => `<span class="lab-ig__punto ${n === 0 ? 'is-activo' : ''}"></span>`).join('')}</div>` : '';
  return `
    <article class="lab-ig" data-pieza="${i}">
      <div class="lab-ig__cab">${avatar()}<div class="lab-ig__quien"><strong>${esc(nombreVista())}</strong><span>Ahora</span></div><span class="lab-ig__mas">···</span></div>
      <div class="lab-ig__media">
        <div class="lab-ig__slides" data-slides>${slides}</div>
        ${laminas.length > 1 ? `<button type="button" class="lab-ig__flecha" data-flecha aria-label="Siguiente lámina">${ICONO.flecha}</button>` : ''}
      </div>
      ${puntos}
      <div class="lab-ig__acciones">${ICONO.corazon}${ICONO.comentario}${ICONO.enviar}<span class="lab-ig__guardar">${ICONO.guardar}</span></div>
      ${p.descripcion ? `<div class="lab-ig__caption"><strong>${esc(nombreVista())}</strong> ${conHashtags(p.descripcion)}</div>` : ''}
      <div class="lab-copiar-fila">
        ${p.descripcion ? botonCopiar('descripcion', i, 'Copiar descripción') : ''}
        ${botonCopiar('laminas', i, 'Copiar textos de las láminas')}
      </div>
    </article>`;
}

function htmlReel(p, i) {
  return `
    <article class="lab-reelcard" data-pieza="${i}">
      <div class="lab-reel">
        <div class="lab-reel__media" style="${fondo(p.titulo, 0)}">
          ${p.textoPantalla ? `<div class="lab-reel__pantalla">${esc(p.textoPantalla)}</div>` : ''}
          <div class="lab-reel__play">${ICONO.play}</div>
          <div class="lab-reel__pie">${avatar('lab-avatar--chico')}<strong>${esc(nombreVista())}</strong></div>
        </div>
      </div>
      <div class="lab-reelcard__texto">
        ${p.descripcion ? `
        <div class="lab-reelcard__bloque">
          <div class="lab-reelcard__etiqueta">Descripción para publicar</div>
          <div class="lab-ig__caption lab-ig__caption--suelta"><strong>${esc(nombreVista())}</strong> ${conHashtags(p.descripcion)}</div>
          ${botonCopiar('descripcion', i, 'Copiar descripción')}
        </div>` : ''}
        ${p.guion ? `
        <div class="lab-reelcard__bloque">
          <div class="lab-reelcard__etiqueta">Lo que dices en el video</div>
          <div class="lab-reelcard__guion">${esc(p.guion)}</div>
          ${botonCopiar('guion', i, 'Copiar guion')}
        </div>` : ''}
      </div>
    </article>`;
}

function horaActual() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function htmlChat(p, i) {
  const wa = p.formato === 'whatsapp';
  const hora = horaActual();
  const burbujas = (p.mensajes || []).map((m, n) => `
      ${m.contexto ? `<div class="lab-chat__contexto">${esc(m.contexto)}</div>` : ''}
      <div class="lab-chat__fila">
        <div class="lab-burbuja">${esc(m.texto)}<span class="lab-burbuja__hora">${hora}${wa ? ' <span class="lab-burbuja__ticks">✓✓</span>' : ''}</span></div>
        ${botonCopiar('mensaje', i, 'Copiar', n)}
      </div>`).join('');
  return `
    <article class="lab-chat ${wa ? 'lab-chat--wa' : 'lab-chat--ig'}" data-pieza="${i}">
      <div class="lab-chat__cab">
        <span class="lab-avatar lab-avatar--chico lab-avatar--cliente">👤</span>
        <div class="lab-chat__quien"><strong>Tu cliente soñado</strong><span>${wa ? 'en línea' : 'Activo ahora'}</span></div>
      </div>
      <div class="lab-chat__cuerpo">${burbujas}</div>
    </article>`;
}

function htmlAntigua(p, i) {
  return `
    <article class="lab-pieza" data-pieza="${i}">
      <div class="lab-pieza__cab">
        <strong>${esc(p.titulo)}</strong>
        ${botonCopiar('todo', i, 'Copiar')}
      </div>
      ${(p.secciones || []).map(s => `
        <div class="lab-seccion">
          ${s.etiqueta ? `<div class="lab-seccion__etiqueta">${esc(s.etiqueta)}</div>` : ''}
          <div class="lab-seccion__texto">${esc(s.texto)}</div>
        </div>`).join('')}
    </article>`;
}

function htmlPieza(p, i) {
  const vista = p.tipo === 'carrusel' ? htmlCarrusel(p, i)
    : p.tipo === 'reel' ? htmlReel(p, i)
    : p.tipo === 'chat' ? htmlChat(p, i)
    : htmlAntigua(p, i);
  return `<div class="lab-propuesta">${p.tipo ? `<div class="lab-propuesta__titulo">${esc(p.titulo)}</div>` : ''}${vista}</div>`;
}

/** Todas las propuestas, agrupadas por formato. `nombresFormato`: { reel: { nombre }, ... } */
export function htmlPiezas(piezas, nombresFormato) {
  const porFormato = {};
  (piezas || []).forEach((p, i) => { (porFormato[p.formato] = porFormato[p.formato] || []).push({ p, i }); });
  return Object.keys(porFormato).map(f => `
    <div class="lab-formato">
      <h4 class="lab-formato__titulo">${esc((nombresFormato && nombresFormato[f] && nombresFormato[f].nombre) || f)}</h4>
      <div class="lab-formato__lista lab-formato__lista--${esc(f)}">${porFormato[f].map(({ p, i }) => htmlPieza(p, i)).join('')}</div>
    </div>`).join('');
}

/** Enlaza los botones Copiar y las láminas deslizables dentro de `contenedor`. */
export function conectarPiezas(contenedor, piezas) {
  contenedor.querySelectorAll('[data-copiar]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const original = btn.textContent;
      const texto = textoACopiar(piezas[Number(btn.dataset.pieza)], btn.dataset.copiar, btn.dataset.m);
      const ok = texto ? await copiarAlPortapapeles(texto) : false;
      btn.textContent = ok ? 'Copiado ✓' : 'No se pudo copiar';
      setTimeout(() => { btn.textContent = original; }, 1800);
    });
  });
  contenedor.querySelectorAll('.lab-ig__media').forEach(media => {
    const slides = media.querySelector('[data-slides]');
    const puntos = media.parentElement.querySelectorAll('.lab-ig__punto');
    if (!slides) return;
    const actualizar = () => {
      const n = Math.round(slides.scrollLeft / Math.max(slides.clientWidth, 1));
      puntos.forEach((pt, k) => pt.classList.toggle('is-activo', k === n));
    };
    slides.addEventListener('scroll', actualizar, { passive: true });
    const flecha = media.querySelector('[data-flecha]');
    if (flecha) flecha.addEventListener('click', () => {
      const total = slides.children.length;
      const n = Math.round(slides.scrollLeft / Math.max(slides.clientWidth, 1));
      slides.scrollTo({ left: ((n + 1) % total) * slides.clientWidth, behavior: 'smooth' });
    });
  });
}
