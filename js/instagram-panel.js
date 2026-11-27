/* ============================================================
   instagram-panel.js — panel "Instagram" dentro del Laboratorio IA y del Laboratorio UNEQ
   ============================================================
   Laboratorio IA (fase de prueba): solo lo ve el equipo (director, copiloto) y el Alumno Demo. Permite conectar la cuenta de
   Instagram por el inicio de sesión de Meta, ver cuál está conectada, publicar UNA imagen de prueba y desconectar.
   Laboratorio UNEQ: el mismo panel, pero para la cuenta COMPARTIDA del equipo (@somosuneq): se conecta una vez y todas las
   personas con acceso publican en ella. Quién puede verlo lo decide quien lo abre (laboratorio-uneq.js).
   El acceso a Instagram vive en el servidor; aquí solo se ve el estado (instagramEstado/{uid} o instagramEstado/uneq). */

import { auth, db } from './firebase-config.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { escaparHtml } from './util-html.js';
import { getCurrentRole, esModoDemo } from './main.js';
import { llamarInstagram, urlInicioSesion, direccionDeRetorno, CUENTA_UNEQ } from './instagram-api.js';
import { abrirDisenoCarrusel, CARRUSEL_EJEMPLO } from './instagram-carrusel.js';

// Dónde se dibuja y de quién es la conexión. Por defecto: el panel del Laboratorio IA y la cuenta propia de la persona.
let cfg = { raizId: 'lab-instagram', cuenta: '' };

function raiz() { return document.getElementById(cfg.raizId); }
const esCompartida = () => cfg.cuenta === CUENTA_UNEQ;
const claveEstado = () => (esCompartida() ? CUENTA_UNEQ : (auth.currentUser && auth.currentUser.uid));
const extra = () => (esCompartida() ? { cuenta: CUENTA_UNEQ } : {});
function puedeVerlo() { const r = getCurrentRole(); return r === 'director' || r === 'coach' || (r === 'alumno' && esModoDemo()); }

/* `opciones.cuenta = 'uneq'` + `opciones.raizId` dibuja el panel de la cuenta compartida (el que llama ya comprobó el acceso). */
export async function cargarPanelInstagram(opciones) {
  cfg = { raizId: (opciones && opciones.raizId) || 'lab-instagram', cuenta: (opciones && opciones.cuenta === CUENTA_UNEQ) ? CUENTA_UNEQ : '' };
  const el = raiz();
  if (!el) return;
  if (!auth.currentUser || (!esCompartida() && !puedeVerlo())) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = `<div class="ig-panel"><span class="text-soft">Revisando la conexión con Instagram…</span></div>`;
  let estado = { conectado: false };
  try {
    const snap = await get(ref(db, `instagramEstado/${claveEstado()}`));
    const v = snap.val();
    if (v && v.conectado) estado = v;
  } catch (err) { console.error('Instagram: no se pudo leer el estado:', err); }
  pintar(estado);
}

function pintar(estado, aviso) {
  const el = raiz();
  const nota = aviso ? `<p class="ig-aviso">${escaparHtml(aviso)}</p>` : '';
  const compartida = esCompartida();
  if (estado.conectado) {
    el.innerHTML = `<div class="ig-panel">
      <div class="ig-panel__titulo">${compartida ? 'Instagram de UNEQ conectado' : 'Instagram conectado'}: <strong>@${escaparHtml(estado.username || '')}</strong></div>
      <p class="ig-panel__texto">${compartida
        ? 'Todo el equipo con acceso publica en esta cuenta. Solo se publica lo que alguien revisa y confirma. No leemos mensajes.'
        : 'Solo publicamos en tu cuenta lo que tú revisas y confirmas. No leemos tus mensajes.'}</p>
      <div class="ig-panel__acciones">
        ${compartida ? '' : `<button type="button" class="btn btn--primary" id="ig-ejemplo">Probar con un carrusel de ejemplo</button>
        <button type="button" class="btn btn--ghost" id="ig-probar">Publicar imagen de prueba</button>`}
        <button type="button" class="btn btn--ghost" id="ig-desconectar">Desconectar</button>
      </div>${nota}</div>`;
    const ejemplo = document.getElementById('ig-ejemplo');
    if (ejemplo) ejemplo.addEventListener('click', () => abrirDisenoCarrusel(CARRUSEL_EJEMPLO));
    const probar = document.getElementById('ig-probar');
    if (probar) probar.addEventListener('click', publicarPrueba);
    document.getElementById('ig-desconectar').addEventListener('click', desconectar);
  } else {
    const sinRetorno = !direccionDeRetorno();
    el.innerHTML = `<div class="ig-panel">
      <div class="ig-panel__titulo">${compartida ? 'Instagram de UNEQ (@somosuneq)' : 'Instagram'}</div>
      <p class="ig-panel__texto">${compartida
        ? 'Conecta la cuenta profesional de Instagram de UNEQ para publicar desde aquí. Se conecta una sola vez: después todo el equipo con acceso puede publicar. Al iniciar sesión, elige la cuenta @somosuneq.'
        : 'Conecta tu cuenta profesional de Instagram para publicar desde aquí lo que crees en el Laboratorio. Fase de prueba: solo el equipo UNEQ.'}</p>
      <div class="ig-panel__acciones"><button type="button" class="btn btn--primary" id="ig-conectar"${sinRetorno ? ' disabled' : ''}>Conectar Instagram</button></div>
      ${sinRetorno ? '<p class="ig-aviso">Entra por app.somosuneq.com o alumnos.somosuneq.com para conectar.</p>' : ''}${nota}</div>`;
    const b = document.getElementById('ig-conectar');
    if (b) b.addEventListener('click', () => { const u = urlInicioSesion(cfg.cuenta); if (u) location.href = u; });
  }
}

function bloquear(si) { raiz().querySelectorAll('button').forEach(b => { b.disabled = si; }); }

async function publicarPrueba() {
  if (!confirm('Se publicará UNA imagen de prueba, con el texto "Prueba de conexión de Universo UNEQ", en tu Instagram. ¿Continuar? Después puedes borrarla desde Instagram.')) return;
  bloquear(true);
  try {
    const r = await llamarInstagram('publicarPrueba', extra());
    pintar({ conectado: true, username: (await usuarioActual()) }, r.permalink ? `Publicado: ${r.permalink}` : 'Publicado en tu Instagram.');
  } catch (err) {
    pintar({ conectado: true, username: (await usuarioActual()) }, (err && err.message) || 'No se pudo publicar.');
  }
}

async function desconectar() {
  const pregunta = esCompartida()
    ? '¿Desconectar la cuenta de Instagram de UNEQ? Nadie del equipo podrá publicar hasta que alguien la vuelva a conectar.'
    : '¿Desconectar tu cuenta de Instagram? Borraremos el acceso guardado y la app ya no podrá publicar en ella.';
  if (!confirm(pregunta)) return;
  bloquear(true);
  try { await llamarInstagram('desconectar', extra()); pintar({ conectado: false }, esCompartida() ? 'La cuenta de UNEQ se desconectó.' : 'Tu cuenta se desconectó.'); }
  catch (err) { pintar({ conectado: true, username: (await usuarioActual()) }, (err && err.message) || 'No se pudo desconectar.'); }
}

async function usuarioActual() {
  try { const s = await get(ref(db, `instagramEstado/${claveEstado()}`)); return (s.val() || {}).username || ''; } catch (err) { return ''; }
}
