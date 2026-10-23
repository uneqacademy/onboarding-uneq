/* ============================================================
   configuracion.js
   Configuración global de la agencia (solo Director): contenido
   Hotmart por programa, grabaciones de mentorías grupales por
   programa, grupos de WhatsApp (Begin / Next+eXIT combinado),
   soporte y la identidad (foto + nombre) del Director IA. El resto de la app (portal del alumno) lee estos
   valores desde /configuracion/general.

   Las temáticas del BOX ya no las administra el director acá —
   cada mentor agrega las suyas desde su propio perfil (ver
   mentores.js). El director las ve todas y sugiere desde la
   vista "Mentores".
   ============================================================ */

import { db, storage, app } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";
import { tablaPuntos } from './gamificacion-puntos.js';
import { escaparHtml } from './util-html.js';
import { ref, get, set, push, update, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getCurrentRole } from './main.js';

const TAMANO_MAXIMO_ARCHIVO_METODOLOGIA = 10 * 1024 * 1024;
const TAMANO_MAXIMO_FOTO_DIRECTOR_IA = 5 * 1024 * 1024;
const RUTA_FOTO_DIRECTOR_IA = 'fotos-perfil-ia/director-ia';
const PLACEHOLDER_FOTO_DIRECTOR_IA = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#1B2A4A"/><text x="40" y="52" font-size="34" text-anchor="middle" fill="#fff">✨</text></svg>'
);

// Qué campos pertenece a cada sección — para guardar/bloquear cada
// una por separado, sin tocar las demás.
const CAMPOS_POR_SECCION_CONFIG = {
  metodologia: { metodologiaBase: 'config-metodologia-base' },
  comunidad: {
    correoSoporte: 'config-correo-soporte',
    whatsappSoporte: 'config-whatsapp-soporte',
    formSoporteEmbed: 'config-form-soporte-embed'
  },
  hotmart: {
    contenidoHotmartBegin: 'config-contenido-begin',
    contenidoHotmartNext: 'config-contenido-next',
    contenidoHotmartExit: 'config-contenido-exit'
  },
  'director-ia': { directorIaNombre: 'config-director-ia-nombre' },
  grabaciones: {
    grabacionesBegin: 'config-grabaciones-begin',
    grabacionesNext: 'config-grabaciones-next',
    grabacionesExit: 'config-grabaciones-exit'
  },
  whatsapp: {
    whatsappBegin: 'config-whatsapp-begin',
    whatsappNextExit: 'config-whatsapp-nextexit'
  }
};

function bloquearSeccionConfig(seccion, bloqueado) {
  const panel = document.querySelector(`[data-config-seccion="${seccion}"]`);
  if (!panel) return;
  panel.querySelectorAll('input, textarea').forEach(el => { el.disabled = bloqueado; });
  const btnAgregarArchivo = document.getElementById('btn-agregar-archivo-metodologia');
  if (seccion === 'metodologia' && btnAgregarArchivo) btnAgregarArchivo.disabled = bloqueado;
  if (seccion === 'director-ia') {
    ['btn-config-director-ia-foto', 'btn-config-director-ia-quitar-foto'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = bloqueado;
    });
  }
  panel.querySelector('.btn-guardar-config-seccion')?.classList.toggle('hidden', bloqueado);
  panel.querySelector('.btn-editar-config-seccion')?.classList.toggle('hidden', !bloqueado);
}

document.querySelectorAll('.btn-guardar-config-seccion').forEach(btn => {
  btn.addEventListener('click', async () => {
    const seccion = btn.dataset.seccion;
    const campos = CAMPOS_POR_SECCION_CONFIG[seccion];
    const errorEl = document.getElementById(`config-error-${seccion}`);
    if (errorEl) errorEl.classList.add('hidden');
    btn.disabled = true;
    try {
      const datos = {};
      Object.entries(campos).forEach(([campoDb, idInput]) => {
        datos[campoDb] = document.getElementById(idInput).value.trim();
      });
      await update(ref(db, 'configuracion/general'), datos);
      bloquearSeccionConfig(seccion, true);
    } catch (err) {
      console.error('Error al guardar sección de configuración:', seccion, err);
      if (errorEl) {
        errorEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
        errorEl.classList.remove('hidden');
      }
    } finally {
      btn.disabled = false;
    }
  });
});

