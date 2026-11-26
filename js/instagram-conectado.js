/* ============================================================
   instagram-conectado.js — página a la que Meta devuelve a la persona tras iniciar sesión
   ============================================================
   Llega con ?code=...&state=... (o ?error=...). Se comprueba el "state", se manda el código al servidor
   (acción "conectar") y se vuelve a la app. El código es de un solo uso y no se guarda en ningún lado. */

import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { llamarInstagram, direccionDeRetorno, IG_CLAVE_ESTADO } from './instagram-api.js';

const cuadro = document.getElementById('ig-mensaje');
const volver = document.getElementById('ig-volver');

function mostrar(texto, esError) {
  cuadro.textContent = texto;
  cuadro.className = esError ? 'legal-aviso ig-error' : 'legal-aviso';
}
function mostrarVolver() { volver.classList.remove('hidden'); }

async function procesar() {
  const q = new URLSearchParams(location.search);
  // Se borra el código de la barra de direcciones para que no quede en el historial.
  history.replaceState(null, '', location.pathname);
  if (q.get('error') || q.get('error_reason')) {
    mostrar('No se conectó Instagram: cancelaste el permiso o Meta lo rechazó. Puedes intentarlo de nuevo desde el Laboratorio.', true);
    return mostrarVolver();
  }
  const code = q.get('code') || '';
  const state = q.get('state') || '';
  const guardado = sessionStorage.getItem(IG_CLAVE_ESTADO) || '';
  sessionStorage.removeItem(IG_CLAVE_ESTADO);
  if (!code || !state || !guardado || state !== guardado) {
    mostrar('La conexión no se pudo verificar (el enlace caducó o se abrió desde otra ventana). Vuelve al Laboratorio y pulsa "Conectar Instagram" otra vez.', true);
    return mostrarVolver();
  }
  const retorno = direccionDeRetorno();
  if (!retorno) {
    mostrar('Esta dirección no está autorizada para conectar Instagram.', true);
    return mostrarVolver();
  }
  try {
    const r = await llamarInstagram('conectar', { code, redirectUri: retorno });
    mostrar(r && r.username ? `¡Listo! Conectamos la cuenta @${r.username}.` : '¡Listo! Conectamos tu cuenta de Instagram.');
    setTimeout(() => { location.replace('index.html'); }, 1800);
    mostrarVolver();
  } catch (err) {
    mostrar((err && err.message) || 'No se pudo conectar Instagram. Intenta de nuevo.', true);
    mostrarVolver();
  }
}

let iniciado = false;
onAuthStateChanged(auth, user => {
  if (iniciado) return;
  if (!user) {
    // La sesión puede tardar un instante en restaurarse; si no hay, se pide entrar.
    setTimeout(() => { if (!auth.currentUser && !iniciado) { iniciado = true; mostrar('Tu sesión no está abierta. Entra a la app y vuelve a conectar Instagram desde el Laboratorio.', true); mostrarVolver(); } }, 2500);
    return;
  }
  iniciado = true;
  procesar();
});
