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
  onAuthStateChanged,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { applyRole, showLogin } from './main.js';
import { initAlumnosModule } from './alumnos.js';
import { cargarDashboardAlumno, cargarBoxAlumno } from './alumno-portal.js';

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

const linkOlvidePassword = document.getElementById('link-olvide-password');
if (linkOlvidePassword) {
  linkOlvidePassword.addEventListener('click', async (ev) => {
    ev.preventDefault();
    limpiarError();
    const email = inputEmail.value.trim();
    if (!email) {
      mostrarError('Escribe tu correo arriba y luego haz clic en "¿Olvidaste tu contraseña?".');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      alert(`Te mandamos un correo a ${email} con un link para elegir una nueva contraseña.`);
    } catch (err) {
      mostrarError('No se pudo enviar el correo. Verifica que esté bien escrito.');
    }
  });
}

/* --- Cambiar contraseña dentro de la sesión (los 3 roles) --- */
const btnCambiarPassword = document.getElementById('btn-cambiar-password');
const panelCambiarPassword = document.getElementById('panel-cambiar-password');
if (btnCambiarPassword && panelCambiarPassword) {
  btnCambiarPassword.addEventListener('click', () => panelCambiarPassword.classList.toggle('hidden'));
}

const btnCerrarCambiarPassword = document.getElementById('btn-cerrar-cambiar-password');
if (btnCerrarCambiarPassword) {
  btnCerrarCambiarPassword.addEventListener('click', () => panelCambiarPassword.classList.add('hidden'));
}

const btnGuardarPassword = document.getElementById('btn-guardar-password');
if (btnGuardarPassword) {
  btnGuardarPassword.addEventListener('click', async () => {
    const errorEl = document.getElementById('cambiar-password-error');
    errorEl.classList.add('hidden');
    const actual = document.getElementById('password-actual').value;
    const nueva = document.getElementById('password-nueva').value;
    const confirmar = document.getElementById('password-confirmar').value;

    if (!actual || !nueva || !confirmar) {
      errorEl.textContent = 'Completa los 3 campos.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (nueva !== confirmar) {
      errorEl.textContent = 'La nueva contraseña no coincide con la confirmación.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (nueva.length < 6) {
      errorEl.textContent = 'La nueva contraseña debe tener al menos 6 caracteres.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnGuardarPassword.disabled = true;
    try {
      const user = auth.currentUser;
      const credencial = EmailAuthProvider.credential(user.email, actual);
      await reauthenticateWithCredential(user, credencial);
      await updatePassword(user, nueva);

      document.getElementById('password-actual').value = '';
      document.getElementById('password-nueva').value = '';
      document.getElementById('password-confirmar').value = '';
      panelCambiarPassword.classList.add('hidden');
      alert('Contraseña actualizada correctamente.');
    } catch (err) {
      errorEl.textContent = (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
        ? 'La contraseña actual no es correcta.'
        : 'No se pudo cambiar la contraseña. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
    } finally {
      btnGuardarPassword.disabled = false;
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showLogin();
    return;
  }

  try {
    const snap = await get(ref(db, `usuarios/${user.uid}`));

    if (!snap.exists()) {
      const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${user.uid}`));
      if (mapaSnap.exists()) {
        const alumnoId = mapaSnap.val();
        const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
        if (!alumnoSnap.exists()) {
          mostrarError('No se encontró tu ficha. Contacta a tu coach.');
          await signOut(auth);
          return;
        }
        const datosAlumno = alumnoSnap.val();
        limpiarError();
        inputEmail.value = '';
        inputPass.value = '';
        applyRole('alumno', `${datosAlumno.nombre || ''} ${datosAlumno.apellido || ''}`.trim() || user.email, ['alumno']);
        await cargarDashboardAlumno(alumnoId);
        await cargarBoxAlumno();
        return;
      }

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

    const roles = (perfil.roles && typeof perfil.roles === 'object')
      ? Object.keys(perfil.roles).filter(r => perfil.roles[r])
      : (perfil.rol ? [perfil.rol] : []);

    if (!roles.length || !roles.every(r => ['director', 'coach', 'mentor'].includes(r))) {
      mostrarError('Esta cuenta no tiene un rol válido asignado.');
      await signOut(auth);
      return;
    }

    limpiarError();
    inputEmail.value = '';
    inputPass.value = '';
    const rolActivo = roles.includes('director') ? 'director' : roles.includes('coach') ? 'coach' : 'mentor';
    applyRole(rolActivo, perfil.nombre || user.email, roles);
    await initAlumnosModule();
  } catch (err) {
    mostrarError('Error al cargar tu perfil. Intenta de nuevo.');
    await signOut(auth);
  }
});
