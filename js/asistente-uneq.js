/* ============================================================
   asistente-uneq.js
   Conecta el chat "Asistente UNEQ" (Dashboard de mentor/coach/
   director) con la Cloud Function consultarAsistenteUneq — que
   usa Gemini con herramientas para ir a buscar datos reales según
   la pregunta (nunca lee todo de una vez). Nunca tiene acceso a
   pagos/acuerdos/montos: esas herramientas ni siquiera existen del
   lado del servidor.

   El mismo chat vive 3 veces en el HTML (uno por rol, con IDs que
   terminan en -mentor/-coach/-director) porque las 3 vistas de
   Dashboard coexisten en el DOM — cada una se conecta por separado acá.

   El historial se guarda en asistenteHistorial/{uid}: cada persona ve
   solo su propia conversación (las reglas de Firebase no permiten leer
   la de otro, ni al Director). Se muestran los últimos 30 mensajes, con
   un botón para ir cargando los anteriores. A la IA solo se le manda el
   tramo más reciente (ver MENSAJES_CONTEXTO_IA): las respuestas se
   arman leyendo los datos reales de la app, no releyendo el historial.

   La foto y el nombre del asistente salen de configuracion/general
   (directorIaFotoUrl / directorIaNombre), editables por el Director.
   ============================================================ */

