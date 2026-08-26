/* ============================================================
   mis-datos.js
   Pestaña compartida "Mis Datos" para Director/Coach/Mentor:
   foto, correo y teléfono de contacto (auto-servicio, editan
   su propio /usuarios/{uid}). El director además puede
   activarse a sí mismo los roles de Coach y/o Mentor.
   ============================================================ */

import { db, auth, storage } from './firebase-config.js';
import { ref, get, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getCurrentRole } from './main.js';

const PLACEHOLDER_FOTO_MIS_DATOS = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#E4E7EC"/><circle cx="40" cy="32" r="14" fill="#9AA4B2"/><ellipse cx="40" cy="70" rx="24" ry="18" fill="#9AA4B2"/></svg>'
);
const NOMBRES_ROL_MIS_DATOS = { director: 'Director/a Académico', coach: 'Coach', mentor: 'Mentor/a' };

export async function cargarMisDatos() {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;
  const snap = await get(ref(db, `usuarios/${uid}`));
  const datos = snap.exists() ? snap.val() : {};

  document.getElementById('mis-datos-foto-preview').src = datos.fotoUrl || PLACEHOLDER_FOTO_MIS_DATOS;
  document.getElementById('mis-datos-nombre').innerHTML = `<strong>${datos.nombre || '—'}</strong>`;
  const rolActivo = getCurrentRole();
  document.getElementById('mis-datos-rol').textContent = NOMBRES_ROL_MIS_DATOS[rolActivo] || rolActivo || '';
  document.getElementById('mis-datos-email').value = datos.email || '';
  document.getElementById('mis-datos-telefono').value = datos.telefono || '';

  const hayContacto = !!(datos.email && datos.telefono);
  const btnEditarMisDatos = document.getElementById('btn-editar-mis-datos');
  const btnGuardarMisDatosEl = document.getElementById('btn-guardar-mis-datos');
  document.getElementById('mis-datos-email').disabled = hayContacto;
  document.getElementById('mis-datos-telefono').disabled = hayContacto;
  if (btnGuardarMisDatosEl) btnGuardarMisDatosEl.classList.toggle('hidden', hayContacto);
  if (btnEditarMisDatos) btnEditarMisDatos.classList.toggle('hidden', !hayContacto);

  const panelRoles = document.getElementById('panel-mis-roles-director');
  if (panelRoles) {
    const roles = (datos.roles && typeof datos.roles === 'object') ? datos.roles : (datos.rol ? { [datos.rol]: true } : {});
    document.getElementById('chk-rol-propio-coach').checked = !!roles.coach;
    document.getElementById('chk-rol-propio-mentor').checked = !!roles.mentor;
  }
}

const btnCambiarFotoMisDatos = document.getElementById('btn-cambiar-foto-mis-datos');
const inputFotoMisDatos = document.getElementById('mis-datos-foto-input');
if (btnCambiarFotoMisDatos && inputFotoMisDatos) {
  btnCambiarFotoMisDatos.addEventListener('click', () => inputFotoMisDatos.click());
  inputFotoMisDatos.addEventListener('change', async () => {
    const file = inputFotoMisDatos.files[0];
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!file || !uid) return;
    btnCambiarFotoMisDatos.disabled = true;
    try {
      const archivoRef = storageRef(storage, `fotos-perfil/${uid}`);
      await uploadBytes(archivoRef, file);
      const url = await getDownloadURL(archivoRef);
      await update(ref(db, `usuarios/${uid}`), { fotoUrl: url });
      document.getElementById('mis-datos-foto-preview').src = url;
    } catch (err) {
      alert('No se pudo subir la foto. Intenta de nuevo.');
    } finally {
      btnCambiarFotoMisDatos.disabled = false;
      inputFotoMisDatos.value = '';
    }
  });
}

const btnGuardarMisDatos = document.getElementById('btn-guardar-mis-datos');
if (btnGuardarMisDatos) {
  btnGuardarMisDatos.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const email = document.getElementById('mis-datos-email').value.trim();
    const telefono = document.getElementById('mis-datos-telefono').value.trim();
    if (!uid || !email || !telefono) { alert('Completa correo y teléfono.'); return; }
    btnGuardarMisDatos.disabled = true;
    try {
      await update(ref(db, `usuarios/${uid}`), { email, telefono });
      await cargarMisDatos();
    } finally {
      btnGuardarMisDatos.disabled = false;
    }
  });
}

const btnEditarMisDatosGlobal = document.getElementById('btn-editar-mis-datos');
if (btnEditarMisDatosGlobal) {
  btnEditarMisDatosGlobal.addEventListener('click', () => {
    document.getElementById('mis-datos-email').disabled = false;
    document.getElementById('mis-datos-telefono').disabled = false;
    document.getElementById('btn-guardar-mis-datos').classList.remove('hidden');
    btnEditarMisDatosGlobal.classList.add('hidden');
  });
}

const btnGuardarRolesPropios = document.getElementById('btn-guardar-roles-propios');
if (btnGuardarRolesPropios) {
  btnGuardarRolesPropios.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid) return;
    btnGuardarRolesPropios.disabled = true;
    try {
      const rolesSnap = await get(ref(db, `usuarios/${uid}/roles`));
      const rolesActuales = rolesSnap.exists() ? rolesSnap.val() : { director: true };
      const nuevosRoles = {
        ...rolesActuales,
        director: true,
        coach: document.getElementById('chk-rol-propio-coach').checked,
        mentor: document.getElementById('chk-rol-propio-mentor').checked
      };
      await update(ref(db, `usuarios/${uid}`), { roles: nuevosRoles, rol: null });
      alert('Roles actualizados — cierra sesión y vuelve a entrar para ver el selector "Viendo como" con los cambios.');
    } finally {
      btnGuardarRolesPropios.disabled = false;
    }
  });
}

document.querySelectorAll('.nav-item[data-nav="mis-datos"]').forEach(item => {
  item.addEventListener('click', cargarMisDatos);
});
