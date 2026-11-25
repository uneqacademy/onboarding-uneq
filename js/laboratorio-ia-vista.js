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
// Número de WhatsApp de Venta (solo dígitos, con código de país): sirve para armar el link con el mensaje predefinido.
let waVenta = '';
export function fijarWhatsappVenta(n) { waVenta = String(n || '').replace(/[^0-9]/g, ''); }
const ETIQUETA_MENSAJE_PREDEFINIDO = 'Mensaje predefinido de WhatsApp';
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
function valorFondo(semilla, desplazamiento) {
  const n = hash(semilla) + (desplazamiento || 0);
  if (imagenes.length) return `url('${esc(imagenes[n % imagenes.length])}')`;
  return DEGRADADOS[n % DEGRADADOS.length];
}
function fondo(semilla, desplazamiento) {
  return `background-image:${valorFondo(semilla, desplazamiento)};`;
}

// Fondo del reel: la foto de la persona, como si su video estuviera en pausa. Si no hay foto
// (o no carga), se ve el fondo genérico de siempre debajo.
const fotoValida = () => !!ctx.fotoUrl && /^https:\/\/[^\s"'()<>]+$/.test(ctx.fotoUrl);
function fondoReel(semilla) {
  if (!fotoValida()) return { clase: '', estilo: fondo(semilla, 0) };
  return { clase: ' lab-reel__media--foto', estilo: `background-image:url('${esc(ctx.fotoUrl)}'),${valorFondo(semilla, 0)};` };
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

// Lo que lleva escrita la imagen, en orden: Gancho, Bajada, Título de la sesión con fecha y hora, CTA.
// (Gancho = titular, Bajada = apoyo, CTA = boton; así siguen siendo válidas las imágenes ya creadas.)
const textoImagen = (p) => [p.titular, p.apoyo, p.sesion, p.boton].filter(Boolean).join('\n\n');

export function textoACopiar(pieza, tipo, m) {
  if (!pieza) return '';
  if (tipo === 'descripcion') return pieza.descripcion || '';
  if (tipo === 'guion') return pieza.guion || '';
  if (tipo === 'laminas') return (pieza.laminas || []).join('\n\n');
  if (tipo === 'mensaje') return ((pieza.mensajes || [])[Number(m)] || {}).texto || '';
  if (tipo === 'anuncio') return pieza.anuncio || '';
  if (tipo === 'imagen') return textoImagen(pieza);
  if (tipo === 'linkwa') return waVenta ? `https://wa.me/${waVenta}?text=${encodeURIComponent((((pieza.mensajes || [])[0]) || {}).texto || '')}` : '';
  if (tipo === 'pantallas') return (pieza.laminas || []).join('\n\n');
  if (tipo === 'asunto') return pieza.asunto || '';
  if (tipo === 'cuerpo') return pieza.cuerpo || '';
  if (tipo === 'email') return [pieza.asunto ? `Asunto: ${pieza.asunto}` : '', pieza.cuerpo].filter(Boolean).join('\n\n');
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
  const fr = fondoReel(p.titulo);
  return `
    <article class="lab-reelcard" data-pieza="${i}">
      <div class="lab-reel">
        <div class="lab-reel__media${fr.clase}" style="${fr.estilo}">
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

// Historia de Instagram: marco vertical con barras de progreso arriba; se pasa de pantalla tocando a la derecha o a la izquierda.
function htmlHistoria(p, i) {
  const pant = p.laminas || [];
  return `
    <article class="lab-histcard" data-pieza="${i}">
      <div class="lab-historia" data-historia>
        <div class="lab-historia__marco" style="${fondo(p.titulo, 0)}">
          <div class="lab-historia__barras">${pant.map((_, n) => `<span class="lab-historia__barra ${n === 0 ? 'is-activa' : ''}"></span>`).join('')}</div>
          <div class="lab-historia__cab">${avatar('lab-avatar--chico')}<strong>${esc(nombreVista())}</strong><span>Ahora</span></div>
          <div class="lab-historia__texto" data-texto>${esc(pant[0] || '')}</div>
          <button type="button" class="lab-historia__zona lab-historia__zona--izq" data-prev aria-label="Pantalla anterior"></button>
          <button type="button" class="lab-historia__zona lab-historia__zona--der" data-next aria-label="Pantalla siguiente"></button>
        </div>
        <div class="lab-imagen__medida">Toca a los lados para pasar de pantalla</div>
      </div>
      <div class="lab-reelcard__texto">
        <div class="lab-reelcard__bloque">
          <div class="lab-reelcard__etiqueta">Textos de las pantallas</div>
          <div class="lab-reelcard__guion">${pant.map((t, n) => `<strong>Pantalla ${n + 1}</strong>\n${esc(t)}`).join('\n\n')}</div>
          ${botonCopiar('pantallas', i, 'Copiar textos de las pantallas')}
        </div>
      </div>
    </article>`;
}

// Email con un modelo genérico: para quién va, asunto y cuerpo.
function htmlEmail(p, i) {
  return `
    <article class="lab-emailcard" data-pieza="${i}">
      <div class="lab-email">
        <div class="lab-email__fila"><span>Para</span> ${esc(p.audiencia || 'Tu lista de contactos')}</div>
        <div class="lab-email__fila"><span>Asunto</span> <strong>${esc(p.asunto)}</strong></div>
        <div class="lab-email__cuerpo">${esc(p.cuerpo)}</div>
      </div>
      <div class="lab-copiar-fila">
        ${botonCopiar('asunto', i, 'Copiar asunto')}
        ${botonCopiar('cuerpo', i, 'Copiar cuerpo')}
        ${botonCopiar('email', i, 'Copiar todo')}
      </div>
    </article>`;
}

// Imagen estática de un anuncio: marco 4:5 (1080x1350) con el titular, el apoyo y el botón; a un lado, el texto del anuncio.
function htmlImagen(p, i) {
  return `
    <article class="lab-imgcard" data-pieza="${i}">
      <div class="lab-imagen">
        <div class="lab-imagen__marco" style="${fondo(p.titulo, 0)}">
          <div class="lab-imagen__texto">
            ${p.titular ? `<div class="lab-imagen__titular">${esc(p.titular)}</div>` : ''}
            ${p.apoyo ? `<div class="lab-imagen__apoyo">${esc(p.apoyo)}</div>` : ''}
            ${p.sesion ? `<div class="lab-imagen__sesion">${esc(p.sesion)}</div>` : ''}
          </div>
          ${p.boton ? `<div class="lab-imagen__boton">${esc(p.boton)}</div>` : ''}
        </div>
        <div class="lab-imagen__medida">Formato 1080 × 1350</div>
      </div>
      <div class="lab-reelcard__texto">
        ${p.anuncio ? `
        <div class="lab-reelcard__bloque">
          <div class="lab-reelcard__etiqueta">Texto del anuncio</div>
          <div class="lab-ig__caption lab-ig__caption--suelta">${esc(p.anuncio)}</div>
          ${botonCopiar('anuncio', i, 'Copiar texto del anuncio')}
        </div>` : ''}
        <div class="lab-reelcard__bloque">
          <div class="lab-reelcard__etiqueta">Texto de la imagen</div>
          <div class="lab-reelcard__guion">${esc(textoImagen(p))}</div>
          ${botonCopiar('imagen', i, 'Copiar texto de la imagen')}
        </div>
        ${p.ideaVisual ? `
        <div class="lab-reelcard__bloque">
          <div class="lab-reelcard__etiqueta">Idea visual</div>
          <div class="lab-reelcard__guion">${esc(p.ideaVisual)}</div>
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
      ${p.audiencia === ETIQUETA_MENSAJE_PREDEFINIDO ? `
      <div class="lab-copiar-fila">
        ${waVenta
          ? `${botonCopiar('linkwa', i, 'Copiar link de WhatsApp con este mensaje')}<span class="text-soft lab-pagado__nota">Pega este link en el botón de tu anuncio: al hacer clic, WhatsApp se abre con el mensaje ya escrito.</span>`
          : '<span class="text-soft lab-pagado__nota">Para armar el link de WhatsApp con este mensaje, agrega tu número en tu estrategia de Venta.</span>'}
      </div>` : ''}
    </article>`;
}

// Idea de contenido para el grupo de WhatsApp (programa OPEN): encuesta, pregunta abierta, video, audio o texto.
// Se guarda en descripcion (el mensaje listo para publicar), apoyo (para qué sirve) y, en video y audio, guion.
const NOMBRES_IDEA = { encuesta: 'Encuesta', video: 'Video', audio: 'Audio', texto: 'Texto' };
const CATEGORIAS_IDEA = { encuesta: 'Encuesta', pregunta: 'Pregunta abierta', interaccion: 'Interacción general', abrir: 'Abrir el grupo por un tiempo', contenido: 'Invitación a un contenido en redes sociales', recurso: 'Invitación a descargar un recurso o ver un video' };
const ICONOS_IDEA = { encuesta: '📊', pregunta: '💬', video: '🎥', audio: '🎙️', texto: '✍️' };

function htmlIdea(p, i) {
  const tipo = NOMBRES_IDEA[p.medio || p.ideaTipo] ? (p.medio || p.ideaTipo) : 'texto';
  const categoria = CATEGORIAS_IDEA[p.ideaTipo] || '';
  const hora = horaActual();
  const lineas = String(p.descripcion || '').split('\n').map(l => l.trim()).filter(Boolean);
  // Encuesta: la primera línea es la pregunta y cada línea siguiente es una opción.
  const cuerpoMensaje = tipo === 'encuesta' && lineas.length > 1
    ? `<div class="lab-burbuja lab-burbuja--encuesta"><div class="lab-encuesta__pregunta">${esc(lineas[0])}</div><div class="lab-encuesta__nota">Selecciona una opción</div>${lineas.slice(1).map(o => `<div class="lab-encuesta__opcion"><span class="lab-encuesta__circulo"></span>${esc(o)}</div>`).join('')}<span class="lab-burbuja__hora">${hora} <span class="lab-burbuja__ticks">✓✓</span></span></div>`
    : `<div class="lab-burbuja">${esc(p.descripcion)}<span class="lab-burbuja__hora">${hora} <span class="lab-burbuja__ticks">✓✓</span></span></div>`;
  const anuncio = tipo === 'video' ? '🎥 Video para grabar y enviar al grupo' : tipo === 'audio' ? '🎙️ Audio para grabar y enviar al grupo' : '';
  return `
    <article class="lab-chat lab-chat--wa lab-idea" data-pieza="${i}">
      <div class="lab-chat__cab">
        <span class="lab-avatar lab-avatar--chico lab-avatar--cliente">${ICONOS_IDEA[tipo]}</span>
        <div class="lab-chat__quien"><strong>${esc(NOMBRES_IDEA[tipo])} para tu grupo</strong><span>${esc(categoria ? `${categoria}${p.apoyo ? ' · ' + p.apoyo : ''}` : (p.apoyo || 'Idea para mantener la conexión'))}</span></div>
      </div>
      <div class="lab-chat__cuerpo">
        ${anuncio ? `<div class="lab-chat__contexto">${anuncio}</div>` : ''}
        <div class="lab-chat__fila">${cuerpoMensaje}</div>
      </div>
      <div class="lab-copiar-fila">
        ${botonCopiar('descripcion', i, tipo === 'encuesta' ? 'Copiar pregunta y opciones' : 'Copiar mensaje')}
        ${p.guion ? botonCopiar('guion', i, 'Copiar guion') : ''}
      </div>
      ${p.guion ? `<div class="lab-reelcard__bloque"><div class="lab-reelcard__etiqueta">Lo que dices</div><div class="lab-reelcard__guion">${esc(p.guion)}</div></div>` : ''}
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
const esEditable = (p) => !!p && ['reel', 'carrusel', 'chat', 'imagen', 'historia', 'email', 'idea'].includes(p.tipo);

function htmlVista(p, i) {
  return p.tipo === 'carrusel' ? htmlCarrusel(p, i)
    : p.tipo === 'historia' ? htmlHistoria(p, i)
    : p.tipo === 'email' ? htmlEmail(p, i)
    : p.tipo === 'imagen' ? htmlImagen(p, i)
    : p.tipo === 'reel' ? htmlReel(p, i)
    : p.tipo === 'chat' ? htmlChat(p, i)
    : p.tipo === 'idea' ? htmlIdea(p, i)
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
    ? `<div class="lab-propuesta__titulo">${esc(p.titulo)}${p.angulo ? ` <span class="lab-propuesta__angulo">Ángulo ${esc(p.angulo)}</span>` : ''}${p.formato === 'email' && p.orden ? ` <span class="lab-propuesta__angulo">Email ${esc(p.orden)}</span>` : ''}${p.formato !== 'email' && p.audiencia ? ` <span class="lab-propuesta__angulo">${esc(p.audiencia)}</span>` : ''}${p.editadoEn ? ' <span class="lab-propuesta__editado">Editado</span>' : ''}</div>`
    : '';
  return `<div class="lab-propuesta" data-i="${i}">${titulo}<div class="lab-propuesta__cuerpo">${htmlCuerpoVista(p, i, op)}</div></div>`;
}

/** Todas las propuestas, agrupadas por formato y a la vista, como siempre.
 *  `nombresFormato`: { reel: { nombre }, ... }. `op.editable`: muestra el botón Editar. */
export function htmlPiezas(piezas, nombresFormato, op) {
  const porFormato = {};
  (piezas || []).forEach((p, i) => { (porFormato[p.formato] = porFormato[p.formato] || []).push({ p, i }); });
  // Flujo de mensajes para el grupo: un botón copia todos los mensajes en orden, cada uno con su día y su hora.
  const barraFlujo = op && op.flujo
    ? '<div class="lab-copiar-fila"><button type="button" class="btn btn--ghost lab-btn-copiar" data-copiar-flujo>Copiar todo el flujo</button><span class="text-soft lab-pagado__nota">Copia todos los mensajes en orden, cada uno con su día y su hora.</span></div>'
    : '';
  return barraFlujo + Object.keys(porFormato).map(f => `
    <div class="lab-formato">
      <h4 class="lab-formato__titulo">${esc((nombresFormato && nombresFormato[f] && nombresFormato[f].nombre) || (f === 'idea' ? 'Ideas para tu grupo' : f))}</h4>
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
  } else if (p.tipo === 'historia') {
    campos = (p.laminas || []).map((t, n) => campoTexto(`Pantalla ${n + 1}`, `lamina:${n}`, t, 2, 500)).join('');
  } else if (p.tipo === 'email') {
    campos = campoLinea('Asunto', 'asunto', p.asunto, 150)
      + campoTexto('Cuerpo del email', 'cuerpo', p.cuerpo, 12, 3500);
  } else if (p.tipo === 'imagen') {
    campos = campoLinea('Gancho', 'titular', p.titular, 200)
      + campoLinea('Bajada', 'apoyo', p.apoyo, 300)
      + campoLinea(p.etapaId === 'venta' ? 'Producto y promesa' : p.etapaId === 'open' ? 'Invitación a la comunidad' : 'Título de la sesión con fecha y hora', 'sesion', p.sesion, 200)
      + campoLinea('CTA (texto del botón)', 'boton', p.boton, 40)
      + campoTexto('Texto del anuncio', 'anuncio', p.anuncio, 6, 2500)
      + campoTexto('Idea visual', 'ideaVisual', p.ideaVisual, 3, 500);
  } else if (p.tipo === 'idea') {
    campos = campoLinea('Para qué sirve', 'apoyo', p.apoyo, 300)
      + campoTexto((p.medio || p.ideaTipo) === 'encuesta' ? 'Pregunta y opciones (una por línea)' : 'Mensaje para el grupo', 'descripcion', p.descripcion, 6, 1500)
      + (p.guion !== undefined ? campoTexto('Lo que dices', 'guion', p.guion, 6, 2500) : '');
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
  if (p.tipo === 'historia') return { laminas: (p.laminas || []).map((_, n) => val(`lamina:${n}`)) };
  if (p.tipo === 'email') return { asunto: val('asunto'), cuerpo: val('cuerpo') };
  if (p.tipo === 'idea') return { apoyo: val('apoyo'), descripcion: val('descripcion'), ...(p.guion !== undefined ? { guion: val('guion') } : {}) };
  if (p.tipo === 'imagen') return { titular: val('titular'), apoyo: val('apoyo'), sesion: val('sesion'), boton: val('boton'), anuncio: val('anuncio'), ideaVisual: val('ideaVisual') };
  return { mensajes: (p.mensajes || []).map((m, n) => ({ contexto: form.querySelector(`[data-campo="contexto:${n}"]`) ? val(`contexto:${n}`) : (m.contexto || ''), texto: val(`texto:${n}`) })) };
}

export function validarEdicion(p, c) {
  if (p.tipo === 'reel' && !c.guion && !c.descripcion) return 'Escribe el guion o la descripción.';
  if (p.tipo === 'carrusel' && c.laminas.some(t => !t)) return 'Ninguna lámina puede quedar vacía.';
  if (p.tipo === 'historia' && c.laminas.some(t => !t)) return 'Ninguna pantalla puede quedar vacía.';
  if (p.tipo === 'email' && (!c.asunto || !c.cuerpo)) return 'El email necesita asunto y cuerpo.';
  if (p.tipo === 'imagen' && !c.titular && !c.anuncio) return 'Escribe el titular o el texto del anuncio.';
  if (p.tipo === 'chat' && c.mensajes.some(m => !m.texto)) return 'Ningún mensaje puede quedar vacío.';
  if (p.tipo === 'idea' && !c.descripcion) return 'Escribe el mensaje para el grupo.';
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
  // Historias: tocar a la derecha o a la izquierda cambia de pantalla.
  cuerpo.querySelectorAll('[data-historia]').forEach(h => {
    const art = h.closest('[data-pieza]');
    const pant = (piezas[Number(art && art.dataset.pieza)] || {}).laminas || [];
    const texto = h.querySelector('[data-texto]');
    const barras = [...h.querySelectorAll('.lab-historia__barra')];
    let n = 0;
    const ir = (k) => {
      if (!pant.length) return;
      n = (k + pant.length) % pant.length;
      texto.textContent = pant[n];
      barras.forEach((b, j) => b.classList.toggle('is-activa', j <= n));
    };
    const sig = h.querySelector('[data-next]');
    const ant = h.querySelector('[data-prev]');
    if (sig) sig.addEventListener('click', () => ir(n + 1));
    if (ant) ant.addEventListener('click', () => ir(n - 1));
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
/** Todos los mensajes de un flujo, en orden, cada uno con su día y su hora, listos para copiar. */
export function textoFlujo(piezas) {
  return [...(piezas || [])]
    .filter(p => p && p.tipo === 'chat' && p.mensajes && p.mensajes[0])
    .sort((a, b) => (a.orden || 0) - (b.orden || 0))
    .map(p => `${p.mensajes[0].contexto ? `📅 ${p.mensajes[0].contexto}\n\n` : ''}${p.mensajes[0].texto}`)
    .join('\n\n———\n\n');
}

export function conectarPiezas(contenedor, piezas, op) {
  const opciones = op || {};

  contenedor.querySelectorAll('[data-copiar-flujo]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const original = btn.textContent;
      const ok = await copiarAlPortapapeles(textoFlujo(piezas));
      btn.textContent = ok ? 'Copiado ✓' : 'No se pudo copiar';
      setTimeout(() => { btn.textContent = original; }, 1800);
    });
  });

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