document.querySelectorAll('.btn-editar-config-seccion').forEach(btn => {
  btn.addEventListener('click', () => bloquearSeccionConfig(btn.dataset.seccion, false));
});

/* --- Archivos de apoyo para la Metodología Base (imagen/PDF/Word) --- */
async function cargarArchivosMetodologia() {
  const cont = document.getElementById('metodologia-archivos-lista');
  if (!cont) return;
  const snap = await get(ref(db, 'configuracion/metodologiaArchivos'));
  const archivos = snap.exists() ? Object.entries(snap.val()) : [];

  if (!archivos.length) {
    cont.innerHTML = '<p class="text-soft" style="font-size:12px;">Sin archivos agregados todavía.</p>';
    return;
  }
  cont.innerHTML = archivos.map(([id, a]) => `
    <div class="flex-between" data-archivo-id="${id}" style="padding:8px 0; border-bottom:0.5px solid var(--border);">
      <span style="font-size:12.5px;">📎 <a href="${escaparHtml(a.archivoUrl)}" target="_blank" rel="noopener">${escaparHtml(a.nombre)}</a> ${a.archivoTexto ? '' : '<span class=\"text-soft\" style=\"font-size:11px;\">— procesando...</span>'}</span>
      <button type="button" class="btn btn--ghost btn-quitar-archivo-metodologia" style="font-size:11px; padding:3px 8px;">Quitar</button>
    </div>`).join('');

  cont.querySelectorAll('.btn-quitar-archivo-metodologia').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fila = btn.closest('[data-archivo-id]');
      const id = fila.dataset.archivoId;
      const archivo = archivos.find(([aid]) => aid === id)[1];
      btn.disabled = true;
      try {
        await remove(ref(db, `configuracion/metodologiaArchivos/${id}`));
        try { await deleteObject(storageRef(storage, archivo.storagePath)); } catch (e) { /* no pasa nada si ya no existe */ }
        await cargarArchivosMetodologia();
      } catch (err) {
        alert('No se pudo quitar. Intenta de nuevo.');
        btn.disabled = false;
      }
    });
  });
}

const btnAgregarArchivoMetodologia = document.getElementById('btn-agregar-archivo-metodologia');
const inputArchivoMetodologia = document.getElementById('input-archivo-metodologia');
if (btnAgregarArchivoMetodologia && inputArchivoMetodologia) {
  btnAgregarArchivoMetodologia.addEventListener('click', () => inputArchivoMetodologia.click());
  inputArchivoMetodologia.addEventListener('change', async () => {
    const archivo = inputArchivoMetodologia.files[0];
    inputArchivoMetodologia.value = '';
    if (!archivo) return;
    if (archivo.size > TAMANO_MAXIMO_ARCHIVO_METODOLOGIA) {
      alert('El archivo pesa más de 10MB. Elige uno más liviano.');
      return;
    }
    btnAgregarArchivoMetodologia.disabled = true;
    try {
      const nuevoRef = push(ref(db, 'configuracion/metodologiaArchivos'));
      const storagePath = `metodologia-base/${nuevoRef.key}_${archivo.name}`;
      const archivoRef = storageRef(storage, storagePath);
      await uploadBytes(archivoRef, archivo);
      const archivoUrl = await getDownloadURL(archivoRef);
      // archivoTexto queda vacío por ahora — una Cloud Function lo
      // procesa solo apenas detecta el archivoUrl, igual que con el
      // Conocimiento Adicional de cada mentor.
      await set(nuevoRef, { nombre: archivo.name, archivoUrl, storagePath, createdAt: Date.now() });
      await cargarArchivosMetodologia();
    } catch (err) {
      alert('No se pudo subir el archivo. Intenta de nuevo.');
    } finally {
      btnAgregarArchivoMetodologia.disabled = false;
    }
  });
}

