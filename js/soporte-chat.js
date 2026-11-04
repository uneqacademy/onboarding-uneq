/* ============================================================
   soporte-chat.js
   Burbuja flotante de soporte para ALUMNOS (todos los niveles). Abre un
   chat con la Cloud Function chatSoporteAlumno, que responde dudas de la
   app, del programa y de los pagos de quien escribe.

   Privacidad: acá nunca se manda un id de alumno. La función identifica
   a la persona por su sesión y solo lee SUS datos (ver functions/index.js).

   El historial se guarda en soporteChat/{uid} (cada persona ve solo el
   suyo). A la IA solo se le manda el tramo más reciente.
   Nombre y foto del asistente: configuracion/general (soporteIaNombre /
   soporteIaFotoUrl), editables por el director en Configuración.
   ============================================================ */

import { app, db, auth } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";
import { ref, get, push, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { escaparHtml } from './util-html.js';

const MENSAJES_POR_PAGINA = 40;   // cuántos se muestran al abrir
const MENSAJES_CONTEXTO_IA = 6;   // cuántos se le pasan a la IA
const chatSoporte = httpsCallable(getFunctions(app), 'chatSoporteAlumno', { timeout: 90000 });

const PLACEHOLDER_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#1B2A4A"/><text x="40" y="53" font-size="36" text-anchor="middle">💬</text></svg>'
);

let uid = null;
let identidadCargada = false;
let chatIniciado = false;
let nombreAsistente = 'Asistente UNEQ';
let fotoAsistente = '';
let whatsappSoporte = '';
let nombreAlumno = '';
let historial = [];     // de más antiguo a más nuevo

const el = (id) => document.getElementById(id);

