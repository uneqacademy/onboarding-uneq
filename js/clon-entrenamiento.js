/* ============================================================
   clon-entrenamiento.js
   "Entrenar a mi Clon IA" — chat privado del mentor con su propio
   Clon (Mi Clon IA), separado de BOX Inteligente:
     - No lo ve ningún alumno.
     - No cuenta como pregunta real ni afecta Rendimiento IA — no
       toca box/ para nada.
     - El historial de ESTA conversación vive en su propio nodo:
       entrenamientoClonHistorial/{uid}.

   Usa las Cloud Functions `entrenarClonIA` y
   `guardarValidacionEntrenamiento` (nuevas — código real ya
   integrado en el functions/index.js que Felipe compartió) con el
   mismo patrón que ya usa el chat del Asistente UNEQ
   (asistente-uneq.js): mensaje + un tramo reciente de historial.

   Cuando el mentor confirma o corrige una respuesta del Clon, eso
   se guarda en boxConocimientoValidado/{uid} — el MISMO índice
   (con embedding) que ya alimentan las respuestas confirmadas o
   corregidas de preguntas reales en BOX Inteligente. Por eso una
   corrección hecha acá mejora también lo que le responde a un
   alumno de verdad, y no hace falta nada más para que "aprenda".

   El resumen de temas ("Lo que más te han preguntado") es una
   lectura aparte, 100% del lado del cliente, de las preguntas que
   ya existen en box/{uid} — no depende de esta Cloud Function ni le
   pide nada nuevo al alumno.
   ============================================================ */

import { app, db, auth } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";
import { ref, get, push, set, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getCurrentRole } from './main.js';

const functions = getFunctions(app);
const MENSAJES_POR_PAGINA = 30;
const MENSAJES_CONTEXTO_IA = 6;
const entrenarClonIA = httpsCallable(functions, 'entrenarClonIA', { timeout: 170000 });
const guardarValidacionEntrenamiento = httpsCallable(functions, 'guardarValidacionEntrenamiento', { timeout: 60000 });