export async function cargarConfiguracion() {
  if (getCurrentRole() !== 'director') return;
  const snap = await get(ref(db, 'configuracion/general'));
  const c = snap.exists() ? snap.val() : {};

  document.getElementById('config-metodologia-base').value = c.metodologiaBase || '';
  document.getElementById('config-correo-soporte').value = c.correoSoporte || '';
  document.getElementById('config-whatsapp-soporte').value = c.whatsappSoporte || '';
  document.getElementById('config-form-soporte-embed').value = c.formSoporteEmbed || '';
  document.getElementById('config-contenido-begin').value = c.contenidoHotmartBegin || '';
  document.getElementById('config-contenido-next').value = c.contenidoHotmartNext || '';
  document.getElementById('config-contenido-exit').value = c.contenidoHotmartExit || '';
  const fotoDirectorIaEl = document.getElementById('config-director-ia-foto-preview');
  if (fotoDirectorIaEl) {
    fotoDirectorIaEl.src = c.directorIaFotoUrl || PLACEHOLDER_FOTO_DIRECTOR_IA;
    document.getElementById('btn-config-director-ia-quitar-foto')?.classList.toggle('hidden', !c.directorIaFotoUrl);
  }
  const nombreDirectorIaEl = document.getElementById('config-director-ia-nombre');
  if (nombreDirectorIaEl) nombreDirectorIaEl.value = c.directorIaNombre || '';
  document.getElementById('config-grabaciones-begin').value = c.grabacionesBegin || '';
  document.getElementById('config-grabaciones-next').value = c.grabacionesNext || '';
  document.getElementById('config-grabaciones-exit').value = c.grabacionesExit || '';
  document.getElementById('config-whatsapp-begin').value = c.whatsappBegin || '';
  document.getElementById('config-whatsapp-nextexit').value = c.whatsappNextExit || '';

  // Cada sección arranca bloqueada si ya tiene algún dato guardado;
  // si está vacía (primera vez), arranca lista para escribir.
  Object.entries(CAMPOS_POR_SECCION_CONFIG).forEach(([seccion, campos]) => {
    const tieneDatos = Object.keys(campos).some(campoDb => (c[campoDb] || '').trim() !== '');
    bloquearSeccionConfig(seccion, tieneDatos);
  });

  await cargarArchivosMetodologia();
  await cargarHitosDefinidos();
  await cargarGamificacion();
}

document.querySelectorAll('.nav-item[data-nav="configuracion"]').forEach(item => {
  item.addEventListener('click', cargarConfiguracion);
});

const FASES_HITOS = { fase1: 'Fase 1', fase2: 'Fase 2', fase3: 'Fase 3', fase4: 'Fase 4' };

