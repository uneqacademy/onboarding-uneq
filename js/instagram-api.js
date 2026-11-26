/* ============================================================
   instagram-api.js — pedidos a la conexión de Instagram
   ============================================================
   Cada pedido se deja en instagramSolicitudes/{uid}/{id} = { accion, datos } y la función instagramProcesar (servidor) lo
   atiende y escribe la respuesta ahí. El acceso a Instagram (token) NUNCA llega al navegador. Acciones: conectar,
   estado, desconectar, publicarPrueba. */

import { auth, db } from './firebase-config.js';
import { ref, push, set, onValue, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

// Datos públicos de la app de Meta (no son secretos): id de la app y de la configuración de inicio de sesión.
export const META_APP_ID = '1681371620005466';
export const META_CONFIG_ID = '1904742287562013';
export const IG_CLAVE_ESTADO = 'uneq-ig-estado';
// Solo estos dominios están registrados en la app de Meta como dirección de retorno.
const HOSTS_RETORNO = ['alumnos.somosuneq.com', 'app.somosuneq.com'];

export function direccionDeRetorno() {
  if (!HOSTS_RETORNO.includes(location.hostname)) return null;
  return `${location.origin}/instagram-conectado.html`;
}

export function llamarInstagram(accion, datos) {
  const u = auth.currentUser;
  if (!u) return Promise.reject(new Error('Tu sesión se cerró. Vuelve a entrar.'));
  const nodo = push(ref(db, `instagramSolicitudes/${u.uid}`));
  const ruta = `instagramSolicitudes/${u.uid}/${nodo.key}`;
  return new Promise((resolve, reject) => {
    let cerrado = false, dejarDeEscuchar = () => {};
    const cierre = setTimeout(() => fin(new Error('Instagram tardó demasiado en responder. Intenta de nuevo.')), 100000);
    function fin(err, datosRespuesta) {
      if (cerrado) return;
      cerrado = true; clearTimeout(cierre); dejarDeEscuchar();
      remove(ref(db, ruta)).catch(() => {});
      if (err) reject(err); else resolve(datosRespuesta);
    }
    set(nodo, { accion, datos: datos || {}, creada: Date.now() }).then(() => {
      dejarDeEscuchar = onValue(ref(db, `${ruta}/respuesta`), snap => {
        const r = snap.val();
        if (!r) return;
        if (r.ok) fin(null, r.datos || {}); else fin(new Error(r.mensaje || 'Instagram no pudo completar la acción.'));
      });
      if (cerrado) dejarDeEscuchar();
    }).catch(err => fin(err));
  });
}

/* Dirección del inicio de sesión de Meta. Lleva un "state" aleatorio que se guarda en esta pestaña: al volver se
   comprueba que sea el mismo (así nadie puede conectar otra cuenta de Instagram a tu perfil sin que tú lo pidas). */
export function urlInicioSesion() {
  const retorno = direccionDeRetorno();
  if (!retorno) return null;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const state = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(IG_CLAVE_ESTADO, state);
  const p = new URLSearchParams({ client_id: META_APP_ID, config_id: META_CONFIG_ID, redirect_uri: retorno, response_type: 'code', state });
  return `https://www.facebook.com/dialog/oauth?${p.toString()}`;
}
