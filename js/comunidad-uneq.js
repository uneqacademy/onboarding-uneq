/* ============================================================
   comunidad-uneq.js — orquesta la sección "Comunidad UNEQ": el clic
   en el nav-item y el cambio entre sus 4 subtabs. La carga de
   "Hitos" y "Preguntas" vive en hitos.js / alumno-portal.js;
   "Presentación" e "Historias Reales" se manejan acá mismo, con el
   mismo motor de interacción social que Hitos (fotos, emojis,
   reacciones, comentarios, respuestas, compartir) — mismas clases
   CSS que .hito-* a propósito, para que se vean idénticos.
   ============================================================ */

import { db, auth, storage } from './firebase-config.js';
import { ref, get, set, update, push, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getCurrentRole } from './main.js';
import { aplicarClampTexto } from './texto-clamp.js';
import { cargarHitosComunidad } from './hitos.js';
import { cargarPreguntasComunidad } from './alumno-portal.js';

const VENTANA_EDICION_MS = 24 * 60 * 60 * 1000;
const TAMANO_MAXIMO_FOTO = 10 * 1024 * 1024;
const PLACEHOLDER_FOTO = 'https://app.uneqacademy.com/assets/logos/isotipo-uneq.png';
function dentroDeVentana(createdAt) { return (Date.now() - createdAt) < VENTANA_EDICION_MS; }
function formatFecha(ts) {
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
}
function linkifyTexto(texto) {
  if (!texto) return '';
  const escapado = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escapado.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
}

let subtabActual = 'hitos';
let presentacionAprobada = false; // controla el candado de las otras 3 pestañas

const CARGADORES = {
  hitos: cargarHitosComunidad,
  preguntas: cargarPreguntasComunidad,
  presentacion: cargarPresentacion,
  historias: cargarHistoriasReales
};

function activarSubtab(nombre) {
  const role = getCurrentRole();
  if (role === 'alumno' && !presentacionAprobada && nombre !== 'presentacion') nombre = 'presentacion';
  subtabActual = nombre;
  document.querySelectorAll('[data-comunidad-tab]').forEach(btn => btn.classList.toggle('is-activa', btn.dataset.comunidadTab === nombre));
  document.querySelectorAll('.comunidad-vista').forEach(vista => vista.classList.toggle('is-activa', vista.id === `comunidad-vista-${nombre}`));
  CARGADORES[nombre]?.();
}

document.querySelectorAll('[data-comunidad-tab]').forEach(btn => {
  btn.addEventListener('click', () => activarSubtab(btn.dataset.comunidadTab));
});

document.querySelectorAll('.nav-item[data-nav="comunidad-uneq"]').forEach(item => {
  item.addEventListener('click', async () => {
    const role = getCurrentRole();
    if (role === 'alumno') {
      const uid = auth.currentUser?.uid;
      const mapaSnap = uid ? await get(ref(db, `alumnoPorAuthUid/${uid}`)) : null;
      const alumnoId = mapaSnap && mapaSnap.exists() ? mapaSnap.val() : null;
      const presSnap = alumnoId ? await get(ref(db, `comunidad/presentaciones/${alumnoId}`)) : null;
      presentacionAprobada = !!(presSnap && presSnap.exists() && presSnap.val().estado === 'aprobada');
    } else {
      presentacionAprobada = true;
    }
    activarSubtab(subtabActual);
  });
});

async function obtenerContextoAlumno(uid) {
  const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
  const alumnoId = mapaSnap.exists() ? mapaSnap.val() : null;
  if (!alumnoId) return { alumnoId: null };
  const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
  const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
  const nombre = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim();
  let programa = '', coachId = '';
  if (alumno.cicloActualId) {
    const cicloSnap = await get(ref(db, `ciclos/${alumno.cicloActualId}`));
    if (cicloSnap.exists()) { programa = cicloSnap.val().programa || ''; coachId = cicloSnap.val().coachId || ''; }
  }
  return { alumnoId, nombre, fotoUrl: alumno.fotoUrl || '', programa, coachId };
}

/* ============================================================
   MOTOR SOCIAL COMPARTIDO — fotos, reacciones, comentarios,
   respuestas y compartir. Usado por Presentación e Historias
   Reales. "basePath" es la ruta en la base de datos de esa
   publicación puntual (comunidad/presentaciones/{alumnoId} o
   comunidad/historiasReales/{historiaId}).
   ============================================================ */

function renderRespuestasSociales(basePath, comentarioId, respuestas, nombreDueño, esDueño, esDirector) {
  const lista = Object.entries(respuestas || {}).sort((a, b) => a[1].createdAt - b[1].createdAt);
  if (!lista.length) return '';
  return `<div class="hito-comentario-respuestas">${lista.map(([respuestaId, r]) => `
    <div class="hito-comentario-respuesta" data-respuesta-id="${respuestaId}">
      <strong>${r.autorNombre || nombreDueño}</strong>: ${linkifyTexto(r.texto)}
      <span class="text-soft" style="font-size:10px; margin-left:6px;">${formatFecha(r.createdAt)}</span>
      ${(esDueño && dentroDeVentana(r.createdAt)) || esDirector ? `<button type="button" class="btn-editar-hito btn-eliminar-respuesta-social" data-base-path="${basePath}" data-comentario-id="${comentarioId}" data-respuesta-id="${respuestaId}" style="margin-left:6px;">Eliminar</button>` : ''}
    </div>`).join('')}</div>`;
}

