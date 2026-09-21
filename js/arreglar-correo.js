/* ============================================================
   arreglar-correo.js — página interna arreglar-correo.html, solo
   para el Director. Corrige un correo mal escrito en Authentication.

   No llama a una Cloud Function HTTPS directamente: el proyecto tiene
   una política de organización de Google Cloud que bloquea hacer
   públicas funciones nuevas, así que en vez de eso esta página escribe
   la solicitud en mantenimiento/corregirCorreo/{id} (protegido para
   que solo el Director pueda escribir ahí) y la función
   corregirCorreoAlumnoDb (un disparador de la base de datos, que no
   necesita ser pública) hace el cambio y escribe el resultado en el
   mismo registro — esta página lo espera y lo muestra.

   No está enlazada desde ningún menú; se abre escribiendo la URL
   directo. Reutiliza la sesión ya iniciada en el resto de la app.

   Recomendación: una vez que ya no necesites esta herramienta, borra
   este archivo, arreglar-correo.html, el nodo mantenimiento de las
   reglas y la función corregirCorreoAlumnoDb de index.js, y vuelve a
   desplegar.
   ============================================================ */

import { app, auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getDatabase, ref, get, push, set, onValue, off } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

const db = getDatabase(app);

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
    const solicitudRef = push(ref(db, 'mantenimiento/corregirCorreo'));
    await set(solicitudRef, { correoActual, correoNuevo, createdAt: Date.now() });

    // Espera a que la función escriba el resultado en el mismo registro
    // (normalmente toma 1-2 segundos). Si pasan 20s sin respuesta, avisa.
    const timeoutId = setTimeout(() => {
      off(solicitudRef);
      mostrarResultado('No llegó respuesta después de 20 segundos. Revisa en Firebase si la función corregirCorreoAlumnoDb está desplegada.', true);
      btnEl.disabled = false;
      btnEl.textContent = 'Corregir correo';
    }, 20000);

    onValue(solicitudRef, (snap) => {
      const val = snap.val();
      if (!val || !val.estado) return; // aún procesando
      clearTimeout(timeoutId);
      off(solicitudRef);
      mostrarResultado(val.estado === 'ok' ? `✅ ${val.mensaje}` : `❌ ${val.mensaje}`, val.estado !== 'ok');
      if (val.estado === 'ok') formEl.reset();
      btnEl.disabled = false;
      btnEl.textContent = 'Corregir correo';
    });
  } catch (err) {
    mostrarResultado(`❌ ${err.message || 'No se pudo enviar la solicitud. Intenta de nuevo.'}`, true);
    btnEl.disabled = false;
    btnEl.textContent = 'Corregir correo';
  }
});
