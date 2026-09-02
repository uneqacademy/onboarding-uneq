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

import { db } from './firebase-config.js';
import { ref, get, set, push, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole } from './main.js';

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

  await cargarHitosDefinidos();
}

const btnGuardarConfiguracion = document.getElementById('btn-guardar-configuracion');
if (btnGuardarConfiguracion) {
  btnGuardarConfiguracion.addEventListener('click', async () => {
    const errorEl = document.getElementById('configuracion-error');
    errorEl.classList.add('hidden');
    btnGuardarConfiguracion.disabled = true;
    try {
      await set(ref(db, 'configuracion/general'), {
        comunidadHotmartUrl: document.getElementById('config-comunidad-hotmart').value.trim(),
        metodologiaBase: document.getElementById('config-metodologia-base').value,
        correoSoporte: document.getElementById('config-correo-soporte').value.trim(),
        whatsappSoporte: document.getElementById('config-whatsapp-soporte').value.trim(),
        formSoporteEmbed: document.getElementById('config-form-soporte-embed').value,
        contenidoHotmartBegin: document.getElementById('config-contenido-begin').value.trim(),
        contenidoHotmartNext: document.getElementById('config-contenido-next').value.trim(),
        contenidoHotmartExit: document.getElementById('config-contenido-exit').value.trim(),
        whatsappBegin: document.getElementById('config-whatsapp-begin').value.trim(),
        whatsappNextExit: document.getElementById('config-whatsapp-nextexit').value.trim()
      });
      alert('Configuración guardada.');
    } catch (err) {
      errorEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
    } finally {
      btnGuardarConfiguracion.disabled = false;
    }
  });
}

document.querySelectorAll('.nav-item[data-nav="configuracion"]').forEach(item => {
  item.addEventListener('click', cargarConfiguracion);
});
