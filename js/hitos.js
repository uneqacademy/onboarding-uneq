/* ============================================================
   hitos.js — "Mis Hitos"
   Los alumnos publican hitos predefinidos (uno por proyecto, no se
   puede repetir), con su propio texto y fotos. Sus compañeros (y el
   staff) comentan y reaccionan. BEGIN solo ve BEGIN; Next/eXIT
   conviven entre ellos; el staff ve todo junto con etiqueta de
   programa. Moderación: cualquier alumno puede denunciar (queda
   oculto hasta que el director decide); el autor puede borrar lo
   suyo en cualquier momento; el director puede eliminar directo.
   ============================================================ */

import { db, auth, storage } from './firebase-config.js';
import { ref, get, set, push, update, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getCurrentRole } from './main.js';

const FASES_HITOS = { fase1: 'Fase 1: Claridad y Fundamentos', fase2: 'Fase 2: Cliente Soñado', fase3: 'Fase 3: Oferta y Método', fase4: 'Fase 4: Acción y Sistemas' };
const TAMANO_MAXIMO_FOTO_HITO = 10 * 1024 * 1024;

function formatFechaHito(ts) {
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
}

function linkifyTexto(texto) {
  if (!texto) return '';
  const escapado = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escapado.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
}

let fotosSeleccionadasHito = [];

export async function cargarMisHitos() {
  const role = getCurrentRole();
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;

  const esAlumno = role === 'alumno';
  const esStaff = !esAlumno;
  const esDirector = role === 'director';

  document.getElementById('hitos-seguimiento-panel')?.classList.toggle('hidden', !esAlumno);
  document.getElementById('hitos-publicar-panel')?.classList.toggle('hidden', !esAlumno);
  document.getElementById('hitos-filtros-panel')?.classList.toggle('hidden', !esStaff);

  // --- Determinar alumnoId/proyecto/programa (si es alumno) ---
  let alumnoIdPropio = null;
  let cicloIdPropio = null;
  let programaPropio = null;
  let idsProyectoPropio = [];
  if (esAlumno) {
    const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
    alumnoIdPropio = mapaSnap.exists() ? mapaSnap.val() : null;
    if (alumnoIdPropio) {
      const alumnoSnap = await get(ref(db, `alumnos/${alumnoIdPropio}`));
      cicloIdPropio = alumnoSnap.exists() ? alumnoSnap.val().cicloActualId : null;
      if (cicloIdPropio) {
        const cicloSnap = await get(ref(db, `ciclos/${cicloIdPropio}`));
        if (cicloSnap.exists()) {
          programaPropio = cicloSnap.val().programa || null;
          idsProyectoPropio = Array.isArray(cicloSnap.val().alumnoIds) ? cicloSnap.val().alumnoIds : [alumnoIdPropio];
        }
      }
    }
  }

  // --- Hitos definidos (activos e inactivos — los inactivos igual
  //     hay que poder mostrarlos si ya fueron publicados) ---
  const [hitosDefSnap, hitosSnap, usuariosSnap] = await Promise.all([
    get(ref(db, 'configuracion/hitosDefinidos')),
    get(ref(db, 'hitos')),
    get(ref(db, 'usuarios'))
  ]);
  const hitosDefinidos = hitosDefSnap.exists() ? hitosDefSnap.val() : {};
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
  const todosLosHitos = hitosSnap.exists() ? Object.entries(hitosSnap.val()) : [];

  // --- Filtro de visibilidad: BEGIN solo ve BEGIN; Next/eXIT conviven;
  //     staff ve todo. Los "oculto_denuncia" no los ve nadie excepto
  //     el director (para poder decidir). ---
  const hitosVisibles = todosLosHitos.filter(([, h]) => {
    if (h.estado === 'oculto_denuncia' && !esDirector) return false;
    if (esAlumno) {
      if (programaPropio === 'begin') return h.programa === 'begin';
      return h.programa === 'next' || h.programa === 'exit';
    }
    return true;
  }).sort((a, b) => b[1].createdAt - a[1].createdAt);

  // --- Seguimiento personal + selector de publicar (solo alumno) ---
  if (esAlumno && cicloIdPropio) {
    const misHitosPublicadosDefIds = new Set(
      todosLosHitos.filter(([, h]) => h.proyectoId === cicloIdPropio).map(([, h]) => h.hitoDefId)
    );
    renderSeguimientoPersonal(hitosDefinidos, misHitosPublicadosDefIds);
    poblarSelectorPublicar(hitosDefinidos, misHitosPublicadosDefIds);
  } else if (esAlumno) {
    const seg = document.getElementById('hitos-seguimiento-contenido');
    if (seg) seg.innerHTML = '<p class="text-soft">Todavía no tienes un ciclo asignado.</p>';
  }

  // --- Filtros de staff: poblar selector de alumno ---
  if (esStaff) {
    const filtroAlumnoEl = document.getElementById('hitos-filtro-alumno');
    if (filtroAlumnoEl && !filtroAlumnoEl.dataset.cargado) {
      const nombresUnicos = [...new Set(todosLosHitos.map(([, h]) => h.nombreAutor))].sort((a, b) => a.localeCompare(b, 'es'));
      filtroAlumnoEl.innerHTML = '<option value="">Todos los alumnos</option>' + nombresUnicos.map(n => `<option value="${n}">${n}</option>`).join('');
      filtroAlumnoEl.dataset.cargado = '1';
    }
    ['hitos-filtro-alumno', 'hitos-filtro-programa', 'hitos-filtro-fase', 'hitos-filtro-denunciados'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.dataset.conectado) {
        el.addEventListener('change', cargarMisHitos);
        el.dataset.conectado = '1';
      }
    });
  }

  renderFeedHitos(hitosVisibles, usuarios, { esAlumno, esStaff, esDirector, uid, alumnoIdPropio, idsProyectoPropio });

  // --- Link directo a un hito (compartido por WhatsApp) ---
  const hash = window.location.hash;
  if (hash && hash.startsWith('#hito-')) {
    const elDestino = document.getElementById(hash.slice(1));
    if (elDestino) {
      setTimeout(() => elDestino.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    }
  }
}

