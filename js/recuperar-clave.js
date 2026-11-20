/* ============================================================
   recuperar-clave.js — pide el correo de "crear o cambiar contraseña".
   Antes se usaba la plantilla de Firebase (texto fijo, enlace a firebaseapp.com).
   Ahora se deja una solicitud en recuperacionSolicitudes/{id} (la regla solo deja crearla, nunca leerla)
   y la función procesarSolicitudRecuperacion (repo de funciones) envía el correo con el diseño de UNEQ
   y un enlace a restablecer.html en el dominio que corresponde (equipo o alumnos), y borra la solicitud.
   No se usa una función HTTP porque la política de la organización de Google no deja crear públicas nuevas.
   Como no hay respuesta (y para no revelar qué correos tienen cuenta), los avisos de la app dicen
   "si el correo tiene una cuenta, le llegará…".
   `app` es la app de Firebase de quien llama (la de la app principal o la de agendamiento).
   ============================================================ */
import { getDatabase, ref, push } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

// motivo: 'recuperar' (olvidó su contraseña) | 'acceso' (primer acceso: cambia el texto del correo)
export async function solicitarRecuperacion(app, email, motivo = 'recuperar') {
  const correo = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('correo-invalido');
  await push(ref(getDatabase(app), 'recuperacionSolicitudes'), { email: correo, motivo });
}
