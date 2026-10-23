/* ============================================================
   puntos-marcas.js — anota en la base lo que el servidor no puede ver
   por sí solo para el ranking: entrar a la app (una vez al día) y
   compartir una publicación por WhatsApp (una vez por publicación).
   Solo anota una fecha: los puntos los calcula la función del ranking
   con la tabla del director. Si algo falla no se avisa al alumno.
   El staff (también el director en "Ver como Alumno") no suma puntos.
   ============================================================ */

import { db, auth } from './firebase-config.js';
import { ref, get, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });

let alumnoIdMarcas = undefined; // undefined = sin averiguar; null = no es un alumno real

async function alumnoRealActual() {
  if (alumnoIdMarcas !== undefined) return alumnoIdMarcas;
  alumnoIdMarcas = null;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return null;
  try {
    const [mapa, staff] = await Promise.all([get(ref(db, `alumnoPorAuthUid/${uid}`)), get(ref(db, `usuarios/${uid}`))]);
    if (mapa.exists() && !staff.exists()) alumnoIdMarcas = mapa.val();
  } catch (err) { console.warn('Ranking: no se pudo identificar al alumno', err); }
  return alumnoIdMarcas;
}

function recordado(clave) { try { return localStorage.getItem(clave) === '1'; } catch (e) { return false; } }
function recordar(clave) { try { localStorage.setItem(clave, '1'); } catch (e) { /* sin almacenamiento: se reintenta y la regla evita duplicados */ } }

export async function marcarEntradaDelDia() {
  const alumnoId = await alumnoRealActual();
  if (!alumnoId) return;
  const dia = FORMATO_DIA.format(new Date());
  const clave = `uneq.ranking.entrada.${alumnoId}.${dia}`;
  if (recordado(clave)) return;
  try { await set(ref(db, `puntosMarcas/${alumnoId}/entradas/${dia}`), Date.now()); } catch (err) { /* ya estaba anotada */ }
  recordar(clave);
}

// "clave" identifica la publicación (por ejemplo "hito_ID"). Solo el primer compartir de cada una cuenta.
export async function marcarCompartido(clave) {
  const alumnoId = await alumnoRealActual();
  if (!alumnoId || !clave) return;
  const id = String(clave).replace(/[.#$\[\]\/]/g, '_').slice(0, 150);
  const recuerdo = `uneq.ranking.compartido.${alumnoId}.${id}`;
  if (recordado(recuerdo)) return;
  try { await set(ref(db, `puntosMarcas/${alumnoId}/compartidos/${id}`), Date.now()); } catch (err) { /* ya estaba anotada */ }
  recordar(recuerdo);
}

// Al cerrar sesión se olvida el alumno, por si entra otra persona en el mismo navegador.
auth.onAuthStateChanged(() => { alumnoIdMarcas = undefined; });