function escaparHtml(texto) {
  return String(texto || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function limpiarFormatoIA(texto) {
  return String(texto || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');
}

/* ============================================================
   Chat de entrenamiento
   ============================================================ */

let fotoIAMentor = null;

function avatarClon(tamano) {
  const estiloBase = `width:${tamano}px; height:${tamano}px; border-radius:50%; flex-shrink:0; overflow:hidden;`;
  if (fotoIAMentor) {
    return `<img src="${fotoIAMentor}" alt="" style="${estiloBase} object-fit:cover; display:block;">`;
  }
  return `<div style="${estiloBase} background:var(--color-primary); display:flex; align-items:center; justify-content:center; color:#fff; font-size:${Math.round(tamano / 2.15)}px;">🤖</div>`;
}

function burbujaMentor(texto) {
  return `<div style="display:flex; justify-content:flex-end;">
    <div style="background:var(--color-primary); color:#fff; padding:12px 16px; border-radius:14px; border-top-right-radius:4px; max-width:82%;">
      <p style="margin:0; font-size:13.5px; line-height:1.5; white-space:pre-wrap;">${escaparHtml(texto)}</p>
    </div>
  </div>`;
}

function burbujaClon(mensajeId, texto, estadoRevision, textoCorregido) {
  const textoAMostrar = textoCorregido || texto;
  const ESTADO_LABELS = { confirmada: '✓ Confirmada', intervenida: '✏️ Corregida' };
  const badge = estadoRevision
    ? `<span class="badge badge--activo" style="font-size:9px; margin-left:6px;">${ESTADO_LABELS[estadoRevision]}</span>`
    : '';
  return `<div style="display:flex; gap:10px; align-items:flex-start;" data-clon-msg-id="${mensajeId}">
    ${avatarClon(28)}
    <div style="max-width:82%;">
      <div style="background:#fff; padding:12px 16px; border-radius:14px; border-top-left-radius:4px; box-shadow:0 1px 2px rgba(0,0,0,0.06);">
        <p class="clon-burbuja-texto" style="margin:0; font-size:13.5px; line-height:1.5; white-space:pre-wrap;">${escaparHtml(limpiarFormatoIA(textoAMostrar))}</p>
      </div>
      <div class="clon-acciones-revision" style="display:flex; align-items:center; gap:10px; margin-top:6px; ${estadoRevision ? 'display:none;' : ''}">
        <button type="button" class="clon-btn-confirmar" data-id="${mensajeId}" style="background:none; border:0; padding:0; font-size:11.5px; color:var(--color-ink-soft); cursor:pointer; text-decoration:underline;">✓ Está bien</button>
        <button type="button" class="clon-btn-corregir" data-id="${mensajeId}" style="background:none; border:0; padding:0; font-size:11.5px; color:var(--color-ink-soft); cursor:pointer; text-decoration:underline;">✏️ Corregir esta respuesta</button>
      </div>
      <div class="clon-badge-estado">${badge}</div>
    </div>
  </div>`;
}

function burbujaCargando() {
  return `<div id="clon-chat-burbuja-cargando" style="display:flex; gap:10px; align-items:flex-start;">
    ${avatarClon(28)}
    <div style="background:#fff; padding:12px 16px; border-radius:14px; border-top-left-radius:4px; box-shadow:0 1px 2px rgba(0,0,0,0.06);">
      <p class="text-soft" style="margin:0; font-size:13px;">Pensando...</p>
    </div>
  </div>`;
}

function formularioCorreccion(mensajeId, textoActual) {
  return `<div class="clon-form-correccion" data-id="${mensajeId}" style="margin-top:8px;">
    <textarea class="clon-textarea-correccion" style="min-height:100px; font-size:13px;">${escaparHtml(textoActual)}</textarea>
    <div style="display:flex; gap:8px; margin-top:6px;">
      <button type="button" class="btn btn--primary clon-btn-guardar-correccion" style="font-size:11px; padding:4px 10px;">Guardar corrección</button>
      <button type="button" class="btn btn--ghost clon-btn-cancelar-correccion" style="font-size:11px; padding:4px 10px;">Cancelar</button>
    </div>
    <p class="text-soft" style="font-size:11px; margin:6px 0 0;">Esto queda guardado como referencia validada para preguntas parecidas — a alumnos reales y acá.</p>
  </div>`;
}

function inicializarChatEntrenamiento() {
  const contMensajes = document.getElementById('clon-chat-mensajes');
  const input = document.getElementById('clon-chat-input');
  const btnEnviar = document.getElementById('clon-chat-enviar');
  if (!contMensajes || !input || !btnEnviar) return;

  const btnVerMas = document.getElementById('clon-chat-ver-mas');
  const btnBorrar = document.getElementById('clon-chat-borrar');
  const bienvenidaEl = document.getElementById('clon-chat-bienvenida');

  let uid = null;
  let historialCompleto = [];
  let mostrados = 0;
  // Guarda, por mensaje del Clon, la última pregunta del mentor que lo
  // generó — para armar el título de "Conocimiento Adicional" al corregir.
  let preguntaPorMensaje = {};

  function pintarMensajes() {
    const visibles = historialCompleto.slice(Math.max(0, historialCompleto.length - mostrados));
    contMensajes.querySelectorAll('[data-clon-render]').forEach(el => el.remove());
    const html = visibles.map(m => {
      const interior = m.rol === 'mentor'
        ? burbujaMentor(m.texto)
        : burbujaClon(m.id, m.texto, m.estadoRevision, m.textoCorregido);
      return `<div data-clon-render>${interior}</div>`;
    }).join('');
    contMensajes.insertAdjacentHTML('beforeend', html);
    if (bienvenidaEl) bienvenidaEl.classList.toggle('hidden', historialCompleto.length > 0);
    if (btnVerMas) btnVerMas.classList.toggle('hidden', historialCompleto.length <= mostrados);
    if (btnBorrar) btnBorrar.classList.toggle('hidden', historialCompleto.length === 0);
    wireAccionesRevision();
  }

  async function cargarHistorial() {
    if (!uid) return;
    try {
      const snap = await get(ref(db, `entrenamientoClonHistorial/${uid}`));
      historialCompleto = snap.exists()
        ? Object.entries(snap.val())
          .map(([id, m]) => ({ id, ...m }))
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        : [];
    } catch (err) {
      console.error('No se pudo cargar el historial de entrenamiento:', err);
      historialCompleto = [];
    }
    // Reconstruye qué pregunta del mentor antecede a cada respuesta del
    // Clon, para poder titular bien una corrección aunque se recargue la página.
    preguntaPorMensaje = {};
    let ultimaPreguntaMentor = '';
    historialCompleto.forEach(m => {
      if (m.rol === 'mentor') ultimaPreguntaMentor = m.texto;
      else preguntaPorMensaje[m.id] = ultimaPreguntaMentor;
    });
    mostrados = Math.min(MENSAJES_POR_PAGINA, historialCompleto.length);
    pintarMensajes();
    contMensajes.scrollTop = contMensajes.scrollHeight;
  }

  async function guardarMensaje(rol, texto) {
    const nuevaRef = push(ref(db, `entrenamientoClonHistorial/${uid}`));
    const registro = { rol, texto, createdAt: Date.now() };
    historialCompleto.push({ id: nuevaRef.key, ...registro });
    try {
      await set(nuevaRef, registro);
    } catch (err) {
      console.error('No se pudo guardar el mensaje de entrenamiento:', err);
    }
    return nuevaRef.key;
  }

  async function enviar() {
    const mensaje = input.value.trim();
    if (!mensaje || !uid) return;

    input.value = '';
    input.disabled = true;
    btnEnviar.disabled = true;

    if (bienvenidaEl) bienvenidaEl.classList.add('hidden');
    contMensajes.insertAdjacentHTML('beforeend', `<div data-clon-render>${burbujaMentor(mensaje)}</div>`);
    const contexto = historialCompleto.slice(-MENSAJES_CONTEXTO_IA).map(m => ({ rol: m.rol, texto: m.textoCorregido || m.texto }));
    await guardarMensaje('mentor', mensaje);
    mostrados = Math.min(historialCompleto.length, Math.max(mostrados + 1, MENSAJES_POR_PAGINA));
    contMensajes.insertAdjacentHTML('beforeend', burbujaCargando());
    contMensajes.scrollTop = contMensajes.scrollHeight;

    try {
      const resultado = await entrenarClonIA({ mensaje, historial: contexto });
      const respuesta = (resultado.data && resultado.data.respuesta) || 'No pude generar una respuesta. Intenta de nuevo.';
      document.getElementById('clon-chat-burbuja-cargando')?.remove();
      const idRespuesta = await guardarMensaje('clon', respuesta);
      preguntaPorMensaje[idRespuesta] = mensaje;
      contMensajes.insertAdjacentHTML('beforeend', `<div data-clon-render>${burbujaClon(idRespuesta, respuesta, null, null)}</div>`);
      mostrados = Math.min(historialCompleto.length, mostrados + 1);
      if (btnBorrar) btnBorrar.classList.remove('hidden');
      wireAccionesRevision();
    } catch (err) {
      console.error('Error consultando al Clon IA:', err);
      document.getElementById('clon-chat-burbuja-cargando')?.remove();
      const mensajeError = err && err.code === 'functions/unavailable'
        ? 'El servicio de IA de Google está saturado en este momento. Intenta de nuevo en unos minutos.'
        : 'Hubo un problema respondiendo. Intenta de nuevo en un momento.';
      contMensajes.insertAdjacentHTML('beforeend', `<div data-clon-render style="display:flex; gap:10px; align-items:flex-start;">${avatarClon(28)}<div style="background:#fff; padding:12px 16px; border-radius:14px; border-top-left-radius:4px; box-shadow:0 1px 2px rgba(0,0,0,0.06);"><p class="text-soft" style="margin:0; font-size:13px;">${mensajeError}</p></div></div>`);
    } finally {
      contMensajes.scrollTop = contMensajes.scrollHeight;
      input.disabled = false;
      btnEnviar.disabled = false;
      input.focus();
    }
  }

  async function guardarValidacion(mensajeId, textoFinal, estadoRevision) {
    const preguntaOrigen = preguntaPorMensaje[mensajeId] || '';
    if (!preguntaOrigen) return; // sin la pregunta que lo originó no hay qué indexar
    await guardarValidacionEntrenamiento({ pregunta: preguntaOrigen, respuesta: textoFinal, estadoRevision });
  }

  function wireAccionesRevision() {
    contMensajes.querySelectorAll('.clon-btn-confirmar').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const bloque = btn.closest('[data-clon-msg-id]');
        const textoActual = bloque.querySelector('.clon-burbuja-texto').textContent;
        btn.disabled = true;
        try {
          await guardarValidacion(id, textoActual, 'confirmada');
          await set(ref(db, `entrenamientoClonHistorial/${uid}/${id}/estadoRevision`), 'confirmada');
          const m = historialCompleto.find(x => x.id === id);
          if (m) m.estadoRevision = 'confirmada';
          bloque.querySelector('.clon-acciones-revision').style.display = 'none';
          bloque.querySelector('.clon-badge-estado').innerHTML = '<span class="badge badge--activo" style="font-size:9px; margin-left:6px;">✓ Confirmada</span>';
        } catch (err) {
          alert('No se pudo guardar. Intenta de nuevo.');
          btn.disabled = false;
        }
      });
    });
    contMensajes.querySelectorAll('.clon-btn-corregir').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const bloque = btn.closest('[data-clon-msg-id]');
        if (bloque.querySelector('.clon-form-correccion')) return;
        const textoActual = bloque.querySelector('.clon-burbuja-texto').textContent;
        btn.closest('.clon-acciones-revision').insertAdjacentHTML('afterend', formularioCorreccion(id, textoActual));

        bloque.querySelector('.clon-btn-cancelar-correccion').addEventListener('click', () => {
          bloque.querySelector('.clon-form-correccion').remove();
        });
        bloque.querySelector('.clon-btn-guardar-correccion').addEventListener('click', async (ev) => {
          const nuevoTexto = bloque.querySelector('.clon-textarea-correccion').value.trim();
          if (!nuevoTexto) { alert('La corrección no puede quedar vacía.'); return; }
          ev.target.disabled = true;
          try {
            await guardarValidacion(id, nuevoTexto, 'intervenida');
            await set(ref(db, `entrenamientoClonHistorial/${uid}/${id}/estadoRevision`), 'intervenida');
            await set(ref(db, `entrenamientoClonHistorial/${uid}/${id}/textoCorregido`), nuevoTexto);
            const m = historialCompleto.find(x => x.id === id);
            if (m) { m.estadoRevision = 'intervenida'; m.textoCorregido = nuevoTexto; }
            bloque.querySelector('.clon-burbuja-texto').textContent = nuevoTexto;
            bloque.querySelector('.clon-acciones-revision').style.display = 'none';
            bloque.querySelector('.clon-form-correccion').remove();
            bloque.querySelector('.clon-badge-estado').innerHTML = '<span class="badge badge--activo" style="font-size:9px; margin-left:6px;">✏️ Corregida</span>';
          } catch (err) {
            alert('No se pudo guardar la corrección. Intenta de nuevo.');
            ev.target.disabled = false;
          }
        });
      });
    });
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
    if (!confirm('¿Borrar toda tu conversación de entrenamiento? No se puede recuperar (lo que ya confirmaste o corregiste queda guardado igual, eso no se borra).')) return;
    try {
      if (uid) await remove(ref(db, `entrenamientoClonHistorial/${uid}`));
      historialCompleto = [];
      mostrados = 0;
      pintarMensajes();
    } catch (err) {
      console.error('No se pudo borrar el historial de entrenamiento:', err);
      alert('No se pudo borrar la conversación. Intenta de nuevo.');
    }
  });

  onAuthStateChanged(auth, async (usuario) => {
    if (!usuario || getCurrentRole() !== 'mentor') {
      uid = null;
      historialCompleto = [];
      mostrados = 0;
      pintarMensajes();
      return;
    }
    if (uid === usuario.uid) return;
    uid = usuario.uid;
    try {
      const fotoSnap = await get(ref(db, `usuarios/${uid}/fotoIA`));
      fotoIAMentor = fotoSnap.exists() ? fotoSnap.val() : null;
    } catch (err) {
      fotoIAMentor = null;
    }
    cargarHistorial();
  });
}

