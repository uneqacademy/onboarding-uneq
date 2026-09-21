/* ============================================================
   staff-auth.js — login compartido para director-comercial.html y
   closer.html. Usa el mismo Firebase Auth del resto del proyecto,
   pero el rol se guarda en agendamiento/staff/{uid} (no en
   usuarios/{uid} de la app principal) para no mezclar sistemas.
   ============================================================ */

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

export function iniciarSesionStaff(rolEsperado, onListo) {
  const overlay = document.getElementById('login-overlay');
  const shell = document.getElementById('adm-shell');
  const errorEl = document.getElementById('login-error');
  const btnLogin = document.getElementById('btn-login');

  async function intentarLogin() {
    const correo = document.getElementById('login-correo').value.trim();
    const password = document.getElementById('login-password').value;
    errorEl.classList.add('hidden');
    btnLogin.disabled = true; btnLogin.textContent = 'Ingresando…';
    try {
      await signInWithEmailAndPassword(auth, correo, password);
      // onAuthStateChanged abajo se encarga del resto
    } catch (err) {
      errorEl.textContent = 'Correo o contraseña incorrectos.';
      errorEl.classList.remove('hidden');
      btnLogin.disabled = false; btnLogin.textContent = 'Iniciar sesión';
    }
  }
  btnLogin.addEventListener('click', intentarLogin);
  document.getElementById('login-password').addEventListener('keypress', (ev) => { if (ev.key === 'Enter') intentarLogin(); });

  onAuthStateChanged(auth, async (usuario) => {
    if (!usuario) { overlay.classList.remove('hidden'); shell.classList.add('hidden'); return; }
    const snap = await get(ref(db, `agendamiento/staff/${usuario.uid}`));
    const datos = snap.exists() ? snap.val() : null;
    if (!datos || datos.rol !== rolEsperado || datos.activo === false) {
      errorEl.textContent = 'Esta cuenta no tiene acceso a esta sección.';
      errorEl.classList.remove('hidden');
      await signOut(auth);
      btnLogin.disabled = false; btnLogin.textContent = 'Iniciar sesión';
      return;
    }
    overlay.classList.add('hidden');
    shell.classList.remove('hidden');
    const nombreEl = document.querySelector('.adm-sidebar-footer strong');
    if (nombreEl) nombreEl.textContent = datos.nombre;
    onListo(usuario.uid, datos);
  });
}