async function cargarHitosDefinidos() {
  const cont = document.getElementById('hitos-por-fase-lista');
  if (!cont) return;
  const snap = await get(ref(db, 'configuracion/hitosDefinidos'));
  const hitos = snap.exists() ? Object.entries(snap.val()) : [];

  cont.innerHTML = Object.keys(FASES_HITOS).map(faseClave => {
    const deEstaFase = hitos.filter(([, h]) => h.fase === faseClave);
    return `
      <div style="margin-bottom:18px;">
        <p style="font-weight:700; font-size:13px; margin-bottom:8px;">${FASES_HITOS[faseClave]}</p>
        ${deEstaFase.length ? deEstaFase.map(([id, h]) => `
          <div class="flex-between" data-hito-id="${id}" data-activo="${h.activo !== false}" style="padding:10px 0; border-bottom:0.5px solid var(--border); ${h.activo === false ? 'opacity:0.5;' : ''}">
            <div style="flex:1;">
              <strong style="font-size:13px;">${escaparHtml(h.titulo)}</strong>
              <p class="text-soft" style="font-size:12px; margin:2px 0 0;">${escaparHtml(h.descripcion || '')}</p>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button type="button" class="btn btn--ghost btn-editar-hito" style="font-size:11px; padding:3px 8px;">Editar</button>
              <button type="button" class="btn btn--ghost btn-toggle-activo-hito" style="font-size:11px; padding:3px 8px;">${h.activo === false ? 'Activar' : 'Desactivar'}</button>
            </div>
          </div>`).join('') : '<p class="text-soft" style="font-size:12px;">Sin hitos todavía para esta fase.</p>'}
      </div>`;
  }).join('');

  cont.querySelectorAll('.btn-toggle-activo-hito').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fila = btn.closest('[data-hito-id]');
      const id = fila.dataset.hitoId;
      const activoActual = fila.dataset.activo === 'true';
      btn.disabled = true;
      try {
        await update(ref(db, `configuracion/hitosDefinidos/${id}`), { activo: !activoActual });
        await cargarHitosDefinidos();
      } catch (err) {
        alert('No se pudo actualizar. Intenta de nuevo.');
        btn.disabled = false;
      }
    });
  });

  cont.querySelectorAll('.btn-editar-hito').forEach(btn => {
    btn.addEventListener('click', () => {
      const fila = btn.closest('[data-hito-id]');
      const id = fila.dataset.hitoId;
      const hito = hitos.find(([hid]) => hid === id)[1];
      fila.innerHTML = `
        <div style="width:100%;">
          <input class="mb-16" id="editar-hito-titulo-${id}" value="${escaparHtml(hito.titulo)}" placeholder="Título">
          <textarea id="editar-hito-descripcion-${id}" style="min-height:60px;">${escaparHtml(hito.descripcion || '')}</textarea>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button type="button" class="btn btn--primary btn-guardar-edicion-hito" style="font-size:11px; padding:4px 10px;">Guardar</button>
            <button type="button" class="btn btn--ghost btn-cancelar-edicion-hito" style="font-size:11px; padding:4px 10px;">Cancelar</button>
          </div>
        </div>`;
      fila.querySelector('.btn-cancelar-edicion-hito').addEventListener('click', () => cargarHitosDefinidos());
      fila.querySelector('.btn-guardar-edicion-hito').addEventListener('click', async (ev) => {
        const nuevoTitulo = document.getElementById(`editar-hito-titulo-${id}`).value.trim();
        const nuevaDescripcion = document.getElementById(`editar-hito-descripcion-${id}`).value.trim();
        if (!nuevoTitulo) { alert('El título no puede quedar vacío.'); return; }
        ev.target.disabled = true;
        try {
          // Ojo: esto NO cambia lo que los alumnos ya publicaron con la
          // versión anterior — ese texto queda copiado y congelado en
          // cada hito publicado, tal como se acordó.
          await update(ref(db, `configuracion/hitosDefinidos/${id}`), { titulo: nuevoTitulo, descripcion: nuevaDescripcion });
          await cargarHitosDefinidos();
        } catch (err) {
          alert('No se pudo guardar. Intenta de nuevo.');
          ev.target.disabled = false;
        }
      });
    });
  });
}

const btnAgregarHito = document.getElementById('btn-agregar-hito');
if (btnAgregarHito) {
  btnAgregarHito.addEventListener('click', async () => {
    const fase = document.getElementById('hito-nueva-fase').value;
    const titulo = document.getElementById('hito-nuevo-titulo').value.trim();
    const descripcion = document.getElementById('hito-nueva-descripcion').value.trim();
    if (!titulo) {
      alert('Escribe un título para el hito.');
      return;
    }
    btnAgregarHito.disabled = true;
    try {
      await set(push(ref(db, 'configuracion/hitosDefinidos')), { fase, titulo, descripcion, activo: true, createdAt: Date.now() });
      document.getElementById('hito-nuevo-titulo').value = '';
      document.getElementById('hito-nueva-descripcion').value = '';
      await cargarHitosDefinidos();
    } catch (err) {
      alert('No se pudo agregar. Intenta de nuevo.');
    } finally {
      btnAgregarHito.disabled = false;
    }
  });
}


/* --- Foto del Director IA (se usa en el chat de los 3 roles) --- */
const btnFotoDirectorIa = document.getElementById('btn-config-director-ia-foto');
const inputFotoDirectorIa = document.getElementById('config-director-ia-foto-input');
const btnQuitarFotoDirectorIa = document.getElementById('btn-config-director-ia-quitar-foto');