function renderSeguimientoPersonal(hitosDefinidos, misHitosPublicadosDefIds) {
  const cont = document.getElementById('hitos-seguimiento-contenido');
  if (!cont) return;
  const activos = Object.entries(hitosDefinidos).filter(([, h]) => h.activo !== false);
  const totalPublicados = activos.filter(([id]) => misHitosPublicadosDefIds.has(id)).length;

  cont.innerHTML = `
    <p class="mb-16" style="font-weight:600;">${totalPublicados} de ${activos.length} hitos publicados</p>
    ${Object.keys(FASES_HITOS).map(faseClave => {
      const deEstaFase = activos.filter(([, h]) => h.fase === faseClave);
      if (!deEstaFase.length) return '';
      return `
        <div style="margin-bottom:14px;">
          <p class="text-soft" style="font-size:12px; font-weight:600; margin-bottom:6px;">${FASES_HITOS[faseClave]}</p>
          ${deEstaFase.map(([id, h]) => `
            <p style="font-size:13px; margin:2px 0;">${misHitosPublicadosDefIds.has(id) ? '✅' : '⬜'} ${h.titulo}</p>`).join('')}
        </div>`;
    }).join('')}`;
}

function poblarSelectorPublicar(hitosDefinidos, misHitosPublicadosDefIds) {
  const select = document.getElementById('hito-select-publicar');
  if (!select) return;
  const disponibles = Object.entries(hitosDefinidos).filter(([id, h]) => h.activo !== false && !misHitosPublicadosDefIds.has(id));
  select.innerHTML = '<option value="">Selecciona...</option>' + Object.keys(FASES_HITOS).map(faseClave => {
    const deEstaFase = disponibles.filter(([, h]) => h.fase === faseClave);
    if (!deEstaFase.length) return '';
    return `<optgroup label="${FASES_HITOS[faseClave]}">${deEstaFase.map(([id, h]) => `<option value="${id}">${h.titulo}</option>`).join('')}</optgroup>`;
  }).join('');
}

