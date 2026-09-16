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
   Dashboard coexisten en el DOM — cada una se conecta por separado
   acá, con su propio historial de conversación en memoria.
   ============================================================ */

import { app } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";

const functions = getFunctions(app);
const consultarAsistente = httpsCallable(functions, 'consultarAsistenteUneq');

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

function burbuja(texto, esUsuario) {
  if (esUsuario) {
    return `<div style="display:flex; justify-content:flex-end;">
      <div style="background:var(--color-primary); color:#fff; padding:12px 16px; border-radius:14px; border-top-right-radius:4px; max-width:82%;">
        <p style="margin:0; font-size:13.5px; line-height:1.5; white-space:pre-wrap;">${escaparHtml(texto)}</p>
      </div>
    </div>`;
  }
  return `<div style="display:flex; gap:10px; align-items:flex-start;">
    <div style="width:28px; height:28px; border-radius:50%; background:var(--color-primary); flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:13px;">✨</div>
    <div style="background:#fff; padding:12px 16px; border-radius:14px; border-top-left-radius:4px; max-width:82%; box-shadow:0 1px 2px rgba(0,0,0,0.06);">
      <p style="margin:0; font-size:13.5px; line-height:1.5; white-space:pre-wrap;">${escaparHtml(texto)}</p>
    </div>
  </div>`;
}

function burbujaCargando() {
  return `<div id="asistente-burbuja-cargando" style="display:flex; gap:10px; align-items:flex-start;">
    <div style="width:28px; height:28px; border-radius:50%; background:var(--color-primary); flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:13px;">✨</div>
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

  const historial = []; // [{rol:'usuario'|'asistente', texto}]

  async function enviar() {
    const mensaje = input.value.trim();
    if (!mensaje) return;

    input.value = '';
    input.disabled = true;
    btnEnviar.disabled = true;

    contMensajes.insertAdjacentHTML('beforeend', burbuja(mensaje, true));
    historial.push({ rol: 'usuario', texto: mensaje });
    contMensajes.insertAdjacentHTML('beforeend', burbujaCargando());
    contMensajes.scrollTop = contMensajes.scrollHeight;

    try {
      const resultado = await consultarAsistente({ mensaje, historial: historial.slice(0, -1) });
      const respuesta = (resultado.data && resultado.data.respuesta) || 'No pude generar una respuesta. Intenta de nuevo.';
      document.getElementById('asistente-burbuja-cargando')?.remove();
      contMensajes.insertAdjacentHTML('beforeend', burbuja(limpiarFormatoIA(respuesta), false));
      historial.push({ rol: 'asistente', texto: respuesta });
    } catch (err) {
      console.error('Error consultando al Asistente UNEQ:', err);
      document.getElementById('asistente-burbuja-cargando')?.remove();
      contMensajes.insertAdjacentHTML('beforeend', burbuja('Hubo un problema respondiendo. Intenta de nuevo en un momento.', false));
    } finally {
      contMensajes.scrollTop = contMensajes.scrollHeight;
      input.disabled = false;
      btnEnviar.disabled = false;
      input.focus();
    }
  }

  btnEnviar.addEventListener('click', enviar);
  input.addEventListener('keypress', (ev) => { if (ev.key === 'Enter') enviar(); });
}

['mentor', 'coach', 'director'].forEach(inicializarChatAsistente);
