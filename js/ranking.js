/* ============================================================
   ranking.js — sección "Ranking" (alumnos y director): podio del
   mes con los 3 primeros lugares, el lugar del propio alumno y el
   premio del mes. Los puntos y el podio los escribe la función
   actualizarRankingProgramado; aquí solo se leen.
   ============================================================ */

import { db, auth } from './firebase-config.js';
import { escaparHtml } from './util-html.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole, setNav } from './main.js';
import { programaLabel } from './ciclos.js';
import { tablaPuntos } from './gamificacion-puntos.js';

const ZONA = 'America/Santiago';
const MEDALLAS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const NOMBRES_MEDALLA = { 1: 'Oro', 2: 'Plata', 3: 'Bronce' };
const FOTO_VACIA = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#E4E7EC"/><circle cx="40" cy="31" r="14" fill="#9CA0A8"/><path d="M12 76c3-18 16-26 28-26s25 8 28 26z" fill="#9CA0A8"/></svg>'
);

// "2026-10" del mes en curso (hora de Chile) y su nombre: "Octubre 2026".
function mesActual() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
}
export function nombreDeMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const nombre = new Intl.DateTimeFormat('es-CL', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, 15)));
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${a}`;
}

function tarjetaLugar(p, esYo) {
  const medalla = MEDALLAS[p.lugar] || '';
  return `
    <div class="ranking-item ranking-item--${p.lugar} ${esYo ? 'ranking-item--yo' : ''}">
      <div class="ranking-item__puesto" title="${NOMBRES_MEDALLA[p.lugar] || ''}">
        <span class="ranking-item__numero">${p.lugar}°</span>
        <span class="ranking-item__medalla" aria-label="Medalla de ${NOMBRES_MEDALLA[p.lugar] || ''}">${medalla}</span>
      </div>
      <img class="ranking-item__foto" src="${escaparHtml(p.fotoUrl || FOTO_VACIA)}" alt="">
      <div class="ranking-item__datos">
        <div class="ranking-item__nombre"><strong>${escaparHtml(p.nombre)}</strong></div>
        <span class="text-soft ranking-item__programa">${escaparHtml(programaLabel(p.programa) || 'Sin programa')}${esYo ? ' <span class="badge badge--activo" style="font-size:9px; margin-left:4px;">Tú</span>' : ''}</span>
      </div>
      <div class="ranking-item__puntos"><strong>${p.puntos}</strong><span class="text-soft">pts</span></div>
    </div>`;
}

function tarjetaMiLugar(pos) {
  if (!pos || !pos.puntos) {
    return `<div class="panel ranking-mi-lugar mb-16"><div class="panel__body">
      <p class="ranking-mi-lugar__titulo">Tu lugar</p>
      <p class="text-soft" style="margin:4px 0 0;">Todavía no tienes puntos este mes. Publica, comenta y entra a la app para sumar.</p>
    </div></div>`;
  }
  const falta = pos.faltanParaPodio > 0
    ? `Te faltan <strong>${pos.faltanParaPodio} pts</strong> para entrar al podio.`
    : '¡Estás en el podio!';
  return `<div class="panel ranking-mi-lugar mb-16"><div class="panel__body">
    <p class="ranking-mi-lugar__titulo">Tu lugar</p>
    <div class="ranking-mi-lugar__fila">
      <span class="ranking-mi-lugar__lugar">${pos.lugar}°</span>
      <span>de ${pos.participantes} alumnos<br><strong>${pos.puntos} pts</strong> este mes</span>
    </div>
    <p style="margin:8px 0 0; font-size:13px;">${falta}</p>
  </div></div>`;
}

function htmlPremio(premio) {
  if (!premio || (!premio.texto && !premio.fotoUrl)) return '';
  return `<div class="panel ranking-premio mb-16"><div class="panel__body">
    ${premio.fotoUrl ? `<img class="ranking-premio__foto" src="${escaparHtml(premio.fotoUrl)}" alt="Premio del mes">` : ''}
    <div>
      <p class="ranking-mi-lugar__titulo">🎁 Premio del mes</p>
      <p style="margin:4px 0 0; white-space:pre-wrap;">${escaparHtml(premio.texto || '')}</p>
      <p class="text-soft" style="font-size:12px; margin:6px 0 0;">Se premian los 3 primeros lugares (si hay empate, se premian todos los empatados).</p>
    </div>
  </div></div>`;
}

function htmlComoSumar(tabla) {
  const filas = tabla.filter(a => a.puntos > 0).map(a =>
    `<li>${escaparHtml(a.etiqueta)}: <strong>${a.puntos} pts</strong>${a.tope > 0 && a.clave !== 'entrada' ? ` <span class="text-soft">(hasta ${a.tope} por día)</span>` : ''}</li>`
  ).join('');
  return `<details class="panel ranking-como mb-16"><summary class="panel__body" style="cursor:pointer; font-weight:600;">¿Cómo se suman puntos?</summary>
    <ul class="panel__body" style="margin:0; padding-top:0; padding-left:34px; font-size:13px; line-height:1.7;">${filas}</ul></details>`;
}

export async function cargarRanking() {
  const titulo = document.getElementById('ranking-titulo');
  const cont = document.getElementById('ranking-contenido');
  if (!titulo || !cont) return;
  const mes = mesActual();
  titulo.textContent = `Ranking ${nombreDeMes(mes)}`;
  cont.innerHTML = '<p class="text-soft">Cargando…</p>';

  const uid = auth.currentUser ? auth.currentUser.uid : null;
  try {
    const mapa = uid && getCurrentRole() === 'alumno' ? await get(ref(db, `alumnoPorAuthUid/${uid}`)) : null;
    const alumnoId = mapa && mapa.exists() ? mapa.val() : null;
    const [podioSnap, posSnap, cfgSnap] = await Promise.all([
      get(ref(db, `ranking/podio/${mes}`)),
      alumnoId ? get(ref(db, `ranking/posiciones/${alumnoId}`)) : Promise.resolve(null),
      get(ref(db, 'configuracion/gamificacion'))
    ]);
    const cfg = cfgSnap.exists() ? cfgSnap.val() : {};
    const lugares = podioSnap.exists() ? Object.values(podioSnap.val().lugares || {}) : [];
    const pos = posSnap && posSnap.exists() && posSnap.val().mes === mes ? posSnap.val() : null;
    const estaEnPodio = !!alumnoId && lugares.some(p => p.alumnoId === alumnoId);

    let html = htmlPremio(cfg.premio);
    if (alumnoId && !estaEnPodio) html += tarjetaMiLugar(pos);
    html += lugares.length
      ? `<div class="ranking-lista">${lugares.map(p => tarjetaLugar(p, p.alumnoId === alumnoId)).join('')}</div>`
      : '<div class="panel mb-16"><div class="panel__body"><p class="text-soft" style="margin:0;">Aún nadie tiene puntos este mes. ¡Sé el primero en el podio!</p></div></div>';
    if (alumnoId && estaEnPodio && pos) html += tarjetaMiLugar(pos);
    html += htmlComoSumar(tablaPuntos(cfg.puntos));
    if (podioSnap.exists() && podioSnap.val().actualizadoEn) {
      html += `<p class="text-soft" style="font-size:11.5px;">Se actualiza cada pocos minutos. Última actualización: ${new Date(podioSnap.val().actualizadoEn).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>`;
    }
    cont.innerHTML = html;
  } catch (err) {
    console.error('No se pudo cargar el ranking:', err);
    cont.innerHTML = '<p class="text-soft">No se pudo cargar el ranking. Intenta de nuevo.</p>';
  }
}

// Desde la campanita: abre la sección y la carga.
export function irARanking() {
  setNav('ranking');
  cargarRanking();
}

document.querySelectorAll('.nav-item[data-nav="ranking"]').forEach(item => {
  item.addEventListener('click', cargarRanking);
});
