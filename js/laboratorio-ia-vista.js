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

/* ---------------- Cada propuesta: se ve completa y se puede editar ---------------- */

// Solo se pueden editar las propuestas con el formato nuevo (las antiguas, con secciones, no).
const esEditable = (p) => !!p && (p.tipo === 'reel' || p.tipo === 'carrusel' || p.tipo === 'chat');

function htmlVista(p, i) {
  return p.tipo === 'carrusel' ? htmlCarrusel(p, i)
    : p.tipo === 'reel' ? htmlReel(p, i)
    : p.tipo === 'chat' ? htmlChat(p, i)
    : htmlAntigua(p, i);
}

function htmlCuerpoVista(p, i, op) {
  const acciones = (op && op.editable && esEditable(p))
    ? '<div class="lab-acciones-pieza"><button type="button" class="btn btn--ghost lab-btn-editar" data-editar>Editar</button></div>'
    : '';
  return htmlVista(p, i) + acciones;
}

function htmlPieza(p, i, op) {
  const titulo = p.tipo
    ? `<div class="lab-propuesta__titulo">${esc(p.titulo)}${p.editadoEn ? ' <span class="lab-propuesta__editado">Editado</span>' : ''}</div>`
    : '';
  return `<div class="lab-propuesta" data-i="${i}">${titulo}<div class="lab-propuesta__cuerpo">${htmlCuerpoVista(p, i, op)}</div></div>`;
}

/** Todas las propuestas, agrupadas por formato y a la vista, como siempre.
 *  `nombresFormato`: { reel: { nombre }, ... }. `op.editable`: muestra el botón Editar. */
export function htmlPiezas(piezas, nombresFormato, op) {
  const porFormato = {};
  (piezas || []).forEach((p, i) => { (porFormato[p.formato] = porFormato[p.formato] || []).push({ p, i }); });
  return Object.keys(porFormato).map(f => `
    <div class="lab-formato">
      <h4 class="lab-formato__titulo">${esc((nombresFormato && nombresFormato[f] && nombresFormato[f].nombre) || f)}</h4>
      <div class="lab-formato__lista lab-formato__lista--${esc(f)}">${porFormato[f].map(({ p, i }) => htmlPieza(p, i, op)).join('')}</div>
    </div>`).join('');
}

/* --- Formulario de edición: solo los textos; el formato y el título no cambian --- */

const campoTexto = (etiqueta, clave, valor, filas, max) =>
  `<label class="lab-edicion__campo"><span>${esc(etiqueta)}</span><textarea data-campo="${esc(clave)}" rows="${filas}" maxlength="${max}">${esc(valor || '')}</textarea></label>`;
const campoLinea = (etiqueta, clave, valor, max) =>
  `<label class="lab-edicion__campo"><span>${esc(etiqueta)}</span><input type="text" data-campo="${esc(clave)}" maxlength="${max}" value="${esc(valor || '')}"></label>`;

function htmlEdicion(p) {
  let campos = '';
  if (p.tipo === 'reel') {
    campos = campoTexto('Lo que dices en el video', 'guion', p.guion, 8, 3500)
      + campoLinea('Texto en pantalla', 'textoPantalla', p.textoPantalla, 200)
      + campoTexto('Descripción para publicar', 'descripcion', p.descripcion, 6, 2500);
  } else if (p.tipo === 'carrusel') {
    campos = (p.laminas || []).map((t, n) => campoTexto(`Lámina ${n + 1}`, `lamina:${n}`, t, 3, 500)).join('')
      + campoTexto('Descripción para publicar', 'descripcion', p.descripcion, 6, 2500);
  } else if (p.tipo === 'chat') {
    campos = (p.mensajes || []).map((m, n) =>
      ((n > 0 || m.contexto) ? campoLinea('Cuándo se envía', `contexto:${n}`, m.contexto, 80) : '')
      + campoTexto(`Mensaje ${n + 1}`, `texto:${n}`, m.texto, 4, 1500)).join('');
  }
  return `
    <div class="lab-edicion" data-edicion>
      ${campos}
      <p class="lab-error hidden" data-error></p>
      <div class="lab-acciones-pieza" data-acciones>
        <button type="button" class="btn btn--primary" data-guardar>Guardar cambios</button>
        <button type="button" class="btn btn--ghost" data-cancelar>Cancelar</button>
      </div>
      <p class="lab-edicion__estado hidden" data-estado>Guardando…</p>
    </div>`;
}