function renderComentariosSociales(basePath, comentarios, esDirector, uid, nombreDueño, esDueño, expandido) {
  const todos = Object.entries(comentarios || {}).sort((a, b) => a[1].createdAt - b[1].createdAt);
  if (!todos.length) return '<p class="text-soft" style="font-size:12px;">Sin comentarios todavía.</p>';
  const lista = expandido ? todos : todos.slice(-2);
  return lista.map(([comentarioId, c]) => `
    <div data-comentario-id="${comentarioId}" style="padding:6px 0; border-bottom:0.5px solid var(--border);">
      <p class="hito-comentario" style="font-size:12.5px; margin:0;">
        <img src="${c.autorFotoUrl || PLACEHOLDER_FOTO}" alt="" class="hito-comentario__foto">
        <strong>${c.autorNombre || 'Alguien'}</strong>${c.autorTipo === 'staff' ? ' <span class="badge badge--activo" style="font-size:8px;">staff</span>' : ''}
        : <span class="texto-clamp" data-clamp>${linkifyTexto(c.texto)}</span>
      </p>
      <button type="button" class="btn-ver-mas-texto hidden" data-clamp-btn></button>
      <div style="display:flex; gap:10px; margin-top:2px; flex-wrap:wrap;">
        <span class="text-soft" style="font-size:10px;">${formatFecha(c.createdAt)}</span>
        ${(c.autorId === uid && dentroDeVentana(c.createdAt)) || esDirector ? `<button type="button" class="btn-eliminar-comentario-social" data-base-path="${basePath}" data-comentario-id="${comentarioId}" style="font-size:10px; background:none; border:none; color:#9CA0A8; cursor:pointer; padding:0;">Eliminar</button>` : ''}
        ${esDueño ? `<button type="button" class="btn-responder-comentario" data-base-path="${basePath}" data-comentario-id="${comentarioId}">Responder</button>` : ''}
      </div>
      ${renderRespuestasSociales(basePath, comentarioId, c.respuestas, nombreDueño, esDueño, esDirector)}
    </div>`).join('');
}