if (btnFotoDirectorIa && inputFotoDirectorIa) {
  btnFotoDirectorIa.addEventListener('click', () => inputFotoDirectorIa.click());
  inputFotoDirectorIa.addEventListener('change', async () => {
    const archivo = inputFotoDirectorIa.files[0];
    inputFotoDirectorIa.value = '';
    if (!archivo) return;
    if (archivo.size > TAMANO_MAXIMO_FOTO_DIRECTOR_IA) {
      alert('La imagen pesa más de 5MB. Elige una más liviana.');
      return;
    }
    btnFotoDirectorIa.disabled = true;
    try {
      const fotoRef = storageRef(storage, RUTA_FOTO_DIRECTOR_IA);
      await uploadBytes(fotoRef, archivo);
      const url = await getDownloadURL(fotoRef);
      await update(ref(db, 'configuracion/general'), { directorIaFotoUrl: url });
      document.getElementById('config-director-ia-foto-preview').src = url;
      btnQuitarFotoDirectorIa?.classList.remove('hidden');
    } catch (err) {
      console.error('Error subiendo la foto del Director IA:', err);
      alert('No se pudo subir la foto. Intenta de nuevo.');
    } finally {
      btnFotoDirectorIa.disabled = false;
    }
  });
}

if (btnQuitarFotoDirectorIa) {
  btnQuitarFotoDirectorIa.addEventListener('click', async () => {
    if (!confirm('¿Quitar la foto del Director IA? Volverá el ícono por defecto.')) return;
    btnQuitarFotoDirectorIa.disabled = true;
    try {
      await update(ref(db, 'configuracion/general'), { directorIaFotoUrl: null });
      try { await deleteObject(storageRef(storage, RUTA_FOTO_DIRECTOR_IA)); } catch (e) { /* si ya no existe, da igual */ }
      document.getElementById('config-director-ia-foto-preview').src = PLACEHOLDER_FOTO_DIRECTOR_IA;
      btnQuitarFotoDirectorIa.classList.add('hidden');
    } catch (err) {
      console.error('Error quitando la foto del Director IA:', err);
      alert('No se pudo quitar la foto. Intenta de nuevo.');
    } finally {
      btnQuitarFotoDirectorIa.disabled = false;
    }
  });
}


/* --- Ranking: tabla de puntos y premio del mes --- */
const RUTA_FOTO_PREMIO = 'premio-ranking/premio';
const TAMANO_MAXIMO_FOTO_PREMIO = 5 * 1024 * 1024;
const PLACEHOLDER_FOTO_PREMIO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="12" fill="#E4E7EC"/><text x="40" y="52" font-size="34" text-anchor="middle">🎁</text></svg>'
);

async function cargarGamificacion() {
  const tablaEl = document.getElementById('gami-tabla');
  if (!tablaEl) return;
  const snap = await get(ref(db, 'configuracion/gamificacion'));
  const c = snap.exists() ? snap.val() : {};

  tablaEl.innerHTML = `
    <div style="display:grid; grid-template-columns: 1fr 84px 84px; gap:8px 10px; align-items:center; font-size:13px;">
      <span class="text-soft" style="font-size:11.5px;">Acción</span>
      <span class="text-soft" style="font-size:11.5px;">Puntos</span>
      <span class="text-soft" style="font-size:11.5px;">Tope por día</span>
      ${tablaPuntos(c.puntos).map(a => `
        <span>${escaparHtml(a.etiqueta)}</span>
        <input type="number" min="0" max="1000" step="1" inputmode="numeric" id="gami-puntos-${a.clave}" value="${a.puntos}">
        ${a.topeEditable
          ? `<input type="number" min="0" max="100" step="1" inputmode="numeric" id="gami-tope-${a.clave}" value="${a.tope || ''}" placeholder="sin tope">`
          : '<span class="text-soft">—</span>'}`).join('')}
    </div>`;

  const premio = c.premio || {};
  document.getElementById('gami-premio-texto').value = premio.texto || '';
  document.getElementById('gami-premio-foto-preview').src = premio.fotoUrl || PLACEHOLDER_FOTO_PREMIO;
  document.getElementById('btn-gami-premio-quitar-foto').classList.toggle('hidden', !premio.fotoUrl);
}

