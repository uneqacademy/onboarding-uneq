/* ============================================================
   auth.js
   Login/logout real con Firebase Auth. Lee el rol del usuario
   (director|coach) desde /usuarios/{uid} y llama a applyRole()
   de main.js para mostrar el app-shell correcto. Si no hay
   sesión, o el perfil no es válido, vuelve al login.
   ============================================================ */

import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { applyRole, showLogin } from './main.js';
import { initAlumnosModule } from './alumnos.js';

const inputEmail = document.getElementById('login-email');
const inputPass = document.getElementById('login-pass');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const loginError = document.getElementById('login-error');

function mostrarError(mensaje) {
  loginError.textContent = mensaje;
  loginError.classList.remove('hidden');
}

function limpiarError() {
  loginError.classList.add('hidden');
  loginError.textContent = '';
}

btnLogin.addEventListener('click', async () => {
  limpiarError();
  const email = inputEmail.value.trim();
  const pass = inputPass.value;

  if (!email || !pass) {
    mostrarError('Ingresa correo y contraseña.');
    return;
  }

  btnLogin.disabled = true;
  btnLogin.textContent = 'Ingresando...';

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged se encarga de cargar el perfil y mostrar el app-shell
  } catch (err) {
    mostrarError(
      ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(err.code)
        ? 'Correo o contraseña incorrectos.'
        : 'No se pudo iniciar sesión. Intenta de nuevo.'
    );
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = 'Ingresar';
  }
});

btnLogout.addEventListener('click', () => {
  signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showLogin();
    return;
  }

  try {
    const snap = await get(ref(db, `usuarios/${user.uid}`));

    if (!snap.exists()) {
      mostrarError('Esta cuenta no tiene un perfil asignado. Contacta al director/a.');
      await signOut(auth);
      return;
    }

    const perfil = snap.val();

    if (perfil.activo === false) {
      mostrarError('Esta cuenta está desactivada. Contacta al director/a.');
      await signOut(auth);
      return;
    }

    if (!['director', 'coach', 'mentor'].includes(perfil.rol)) {
      mostrarError('Esta cuenta no tiene un rol válido asignado.');
      await signOut(auth);
      return;
    }

    limpiarError();
    inputEmail.value = '';
    inputPass.value = '';
    applyRole(perfil.rol, perfil.nombre || user.email);
    await initAlumnosModule();
  } catch (err) {
    mostrarError('Error al cargar tu perfil. Intenta de nuevo.');
    await signOut(auth);
  }
});