// Resguardo: por si a la IA se le escapa Markdown, se limpia negrita y títulos.
function limpiarFormatoIA(texto) {
  return String(texto || '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '');
}

// Convierte los enlaces https en tocables (el texto ya viene escapado).
function enlazar(textoEscapado) {
  return textoEscapado.replace(/(https?:\/\/[^\s<>"']+)/g, (m) => {
    const limpio = m.replace(/[.,;:!?)]+$/, '');
    return `<a href="${limpio}" target="_blank" rel="noopener noreferrer">${limpio}</a>${m.slice(limpio.length)}`;
  });
}

function avatarHtml() {
  return `<img class="soporte-chat__avatar" src="${escaparHtml(fotoAsistente || PLACEHOLDER_AVATAR)}" alt="">`;
}

function burbujaHtml(texto, esUsuario) {
  if (esUsuario) {
    return `<div class="soporte-chat__fila soporte-chat__fila--usuario"><div class="soporte-chat__msg soporte-chat__msg--usuario">${enlazar(escaparHtml(texto))}</div></div>`;
  }
  return `<div class="soporte-chat__fila">${avatarHtml()}<div class="soporte-chat__msg">${enlazar(escaparHtml(limpiarFormatoIA(texto)))}</div></div>`;
}

function saludoInicial() {
  const nombre = nombreAlumno ? `, ${nombreAlumno}` : '';
  return `¡Hola${nombre}! Soy ${nombreAsistente}. Puedo ayudarte con dudas de la app, de tu programa en Universo UNEQ y de tus pagos, y decirte con quién hablar si necesitas ayuda de una persona. ¿En qué te ayudo?`;
}

function pintar() {
  const cont = el('soporte-chat-mensajes');
  if (!cont) return;
  const visibles = historial.slice(-MENSAJES_POR_PAGINA);
  cont.innerHTML = burbujaHtml(saludoInicial(), false)
    + visibles.map(m => burbujaHtml(m.texto, m.rol === 'usuario')).join('');
  cont.scrollTop = cont.scrollHeight;
}

function aplicarIdentidad() {
  const nombreEl = el('soporte-chat-nombre');
  if (nombreEl) nombreEl.textContent = nombreAsistente;
  const src = fotoAsistente || PLACEHOLDER_AVATAR;
  const burbujaImg = el('soporte-chat-burbuja-img');
  if (burbujaImg) burbujaImg.src = src;
  const cabeceraImg = el('soporte-chat-cabecera-img');
  if (cabeceraImg) cabeceraImg.src = src;
  const humano = el('soporte-chat-humano');
  if (humano) {
    const tel = String(whatsappSoporte || '').replace(/[^0-9]/g, '');
    humano.classList.toggle('hidden', !tel);
    if (tel) humano.href = `https://wa.me/${tel}`;
  }
}

async function cargarIdentidad() {
  if (identidadCargada) return;
  identidadCargada = true;
  try {
    const snap = await get(ref(db, 'configuracion/general'));
    const c = snap.exists() ? snap.val() : {};
    if (String(c.soporteIaNombre || '').trim()) nombreAsistente = String(c.soporteIaNombre).trim();
    fotoAsistente = c.soporteIaFotoUrl || '';
    whatsappSoporte = c.whatsappSoporte || '';
  } catch (err) {
    console.error('No se pudo cargar la identidad del chat de soporte:', err);
  }
  aplicarIdentidad();
}

async function iniciarChat() {
  if (chatIniciado || !uid) return;
  chatIniciado = true;
  try {
    const idSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
    if (idSnap.exists()) {
      const nombreSnap = await get(ref(db, `alumnos/${idSnap.val()}/nombre`));
      if (nombreSnap.exists()) nombreAlumno = String(nombreSnap.val() || '').trim().split(/\s+/)[0];
    }
  } catch (err) {
    console.error('No se pudo leer el nombre del alumno para el saludo:', err);
  }
  try {
    const snap = await get(ref(db, `soporteChat/${uid}`));
    historial = snap.exists() ? Object.values(snap.val()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) : [];
  } catch (err) {
    console.error('No se pudo cargar el historial del chat de soporte:', err);
    historial = [];
  }
  pintar();
}

async function guardarMensaje(rol, texto) {
  const mensaje = { rol, texto, createdAt: Date.now() };
  historial.push(mensaje);
  if (!uid) return;
  try {
    await set(push(ref(db, `soporteChat/${uid}`)), mensaje);
  } catch (err) {
    console.error('No se pudo guardar el mensaje del chat de soporte:', err);
  }
}

async function enviar() {
  const input = el('soporte-chat-input');
  const btn = el('soporte-chat-enviar');
  const cont = el('soporte-chat-mensajes');
  const mensaje = input.value.trim();
  if (!mensaje) return;

  input.value = '';
  input.disabled = true;
  btn.disabled = true;
  cont.insertAdjacentHTML('beforeend', burbujaHtml(mensaje, true));
  // A la IA solo va el tramo reciente (los datos los lee ella, desde el servidor).
  const contexto = historial.slice(-MENSAJES_CONTEXTO_IA).map(m => ({ rol: m.rol, texto: m.texto }));
  await guardarMensaje('usuario', mensaje);
  cont.insertAdjacentHTML('beforeend', `<div class="soporte-chat__fila" id="soporte-chat-cargando">${avatarHtml()}<div class="soporte-chat__msg soporte-chat__msg--cargando">Escribiendo…</div></div>`);
  cont.scrollTop = cont.scrollHeight;

  try {
    const resultado = await chatSoporte({ mensaje, historial: contexto });
    const respuesta = (resultado.data && resultado.data.respuesta) || 'No pude generar una respuesta. Intenta de nuevo.';
    el('soporte-chat-cargando')?.remove();
    cont.insertAdjacentHTML('beforeend', burbujaHtml(respuesta, false));
    await guardarMensaje('asistente', respuesta);
  } catch (err) {
    console.error('Error en el chat de soporte:', err);
    el('soporte-chat-cargando')?.remove();
    // Los mensajes de la función (tope diario, solo alumnos) ya vienen en español.
    const texto = err && ['functions/resource-exhausted', 'functions/permission-denied', 'functions/unavailable', 'functions/invalid-argument'].includes(err.code) && err.message
      ? err.message
      : 'Hubo un problema respondiendo. Intenta de nuevo en un momento.';
    cont.insertAdjacentHTML('beforeend', burbujaHtml(texto, false));
  } finally {
    cont.scrollTop = cont.scrollHeight;
    input.disabled = false;
    btn.disabled = false;
    input.focus();
  }
}

function alternarPanel(abrir) {
  const panel = el('soporte-chat-panel');
  const burbuja = el('soporte-chat-burbuja');
  if (!panel) return;
  const mostrar = abrir === undefined ? panel.classList.contains('hidden') : abrir;
  panel.classList.toggle('hidden', !mostrar);
  burbuja?.setAttribute('aria-expanded', String(mostrar));
  if (mostrar) {
    iniciarChat().then(() => el('soporte-chat-input')?.focus());
  }
}

el('soporte-chat-burbuja')?.addEventListener('click', () => alternarPanel());
el('soporte-chat-cerrar')?.addEventListener('click', () => alternarPanel(false));
el('soporte-chat-enviar')?.addEventListener('click', enviar);
el('soporte-chat-input')?.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); enviar(); }
});

onAuthStateChanged(auth, (user) => {
  // Al cambiar de persona (o cerrar sesión) se limpia todo lo de la anterior.
  uid = user ? user.uid : null;
  chatIniciado = false;
  nombreAlumno = '';
  historial = [];
  el('soporte-chat-panel')?.classList.add('hidden');
  const cont = el('soporte-chat-mensajes');
  if (cont) cont.innerHTML = '';
  if (user) cargarIdentidad();
});
