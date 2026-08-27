/* ============================================================
   configuracion.js
   Configuración global de la agencia (solo Director): link de
   Comunidad Hotmart (único), contenido Hotmart por programa,
   grupos de WhatsApp (Begin / Next+eXIT combinado) y correo de
   soporte. El resto de la app (portal del alumno) lee estos
   valores desde /configuracion/general.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, set, push, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole } from './main.js';

/* --- Lista inicial de temáticas del BOX BEGIN — se siembra una sola
       vez, solo si el nodo todavía no existe (no pisa nada si el
       director ya agregó/quitó algo). "Otra" siempre queda al final
       y el alumno puede escribir libre cuando la elige. --- */
const TEMATICAS_BOX_BEGIN_INICIALES = [
  'Mentalidad', 'Estrategia', 'Energía', 'Saboteadores Internos', 'Bloqueos de Venta',
  'Cliente Soñado', 'PUV', 'Copywriting', 'Producto', 'Escalera de Valor',
  'Anuncios (ADS)', 'Diseño', 'Identidad Visual', 'WEB', 'Plataformas Herramientas y Software',
  'Automatizaciones', 'SDV y relacionados', 'Venta', 'Otra'
];

async function cargarTematicasBoxBegin() {
  const listadoEl = document.getElementById('listado-tematicas-begin');
  if (!listadoEl) return;

  let snap = await get(ref(db, 'configuracion/tematicasBoxBegin'));
  if (!snap.exists()) {
    const seed = {};
    TEMATICAS_BOX_BEGIN_INICIALES.forEach(texto => { seed[push(ref(db, 'configuracion/tematicasBoxBegin')).key] = texto; });
    await set(ref(db, 'configuracion/tematicasBoxBegin'), seed);
    snap = await get(ref(db, 'configuracion/tematicasBoxBegin'));
  }

  const tematicas = snap.exists() ? snap.val() : {};
  listadoEl.innerHTML = Object.entries(tematicas)
    .map(([id, texto]) => `
      <div class="flex-between" data-tematica-id="${id}" style="padding:8px 0; border-bottom:0.5px solid var(--border);">
        <span style="font-size:13px;">${texto}</span>
        <button type="button" class="btn btn--ghost btn-eliminar-tematica-begin" style="font-size:11px; padding:3px 8px; color:#C0392B;">Eliminar</button>
      </div>`).join('') || '<p class="text-soft" style="font-size:13px;">Sin temáticas todavía.</p>';

  listadoEl.querySelectorAll('.btn-eliminar-tematica-begin').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fila = btn.closest('[data-tematica-id]');
      const id = fila.dataset.tematicaId;
      const texto = fila.querySelector('span').textContent;
      if (!confirm(`¿Eliminar la temática "${texto}"? Ya no aparecerá como opción para los alumnos.`)) return;
      btn.disabled = true;
      try {
        await remove(ref(db, `configuracion/tematicasBoxBegin/${id}`));
        await cargarTematicasBoxBegin();
      } catch (err) {
        alert('No se pudo eliminar. Intenta de nuevo.');
        btn.disabled = false;
      }
    });
  });
}

const btnAgregarTematicaBegin = document.getElementById('btn-agregar-tematica-begin');
if (btnAgregarTematicaBegin) {
  btnAgregarTematicaBegin.addEventListener('click', async () => {
    const input = document.getElementById('config-nueva-tematica-begin');
    const texto = input.value.trim();
    if (!texto) return;
    btnAgregarTematicaBegin.disabled = true;
    try {
      await set(push(ref(db, 'configuracion/tematicasBoxBegin')), texto);
      input.value = '';
      await cargarTematicasBoxBegin();
    } catch (err) {
      alert('No se pudo agregar. Intenta de nuevo.');
    } finally {
      btnAgregarTematicaBegin.disabled = false;
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

  await cargarTematicasBoxBegin();
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