const btnAdjuntarFotoHito = document.getElementById('btn-adjuntar-foto-hito');
const inputFotoHito = document.getElementById('input-foto-hito');
if (btnAdjuntarFotoHito && inputFotoHito) {
  btnAdjuntarFotoHito.addEventListener('click', () => inputFotoHito.click());
  inputFotoHito.addEventListener('change', () => {
    const seleccionados = Array.from(inputFotoHito.files);
    const muyPesados = seleccionados.filter(f => f.size > TAMANO_MAXIMO_FOTO_HITO);
    if (muyPesados.length) {
      alert(`Estas fotos pesan más de 10MB: ${muyPesados.map(f => f.name).join(', ')}`);
      inputFotoHito.value = '';
      return;
    }
    fotosSeleccionadasHito = seleccionados;
    document.getElementById('hito-fotos-preview').innerHTML = fotosSeleccionadasHito
      .map(f => `<span class="text-soft" style="font-size:11px; background:#F0F1F3; padding:3px 8px; border-radius:6px;">🖼️ ${f.name}</span>`).join('');
  });
}

function programaLabelCorto(p) {
  return p === 'begin' ? 'Begin' : p === 'next' ? 'Next' : p === 'exit' ? 'eXIT' : '—';
}

function renderComentarios(hitoId, comentarios, esDirector) {
  const lista = Object.entries(comentarios || {})
    .filter(([, c]) => c.estado !== 'oculto_denuncia' || esDirector)
    .sort((a, b) => a[1].createdAt - b[1].createdAt);
  if (!lista.length) return '<p class="text-soft" style="font-size:12px;">Sin comentarios todavía — ¡sé el primero en animar!</p>';
  return lista.map(([comentarioId, c]) => `
    <div data-comentario-id="${comentarioId}" style="padding:6px 0; border-bottom:0.5px solid var(--border);">
      <p style="font-size:12.5px; margin:0;">
        <strong>${c.autorNombre || 'Alguien'}</strong>${c.autorTipo === 'staff' ? ' <span class="badge badge--activo" style="font-size:8px;">staff</span>' : ''}
        ${c.estado === 'oculto_denuncia' ? ' <span style="color:#C0392B; font-size:10px;">⚠️ denunciado</span>' : ''}
        : ${linkifyTexto(c.texto)}
      </p>
      <div style="display:flex; gap:10px; margin-top:2px;">
        <span class="text-soft" style="font-size:10px;">${formatFechaHito(c.createdAt)}</span>
        <button type="button" class="btn-eliminar-comentario" data-hito-id="${hitoId}" data-comentario-id="${comentarioId}" data-autor-id="${c.autorId}" style="font-size:10px; background:none; border:none; color:#9CA0A8; cursor:pointer; padding:0;">Eliminar</button>
        <button type="button" class="btn-denunciar-comentario" data-hito-id="${hitoId}" data-comentario-id="${comentarioId}" style="font-size:10px; background:none; border:none; color:#9CA0A8; cursor:pointer; padding:0;">Denunciar</button>
        ${c.estado === 'oculto_denuncia' && esDirector ? `
          <button type="button" class="btn-aceptar-denuncia-comentario" data-hito-id="${hitoId}" data-comentario-id="${comentarioId}" style="font-size:10px; background:none; border:none; color:#C0392B; cursor:pointer; padding:0;">Aceptar denuncia</button>
          <button type="button" class="btn-rechazar-denuncia-comentario" data-hito-id="${hitoId}" data-comentario-id="${comentarioId}" style="font-size:10px; background:none; border:none; color:#2F9E8F; cursor:pointer; padding:0;">Rechazar</button>` : ''}
      </div>
    </div>`).join('');
}

