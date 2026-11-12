/* ============================================================
   seguimiento-video.js — mide cuánto video de una lección ve de verdad
   un alumno, para el ranking (tiempo de video y "concluir" con 70% visto).

   Cómo cuenta (para que dejar el video corriendo no sirva):
   - El video se divide en tramos de 5 segundos. Un tramo cuenta como visto
     cuando se reprodujo de corrido al menos 4 s dentro de él. Volver a ver
     el mismo tramo no suma: el máximo es la duración de la lección.
   - Solo cuenta si el video está avanzando de verdad (saltar o adelantar no
     suma), la pestaña está visible, el sonido no está en silencio y hubo
     actividad (mouse, teclado, toque o scroll) en los últimos 12 minutos.
   - Se guarda en progresoVideo/{alumnoId}/{claseId}; las reglas de la base
     de datos y la función del ranking vuelven a limitar lo que sea creíble
     (nunca más segundos que el tiempo real transcurrido, ni más que la
     duración). El staff y el Alumno Demo solo ven el porcentaje, sin guardar.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { alumnoRealActual } from './puntos-marcas.js';

const TRAMO = 5;                       // segundos por tramo
const MIN_EN_TRAMO = 4;                // segundos reproducidos dentro de un tramo para darlo por visto
const INACTIVIDAD_MS = 12 * 60 * 1000;
const GUARDAR_CADA_MS = 30 * 1000;
const EVENTOS_ACTIVIDAD = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll', 'wheel'];
const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Empieza a medir. Devuelve una función para detener (y guardar lo pendiente), o null si no se pudo.
 * @param player      elemento <vturb-smartplayer>
 * @param claseId     id de la lección
 * @param duracionSeg duración conocida de la lección (segundos), o 0 si no se sabe
 * @param alCambiar   se llama con { porcentaje (0-100), vistoSeg, duracionSeg, guardando } cuando cambia
 */
export async function iniciarSeguimiento(player, claseId, duracionSeg, alCambiar) {
  if (!player || !claseId) return null;
  const alumnoId = await alumnoRealActual();   // null para staff y Alumno Demo: solo se muestra el avance
  const guardando = !!alumnoId;
  const base = guardando ? `progresoVideo/${alumnoId}/${claseId}` : null;

  let vistos = [];     // '0' / '1' por tramo
  let seg = 0;
  let inicio = null;
  let duracionPlayer = 0;
  const diasHoy = {};  // segundos nuevos de hoy aún no guardados + lo ya guardado
  const hoy = () => FORMATO_DIA.format(new Date());

  if (guardando) {
    try {
      const snap = await get(ref(db, base));
      if (snap.exists()) {
        const d = snap.val();
        vistos = typeof d.vistos === 'string' ? d.vistos.split('') : [];
        seg = Number(d.seg) || 0;
        inicio = Number(d.inicio) || null;
        const dia = hoy();
        if (d.dias && typeof d.dias[dia] === 'number') diasHoy[dia] = d.dias[dia];
      }
    } catch (err) { console.warn('No se pudo leer el avance del video:', err); }
  }

  const duracionTotal = () => duracionSeg || duracionPlayer || 0;
  const informar = () => {
    if (typeof alCambiar !== 'function') return;
    const dur = duracionTotal();
    const visto = Math.min(vistos.filter(v => v === '1').length * TRAMO, dur || Infinity);
    alCambiar({ porcentaje: dur > 0 ? Math.min(100, Math.round(visto * 100 / dur)) : 0, vistoSeg: visto, duracionSeg: dur, guardando });
  };

  const enMemoria = {};      // segundos reproducidos por tramo en esta sesión
  let ultimoTiempo = null;   // posición del video en el tick anterior
  let ultimaActividad = Date.now();
  let sucio = false;
  let detenido = false;

  const actividad = () => { ultimaActividad = Date.now(); };
  EVENTOS_ACTIVIDAD.forEach(e => window.addEventListener(e, actividad, { passive: true, capture: true }));

  const guardar = async () => {
    if (!guardando || !sucio) return;
    sucio = false;
    const dia = hoy();
    const cambios = { vistos: vistos.join(''), seg, inicio: inicio || Date.now() };
    inicio = cambios.inicio;
    if (duracionPlayer > 0 && duracionPlayer <= 86400) cambios.duracion = Math.round(duracionPlayer);
    if (diasHoy[dia]) cambios[`dias/${dia}`] = diasHoy[dia];
    try { await update(ref(db, base), cambios); } catch (err) { sucio = true; console.warn('No se pudo guardar el avance del video:', err); }
  };

  const tick = () => {
    if (detenido) return;
    const dur = Number(player.duration) || 0;
    if (dur > 0 && Math.abs(dur - duracionPlayer) > 0.5) { duracionPlayer = dur; informar(); }
    const t = Number(player.currentTime) || 0;
    const sonando = Number(player.volume) > 0;
    const jugando = !player.paused && sonando && document.visibilityState === 'visible' && (Date.now() - ultimaActividad) < INACTIVIDAD_MS;
    if (jugando && ultimoTiempo !== null) {
      const dv = t - ultimoTiempo;
      // dv > 3 s en un tick es un salto o adelanto: no cuenta.
      if (dv > 0 && dv <= 3) {
        const tramo = Math.floor(t / TRAMO);
        enMemoria[tramo] = (enMemoria[tramo] || 0) + dv;
        if (enMemoria[tramo] >= MIN_EN_TRAMO && vistos[tramo] !== '1') {
          while (vistos.length <= tramo) vistos.push('0');
          vistos[tramo] = '1';
          seg += TRAMO;
          const dia = hoy();
          diasHoy[dia] = (diasHoy[dia] || 0) + TRAMO;
          if (!inicio) inicio = Date.now();
          sucio = true;
          informar();
        }
      }
    }
    ultimoTiempo = jugando ? t : null;
  };

  const intervaloTick = setInterval(tick, 1000);
  const intervaloGuardar = setInterval(guardar, GUARDAR_CADA_MS);
  const alOcultar = () => { if (document.visibilityState === 'hidden') guardar(); };
  document.addEventListener('visibilitychange', alOcultar);
  window.addEventListener('pagehide', guardar);
  informar();

  return function detener() {
    if (detenido) return;
    detenido = true;
    clearInterval(intervaloTick);
    clearInterval(intervaloGuardar);
    document.removeEventListener('visibilitychange', alOcultar);
    window.removeEventListener('pagehide', guardar);
    EVENTOS_ACTIVIDAD.forEach(e => window.removeEventListener(e, actividad, { capture: true }));
    guardar();
  };
}