import { app, db, auth } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";
import { ref, get, push, set, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

const functions = getFunctions(app);
const MENSAJES_POR_PAGINA = 30;      // cuántos se muestran de entrada
const MENSAJES_CONTEXTO_IA = 6;      // cuántos se le pasan a la IA (3 idas y vueltas)
const consultarAsistente = httpsCallable(functions, 'consultarAsistenteUneq', { timeout: 170000 });

function escaparHtml(texto) {
  return String(texto || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Resguardo extra: por si a la IA se le escapa algún símbolo de
// Markdown pese a la instrucción. Los guiones/números de lista SÍ
// se dejan (están permitidos para pasos o listas) — solo se limpia
// negrita con asteriscos y numerales de título.
function limpiarFormatoIA(texto) {
  return String(texto || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');
}

// Foto y nombre configurados por el Director (una sola vez por sesión)
let fotoAsistente = null;
let nombreAsistente = 'Director IA';

function avatarAsistente(tamano) {
  const estiloBase = `width:${tamano}px; height:${tamano}px; border-radius:50%; flex-shrink:0; overflow:hidden;`;
  if (fotoAsistente) {
    return `<img src="${fotoAsistente}" alt="" style="${estiloBase} object-fit:cover; display:block;">`;
  }
  return `<div style="${estiloBase} background:var(--color-primary); display:flex; align-items:center; justify-content:center; color:#fff; font-size:${Math.round(tamano / 2.15)}px;">✨</div>`;
}

async function cargarIdentidadAsistente() {
  try {
    const [fotoSnap, nombreSnap] = await Promise.all([
      get(ref(db, 'configuracion/general/directorIaFotoUrl')),
      get(ref(db, 'configuracion/general/directorIaNombre'))
    ]);
    if (fotoSnap.exists() && fotoSnap.val()) fotoAsistente = fotoSnap.val();
    if (nombreSnap.exists() && String(nombreSnap.val()).trim()) nombreAsistente = String(nombreSnap.val()).trim();
  } catch (err) {
    console.error('No se pudo cargar la identidad del asistente:', err);
  }
  ['mentor', 'coach', 'director'].forEach(sufijo => {
    const nombreEl = document.getElementById(`asistente-nombre-${sufijo}`);
    if (nombreEl) nombreEl.textContent = nombreAsistente;
    const avatarEl = document.getElementById(`asistente-avatar-${sufijo}`);
    if (avatarEl && fotoAsistente) {
      avatarEl.style.background = 'none';
      avatarEl.innerHTML = `<img src="${fotoAsistente}" alt="" style="width:100%; height:100%; object-fit:cover; display:block;">`;
    }
    const bienvenidaEl = document.getElementById(`asistente-bienvenida-${sufijo}`);
    const avatarBienvenida = bienvenidaEl ? bienvenidaEl.querySelector('div > div:first-child') : null;
    if (avatarBienvenida && fotoAsistente) {
      avatarBienvenida.style.background = 'none';
      avatarBienvenida.innerHTML = `<img src="${fotoAsistente}" alt="" style="width:100%; height:100%; object-fit:cover; display:block;">`;
    }
  });
}

function burbuja(texto, esUsuario) {
  if (esUsuario) {
    return `<div style="display:flex; justify-content:flex-end;">
      <div style="background:var(--color-primary); color:#fff; padding:12px 16px; border-radius:14px; border-top-right-radius:4px; max-width:82%;">
        <p style="margin:0; font-size:13.5px; line-height:1.5; white-space:pre-wrap;">${escaparHtml(texto)}</p>
      </div>
    </div>`;
  }
  return `<div style="display:flex; gap:10px; align-items:flex-start;">
    ${avatarAsistente(28)}
    <div style="background:#fff; padding:12px 16px; border-radius:14px; border-top-left-radius:4px; max-width:82%; box-shadow:0 1px 2px rgba(0,0,0,0.06);">
      <p style="margin:0; font-size:13.5px; line-height:1.5; white-space:pre-wrap;">${escaparHtml(texto)}</p>
    </div>
  </div>`;
}

function burbujaCargando() {
  return `<div id="asistente-burbuja-cargando" style="display:flex; gap:10px; align-items:flex-start;">
    ${avatarAsistente(28)}
    <div style="background:#fff; padding:12px 16px; border-radius:14px; border-top-left-radius:4px; box-shadow:0 1px 2px rgba(0,0,0,0.06);">
      <p class="text-soft" style="margin:0; font-size:13px;">Pensando...</p>
    </div>
  </div>`;
}

function inicializarChatAsistente(sufijo) {
  const contMensajes = document.getElementById(`asistente-chat-mensajes-${sufijo}`);
  const input = document.getElementById(`asistente-chat-input-${sufijo}`);
  const btnEnviar = document.getElementById(`asistente-chat-enviar-${sufijo}`);
  if (!contMensajes || !input || !btnEnviar) return;

  const btnVerMas = document.getElementById(`asistente-ver-mas-${sufijo}`);
  const btnBorrar = document.getElementById(`asistente-borrar-${sufijo}`);
  const bienvenidaEl = document.getElementById(`asistente-bienvenida-${sufijo}`);

  let uid = null;
  let historialCompleto = [];   // todo lo guardado, de más antiguo a más nuevo
  let mostrados = 0;            // cuántos de los últimos se están mostrando

  function pintarMensajes() {
    const visibles = historialCompleto.slice(Math.max(0, historialCompleto.length - mostrados));
    contMensajes.querySelectorAll('[data-asistente-msg]').forEach(el => el.remove());
    const html = visibles.map(m => `<div data-asistente-msg>${burbuja(m.rol === 'usuario' ? m.texto : limpiarFormatoIA(m.texto), m.rol === 'usuario')}</div>`).join('');
    contMensajes.insertAdjacentHTML('beforeend', html);
    if (bienvenidaEl) bienvenidaEl.classList.toggle('hidden', historialCompleto.length > 0);
    if (btnVerMas) btnVerMas.classList.toggle('hidden', historialCompleto.length <= mostrados);
    if (btnBorrar) btnBorrar.classList.toggle('hidden', historialCompleto.length === 0);
  }

  async function cargarHistorial() {
    if (!uid) return;
    try {
      const snap = await get(ref(db, `asistenteHistorial/${uid}`));
      historialCompleto = snap.exists()
        ? Object.values(snap.val()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        : [];
    } catch (err) {
      console.error('No se pudo cargar el historial del asistente:', err);
      historialCompleto = [];
    }
    mostrados = Math.min(MENSAJES_POR_PAGINA, historialCompleto.length);
    pintarMensajes();
    contMensajes.scrollTop = contMensajes.scrollHeight;
  }

  async function guardarMensaje(rol, texto) {
    historialCompleto.push({ rol, texto, createdAt: Date.now() });
    if (!uid) return;
    try {
      await set(push(ref(db, `asistenteHistorial/${uid}`)), { rol, texto, createdAt: Date.now() });
    } catch (err) {
      console.error('No se pudo guardar el mensaje en el historial:', err);
    }
  }

  async function enviar() {
    const mensaje = input.value.trim();
    if (!mensaje) return;

    input.value = '';
    input.disabled = true;
    btnEnviar.disabled = true;

    if (bienvenidaEl) bienvenidaEl.classList.add('hidden');
    contMensajes.insertAdjacentHTML('beforeend', `<div data-asistente-msg>${burbuja(mensaje, true)}</div>`);
    // Solo el tramo más reciente va a la IA (los datos los busca en la app).
    const contexto = historialCompleto.slice(-MENSAJES_CONTEXTO_IA).map(m => ({ rol: m.rol, texto: m.texto }));
    await guardarMensaje('usuario', mensaje);
    mostrados = Math.min(historialCompleto.length, Math.max(mostrados + 1, MENSAJES_POR_PAGINA));
    contMensajes.insertAdjacentHTML('beforeend', burbujaCargando());
    contMensajes.scrollTop = contMensajes.scrollHeight;

    try {
      const resultado = await consultarAsistente({ mensaje, historial: contexto });
      const respuesta = (resultado.data && resultado.data.respuesta) || 'No pude generar una respuesta. Intenta de nuevo.';
      document.getElementById('asistente-burbuja-cargando')?.remove();
      contMensajes.insertAdjacentHTML('beforeend', `<div data-asistente-msg>${burbuja(limpiarFormatoIA(respuesta), false)}</div>`);
      await guardarMensaje('asistente', respuesta);
      mostrados = Math.min(historialCompleto.length, mostrados + 1);
      if (btnBorrar) btnBorrar.classList.remove('hidden');
    } catch (err) {
      console.error('Error consultando al Asistente UNEQ:', err);
      document.getElementById('asistente-burbuja-cargando')?.remove();
      const mensajeError = err && err.code === 'functions/unavailable'
        ? 'El servicio de IA de Google está saturado en este momento. Intenta de nuevo en unos minutos.'
        : 'Hubo un problema respondiendo. Intenta de nuevo en un momento.';
      contMensajes.insertAdjacentHTML('beforeend', burbuja(mensajeError, false));
    } finally {
      contMensajes.scrollTop = contMensajes.scrollHeight;
      input.disabled = false;
      btnEnviar.disabled = false;
      input.focus();
    }
  }

  btnEnviar.addEventListener('click', enviar);
  input.addEventListener('keypress', (ev) => { if (ev.key === 'Enter') enviar(); });

  btnVerMas?.addEventListener('click', () => {
    const alturaAntes = contMensajes.scrollHeight;
    mostrados = Math.min(historialCompleto.length, mostrados + MENSAJES_POR_PAGINA);
    pintarMensajes();
    contMensajes.scrollTop = contMensajes.scrollHeight - alturaAntes;
  });

  btnBorrar?.addEventListener('click', async () => {
    if (!confirm('¿Borrar toda tu conversación con el asistente? No se puede recuperar.')) return;
    try {
      if (uid) await remove(ref(db, `asistenteHistorial/${uid}`));
      historialCompleto = [];
      mostrados = 0;
      pintarMensajes();
    } catch (err) {
      console.error('No se pudo borrar el historial:', err);
      alert('No se pudo borrar la conversación. Intenta de nuevo.');
    }
  });

  onAuthStateChanged(auth, (usuario) => {
    if (!usuario) {
      uid = null;
      historialCompleto = [];
      mostrados = 0;
      pintarMensajes();
      return;
    }
    if (uid === usuario.uid) return;
    uid = usuario.uid;
    cargarHistorial();
  });
}

onAuthStateChanged(auth, (usuario) => { if (usuario) cargarIdentidadAsistente(); });

['mentor', 'coach', 'director'].forEach(inicializarChatAsistente);