document.getElementById('btn-gami-guardar-puntos')?.addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  const errorEl = document.getElementById('gami-error-puntos');
  errorEl.classList.add('hidden');
  const puntos = {};
  for (const a of tablaPuntos({})) {
    const valor = Number(document.getElementById(`gami-puntos-${a.clave}`).value);
    if (!Number.isInteger(valor) || valor < 0 || valor > 1000) {
      errorEl.textContent = `Revisa «${a.etiqueta}»: los puntos deben ser un número entero entre 0 y 1000.`;
      errorEl.classList.remove('hidden');
      return;
    }
    let tope = a.tope; // las acciones sin tope editable conservan el suyo
    if (a.topeEditable) {
      const texto = document.getElementById(`gami-tope-${a.clave}`).value.trim();
      tope = texto === '' ? 0 : Number(texto);
      if (!Number.isInteger(tope) || tope < 0 || tope > 100) {
        errorEl.textContent = `Revisa «${a.etiqueta}»: el tope por día debe ser un número entero (o dejarse vacío).`;
        errorEl.classList.remove('hidden');
        return;
      }
    }
    puntos[a.clave] = { puntos: valor, tope };
  }
  btn.disabled = true;
  try {
    await set(ref(db, 'configuracion/gamificacion/puntos'), puntos);
    btn.textContent = 'Guardado ✓';
    setTimeout(() => { btn.textContent = 'Guardar puntos'; }, 2000);
  } catch (err) {
    console.error('No se pudo guardar la tabla de puntos:', err);
    errorEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-gami-guardar-premio')?.addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  const errorEl = document.getElementById('gami-error-premio');
  errorEl.classList.add('hidden');
  btn.disabled = true;
  try {
    await update(ref(db, 'configuracion/gamificacion/premio'), { texto: document.getElementById('gami-premio-texto').value.trim() });
    btn.textContent = 'Guardado ✓';
    setTimeout(() => { btn.textContent = 'Guardar premio'; }, 2000);
  } catch (err) {
    console.error('No se pudo guardar el premio:', err);
    errorEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

const btnPremioFoto = document.getElementById('btn-gami-premio-foto');
const inputPremioFoto = document.getElementById('gami-premio-foto-input');
if (btnPremioFoto && inputPremioFoto) {
  btnPremioFoto.addEventListener('click', () => inputPremioFoto.click());
  inputPremioFoto.addEventListener('change', async () => {
    const archivo = inputPremioFoto.files[0];
    inputPremioFoto.value = '';
    if (!archivo) return;
    if (archivo.size > TAMANO_MAXIMO_FOTO_PREMIO) { alert('La imagen pesa más de 5MB. Elige una más liviana.'); return; }
    btnPremioFoto.disabled = true;
    try {
      const fotoRef = storageRef(storage, RUTA_FOTO_PREMIO);
      await uploadBytes(fotoRef, archivo);
      const url = await getDownloadURL(fotoRef);
      await update(ref(db, 'configuracion/gamificacion/premio'), { fotoUrl: url });
      document.getElementById('gami-premio-foto-preview').src = url;
      document.getElementById('btn-gami-premio-quitar-foto').classList.remove('hidden');
    } catch (err) {
      console.error('Error subiendo la foto del premio:', err);
      alert('No se pudo subir la foto. Intenta de nuevo.');
    } finally {
      btnPremioFoto.disabled = false;
    }
  });
}

document.getElementById('btn-gami-premio-quitar-foto')?.addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  if (!confirm('¿Quitar la foto del premio?')) return;
  btn.disabled = true;
  try {
    await update(ref(db, 'configuracion/gamificacion/premio'), { fotoUrl: null });
    try { await deleteObject(storageRef(storage, RUTA_FOTO_PREMIO)); } catch (e) { /* si ya no existe, da igual */ }
    document.getElementById('gami-premio-foto-preview').src = PLACEHOLDER_FOTO_PREMIO;
    btn.classList.add('hidden');
  } catch (err) {
    console.error('Error quitando la foto del premio:', err);
    alert('No se pudo quitar la foto. Intenta de nuevo.');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-gami-actualizar')?.addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  const msg = document.getElementById('gami-actualizar-msg');
  btn.disabled = true;
  msg.textContent = 'Actualizando…';
  try {
    await httpsCallable(getFunctions(app), 'recalcularRankingAhora', { timeout: 120000 })();
    msg.textContent = 'Ranking actualizado ✓';
  } catch (err) {
    console.error('No se pudo actualizar el ranking:', err);
    msg.textContent = 'No se pudo actualizar. Intenta de nuevo en un momento.';
  } finally {
    btn.disabled = false;
  }
});
