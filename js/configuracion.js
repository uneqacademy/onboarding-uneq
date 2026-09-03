/* ============================================================
   configuracion.js
   Configuración global de la agencia (solo Director): link de
   Comunidad Hotmart (único), contenido Hotmart por programa,
   grupos de WhatsApp (Begin / Next+eXIT combinado) y correo de
   soporte. El resto de la app (portal del alumno) lee estos
   valores desde /configuracion/general.

   Las temáticas del BOX ya no las administra el director acá —
   cada mentor agrega las suyas desde su propio perfil (ver
   mentores.js). El director las ve todas y sugiere desde la
   vista "Mentores".
   ============================================================ */

import { db, storage } from './firebase-config.js';
import { ref, get, set, push, update, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getCurrentRole } from './main.js';

const TAMANO_MAXIMO_ARCHIVO_METODOLOGIA = 10 * 1024 * 1024;

// Qué campos pertenece a cada sección — para guardar/bloquear cada
// una por separado, sin tocar las demás.
const CAMPOS_POR_SECCION_CONFIG = {
  metodologia: { metodologiaBase: 'config-metodologia-base' },
  comunidad: {
    comunidadHotmartUrl: 'config-comunidad-hotmart',
    correoSoporte: 'config-correo-soporte',
    whatsappSoporte: 'config-whatsapp-soporte',
    formSoporteEmbed: 'config-form-soporte-embed'
  },
  hotmart: {
    contenidoHotmartBegin: 'config-contenido-begin',
    contenidoHotmartNext: 'config-contenido-next',
    contenidoHotmartExit: 'config-contenido-exit'
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
  panel.querySelector('.btn-guardar-config-seccion')?.classList.toggle('hidden', bloqueado);
  panel.querySelector('.btn-editar-config-seccion')?.classList.toggle('hidden', !bloqueado);
}

document.querySelectorAll('.btn-guardar-config-seccion').forEach(btn => {
  btn.addEventListener('click', async () => {
    const seccion = btn.dataset.seccion;
    const campos = CAMPOS_POR_SECCION_CONFIG[seccion];
    const errorEl = document.getElementById('configuracion-error');
    errorEl.classList.add('hidden');
    btn.disabled = true;
    try {
      const datos = {};
      Object.entries(campos).forEach(([campoDb, idInput]) => {
        datos[campoDb] = document.getElementById(idInput).value.trim();
      });
      await update(ref(db, 'configuracion/general'), datos);
      bloquearSeccionConfig(seccion, true);
    } catch (err) {
      errorEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
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
      <span style="font-size:12.5px;">📎 <a href="${a.archivoUrl}" target="_blank" rel="noopener">${a.nombre}</a> ${a.archivoTexto ? '' : '<span class=\"text-soft\" style=\"font-size:11px;\">— procesando...</span>'}</span>
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

  document.getElementById('config-comunidad-hotmart').value = c.comunidadHotmartUrl || '';
  document.getElementById('config-metodologia-base').value = c.metodologiaBase || '';
  document.getElementById('config-correo-soporte').value = c.correoSoporte || '';
  document.getElementById('config-whatsapp-soporte').value = c.whatsappSoporte || '';
  document.getElementById('config-form-soporte-embed').value = c.formSoporteEmbed || '';
  document.getElementById('config-contenido-begin').value = c.contenidoHotmartBegin || '';
  document.getElementById('config-contenido-next').value = c.contenidoHotmartNext || '';
  document.getElementById('config-contenido-exit').value = c.contenidoHotmartExit || '';
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
              <strong style="font-size:13px;">${h.titulo}</strong>
              <p class="text-soft" style="font-size:12px; margin:2px 0 0;">${h.descripcion || ''}</p>
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
          <input class="mb-16" id="editar-hito-titulo-${id}" value="${hito.titulo.replace(/"/g, '&quot;')}" placeholder="Título">
          <textarea id="editar-hito-descripcion-${id}" style="min-height:60px;">${hito.descripcion || ''}</textarea>
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
