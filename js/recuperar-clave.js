/* ============================================================
   recuperar-clave.js — pide el correo de "crear o cambiar contraseña".
   Antes se usaba la plantilla de Firebase (texto fijo, enlace a firebaseapp.com).
   Ahora llama a la función solicitarRecuperacion (repo de funciones), que envía el correo con el
   diseño de UNEQ y un enlace a restablecer.html en el dominio que corresponde (equipo o alumnos).
   La función responde siempre lo mismo, exista o no la cuenta; por eso los avisos de la app dicen
   "si el correo tiene una cuenta, le llegará…".
   `app` es la app de Firebase de quien llama (la de la app principal o la de agendamiento).
   ============================================================ */
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";

// motivo: 'recuperar' (olvidó su contraseña) | 'acceso' (primer acceso: cambia el texto del correo)
export async function solicitarRecuperacion(app, email, motivo = 'recuperar') {
  const llamar = httpsCallable(getFunctions(app), 'solicitarRecuperacion', { timeout: 30000 });
  await llamar({ email: String(email || '').trim(), motivo });
}
