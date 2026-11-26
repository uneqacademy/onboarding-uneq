/* ============================================================
   instagram-panel.js — panel "Instagram" dentro del Laboratorio IA
   ============================================================
   Fase 2 (prueba): solo lo ve el equipo (director, copiloto) y el Alumno Demo. Permite conectar la cuenta de
   Instagram por el inicio de sesión de Meta, ver cuál está conectada, publicar UNA imagen de prueba y desconectar.
   El acceso a Instagram vive en el servidor; aquí solo se ve el estado (instagramEstado/{uid}). */

import { auth, db } from './firebase-config.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { escaparHtml } from './util-html.js';
import { getCurrentRole, esModoDemo } from './main.js';
import { llamarInstagram, urlInicioSesion, direccionDeRetorno } from './instagram-api.js';

function raiz() { return document.getElementById('lab-instagram'); }
function puedeVerlo() { const r = getCurrentRole(); return r === 'director' || r === 'coach' || (r === 'alumno' && esModoDemo()); }

export async function cargarPanelInstagram() {
  const el = raiz();
  if (!el) return;
  if (!puedeVerlo() || !auth.currentUser) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = '<div class="ig-panel"><span class="text-soft">Revisando tu conexión con Instagram…</span></div>';
  let estado = { conectado: false };
  try {
    const snap = await get(ref(db, `instagramEstado/${auth.currentUser.uid}`));
    const v = snap.val();
    if (v && v.conectado) estado = v;
  } catch (err) { console.error('Instagram: no se pudo leer el estado:', err); }
  pintar(estado);
}

function pintar(estado, aviso) {
  const el = raiz();
  const nota = aviso ? `<p class="ig-aviso">${escaparHtml(aviso)}</p>` : '';
  if (estado.conectado) {
    el.innerHTML = `<div class="ig-panel">
      <div class="ig-panel__titulo">Instagram conectado: <strong>@${escaparHtml(estado.username || '')}</strong></div>
      <p class="ig-panel__texto">Solo publicamos en tu cuenta lo que tú revisas y confirmas. No leemos tus mensajes.</p>
      <div class="ig-panel__acciones">
        <button type="button" class="btn btn-primary" id="ig-probar">Publicar imagen de prueba</button>
        <button type="button" class="btn btn-secondary" id="ig-desconectar">Desconectar</button>
      </div>${nota}</div>`;
    document.getElementById('ig-probar').addEventListener('click', publicarPrueba);
    document.getElementById('ig-desconectar').addEventListener('click', desconectar);
  } else {
    const sinRetorno = !direccionDeRetorno();
    el.innerHTML = `<div class="ig-panel">
      <div class="ig-panel__titulo">Instagram</div>
      <p class="ig-panel__texto">Conecta tu cuenta profesional de Instagram para publicar desde aquí lo que crees en el Laboratorio. Fase de prueba: solo el equipo UNEQ.</p>
      <div class="ig-panel__acciones"><button type="button" class="btn btn-primary" id="ig-conectar"${sinRetorno ? ' disabled' : ''}>Conectar Instagram</button></div>
      ${sinRetorno ? '<p class="ig-aviso">Entra por app.somosuneq.com o alumnos.somosuneq.com para conectar.</p>' : ''}${nota}</div>`;
    const b = document.getElementById('ig-conectar');
    if (b) b.addEventListener('click', () => { const u = urlInicioSesion(); if (u) location.href = u; });
  }
}

function bloquear(si) { raiz().querySelectorAll('button').forEach(b => { b.disabled = si; }); }

async function publicarPrueba() {
  if (!confirm('Se publicará UNA imagen de prueba, con el texto "Prueba de conexión de Universo UNEQ", en tu Instagram. ¿Continuar? Después puedes borrarla desde Instagram.')) return;
  bloquear(true);
  try {
    const r = await llamarInstagram('publicarPrueba');
    pintar({ conectado: true, username: (await usuarioActual()) }, r.permalink ? `Publicado: ${r.permalink}` : 'Publicado en tu Instagram.');
  } catch (err) {
    pintar({ conectado: true, username: (await usuarioActual()) }, (err && err.message) || 'No se pudo publicar.');
  }
}

async function desconectar() {
  if (!confirm('¿Desconectar tu cuenta de Instagram? Borraremos el acceso guardado y la app ya no podrá publicar en ella.')) return;
  bloquear(true);
  try { await llamarInstagram('desconectar'); pintar({ conectado: false }, 'Tu cuenta se desconectó.'); }
  catch (err) { pintar({ conectado: true, username: (await usuarioActual()) }, (err && err.message) || 'No se pudo desconectar.'); }
}

async function usuarioActual() {
  try { const s = await get(ref(db, `instagramEstado/${auth.currentUser.uid}`)); return (s.val() || {}).username || ''; } catch (err) { return ''; }
}
