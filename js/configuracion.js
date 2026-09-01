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
import { ref, get, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole } from './main.js';

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
