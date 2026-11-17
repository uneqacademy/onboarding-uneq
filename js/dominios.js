/* ============================================================
   dominios.js — dos entradas a la misma app:
   · app.somosuneq.com        → equipo (director, sub-directora, copiloto, mentor, agendamiento)
   · alumnos.somosuneq.com    → alumnos
   · app.uneqacademy.com      → dirección antigua: manda a app.somosuneq.com conservando ruta y enlace
   Cada entrada solo deja pasar a su público; la otra gente recibe un aviso con el enlace correcto.
   ============================================================ */

export const DOMINIO_STAFF = 'app.somosuneq.com';
export const DOMINIO_ALUMNOS = 'alumnos.somosuneq.com';
export const DOMINIO_ANTIGUO = 'app.uneqacademy.com';
export const URL_STAFF = `https://${DOMINIO_STAFF}/`;
export const URL_ALUMNOS = `https://${DOMINIO_ALUMNOS}/`;

// Interruptor de seguridad: mientras app.somosuneq.com y alumnos.somosuneq.com no estén publicados (DNS,
// hosting y dominios autorizados en Firebase Authentication), debe seguir en false para que todos sigan
// entrando por app.uneqacademy.com. Pasarlo a true solo cuando ambos dominios nuevos ya abran la app.
export const SEPARAR_ALUMNOS_ACTIVO = false;

// Entrada de alumnos: el dominio de alumnos o, para probar en otros lugares (localhost, vista previa),
// ?entrada=alumnos en la dirección. En app.uneqacademy.com nunca aplica.
export function esEntradaAlumnos() {
  const host = window.location.hostname;
  if (host === DOMINIO_ALUMNOS) return true;
  if (host === DOMINIO_STAFF || host === DOMINIO_ANTIGUO) return false;
  return new URLSearchParams(window.location.search).get('entrada') === 'alumnos';
}

// Un alumno real entró por la puerta del equipo: hay que mandarlo a la suya (solo con el dominio ya activo).
export function debeIrAlDominioAlumnos() {
  const host = window.location.hostname;
  return SEPARAR_ALUMNOS_ACTIVO && (host === DOMINIO_STAFF || host === DOMINIO_ANTIGUO);
}

// Dirección antigua (app.uneqacademy.com): con el cambio activo, pasa a la del equipo sin perder
// la ruta ni el enlace a un hito (#hito-ID) de los mensajes ya enviados.
export function redirigirDominioAntiguo() {
  if (SEPARAR_ALUMNOS_ACTIVO && window.location.hostname === DOMINIO_ANTIGUO) {
    window.location.replace(URL_STAFF.slice(0, -1) + window.location.pathname + window.location.search + window.location.hash);
    return true;
  }
  return false;
}

const esDominioDelEquipo = () => [DOMINIO_STAFF, DOMINIO_ANTIGUO].includes(window.location.hostname);

// Textos y enlaces de la pantalla de ingreso según la entrada.
export function personalizarLogin() {
  const alumnos = esEntradaAlumnos();
  const poner = (id, texto) => { const el = document.getElementById(id); if (el) el.textContent = texto; };
  poner('login-sub', alumnos ? 'Portal de alumnos' : 'Acceso del equipo UNEQ');
  poner('login-pie', alumnos
    ? 'Ingresa con el correo y la contraseña de tu programa en UNEQ Academy.'
    : 'Acceso del equipo — cuentas creadas por el director/a académico.');
  const email = document.getElementById('login-email');
  if (email) email.placeholder = alumnos ? 'tu@correo.com' : 'nombre@agenciauneq.com';

  const otro = document.getElementById('login-otro-acceso');
  if (otro) {
    if (!SEPARAR_ALUMNOS_ACTIVO && esDominioDelEquipo()) {
      otro.classList.add('hidden');
    } else {
      otro.classList.remove('hidden');
      otro.innerHTML = alumnos
        ? `¿Eres parte del equipo UNEQ? <a href="${URL_STAFF}">Ingresa aquí</a>`
        : `¿Eres alumno? <a href="${URL_ALUMNOS}">Ingresa aquí</a>`;
    }
  }

  // Aviso cuando un alumno llegó desde la puerta del equipo.
  if (alumnos && new URLSearchParams(window.location.search).get('aviso') === 'alumno') {
    const err = document.getElementById('login-error');
    if (err) {
      err.style.color = '#1B2A4A';
      err.textContent = 'Los alumnos ahora ingresan por este enlace. Vuelve a iniciar sesión.';
      err.classList.remove('hidden');
    }
  }
}