// Lee lo que hay escrito en el formulario, con la misma forma que la propuesta.
export function leerEdicion(p, form) {
  const val = (k) => ((form.querySelector(`[data-campo="${k}"]`) || {}).value || '').trim();
  if (p.tipo === 'reel') return { guion: val('guion'), textoPantalla: val('textoPantalla'), descripcion: val('descripcion') };
  if (p.tipo === 'carrusel') return { laminas: (p.laminas || []).map((_, n) => val(`lamina:${n}`)), descripcion: val('descripcion') };
  return { mensajes: (p.mensajes || []).map((m, n) => ({ contexto: form.querySelector(`[data-campo="contexto:${n}"]`) ? val(`contexto:${n}`) : (m.contexto || ''), texto: val(`texto:${n}`) })) };
}

export function validarEdicion(p, c) {
  if (p.tipo === 'reel' && !c.guion && !c.descripcion) return 'Escribe el guion o la descripción.';
  if (p.tipo === 'carrusel' && c.laminas.some(t => !t)) return 'Ninguna lámina puede quedar vacía.';
  if (p.tipo === 'chat' && c.mensajes.some(m => !m.texto)) return 'Ningún mensaje puede quedar vacío.';
  return '';
}

/* --- Botones Copiar y láminas deslizables dentro de un cuerpo ya dibujado --- */

