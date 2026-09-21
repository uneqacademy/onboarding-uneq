/* ============================================================
   arreglar-correo.js — página interna arreglar-correo.html, solo
   para el Director. Llama a la Cloud Function corregirCorreoUsuario
   (ver index.js) para arreglar un correo mal escrito en Authentication.

   No está enlazada desde ningún menú; se abre escribiendo la URL
   directo. Reutiliza la sesión ya iniciada en el resto de la app
   (mismo dominio → mismo Firebase Auth). Si nadie tiene sesión de
   Director abierta en el navegador, pide iniciar sesión primero desde
   la app normal.

   Recomendación: una vez que ya no necesites esta herramienta, borra
   este archivo, arreglar-correo.html y la función corregirCorreoUsuario
   de index.js, y vuelve a desplegar.
   ============================================================ */

import { app, auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";

const db = getDatabase(app);
const functions = getFunctions(app);
const corregirCorreo = httpsCallable(functions, 'corregirCorreoUsuario');

const estadoSesionEl = document.getElementById('estado-sesion');
const formEl = document.getElementById('form-corregir');
const resultadoEl = document.getElementById('resultado');
const btnEl = document.getElementById('btn-corregir');

function mostrarResultado(texto, esError) {
  resultadoEl.textContent = texto;
  resultadoEl.className = esError ? 'error' : 'ok';
}

onAuthStateChanged(auth, async (usuario) => {
  if (!usuario) {
    estadoSesionEl.textContent = 'No hay una sesión iniciada. Abre la app normal (app.uneqacademy.com), inicia sesión como Director, y vuelve a abrir esta página en la misma pestaña o navegador.';
    return;
  }
  const snap = await get(ref(db, `usuarios/${usuario.uid}`));
  const datos = snap.exists() ? snap.val() : {};
  const roles = datos.roles || (datos.rol ? { [datos.rol]: true } : {});
  if (!roles.director) {
    estadoSesionEl.textContent = `Sesión iniciada como ${datos.nombre || usuario.email}, pero esta herramienta es solo para el Director.`;
    return;
  }
  estadoSesionEl.textContent = `Sesión: ${datos.nombre || usuario.email} (Director) ✅`;
  formEl.classList.remove('hidden');
});

formEl.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const correoActual = document.getElementById('correo-actual').value.trim();
  const correoNuevo = document.getElementById('correo-nuevo').value.trim();
  resultadoEl.className = '';
  btnEl.disabled = true;
  btnEl.textContent = 'Corrigiendo...';
  try {
    const respuesta = await corregirCorreo({ correoActual, correoNuevo });
    mostrarResultado(`✅ Corregido. La cuenta ahora tiene el correo: ${respuesta.data.correo}`, false);
    formEl.reset();
  } catch (err) {
    mostrarResultado(`❌ ${err.message || 'No se pudo corregir. Intenta de nuevo.'}`, true);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Corregir correo';
  }
});