/* ============================================================
   "Lo que más te han preguntado tus alumnos" — resumen de BOX
   Inteligente por temática, solo lectura, sin IA.
   ============================================================ */

export async function cargarResumenTemasClon() {
  if (getCurrentRole() !== 'mentor') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const vacioEl = document.getElementById('clon-temas-vacio');
  const resumenEl = document.getElementById('clon-temas-resumen');
  if (!uid || !vacioEl || !resumenEl) return;

  const snap = await get(ref(db, `box/${uid}`));
  const preguntas = snap.exists() ? Object.values(snap.val()) : [];

  if (!preguntas.length) {
    vacioEl.classList.remove('hidden');
    resumenEl.classList.add('hidden');
    return;
  }
  vacioEl.classList.add('hidden');
  resumenEl.classList.remove('hidden');

  let confirmadas = 0, intervenidas = 0, sinRevisar = 0;
  const porTema = {};
  preguntas.forEach(p => {
    const tema = p.tematica || 'Sin tema';
    if (!porTema[tema]) porTema[tema] = { veces: 0, corregidas: 0 };
    porTema[tema].veces++;
    const estado = (p.respuesta && p.respuesta.estadoRevision) || 'sin_revisar';
    if (estado === 'confirmada') confirmadas++;
    else if (estado === 'intervenida') { intervenidas++; porTema[tema].corregidas++; }
    else sinRevisar++;
  });

  document.getElementById('clon-temas-total').textContent = preguntas.length;
  document.getElementById('clon-temas-confirmadas').textContent = confirmadas;
  document.getElementById('clon-temas-intervenidas').textContent = intervenidas;
  document.getElementById('clon-temas-sin-revisar').textContent = sinRevisar;

  const filas = Object.entries(porTema).sort((a, b) => b[1].veces - a[1].veces);
  document.getElementById('clon-temas-tabla-body').innerHTML = filas.map(([tema, d]) => `
    <tr><td>${tema}</td><td>${d.veces}</td><td>${d.corregidas || '—'}</td></tr>
  `).join('');
}

document.querySelectorAll('.nav-item[data-nav="mi-clon-ia"]').forEach(item => {
  item.addEventListener('click', cargarResumenTemasClon);
});

inicializarChatEntrenamiento();