function renderFeedHitos(hitosVisibles, usuarios, ctx) {
  const feedEl = document.getElementById('hitos-feed');
  if (!feedEl) return;

  // Filtros de staff
  let lista = hitosVisibles;
  if (ctx.esStaff) {
    const fAlumno = document.getElementById('hitos-filtro-alumno')?.value || '';
    const fPrograma = document.getElementById('hitos-filtro-programa')?.value || '';
    const fFase = document.getElementById('hitos-filtro-fase')?.value || '';
    const fSoloDenunciados = document.getElementById('hitos-filtro-denunciados')?.checked || false;
    lista = lista.filter(([, h]) =>
      (!fAlumno || h.nombreAutor === fAlumno) &&
      (!fPrograma || h.programa === fPrograma) &&
      (!fFase || h.fase === fFase) &&
      (!fSoloDenunciados || h.estado === 'oculto_denuncia')
    );
  }

  if (!lista.length) {
    feedEl.innerHTML = '<p class="text-soft">Todavía no hay hitos publicados por acá.</p>';
    return;
  }

  feedEl.innerHTML = lista.map(([hitoId, h]) => {
    const esAutor = ctx.esAlumno && ctx.idsProyectoPropio.includes(h.alumnoIdPublicador);
    const puedeEliminar = esAutor || ctx.esDirector;
    const puedeDenunciar = ctx.esAlumno && !esAutor;
    const yaReacciono = h.reacciones && h.reacciones[ctx.uid];
    const totalReacciones = h.reacciones ? Object.keys(h.reacciones).length : 0;
    const esDenunciado = h.estado === 'oculto_denuncia';

    return `
    <div class="panel mb-16" id="hito-${hitoId}" data-hito-id="${hitoId}" ${esDenunciado ? 'style="border-color:#F5C6C6;"' : ''}>
      <div class="panel__body">
        <div class="flex-between">
          <div>
            <strong>${h.nombreAutor}</strong>
            ${ctx.esStaff ? `<span class="badge badge--activo" style="font-size:9px;">${programaLabelCorto(h.programa)}</span>` : ''}
            <p class="text-soft" style="font-size:11px; margin:2px 0 0;">${FASES_HITOS[h.fase] || h.fase} · <strong>${h.tituloHito}</strong></p>
          </div>
          ${esDenunciado ? '<span class="badge" style="background:#FBE4E4; color:#C0392B; font-size:9px;">⚠️ Denunciado</span>' : ''}
        </div>
        ${h.descripcionHito ? `<p class="text-soft" style="font-size:12px; margin:8px 0 0; font-style:italic;">${h.descripcionHito}</p>` : ''}
        ${h.textoAlumno ? `<p style="margin:8px 0 0; white-space:pre-wrap;">${linkifyTexto(h.textoAlumno)}</p>` : ''}
        ${(h.fotos || []).map(f => `<img src="${f.url}" alt="" style="max-width:220px; max-height:220px; border-radius:8px; margin:8px 8px 0 0; object-fit:cover;">`).join('')}
        <p class="text-soft" style="font-size:11px; margin:8px 0 0;">${formatFechaHito(h.createdAt)}</p>

        <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; align-items:center;">
          <button type="button" class="btn ${yaReacciono ? 'btn--primary' : 'btn--ghost'} btn-reaccion-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:4px 10px;">❤️ ${totalReacciones}</button>
          <button type="button" class="btn btn--ghost btn-compartir-hito" data-hito-id="${hitoId}" data-titulo="${h.tituloHito}" style="font-size:12px; padding:4px 10px;">📤 Compartir</button>
          ${puedeEliminar ? `<button type="button" class="btn btn--ghost btn-eliminar-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:4px 10px; color:#C0392B;">Eliminar</button>` : ''}
          ${puedeDenunciar ? `<button type="button" class="btn btn--ghost btn-denunciar-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:4px 10px;">Denunciar</button>` : ''}
          ${esDenunciado && ctx.esDirector ? `
            <button type="button" class="btn btn--ghost btn-aceptar-denuncia-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:4px 10px; color:#C0392B;">Aceptar denuncia (elimina)</button>
            <button type="button" class="btn btn--ghost btn-rechazar-denuncia-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:4px 10px; color:#2F9E8F;">Rechazar</button>` : ''}
        </div>

        <div class="comentarios-hito" style="margin-top:12px; border-top:0.5px solid var(--border); padding-top:10px;">
          ${renderComentarios(hitoId, h.comentarios, ctx.esDirector)}
        </div>
        <div style="display:flex; gap:8px; margin-top:10px;">
          <input class="input-comentario-hito" data-hito-id="${hitoId}" placeholder="Escribe un comentario de ánimo..." style="flex:1;">
          <button type="button" class="btn btn--primary btn-enviar-comentario-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:6px 14px;">Enviar</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

const btnPublicarHito = document.getElementById('btn-publicar-hito');
if (btnPublicarHito) {
  btnPublicarHito.addEventListener('click', async () => {
    const errorEl = document.getElementById('hito-publicar-error');
    errorEl.classList.add('hidden');
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const hitoDefId = document.getElementById('hito-select-publicar').value;
    const texto = document.getElementById('hito-texto-publicar').value.trim();

    if (!uid || !hitoDefId) {
      errorEl.textContent = 'Elige qué hito lograste antes de publicar.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnPublicarHito.disabled = true;
    try {
      const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
      const alumnoId = mapaSnap.exists() ? mapaSnap.val() : null;
      const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
      const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
      const cicloId = alumno.cicloActualId;
      if (!cicloId) throw new Error('Sin ciclo asignado');
      const cicloSnap = await get(ref(db, `ciclos/${cicloId}`));
      const ciclo = cicloSnap.exists() ? cicloSnap.val() : {};

      // Nombre combinado del proyecto (si hay socia, van los 2 nombres)
      const idsProyecto = Array.isArray(ciclo.alumnoIds) ? ciclo.alumnoIds : [alumnoId];
      const nombresSnaps = await Promise.all(idsProyecto.map(id => get(ref(db, `alumnos/${id}`))));
      const nombreAutor = nombresSnaps.filter(s => s.exists()).map(s => `${s.val().nombre || ''} ${s.val().apellido || ''}`.trim()).filter(Boolean).join(' y ');

      const hitoDefSnap = await get(ref(db, `configuracion/hitosDefinidos/${hitoDefId}`));
      if (!hitoDefSnap.exists()) throw new Error('Hito no encontrado');
      const hitoDef = hitoDefSnap.val();

      // Doble chequeo: que el proyecto no lo haya publicado ya (por si
      // se abrieron 2 pestañas a la vez)
      const yaExistentesSnap = await get(ref(db, 'hitos'));
      const yaExistentes = yaExistentesSnap.exists() ? Object.values(yaExistentesSnap.val()) : [];
      if (yaExistentes.some(h => h.proyectoId === cicloId && h.hitoDefId === hitoDefId)) {
        errorEl.textContent = 'Este hito ya fue publicado por tu proyecto.';
        errorEl.classList.remove('hidden');
        return;
      }

      const nuevoRef = push(ref(db, 'hitos'));
      const fotos = [];
      for (let i = 0; i < fotosSeleccionadasHito.length; i++) {
        const archivoRef = storageRef(storage, `hitos/${nuevoRef.key}/${i}_${Date.now()}_${fotosSeleccionadasHito[i].name}`);
        await uploadBytes(archivoRef, fotosSeleccionadasHito[i]);
        fotos.push({ url: await getDownloadURL(archivoRef), nombre: fotosSeleccionadasHito[i].name });
      }

      await set(nuevoRef, {
        proyectoId: cicloId,
        alumnoIdPublicador: alumnoId,
        nombreAutor,
        programa: ciclo.programa || null,
        fase: hitoDef.fase,
        hitoDefId,
        tituloHito: hitoDef.titulo,
        descripcionHito: hitoDef.descripcion || '',
        textoAlumno: texto,
        fotos,
        createdAt: Date.now(),
        estado: 'visible'
      });

      document.getElementById('hito-texto-publicar').value = '';
      document.getElementById('hito-fotos-preview').innerHTML = '';
      fotosSeleccionadasHito = [];
      await cargarMisHitos();
    } catch (err) {
      console.error(err);
      errorEl.textContent = 'No se pudo publicar. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
    } finally {
      btnPublicarHito.disabled = false;
    }
  });
}

async function enviarComentario(hitoId, texto) {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid || !texto.trim()) return;
  const role = getCurrentRole();
  const esAlumno = role === 'alumno';
  let autorNombre = '';
  if (esAlumno) {
    const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
    const alumnoId = mapaSnap.exists() ? mapaSnap.val() : null;
    const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
    const a = alumnoSnap.exists() ? alumnoSnap.val() : {};
    autorNombre = `${a.nombre || ''} ${a.apellido || ''}`.trim();
  } else {
    const usuarioSnap = await get(ref(db, `usuarios/${uid}`));
    autorNombre = usuarioSnap.exists() ? (usuarioSnap.val().nombre || '') : '';
  }
  await set(push(ref(db, `hitos/${hitoId}/comentarios`)), {
    autorId: uid,
    autorNombre,
    autorTipo: esAlumno ? 'alumno' : 'staff',
    texto: texto.trim(),
    createdAt: Date.now(),
    estado: 'visible'
  });
  await cargarMisHitos();
}

function compartirHitoWhatsapp(hitoId, titulo) {
  const url = `${window.location.origin}${window.location.pathname}#hito-${hitoId}`;
  const mensaje = encodeURIComponent(`¡Quiero compartir con ustedes que logré "${titulo}" en mi programa con UNEQ Mentoring! 🎉\n\nMíralo y déjame un comentario acá:\n${url}`);
  window.open(`https://wa.me/?text=${mensaje}`, '_blank');
}

const feedHitosEl = document.getElementById('hitos-feed');
if (feedHitosEl) {
  feedHitosEl.addEventListener('click', async (ev) => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid) return;

    const btnReaccion = ev.target.closest('.btn-reaccion-hito');
    if (btnReaccion) {
      const hitoId = btnReaccion.dataset.hitoId;
      const refReaccion = ref(db, `hitos/${hitoId}/reacciones/${uid}`);
      const yaExiste = (await get(refReaccion)).exists();
      if (yaExiste) await remove(refReaccion); else await set(refReaccion, true);
      await cargarMisHitos();
      return;
    }

    const btnCompartir = ev.target.closest('.btn-compartir-hito');
    if (btnCompartir) {
      compartirHitoWhatsapp(btnCompartir.dataset.hitoId, btnCompartir.dataset.titulo);
      return;
    }

    const btnEliminarHito = ev.target.closest('.btn-eliminar-hito');
    if (btnEliminarHito) {
      if (!confirm('¿Eliminar este hito? Esta acción no se puede deshacer.')) return;
      await remove(ref(db, `hitos/${btnEliminarHito.dataset.hitoId}`));
      await cargarMisHitos();
      return;
    }

    const btnDenunciarHito = ev.target.closest('.btn-denunciar-hito');
    if (btnDenunciarHito) {
      if (!confirm('¿Denunciar este hito? Quedará oculto hasta que el director/a lo revise.')) return;
      const hitoId = btnDenunciarHito.dataset.hitoId;
      await update(ref(db, `hitos/${hitoId}`), { estado: 'oculto_denuncia' });
      await update(ref(db, `hitos/${hitoId}/denuncia`), { denunciadoPor: uid, createdAt: Date.now() });
      await cargarMisHitos();
      return;
    }

    const btnAceptarDenunciaHito = ev.target.closest('.btn-aceptar-denuncia-hito');
    if (btnAceptarDenunciaHito) {
      if (!confirm('¿Eliminar este hito denunciado? Esta acción no se puede deshacer.')) return;
      await remove(ref(db, `hitos/${btnAceptarDenunciaHito.dataset.hitoId}`));
      await cargarMisHitos();
      return;
    }

    const btnRechazarDenunciaHito = ev.target.closest('.btn-rechazar-denuncia-hito');
    if (btnRechazarDenunciaHito) {
      const hitoId = btnRechazarDenunciaHito.dataset.hitoId;
      await update(ref(db, `hitos/${hitoId}`), { estado: 'visible' });
      await remove(ref(db, `hitos/${hitoId}/denuncia`));
      await cargarMisHitos();
      return;
    }

    const btnEnviarComentario = ev.target.closest('.btn-enviar-comentario-hito');
    if (btnEnviarComentario) {
      const hitoId = btnEnviarComentario.dataset.hitoId;
      const input = feedHitosEl.querySelector(`.input-comentario-hito[data-hito-id="${hitoId}"]`);
      if (input && input.value.trim()) {
        btnEnviarComentario.disabled = true;
        await enviarComentario(hitoId, input.value);
      }
      return;
    }

    const btnEliminarComentario = ev.target.closest('.btn-eliminar-comentario');
    if (btnEliminarComentario) {
      if (!confirm('¿Eliminar este comentario?')) return;
      await remove(ref(db, `hitos/${btnEliminarComentario.dataset.hitoId}/comentarios/${btnEliminarComentario.dataset.comentarioId}`));
      await cargarMisHitos();
      return;
    }

    const btnDenunciarComentario = ev.target.closest('.btn-denunciar-comentario');
    if (btnDenunciarComentario) {
      if (!confirm('¿Denunciar este comentario? Quedará oculto hasta que el director/a lo revise.')) return;
      const { hitoId, comentarioId } = btnDenunciarComentario.dataset;
      await update(ref(db, `hitos/${hitoId}/comentarios/${comentarioId}`), { estado: 'oculto_denuncia' });
      await update(ref(db, `hitos/${hitoId}/comentarios/${comentarioId}/denuncia`), { denunciadoPor: uid, createdAt: Date.now() });
      await cargarMisHitos();
      return;
    }

    const btnAceptarDenunciaComentario = ev.target.closest('.btn-aceptar-denuncia-comentario');
    if (btnAceptarDenunciaComentario) {
      if (!confirm('¿Eliminar este comentario denunciado?')) return;
      const { hitoId, comentarioId } = btnAceptarDenunciaComentario.dataset;
      await remove(ref(db, `hitos/${hitoId}/comentarios/${comentarioId}`));
      await cargarMisHitos();
      return;
    }

    const btnRechazarDenunciaComentario = ev.target.closest('.btn-rechazar-denuncia-comentario');
    if (btnRechazarDenunciaComentario) {
      const { hitoId, comentarioId } = btnRechazarDenunciaComentario.dataset;
      await update(ref(db, `hitos/${hitoId}/comentarios/${comentarioId}`), { estado: 'visible' });
      await remove(ref(db, `hitos/${hitoId}/comentarios/${comentarioId}/denuncia`));
      await cargarMisHitos();
      return;
    }
  });

  feedHitosEl.addEventListener('keypress', async (ev) => {
    if (ev.key === 'Enter' && ev.target.classList.contains('input-comentario-hito')) {
      const hitoId = ev.target.dataset.hitoId;
      if (ev.target.value.trim()) await enviarComentario(hitoId, ev.target.value);
    }
  });
}

document.querySelectorAll('.nav-item[data-nav="mis-hitos"]').forEach(item => {
  item.addEventListener('click', cargarMisHitos);
});
