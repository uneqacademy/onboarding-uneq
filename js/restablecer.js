/* ============================================================
   restablecer.js — página donde la persona elige su contraseña (restablecer.html).
   El enlace del correo trae un código de un solo uso (oobCode, válido 1 hora). Se comprueba con
   Firebase Authentication, se muestra para qué cuenta es y, al guardar, se cambia la contraseña.
   No inicia sesión: después la persona entra normal por su dirección (equipo o alumnos).
   ============================================================ */
import { auth } from './firebase-config.js';
import { verifyPasswordResetCode, confirmPasswordReset } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

const ESTADOS = ['cargando', 'formulario', 'exito', 'error'];
const el = (id) => document.getElementById(id);

function mostrar(estado) {
  ESTADOS.forEach(e => el(`estado-${e}`).classList.toggle('hidden', e !== estado));
}

function mostrarEnlaceInvalido(texto) {
  el('error-detalle').textContent = texto;
  mostrar('error');
}

const codigo = new URLSearchParams(window.location.search).get('oobCode');
// El código ya está guardado en memoria: se quita de la barra de direcciones.
try { history.replaceState(null, '', window.location.pathname); } catch (err) { /* no pasa nada */ }

async function iniciar() {
  if (!codigo) {
    mostrarEnlaceInvalido('El enlace está incompleto. Abre el botón del correo otra vez o pide uno nuevo.');
    return;
  }
  try {
    const email = await verifyPasswordResetCode(auth, codigo);
    el('restablecer-email').textContent = email;
    mostrar('formulario');
    el('clave-nueva').focus();
  } catch (err) {
    mostrarEnlaceInvalido('El enlace venció (dura 1 hora) o ya se usó.');
  }
}

el('clave-mostrar').addEventListener('change', (ev) => {
  const tipo = ev.target.checked ? 'text' : 'password';
  el('clave-nueva').type = tipo;
  el('clave-repetir').type = tipo;
});

async function guardar() {
  const errorEl = el('restablecer-error');
  errorEl.classList.add('hidden');
  const nueva = el('clave-nueva').value;
  const repetir = el('clave-repetir').value;
  let problema = '';
  if (nueva.length < 8) problema = 'La contraseña debe tener al menos 8 caracteres.';
  else if (nueva !== repetir) problema = 'Las dos contraseñas no coinciden.';
  if (problema) { errorEl.textContent = problema; errorEl.classList.remove('hidden'); return; }

  const boton = el('btn-guardar-clave');
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    await confirmPasswordReset(auth, codigo, nueva);
    mostrar('exito');
  } catch (err) {
    if (err.code === 'auth/weak-password') {
      errorEl.textContent = 'Esa contraseña es muy débil. Prueba con una más larga o con números y letras.';
      errorEl.classList.remove('hidden');
    } else if (err.code === 'auth/expired-action-code' || err.code === 'auth/invalid-action-code') {
      mostrarEnlaceInvalido('El enlace venció (dura 1 hora) o ya se usó.');
    } else {
      errorEl.textContent = 'No se pudo guardar la contraseña. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
    }
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar contraseña';
  }
}

el('btn-guardar-clave').addEventListener('click', guardar);
['clave-nueva', 'clave-repetir'].forEach(id => el(id).addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') { ev.preventDefault(); guardar(); }
}));

iniciar();
