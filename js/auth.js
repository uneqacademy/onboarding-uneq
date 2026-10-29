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
import { ref, get, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { applyRole, showLogin, restaurarSeccionGuardada, RUTAS_AGENDAMIENTO } from './main.js';

// Un enlace a un hito (WhatsApp) manda sobre la sección recordada.
async function abrirDestinoInicial() {
  if (!(await abrirHitoDeEnlace())) restaurarSeccionGuardada();
}
import { initAlumnosModule } from './alumnos.js';
import { cargarDashboardAlumno, cargarBoxAlumno } from './alumno-portal.js';
import { abrirHitoDeEnlace } from './comunidad-uneq.js';
import './pre-onboarding.js';
import { iniciarNotificaciones } from './notificaciones.js';
import './ranking.js';
import './pagos-consolidado.js';
import { marcarEntradaDelDia } from './puntos-marcas.js';

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

// Enter en cualquiera de los 2 campos dispara el mismo botón (funciona con
// mouse/touch Y teclado — PC y celular con teclado en pantalla).
[inputEmail, inputPass].forEach(input => {
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      btnLogin.click();
    }
  });
});

btnLogout.addEventListener('click', async () => {
  // Resguardo: si esta cuenta es de staff (director/coach/mentor) pero
  // por cualquier motivo quedó con un mapeo de alumno pegado (ej. modo
  // demo cerrado sin usar "Salir Modo Demo"), se limpia ANTES de cerrar
  // sesión — así nunca queda una cuenta de staff bloqueada la próxima
  // vez que entre.
  try {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (uid) {
      const [esStaffSnap, mapeoSnap] = await Promise.all([
        get(ref(db, `usuarios/${uid}`)),
        get(ref(db, `alumnoPorAuthUid/${uid}`))
      ]);
      if (esStaffSnap.exists() && mapeoSnap.exists()) {
        await set(ref(db, `alumnoPorAuthUid/${uid}`), null);
      }
    }
  } catch (err) {
    console.error('No se pudo limpiar el mapeo de alumno al cerrar sesión:', err);
  }
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

/* --- Cambiar contraseña dentro de la sesión (los 4 roles) ---
       Vive en 2 lugares con IDs distintos: "Mis Datos" (director/
       coach/mentor) y "Mi Ficha Alumno" (alumno) — misma lógica. */
function configurarCambiarPassword(sufijo) {
  const btnGuardarPassword = document.getElementById(`btn-guardar-password${sufijo}`);
  if (!btnGuardarPassword) return;

  btnGuardarPassword.addEventListener('click', async () => {
    const errorEl = document.getElementById(`cambiar-password-error${sufijo}`);
    errorEl.classList.add('hidden');
    const actual = document.getElementById(`password-actual${sufijo}`).value;
    const nueva = document.getElementById(`password-nueva${sufijo}`).value;
    const confirmar = document.getElementById(`password-confirmar${sufijo}`).value;

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

      document.getElementById(`password-actual${sufijo}`).value = '';
      document.getElementById(`password-nueva${sufijo}`).value = '';
      document.getElementById(`password-confirmar${sufijo}`).value = '';
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

configurarCambiarPassword('');
configurarCambiarPassword('-alumno');

const ROLES_APP = ['director', 'coach', 'mentor'];
const ROLES_AGENDAMIENTO = Object.keys(RUTAS_AGENDAMIENTO);
// Orden en que se elige la vista inicial cuando la cuenta tiene varios roles.
const PRIORIDAD_ROLES = ['director', 'coach', 'mentor', 'directorComercial', 'closer'];

// Closer y Director Comercial viven en agendamiento/staff/{uid}; si no hay
// registro, está inactivo o falla la lectura, la cuenta simplemente no los tiene.
async function leerRolAgendamiento(uid) {
  try {
    const snap = await get(ref(db, `agendamiento/staff/${uid}`));
    const datos = snap.exists() ? snap.val() : null;
    return (datos && datos.activo !== false && ROLES_AGENDAMIENTO.includes(datos.rol)) ? datos : null;
  } catch (err) {
    console.error('No se pudo leer el rol de agendamiento:', err);
    return null;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showLogin();
    return;
  }

  try {
    const [snap, staff] = await Promise.all([
      get(ref(db, `usuarios/${user.uid}`)),
      leerRolAgendamiento(user.uid)
    ]);

    if (!snap.exists() && !staff) {
      const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${user.uid}`));
      if (mapaSnap.exists()) {
        const alumnoId = mapaSnap.val();
        const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
        if (!alumnoSnap.exists()) {
          mostrarError('No se encontró tu ficha. Contacta a tu copiloto.');
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
        iniciarNotificaciones();
        marcarEntradaDelDia();
        await abrirDestinoInicial();
        return;
      }

      mostrarError('Esta cuenta no tiene un perfil asignado. Contacta al director/a.');
      await signOut(auth);
      return;
    }

    const perfil = snap.exists() ? snap.val() : null;

    if (perfil && perfil.activo === false) {
      mostrarError('Esta cuenta está desactivada. Contacta al director/a.');
      await signOut(auth);
      return;
    }

    const rolesApp = !perfil ? [] : (perfil.roles && typeof perfil.roles === 'object')
      ? Object.keys(perfil.roles).filter(r => perfil.roles[r])
      : (perfil.rol ? [perfil.rol] : []);

    if (!rolesApp.every(r => ROLES_APP.includes(r)) || (perfil && !rolesApp.length && !staff)) {
      mostrarError('Esta cuenta no tiene un rol válido asignado.');
      await signOut(auth);
      return;
    }

    const roles = [...rolesApp, ...(staff ? [staff.rol] : [])];
    const rolActivo = PRIORIDAD_ROLES.find(r => roles.includes(r));
    const nombre = (perfil && perfil.nombre) || (staff && staff.nombre) || user.email;

    // Cuenta cuya vista inicial es de agendamiento: esa vista vive en agendamiento/
    // (la sesión de Firebase es la misma, no vuelve a pedir contraseña).
    if (RUTAS_AGENDAMIENTO[rolActivo]) {
      limpiarError();
      inputEmail.value = '';
      inputPass.value = '';
      window.location.href = RUTAS_AGENDAMIENTO[rolActivo];
      return;
    }

    // Segunda capa de resguardo: si esta cuenta de staff quedó con un
    // mapeo de alumno pegado de alguna sesión anterior (ej. el
    // navegador se cerró de golpe estando en modo demo, sin pasar por
    // "Cerrar sesión"), se limpia acá también, al iniciar sesión.
    try {
      const mapeoResidualSnap = await get(ref(db, `alumnoPorAuthUid/${user.uid}`));
      if (mapeoResidualSnap.exists()) {
        await set(ref(db, `alumnoPorAuthUid/${user.uid}`), null);
      }
    } catch (err) {
      console.error('No se pudo limpiar un mapeo de alumno residual:', err);
    }

    limpiarError();
    inputEmail.value = '';
    inputPass.value = '';
    applyRole(rolActivo, nombre, roles);
    await initAlumnosModule();
    await abrirDestinoInicial();
  } catch (err) {
    mostrarError('Error al cargar tu perfil. Intenta de nuevo.');
    await signOut(auth);
  }
});