function renderTarjetaSocial(basePath, id, item, ctx) {
  const { esDirector, uid, autorFotoUrl, esDueño, puedeEditar, puedeEliminar, onEditar, extraFooterHtml } = ctx;
  const yaReacciono = item.reacciones && item.reacciones[uid];
  const totalReacciones = item.reacciones ? Object.keys(item.reacciones).length : 0;
  const totalComentarios = Object.keys(item.comentarios || {}).length;
  const comentariosExpandidos = tarjetasComentariosExpandidos.has(basePath);
  return `
  <div class="panel mb-16" id="social-${id}" data-base-path="${basePath}" data-es-dueño="${esDueño ? '1' : '0'}" data-nombre-dueño="${(item.alumnoNombre || '').replace(/"/g, '&quot;')}" data-on-editar="${onEditar || ''}">
    <div class="panel__body">
      <div class="flex-between">
        <div class="hito-autor">
          <span class="hito-autor__fotos"><img src="${autorFotoUrl || PLACEHOLDER_FOTO}" alt=""></span>
          <strong>${item.alumnoNombre || 'Alumno'}</strong>
          ${item.estado === 'pendiente' ? '<span class="badge badge--impaga" style="font-size:9px; margin-left:6px;">En Revisión</span>' : ''}
        </div>
      </div>
      <p class="texto-clamp" data-clamp data-texto-original="${(item.texto || '').replace(/"/g, '&quot;')}" style="margin:8px 0 0; white-space:pre-wrap;">${linkifyTexto(item.texto)}</p>
      <button type="button" class="btn-ver-mas-texto hidden" data-clamp-btn></button>
      ${(item.fotos || []).map(f => `<img src="${f.url}" alt="" class="btn-ampliar-foto-hito" data-src="${f.url}" style="max-width:220px; max-height:220px; border-radius:8px; margin:8px 8px 0 0; object-fit:cover; cursor:zoom-in;">`).join('')}
      <p class="text-soft" style="font-size:11px; margin:8px 0 0;">${formatFecha(item.createdAt)}</p>

      <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; align-items:center;">
        <button type="button" class="btn ${yaReacciono ? 'btn--primary' : 'btn--ghost'} btn-reaccion-social" data-base-path="${basePath}" style="font-size:12px; padding:4px 10px;">❤️ ${totalReacciones}</button>
        <button type="button" class="btn ${comentariosExpandidos ? 'btn--primary' : 'btn--ghost'} btn-comentarios-social" data-base-path="${basePath}" style="font-size:12px; padding:4px 10px;">💬 ${totalComentarios}</button>
        ${esDueño ? `<button type="button" class="btn btn--ghost btn-compartir-social" data-titulo="${(item.alumnoNombre || '').replace(/"/g, '&quot;')}" style="font-size:12px; padding:4px 10px;">📤 Compartir</button>` : ''}
        ${puedeEditar ? `<button type="button" class="btn btn--ghost btn-editar-social" data-base-path="${basePath}" style="font-size:12px; padding:4px 10px;">✏️ Editar</button>` : ''}
        ${puedeEliminar ? `<button type="button" class="btn btn--ghost btn-eliminar-social" data-base-path="${basePath}" style="font-size:12px; padding:4px 10px; color:#C0392B;">Eliminar</button>` : ''}
      </div>
      ${renderMiniaturasReaccionesSociales(basePath, item.reacciones)}

      <div class="comentarios-social" data-base-path="${basePath}" style="margin-top:12px; border-top:0.5px solid var(--border); padding-top:10px;">
        ${renderComentariosSociales(basePath, item.comentarios, esDirector, uid, item.alumnoNombre, esDueño, comentariosExpandidos)}
      </div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <input class="input-comentario-social" data-base-path="${basePath}" placeholder="Escribe un comentario..." style="flex:1;">
        <button type="button" class="btn btn--ghost btn-emoji-picker" data-target-selector=".input-comentario-social[data-base-path='${basePath.replace(/'/g, "\\'")}']" style="font-size:14px; padding:6px 10px;">😊</button>
        <button type="button" class="btn btn--primary btn-enviar-comentario-social" data-base-path="${basePath}" style="font-size:12px; padding:6px 14px;">Enviar</button>
      </div>
    </div>
    ${extraFooterHtml || ''}
  </div>`;
}

function renderMiniaturasReaccionesSociales(basePath, reacciones) {
  const lista = Object.values(reacciones || {});
  if (!lista.length) return '';
  const primeras5 = lista.slice(0, 5);
  return `<div style="display:flex; align-items:center; margin-top:8px;">
    <div style="display:flex;">${primeras5.map((r, i) => `<img src="${(r && r.fotoUrl) || PLACEHOLDER_FOTO}" alt="" title="${(r && r.nombre) || ''}" style="width:22px; height:22px; border-radius:50%; object-fit:cover; border:2px solid #fff; margin-left:${i === 0 ? '0' : '-8px'};">`).join('')}</div>
    ${lista.length > 5 ? `<span class="text-soft" style="font-size:11.5px; margin-left:8px;">${lista.length} reacciones</span>` : ''}
  </div>`;
}

const tarjetasComentariosExpandidos = new Set();

async function datosPerfilActual() {
  const role = getCurrentRole();
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (role === 'alumno') {
    const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
    const alumnoId = mapaSnap.exists() ? mapaSnap.val() : null;
    const alumnoSnap = alumnoId ? await get(ref(db, `alumnos/${alumnoId}`)) : null;
    const a = alumnoSnap && alumnoSnap.exists() ? alumnoSnap.val() : {};
    return { nombre: `${a.nombre || ''} ${a.apellido || ''}`.trim(), fotoUrl: a.fotoUrl || '', tipo: 'alumno' };
  }
  const usuarioSnap = await get(ref(db, `usuarios/${uid}`));
  const u = usuarioSnap.exists() ? usuarioSnap.val() : {};
  return { nombre: u.nombre || '', fotoUrl: u.fotoUrl || '', tipo: 'staff' };
}

// Se engancha una sola vez; sirve para cualquier feed que use
// renderTarjetaSocial (Presentación e Historias).
let interaccionSocialActiva = false;
function activarInteraccionSocial() {
  if (interaccionSocialActiva) return;
  interaccionSocialActiva = true;

  document.addEventListener('click', async (ev) => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid) return;

    const btnReaccion = ev.target.closest('.btn-reaccion-social');
    if (btnReaccion) {
      const basePath = btnReaccion.dataset.basePath;
      const refReaccion = ref(db, `${basePath}/reacciones/${uid}`);
      try {
        if ((await get(refReaccion)).exists()) { await remove(refReaccion); }
        else {
          const perfil = await datosPerfilActual();
          await set(refReaccion, { nombre: perfil.nombre, fotoUrl: perfil.fotoUrl });
        }
        recargarTarjeta(basePath);
      } catch (err) { console.error('No se pudo reaccionar:', err); }
      return;
    }

    const btnComentarios = ev.target.closest('.btn-comentarios-social');
    if (btnComentarios) {
      const basePath = btnComentarios.dataset.basePath;
      if (tarjetasComentariosExpandidos.has(basePath)) tarjetasComentariosExpandidos.delete(basePath);
      else tarjetasComentariosExpandidos.add(basePath);
      recargarTarjeta(basePath);
      return;
    }

    const btnCompartir = ev.target.closest('.btn-compartir-social');
    if (btnCompartir) {
      const mensaje = encodeURIComponent(`¡Quiero compartir con ustedes! ${btnCompartir.dataset.titulo ? `"${btnCompartir.dataset.titulo}" en UNEQ Mentoring.` : ''}\n\nEntra a la Comunidad UNEQ en la app para verlo.`);
      window.open(`https://wa.me/?text=${mensaje}`, '_blank');
      return;
    }

    const btnEditar = ev.target.closest('.btn-editar-social');
    if (btnEditar) {
      const basePath = btnEditar.dataset.basePath;
      const tarjeta = document.querySelector(`[data-base-path="${cssEscape(basePath)}"].panel`);
      const parrafo = tarjeta?.querySelector('[data-clamp]');
      if (!parrafo) return;
      const nuevo = prompt('Edita tu texto:', parrafo.dataset.textoOriginal);
      if (nuevo === null || !nuevo.trim()) return;
      try { await update(ref(db, basePath), { texto: nuevo.trim() }); recargarTarjeta(basePath); }
      catch (err) { console.error('No se pudo editar:', err); alert('No se pudo guardar el cambio. Intenta de nuevo.'); }
      return;
    }

    const btnEliminar = ev.target.closest('.btn-eliminar-social');
    if (btnEliminar) {
      if (!confirm('¿Eliminar esta publicación?')) return;
      try { await set(ref(db, btnEliminar.dataset.basePath), null); recargarTarjeta(null, btnEliminar.dataset.basePath); }
      catch (err) { console.error('No se pudo eliminar:', err); alert('No se pudo eliminar. Intenta de nuevo.'); }
      return;
    }

    const btnEnviarComentario = ev.target.closest('.btn-enviar-comentario-social');
    if (btnEnviarComentario) {
      const basePath = btnEnviarComentario.dataset.basePath;
      const input = document.querySelector(`.input-comentario-social[data-base-path="${cssEscape(basePath)}"]`);
      if (!input || !input.value.trim()) return;
      try {
        const perfil = await datosPerfilActual();
        await set(push(ref(db, `${basePath}/comentarios`)), {
          autorId: uid, autorNombre: perfil.nombre, autorFotoUrl: perfil.fotoUrl, autorTipo: perfil.tipo,
          texto: input.value.trim(), createdAt: Date.now()
        });
        input.value = '';
        recargarTarjeta(basePath);
      } catch (err) { console.error('No se pudo comentar:', err); alert('No se pudo enviar el comentario. Intenta de nuevo.'); }
      return;
    }

    const btnEliminarComentario = ev.target.closest('.btn-eliminar-comentario-social');
    if (btnEliminarComentario) {
      if (!confirm('¿Eliminar este comentario?')) return;
      try {
        await remove(ref(db, `${btnEliminarComentario.dataset.basePath}/comentarios/${btnEliminarComentario.dataset.comentarioId}`));
        recargarTarjeta(btnEliminarComentario.dataset.basePath);
      } catch (err) { console.error('No se pudo eliminar el comentario:', err); }
      return;
    }

    const btnResponder = ev.target.closest('.btn-responder-comentario');
    if (btnResponder) {
      const { basePath, comentarioId } = btnResponder.dataset;
      const yaAbierto = document.querySelector(`.form-responder-comentario[data-comentario-id="${comentarioId}"]`);
      if (yaAbierto) { yaAbierto.remove(); return; }
      const contenedorComentario = btnResponder.closest('[data-comentario-id]');
      const form = document.createElement('div');
      form.className = 'form-responder-comentario';
      form.dataset.comentarioId = comentarioId;
      form.dataset.basePath = basePath;
      form.innerHTML = `<input type="text" placeholder="Escribe tu respuesta..."><button type="button" class="btn btn--primary btn-enviar-respuesta-social" style="font-size:11px; padding:5px 12px;">Enviar</button>`;
      contenedorComentario.insertAdjacentElement('afterend', form);
      form.querySelector('input').focus();
      return;
    }

    const btnEnviarRespuesta = ev.target.closest('.btn-enviar-respuesta-social');
    if (btnEnviarRespuesta) {
      const form = btnEnviarRespuesta.closest('.form-responder-comentario');
      const input = form.querySelector('input');
      const { comentarioId, basePath } = form.dataset;
      if (!input.value.trim()) return;
      try {
        const perfil = await datosPerfilActual();
        await set(push(ref(db, `${basePath}/comentarios/${comentarioId}/respuestas`)), {
          autorId: uid, autorNombre: perfil.nombre, texto: input.value.trim(), createdAt: Date.now()
        });
        recargarTarjeta(basePath);
      } catch (err) { console.error('No se pudo responder:', err); alert('No se pudo enviar la respuesta. Intenta de nuevo.'); }
      return;
    }

    const btnEliminarRespuesta = ev.target.closest('.btn-eliminar-respuesta-social');
    if (btnEliminarRespuesta) {
      if (!confirm('¿Eliminar esta respuesta?')) return;
      const { basePath, comentarioId, respuestaId } = btnEliminarRespuesta.dataset;
      try { await remove(ref(db, `${basePath}/comentarios/${comentarioId}/respuestas/${respuestaId}`)); recargarTarjeta(basePath); }
      catch (err) { console.error('No se pudo eliminar la respuesta:', err); }
      return;
    }

    const imgAmpliar = ev.target.closest('.btn-ampliar-foto-hito');
    if (imgAmpliar) {
      const lightbox = document.getElementById('hito-lightbox-imagen');
      if (lightbox) { document.getElementById('hito-lightbox-imagen-img').src = imgAmpliar.dataset.src; lightbox.classList.remove('hidden'); }
      return;
    }
  });

  document.addEventListener('keypress', (ev) => {
    if (ev.key === 'Enter' && ev.target.classList.contains('input-comentario-social')) {
      document.querySelector(`.btn-enviar-comentario-social[data-base-path="${cssEscape(ev.target.dataset.basePath)}"]`)?.click();
    }
    if (ev.key === 'Enter' && ev.target.matches('.form-responder-comentario input')) {
      ev.target.closest('.form-responder-comentario').querySelector('.btn-enviar-respuesta-social').click();
    }
  });
}
function cssEscape(s) { return (s || '').replace(/[.:#/]/g, '\\$&'); }
function recargarTarjeta(basePathOEliminado, forzarRecarga) {
  if (subtabActual === 'presentacion') cargarPresentacion();
  else if (subtabActual === 'historias') cargarHistoriasReales();
}

/* --- Adjuntar y subir fotos (reutilizable para ambos formularios) --- */
function wireAdjuntarFoto(btnId, inputId, previewId, storeArr) {
  const btn = document.getElementById(btnId), input = document.getElementById(inputId);
  if (!btn || !input || btn.dataset.conectado) return;
  btn.dataset.conectado = '1';
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const seleccionados = Array.from(input.files);
    const pesados = seleccionados.filter(f => f.size > TAMANO_MAXIMO_FOTO);
    if (pesados.length) { alert(`Estas fotos pesan más de 10MB: ${pesados.map(f => f.name).join(', ')}`); input.value = ''; return; }
    storeArr.length = 0; storeArr.push(...seleccionados);
    document.getElementById(previewId).innerHTML = storeArr.map(f => `<span class="text-soft" style="font-size:11px; background:#F0F1F3; padding:3px 8px; border-radius:6px;">🖼️ ${f.name}</span>`).join('');
  });
}
async function subirFotos(storagePrefix, id, archivos) {
  const fotos = [];
  for (let i = 0; i < archivos.length; i++) {
    const archivoRef = storageRef(storage, `${storagePrefix}/${id}/${i}_${Date.now()}_${archivos[i].name}`);
    await uploadBytes(archivoRef, archivos[i]);
    fotos.push({ url: await getDownloadURL(archivoRef), nombre: archivos[i].name });
  }
  return fotos;
}

/* ============================================================
   PRESENTACIÓN
   ============================================================ */
let fotosSeleccionadasPres = [];

async function cargarPresentacion() {
  activarInteraccionSocial();
  const role = getCurrentRole();
  const esAlumno = role === 'alumno';
  const esStaff = !esAlumno;
  const esDirector = role === 'director';
  const esCoach = role === 'coach';
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;

  document.getElementById('pres-filtros-staff-panel')?.classList.toggle('hidden', !esStaff);
  document.getElementById('pres-filtros-alumno-panel')?.classList.toggle('hidden', !esAlumno);
  wireAdjuntarFoto('pres-btn-adjuntar-foto', 'pres-input-foto', 'pres-fotos-preview', fotosSeleccionadasPres);

  let ctxAlumno = { alumnoId: null };
  if (esAlumno) {
    ctxAlumno = await obtenerContextoAlumno(uid);
    await renderPropiaPresentacion(ctxAlumno);
  }

  let presSnap, alumnosSnap, ciclosSnap, usuariosSnap;
  try {
    [presSnap, alumnosSnap, ciclosSnap, usuariosSnap] = await Promise.all([
      get(ref(db, 'comunidad/presentaciones')),
      get(ref(db, 'alumnos')),
      get(ref(db, 'ciclos')),
      esStaff ? get(ref(db, 'usuarios')) : Promise.resolve(null)
    ]);
  } catch (err) {
    console.error('No se pudieron cargar las presentaciones:', err);
    const feedEl = document.getElementById('pres-feed');
    if (feedEl) feedEl.innerHTML = '<p class="text-soft">No se pudo cargar la lista. Recarga la página e intenta de nuevo.</p>';
    return;
  }
  const alumnos = alumnosSnap.exists() ? alumnosSnap.val() : {};
  const ciclos = ciclosSnap.exists() ? ciclosSnap.val() : {};
  const usuarios = usuariosSnap && usuariosSnap.exists() ? usuariosSnap.val() : {};
  const todas = presSnap.exists() ? Object.entries(presSnap.val()) : [];

  const conDatos = todas.map(([alumnoId, p]) => {
    const alumno = alumnos[alumnoId] || {};
    const ciclo = alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
    return { alumnoId, ...p, nombre: `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim() || p.alumnoNombre || 'Alumno', fotoUrl: alumno.fotoUrl || '', programa: ciclo ? ciclo.programa : '', coachId: ciclo ? ciclo.coachId : '' };
  }).filter(p => esDirector || esCoach || p.estado === 'aprobada' || p.alumnoId === ctxAlumno.alumnoId)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (esStaff) {
    const coachEl = document.getElementById('pres-f-coach');
    if (coachEl && !coachEl.dataset.cargado) {
      const coaches = Object.entries(usuarios).filter(([, u]) => {
        const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
        return !!roles.coach;
      }).sort((a, b) => (a[1].nombre || '').localeCompare(b[1].nombre || '', 'es'));
      coachEl.innerHTML = '<option value="">Todos</option>' + coaches.map(([id, c]) => `<option value="${id}">${c.nombre || c.email}</option>`).join('');
      coachEl.dataset.cargado = '1';
    }
    const estEl = document.getElementById('pres-f-estudiante');
    if (estEl) {
      const nombres = [...new Set(conDatos.map(p => p.nombre))].sort((a, b) => a.localeCompare(b, 'es'));
      const previo = estEl.value;
      estEl.innerHTML = '<option value="">Todos</option>' + nombres.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');
      if (nombres.includes(previo)) estEl.value = previo;
    }
  }

  function render() {
    let lista = conDatos;
    if (esStaff) {
      const fPrograma = document.getElementById('pres-f-programa')?.value || '';
      const fCoach = document.getElementById('pres-f-coach')?.value || '';
      const fEstudiante = document.getElementById('pres-f-estudiante')?.value || '';
      const fPendientes = document.getElementById('pres-f-pendientes')?.checked || false;
      const fDesde = document.getElementById('pres-f-desde-staff')?.value ? new Date(document.getElementById('pres-f-desde-staff').value + 'T00:00:00').getTime() : null;
      const fHasta = document.getElementById('pres-f-hasta-staff')?.value ? new Date(document.getElementById('pres-f-hasta-staff').value + 'T23:59:59').getTime() : null;
      lista = lista.filter(p =>
        (!fPrograma || p.programa === fPrograma) && (!fCoach || p.coachId === fCoach) &&
        (!fEstudiante || p.nombre === fEstudiante) && (!fPendientes || p.estado === 'pendiente') &&
        (!fDesde || p.createdAt >= fDesde) && (!fHasta || p.createdAt <= fHasta)
      );
      const contadorEl = document.getElementById('pres-contador');
      if (contadorEl) { contadorEl.textContent = `${lista.length} resultado${lista.length === 1 ? '' : 's'}`; contadorEl.classList.remove('hidden'); }
    } else {
      // "conDatos" ya viene filtrado para dejar pasar tu propia
      // presentación aunque esté pendiente — acá solo se agrega la
      // de fecha, sin volver a excluirla.
      const fDesde = document.getElementById('pres-f-desde')?.value ? new Date(document.getElementById('pres-f-desde').value + 'T00:00:00').getTime() : null;
      const fHasta = document.getElementById('pres-f-hasta')?.value ? new Date(document.getElementById('pres-f-hasta').value + 'T23:59:59').getTime() : null;
      lista = lista.filter(p => (!fDesde || p.createdAt >= fDesde) && (!fHasta || p.createdAt <= fHasta));
    }

    const feedEl = document.getElementById('pres-feed');
    feedEl.innerHTML = lista.length ? lista.map(p => {
      const basePath = `comunidad/presentaciones/${p.alumnoId}`;
      const esDueño = p.alumnoId === ctxAlumno.alumnoId;
      const dentro24h = dentroDeVentana(p.createdAt);
      const extraFooterHtml = (esCoach || esDirector) && p.estado !== 'aprobada'
        ? `<div style="display:flex; gap:8px; padding:0 14px 14px;"><button type="button" class="btn btn--primary btn-aprobar-presentacion" data-alumno-id="${p.alumnoId}" style="font-size:12px; padding:5px 12px;">✓ Aprobar</button></div>`
        : '';
      return renderTarjetaSocial(basePath, p.alumnoId, p, {
        esDirector, uid, autorFotoUrl: p.fotoUrl, esDueño,
        puedeEditar: esDueño && dentro24h, puedeEliminar: (esDueño && dentro24h) || esDirector, extraFooterHtml
      });
    }).join('') : '<p class="text-soft">No hay presentaciones con ese filtro todavía.</p>';
    aplicarClampTexto(feedEl);

    feedEl.querySelectorAll('.btn-aprobar-presentacion').forEach(btn => btn.addEventListener('click', async () => {
      try { await update(ref(db, `comunidad/presentaciones/${btn.dataset.alumnoId}`), { estado: 'aprobada' }); cargarPresentacion(); }
      catch (err) { console.error('No se pudo aprobar:', err); alert('No se pudo aprobar. Intenta de nuevo.'); }
    }));
  }
  render();
  ['pres-f-programa', 'pres-f-coach', 'pres-f-estudiante', 'pres-f-pendientes', 'pres-f-desde-staff', 'pres-f-hasta-staff', 'pres-f-desde', 'pres-f-hasta'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', render);
  });
}

async function renderPropiaPresentacion(ctxAlumno) {
  const candadoPanel = document.getElementById('pres-candado-panel');
  const pendienteBanner = document.getElementById('pres-pendiente-banner');
  const propioPanel = document.getElementById('pres-propia-panel');
  if (!ctxAlumno.alumnoId) return;

  const snap = await get(ref(db, `comunidad/presentaciones/${ctxAlumno.alumnoId}`));
  const propia = snap.exists() ? snap.val() : null;

  candadoPanel?.classList.toggle('hidden', !!propia);
  if (propia) {
    const enVentana = dentroDeVentana(propia.createdAt);
    pendienteBanner?.classList.toggle('hidden', propia.estado !== 'pendiente' || !enVentana);
    propioPanel?.classList.add('hidden'); // la propia ya se ve en el feed principal de abajo
  } else {
    pendienteBanner?.classList.add('hidden');
    propioPanel?.classList.add('hidden');
  }

  const btnEnviarPres = document.getElementById('pres-btn-enviar');
  if (btnEnviarPres && !btnEnviarPres.dataset.conectado) {
    btnEnviarPres.dataset.conectado = '1';
    btnEnviarPres.addEventListener('click', async (ev) => {
      const texto = document.getElementById('pres-texto-form').value.trim();
      const errorEl = document.getElementById('pres-form-error');
      errorEl.classList.add('hidden');
      if (texto.length < 20) { errorEl.textContent = 'Cuéntanos un poco más — al menos unas líneas.'; errorEl.classList.remove('hidden'); return; }
      if (!ctxAlumno.alumnoId) { errorEl.textContent = 'No pudimos identificar tu ficha de alumno. Recarga la página e intenta de nuevo.'; errorEl.classList.remove('hidden'); return; }
      const btn = ev.currentTarget;
      btn.disabled = true; btn.textContent = 'Enviando...';
      try {
        const fotos = await subirFotos('comunidad-presentaciones', ctxAlumno.alumnoId, fotosSeleccionadasPres);
        await set(ref(db, `comunidad/presentaciones/${ctxAlumno.alumnoId}`), {
          texto, estado: 'pendiente', createdAt: Date.now(), alumnoNombre: ctxAlumno.nombre, fotos
        });
        fotosSeleccionadasPres.length = 0;
        btn.disabled = false; btn.textContent = 'Enviar presentación';
        document.getElementById('pres-texto-form').value = '';
        document.getElementById('pres-fotos-preview').innerHTML = '';
        activarSubtab('presentacion');
      } catch (err) {
        console.error('No se pudo enviar la presentación:', err);
        errorEl.textContent = 'No se pudo enviar. Intenta de nuevo en un momento.';
        errorEl.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Enviar presentación';
      }
    });
  }
}

/* ============================================================
   HISTORIAS REALES
   ============================================================ */
let fotosSeleccionadasHist = [];

async function cargarHistoriasReales() {
  activarInteraccionSocial();
  const role = getCurrentRole();
  const esAlumno = role === 'alumno';
  const esStaff = !esAlumno;
  const esDirector = role === 'director';
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;

  document.getElementById('hist-publicar-panel')?.classList.toggle('hidden', !esAlumno);
  document.getElementById('hist-filtros-staff-panel')?.classList.toggle('hidden', !esStaff);
  document.getElementById('hist-filtros-alumno-panel')?.classList.toggle('hidden', !esAlumno);
  wireAdjuntarFoto('hist-btn-adjuntar-foto', 'hist-input-foto', 'hist-fotos-preview', fotosSeleccionadasHist);

  let ctxAlumno = { alumnoId: null };
  if (esAlumno) ctxAlumno = await obtenerContextoAlumno(uid);

  let historiasSnap, alumnosSnap, ciclosSnap, usuariosSnap;
  try {
    [historiasSnap, alumnosSnap, ciclosSnap, usuariosSnap] = await Promise.all([
      get(ref(db, 'comunidad/historiasReales')),
      get(ref(db, 'alumnos')),
      esStaff ? get(ref(db, 'ciclos')) : Promise.resolve(null),
      esStaff ? get(ref(db, 'usuarios')) : Promise.resolve(null)
    ]);
  } catch (err) {
    console.error('No se pudieron cargar las historias:', err);
    const feedEl = document.getElementById('hist-feed');
    if (feedEl) feedEl.innerHTML = '<p class="text-soft">No se pudo cargar la lista. Recarga la página e intenta de nuevo.</p>';
    return;
  }
  const alumnos = alumnosSnap.exists() ? alumnosSnap.val() : {};
  const ciclos = ciclosSnap && ciclosSnap.exists() ? ciclosSnap.val() : {};
  const usuarios = usuariosSnap && usuariosSnap.exists() ? usuariosSnap.val() : {};
  const alumnoPorAuthUid = {};
  Object.entries(alumnos).forEach(([id, a]) => { if (a.authUid) alumnoPorAuthUid[a.authUid] = { id, ...a }; });

  let todas = historiasSnap.exists() ? Object.entries(historiasSnap.val()) : [];
  todas = todas.filter(([, h]) => esDirector || h.estado !== 'oculta')
    .map(([id, h]) => {
      const alumno = alumnoPorAuthUid[h.autorId] || {};
      const ciclo = alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
      return { id, ...h, fotoUrl: alumno.fotoUrl || '', programa: ciclo ? ciclo.programa : '', coachId: ciclo ? ciclo.coachId : '' };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  if (esStaff) {
    const coachEl = document.getElementById('hist-f-coach');
    if (coachEl && !coachEl.dataset.cargado) {
      const coaches = Object.entries(usuarios).filter(([, u]) => {
        const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
        return !!roles.coach;
      }).sort((a, b) => (a[1].nombre || '').localeCompare(b[1].nombre || '', 'es'));
      coachEl.innerHTML = '<option value="">Todos</option>' + coaches.map(([id, c]) => `<option value="${id}">${c.nombre || c.email}</option>`).join('');
      coachEl.dataset.cargado = '1';
    }
    const estEl = document.getElementById('hist-f-estudiante');
    if (estEl) {
      const nombres = [...new Set(todas.map(h => h.alumnoNombre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      const previo = estEl.value;
      estEl.innerHTML = '<option value="">Todos</option>' + nombres.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');
      if (nombres.includes(previo)) estEl.value = previo;
    }
  }

  function render() {
    let lista = todas;
    if (esStaff) {
      const fPrograma = document.getElementById('hist-f-programa')?.value || '';
      const fCoach = document.getElementById('hist-f-coach')?.value || '';
      const fEstudiante = document.getElementById('hist-f-estudiante')?.value || '';
      const fDesde = document.getElementById('hist-f-desde-staff')?.value ? new Date(document.getElementById('hist-f-desde-staff').value + 'T00:00:00').getTime() : null;
      const fHasta = document.getElementById('hist-f-hasta-staff')?.value ? new Date(document.getElementById('hist-f-hasta-staff').value + 'T23:59:59').getTime() : null;
      lista = lista.filter(h =>
        (!fPrograma || h.programa === fPrograma) && (!fCoach || h.coachId === fCoach) &&
        (!fEstudiante || h.alumnoNombre === fEstudiante) &&
        (!fDesde || h.createdAt >= fDesde) && (!fHasta || h.createdAt <= fHasta)
      );
      const contadorEl = document.getElementById('hist-contador');
      if (contadorEl) { contadorEl.textContent = `${lista.length} resultado${lista.length === 1 ? '' : 's'}`; contadorEl.classList.remove('hidden'); }
    } else {
      const fDesde = document.getElementById('hist-f-desde')?.value ? new Date(document.getElementById('hist-f-desde').value + 'T00:00:00').getTime() : null;
      const fHasta = document.getElementById('hist-f-hasta')?.value ? new Date(document.getElementById('hist-f-hasta').value + 'T23:59:59').getTime() : null;
      lista = lista.filter(h => (!fDesde || h.createdAt >= fDesde) && (!fHasta || h.createdAt <= fHasta));
    }

    const feedEl = document.getElementById('hist-feed');
    feedEl.innerHTML = lista.length ? lista.map(h => {
      const basePath = `comunidad/historiasReales/${h.id}`;
      const esDueño = h.autorId === uid;
      const dentro24h = dentroDeVentana(h.createdAt);
      return renderTarjetaSocial(basePath, h.id, { ...h, alumnoNombre: h.alumnoNombre }, {
        esDirector, uid, autorFotoUrl: h.fotoUrl, esDueño,
        puedeEditar: esDueño && dentro24h, puedeEliminar: (esDueño && dentro24h) || esDirector
      });
    }).join('') : '<p class="text-soft">Todavía no hay historias que mostrar.</p>';
    aplicarClampTexto(feedEl);
  }
  render();
  ['hist-f-programa', 'hist-f-coach', 'hist-f-estudiante', 'hist-f-desde-staff', 'hist-f-hasta-staff', 'hist-f-desde', 'hist-f-hasta'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', render);
  });

  const btnPublicarHist = document.getElementById('hist-btn-publicar');
  if (btnPublicarHist && !btnPublicarHist.dataset.conectado) {
    btnPublicarHist.dataset.conectado = '1';
    btnPublicarHist.addEventListener('click', async (ev) => {
      const texto = document.getElementById('hist-texto-form').value.trim();
      const errorEl = document.getElementById('hist-form-error');
      errorEl.classList.add('hidden');
      if (texto.length < 10) { errorEl.textContent = 'Escribe un poco más sobre tu historia.'; errorEl.classList.remove('hidden'); return; }
      const btn = ev.currentTarget;
      btn.disabled = true; btn.textContent = 'Publicando...';
      try {
        const nuevoRef = push(ref(db, 'comunidad/historiasReales'));
        const fotos = await subirFotos('comunidad-historias', nuevoRef.key, fotosSeleccionadasHist);
        await set(nuevoRef, { autorId: uid, alumnoNombre: ctxAlumno.nombre, texto, createdAt: Date.now(), fotos });
        fotosSeleccionadasHist.length = 0;
        document.getElementById('hist-texto-form').value = '';
        document.getElementById('hist-fotos-preview').innerHTML = '';
        btn.disabled = false; btn.textContent = 'Publicar';
        cargarHistoriasReales();
      } catch (err) {
        console.error('No se pudo publicar la historia:', err);
        errorEl.textContent = 'No se pudo publicar. Intenta de nuevo en un momento.';
        errorEl.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Publicar';
      }
    });
  }
}