function enlazarVista(cuerpo, piezas) {
  cuerpo.querySelectorAll('[data-copiar]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const original = btn.textContent;
      const texto = textoACopiar(piezas[Number(btn.dataset.pieza)], btn.dataset.copiar, btn.dataset.m);
      const ok = texto ? await copiarAlPortapapeles(texto) : false;
      btn.textContent = ok ? 'Copiado ✓' : 'No se pudo copiar';
      setTimeout(() => { btn.textContent = original; }, 1800);
    });
  });
  cuerpo.querySelectorAll('.lab-ig__media').forEach(media => {
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

/** Enlaza los botones Copiar, las láminas deslizables y la edición de cada propuesta dentro de `contenedor`.
 *  `op.editable` + `op.guardar(i, cambios)` (promesa que escribe en la base): activan Editar,
 *  Guardar cambios y Cancelar. Guardar solo existe mientras se edita. */
export function conectarPiezas(contenedor, piezas, op) {
  const opciones = op || {};

  contenedor.querySelectorAll('.lab-propuesta').forEach(card => {
    const i = Number(card.dataset.i);
    const cuerpo = card.querySelector('.lab-propuesta__cuerpo');
    let foto = null;   // textos al entrar a editar; null = no se está editando

    const hayCambios = () => {
      const form = cuerpo.querySelector('[data-edicion]');
      return !!form && foto !== null && foto !== JSON.stringify(leerEdicion(piezas[i], form));
    };

    function pintarVista() {
      foto = null;
      cuerpo.innerHTML = htmlCuerpoVista(piezas[i], i, opciones);
      enlazarVista(cuerpo, piezas);
      const editar = cuerpo.querySelector('[data-editar]');
      if (editar) editar.addEventListener('click', entrarEdicion);
    }

    function entrarEdicion() {
      const p = piezas[i];
      cuerpo.innerHTML = htmlEdicion(p);
      const form = cuerpo.querySelector('[data-edicion]');
      foto = JSON.stringify(leerEdicion(p, form));
      form.querySelector('[data-cancelar]').addEventListener('click', pintarVista);
      form.querySelector('[data-guardar]').addEventListener('click', async () => {
        const error = form.querySelector('[data-error]');
        const acciones = form.querySelector('[data-acciones]');
        const estado = form.querySelector('[data-estado]');
        error.classList.add('hidden');
        const cambios = leerEdicion(p, form);
        const problema = validarEdicion(p, cambios);
        if (problema) { error.textContent = problema; error.classList.remove('hidden'); return; }
        // Los botones desaparecen al guardar; solo se muestran de nuevo si algo falla.
        acciones.classList.add('hidden');
        estado.classList.remove('hidden');
        try {
          await opciones.guardar(i, cambios);
          Object.assign(p, cambios, { editadoEn: Date.now() });
          pintarVista();
          const aviso = document.createElement('p');
          aviso.className = 'lab-edicion__ok';
          aviso.textContent = 'Cambios guardados ✓';
          cuerpo.prepend(aviso);
          setTimeout(() => aviso.remove(), 2500);
          const titulo = card.querySelector('.lab-propuesta__titulo');
          if (titulo && !titulo.querySelector('.lab-propuesta__editado')) titulo.insertAdjacentHTML('beforeend', ' <span class="lab-propuesta__editado">Editado</span>');
        } catch (err) {
          console.error('No se pudieron guardar los cambios:', err);
          estado.classList.add('hidden');
          acciones.classList.remove('hidden');
          error.textContent = 'No se pudieron guardar los cambios. Intenta de nuevo.';
          error.classList.remove('hidden');
        }
      });
      const primero = form.querySelector('[data-campo]');
      if (primero) primero.focus();
    }

    card._hayCambios = hayCambios;
    card._descartar = () => { if (foto !== null) pintarVista(); };   // si estaba editando, vuelve a la vista normal

    enlazarVista(cuerpo, piezas);
    const editar = cuerpo.querySelector('[data-editar]');
    if (editar) editar.addEventListener('click', entrarEdicion);
  });
}

/* ---------------- Acordeón de peticiones: solo una abierta a la vez ---------------- */
// Cada petición (el resultado recién creado y cada una del historial) es un <details class="lab-acordeon">.
// Al abrir una, la que estaba abierta se cierra. Dentro de cada una, las propuestas se ven todas, como siempre.

const confirmarDescartar = () => confirm('Tienes cambios sin guardar en una propuesta. ¿Descartarlos?');

export const hayEdicionesSinGuardar = (raiz) => [...raiz.querySelectorAll('.lab-propuesta')].some(c => c._hayCambios && c._hayCambios());
export function descartarEdiciones(raiz) { raiz.querySelectorAll('.lab-propuesta').forEach(c => { if (c._descartar) c._descartar(); }); }

/** Cierra todas las peticiones abiertas de `raiz` menos `salvo`. Devuelve false si el usuario prefirió no descartar cambios. */
export function cerrarOtrasPeticiones(raiz, salvo) {
  const otras = [...raiz.querySelectorAll('details.lab-acordeon[open]')].filter(d => d !== salvo);
  if (otras.some(hayEdicionesSinGuardar) && !confirmarDescartar()) return false;
  otras.forEach(d => { descartarEdiciones(d); d.open = false; });
  return true;
}

/** Enlaza el comportamiento de acordeón (una sola abierta) a las peticiones dentro de `raiz`. */
export function enlazarAcordeon(raiz) {
  raiz.querySelectorAll('details.lab-acordeon > summary').forEach(sum => {
    if (sum.dataset.acordeonListo) return;
    sum.dataset.acordeonListo = '1';
    sum.addEventListener('click', (ev) => {
      const det = sum.parentElement;
      if (!det.open) {                       // se va a abrir: se cierran las demás
        if (!cerrarOtrasPeticiones(raiz, det)) ev.preventDefault();
      } else if (hayEdicionesSinGuardar(det)) {   // se va a cerrar con cambios sin guardar
        if (!confirmarDescartar()) ev.preventDefault();
        else descartarEdiciones(det);
      }
    });
  });
}
