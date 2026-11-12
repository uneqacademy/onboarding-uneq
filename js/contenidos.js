/* ============================================================
   contenidos.js — sección "Contenidos" (clases del programa).
   Estructura: Programa > Módulos > Clases, en /contenidos/{programa}/{moduloId}
   (cada módulo lleva sus clases dentro). Los videos son de Vturb: el director
   pega el código de inserción (JS) y aquí se extrae el reproductor.
   - Alumno: ve solo el programa de su ciclo; un módulo se desbloquea según su
     fase (módulo.desdeFase); marca clases como vistas en /progresoClases/{alumnoId}.
   - Director: ve y administra los 4 programas (crear, editar, ordenar, borrar,
     publicar y adjuntar PDF) en la misma pantalla.
   El candado por fase es de pantalla: el video en sí lo protege Vturb (dominios
   permitidos en su panel).
   ============================================================ */

import { db, auth, storage } from './firebase-config.js';
import { escaparHtml } from './util-html.js';
import { ref, get, set, push, update, remove, onValue, query, limitToLast } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getCurrentRole, getCurrentUserNombre, esModoDemo } from './main.js';
import { marcaDemo, ocultarParaAlumno } from './demo.js';
import { marcarClaseConcluida, marcarValoracion } from './puntos-marcas.js';
import { iniciarSeguimiento } from './seguimiento-video.js';
import { programaLabel } from './ciclos.js';
import { faseMaximaChecklist } from './hitos.js';

// 'comun' es la base que se repite en todos los programas: se sube una sola vez y aparece en los cuatro.
const PROGRAMAS_CONTENIDO = ['comun', 'open', 'begin', 'next', 'exit'];
const PROGRAMAS_REALES = ['open', 'begin', 'next', 'exit'];
const excluidaDe = (c, p) => !!(c && c.excluirDe && c.excluirDe[p]);
const etiquetaPrograma = p => p === 'comun' ? '🌐 Base común' : programaLabel(p);
// Los módulos de la base común solo se editan desde su pestaña; en los programas se ven y ya.
// El director edita todo desde cualquier pestaña; lo de la Base común se guarda siempre en la Base (su origen).
const puedeEditar = () => estado.esDirector;
// El director reordena arrastrando (las flechas siguen como respaldo, p. ej. en el celular).
const arrastrable = () => estado.esDirector && !estado.modoSeleccion ? ' draggable="true"' : '';
const origenDe = mid => (mid && estado.datos[mid] && estado.datos[mid]._origen) || estado.programa;
const TAMANO_MAXIMO_PDF = 25 * 1024 * 1024;
const TEXTOS_FASE = { 0: 'Desde el inicio', 1: 'Fase 1', 2: 'Fase 2', 3: 'Fase 3', 4: 'Fase 4' };

const estado = {
  programa: null,
  datos: {},          // { moduloId: { titulo, ..., clases: { claseId: {...} } } }
  progreso: {},       // { claseId: timestamp }
  alumnoId: null,
  faseMax: 0,
  esDirector: false,  // administra (crear/editar/ordenar/borrar)
  modoSeleccion: false, // director: casillas para acciones masivas (Editar / Replicar)
  seleccion: new Set(),
  verBorradores: false, // staff y Alumno Demo: ven también lo que está sin publicar
  verTodo: false,     // staff: ve todos los programas, sin candado ni progreso
  vista: 'modulos',   // 'modulos' (tablero) | 'modulo' (lecciones) | 'leccion'
  moduloId: null,
  claseId: null,
  favoritos: {},      // { claseId: true } del usuario
  clave: null,        // id bajo el que se guarda lo personal (alumnoId, o el uid del staff)
  miFoto: ''
};
let cargaActual = 0;
let desuscribirValoraciones = null;
let detenerSeguimiento = null;   // detiene la medición del video de la lección abierta
let tokenSeguimiento = 0;
function pararSeguimiento() {
  tokenSeguimiento++;
  if (detenerSeguimiento) { detenerSeguimiento(); detenerSeguimiento = null; }
}

// Texto bajo los botones: cuánto del video se lleva visto (para el 70% que pide el ranking).
function mostrarVisto(info) {
  const p = document.getElementById('ct-visto');
  if (!p) return;
  if (!info.guardando) {
    p.textContent = `Prueba de medición (no se guarda): visto ${info.porcentaje}%.`;
  } else if (info.duracionSeg > 0 && info.porcentaje >= 70) {
    p.textContent = `Visto: ${info.porcentaje}%. ✓ Ya viste lo suficiente para que concluir esta lección sume puntos.`;
  } else {
    p.textContent = `Visto: ${info.porcentaje}%. Mira al menos el 70% del video para que concluir esta lección sume puntos.`;
  }
}
let scriptsPlayer = [];

let desuscribirComentarios = null;
const NOMBRES_ROL_COMENTARIO = { director: 'Director/a', mentor: 'Mentor/a', coach: 'Copiloto', alumno: 'Alumno/a' };
const urlSegura = u => (typeof u === 'string' && u.startsWith('https://')) ? u : '';

// Íconos de las lecciones (reloj de duración y estado: play = pendiente, check = concluida).
const ICONO_RELOJ = '<svg class="ct-ico ct-ico--reloj" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ICONO_PLAY = '<svg class="ct-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const ICONO_CHECK = '<svg class="ct-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const el = id => document.getElementById(id);
const textoMultilinea = t => escaparHtml(t || '').replace(/\n/g, '<br>');

/* ---------- Vturb ---------- */

// Del código que copia el director desde Vturb saca el id del reproductor y la URL del script.
// Solo se aceptan scripts https de converteai.net: nunca se pinta el código pegado tal cual.
export function parsearEmbedVturb(codigo) {
  const texto = String(codigo || '');
  const idM = texto.match(/<vturb-smartplayer[^>]*\sid\s*=\s*["']([A-Za-z0-9_-]{4,80})["']/i);
  const srcM = texto.match(/https:\/\/[A-Za-z0-9.-]+\/[^\s"'<>\\]*player\.js/i);
  if (!idM || !srcM) return null;
  try {
    const host = new URL(srcM[0]).hostname;
    if (!(host === 'converteai.net' || host.endsWith('.converteai.net'))) return null;
  } catch (e) { return null; }
  return { elementoId: idM[1], scriptUrl: srcM[0] };
}

function montarReproductor(cont, vturb) {
  scriptsPlayer.forEach(s => s.remove());
  scriptsPlayer = [];
  cont.innerHTML = '';
  if (!vturb || !vturb.elementoId || !vturb.scriptUrl) {
    cont.innerHTML = '<p class="ct-sin-video">Esta clase todavía no tiene video.</p>';
    return;
  }
  const player = document.createElement('vturb-smartplayer');
  player.id = vturb.elementoId;
  player.style.cssText = 'display:block;width:100%;';
  cont.appendChild(player);
  const s = document.createElement('script');
  s.src = vturb.scriptUrl;
  s.async = true;
  document.head.appendChild(s);
  scriptsPlayer.push(s);
  return player;
}

/* ---------- Duración automática (desde la lista de reproducción del video) ---------- */

// Con el reproductor ya cargado, lee su configuración y suma los segmentos de la lista de
// reproducción (.m3u8) del video: da los minutos reales sin tener que reproducirlo.
async function minutosDesdeReproductor(p) {
  const hostOk = h => /^[\w-]+(\.[\w-]+)*\.converteai\.net$/.test(h) || h === 'converteai.net';
  for (let i = 0; i < 48; i++) {   // hasta ~12 s esperando a que el reproductor se configure
    const cfg = p && p.config;
    if (cfg && cfg.oid && cfg.video && cfg.video.id) {
      if (!/^[\w-]+$/.test(cfg.oid) || !/^[\w-]+$/.test(cfg.video.id)) return null;
      const base = new URL(`https://${cfg.cdn || 'cdn.converteai.net'}/${cfg.oid}/${cfg.video.id}/`);
      if (!hostOk(base.hostname)) return null;
      const principal = await (await fetch(new URL('main.m3u8', base))).text();
      const variante = principal.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
      if (!variante) return null;
      const urlVariante = new URL(variante, base);
      if (!hostOk(urlVariante.hostname)) return null;
      const lista = await (await fetch(urlVariante)).text();
      const segundos = [...lista.matchAll(/#EXTINF:([\d.]+)/g)].reduce((s, m) => s + parseFloat(m[1]), 0);
      return segundos > 0 ? Math.max(1, Math.round(segundos / 60)) : null;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

const duracionIntentada = new Set();   // lecciones ya probadas en esta sesión (no se reintentan)
let detectandoDuraciones = false;

async function guardarDuracion(programa, mid, cid, minutos) {
  if (estado.datos[mid] && estado.datos[mid]._origen === 'comun') programa = 'comun';
  await update(ref(db, `contenidos/${programa}/${mid}/clases/${cid}`), { duracionMin: minutos });
  if (estado.datos[mid] && estado.datos[mid].clases && estado.datos[mid].clases[cid]) {
    estado.datos[mid].clases[cid].duracionMin = minutos;
  }
}

// Solo el director: completa en segundo plano la duración de las lecciones que no la tienen,
// cargando cada video en un reproductor oculto, de a uno.
async function detectarDuracionesFaltantes() {
  if (!estado.esDirector || detectandoDuraciones) return;
  const programa = estado.programa;
  const pendientes = [];
  Object.entries(estado.datos).forEach(([mid, m]) => Object.entries(m.clases || {}).forEach(([cid, c]) => {
    if (c.vturb && c.vturb.elementoId && c.vturb.scriptUrl && !(Number(c.duracionMin) > 0) && !duracionIntentada.has(cid)) pendientes.push([mid, cid, c.vturb]);
  }));
  if (!pendientes.length) return;
  detectandoDuraciones = true;
  try {
    for (const [mid, cid, vturb] of pendientes) {
      if (estado.programa !== programa || estado.vista === 'leccion') break;
      duracionIntentada.add(cid);
      // El video de la lección abierta no se oculta ni se duplica: esa se mide en pintar().
      const caja = document.createElement('div');
      caja.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:180px;overflow:hidden;visibility:hidden;';
      const p = document.createElement('vturb-smartplayer');
      p.id = vturb.elementoId;
      caja.appendChild(p);
      document.body.appendChild(caja);
      const s = document.createElement('script');
      s.src = vturb.scriptUrl; s.async = true;
      document.head.appendChild(s);
      let min = null;
      try { min = await minutosDesdeReproductor(p); } catch (err) { console.warn('No se pudo medir el video:', err); }
      caja.remove(); s.remove();
      if (min) {
        try { await guardarDuracion(programa, mid, cid, min); } catch (err) { console.warn('No se pudo guardar la duración:', err); continue; }
        if (estado.programa === programa && estado.vista !== 'leccion') pintar();
      }
    }
  } finally {
    detectandoDuraciones = false;
  }
}

/* ---------- Datos ---------- */

function ordenar(obj) {
  return Object.entries(obj || {})
    .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0) || a[0].localeCompare(b[0]));
}
const clasesDe = modulo => ordenar(modulo.clases);

// Lo personal (clases concluidas y favoritas) de quien está viendo la sección.
async function cargarMisMarcas() {
  estado.progreso = {}; estado.favoritos = {};
  if (!estado.clave) return;
  try {
    const [p, f] = await Promise.all([
      get(ref(db, `progresoClases/${estado.clave}`)),
      get(ref(db, `favoritosClases/${estado.clave}`))
    ]);
    estado.progreso = p.exists() ? p.val() : {};
    estado.favoritos = f.exists() ? f.val() : {};
  } catch (err) {
    console.warn('No se pudo leer el avance personal:', err);
  }
}

async function resolverAlumno() {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  estado.alumnoId = null; estado.faseMax = 0; estado.progreso = {}; estado.favoritos = {}; estado.clave = null; estado.miFoto = '';
  if (!uid) return null;
  const mapa = await get(ref(db, `alumnoPorAuthUid/${uid}`));
  if (!mapa.exists()) return null;
  estado.alumnoId = mapa.val();
  estado.clave = estado.alumnoId;
  const alumno = await get(ref(db, `alumnos/${estado.alumnoId}`));
  const cicloId = alumno.exists() ? alumno.val().cicloActualId : null;
  if (!cicloId) return null;
  const ciclo = await get(ref(db, `ciclos/${cicloId}`));
  if (!ciclo.exists()) return null;
  estado.faseMax = faseMaximaChecklist(ciclo.val());
  if (esModoDemo()) estado.faseMax = 4;   // el Alumno Demo ve todo, sin candado, para presentar
  estado.miFoto = alumno.val().fotoUrl || '';
  await cargarMisMarcas();
  return ciclo.val().programa || null;
}

export async function cargarContenidos() {
  const role = getCurrentRole();
  const cont = el('contenidos-contenido');
  // Por ahora los alumnos no ven esta sección (el menú la oculta): solo el staff.
  // Solo el staff y el Alumno Demo (modo demo). Los alumnos reales no la ven todavía.
  if (!cont || !(['director', 'mentor', 'coach'].includes(role) || (role === 'alumno' && esModoDemo()))) return;
  const id = ++cargaActual;
  estado.esDirector = role === 'director';
  estado.verTodo = role !== 'alumno';
  estado.verBorradores = estado.verTodo || esModoDemo();
  estado.vista = 'modulos'; estado.moduloId = null; estado.claseId = null;
  cont.innerHTML = '<p class="text-soft">Cargando...</p>';
  try {
    if (estado.verTodo) {
      if (!estado.programa) estado.programa = 'begin';
      const uid = auth.currentUser ? auth.currentUser.uid : null;
      estado.alumnoId = null; estado.clave = uid; estado.miFoto = '';
      try {
        const f = uid ? await get(ref(db, `usuarios/${uid}/fotoUrl`)) : null;
        estado.miFoto = f && f.exists() ? f.val() : '';
      } catch (err) { /* sin foto */ }
      await cargarMisMarcas();
    } else {
      estado.programa = await resolverAlumno();
    }
    if (id !== cargaActual) return;
    if (!estado.programa) {
      cont.innerHTML = '<div class="panel"><div class="panel__body"><p class="text-soft" style="margin:0;">Todavía no tienes un programa asignado.</p></div></div>';
      return;
    }
    await recargarDatos();
    if (id !== cargaActual) return;
    pintar();
  } catch (err) {
    console.error('No se pudieron cargar los contenidos:', err);
    cont.innerHTML = '<p class="text-soft">No se pudieron cargar los contenidos. Intenta de nuevo.</p>';
  }
}

async function recargarDatos() {
  const programa = estado.programa;
  const snap = await get(ref(db, `contenidos/${programa}`));
  const propios = snap.exists() ? snap.val() : {};
  Object.values(propios).forEach(m => { if (m && typeof m === 'object') m._origen = programa; });
  if (programa === 'comun') { estado.datos = propios; return; }
  // La base común va primero (su orden se resta solo en pantalla, no se guarda).
  let comunes = {};
  try {
    const sc = await get(ref(db, 'contenidos/comun'));
    if (sc.exists()) comunes = sc.val();
  } catch (err) { console.warn('No se pudo leer la base común:', err); }
  Object.values(comunes).forEach(m => { if (m && typeof m === 'object') { m._origen = 'comun'; m.orden = (Number(m.orden) || 0) - 1000000; } });
  estado.datos = { ...propios, ...comunes };
}

/* ---------- Pintado: tres pantallas (módulos > lecciones > lección) ---------- */

function moduloBloqueado(m) {
  return !estado.verTodo && (Number(m.desdeFase) || 0) > estado.faseMax;
}
function visibles() {
  // Para el alumno: solo módulos y clases publicados.
  // En un programa, de la base común se quitan las lecciones que el director sacó de ese programa;
  // si un módulo común se queda sin ninguna, tampoco se muestra.
  const enPrograma = estado.programa !== 'comun';
  const resultado = [];
  ordenar(estado.datos).forEach(([id, m]) => {
    if (!estado.verBorradores && m.publicado === false) return;
    const todas = clasesDe(m);
    const clases = todas.filter(([, c]) => (estado.verBorradores || c.publicado !== false) && !(enPrograma && excluidaDe(c, estado.programa)));
    if (enPrograma && m._origen === 'comun' && todas.length && !clases.length && todas.every(([, c]) => excluidaDe(c, estado.programa))) return;
    resultado.push([id, { ...m, clases: Object.fromEntries(clases) }]);
  });
  return resultado;
}

function irA(vista, moduloId = null, claseId = null) {
  estado.modoSeleccion = false; estado.seleccion.clear();
  estado.vista = vista; estado.moduloId = moduloId; estado.claseId = claseId;
  pintar();
  const cont = el('contenidos-contenido');
  if (cont) cont.scrollIntoView({ block: 'start' });
}

function progresoDeModulo(m) {
  const cl = clasesDe(m);
  const vistas = cl.filter(([cid]) => estado.progreso[cid]).length;
  const minutos = cl.reduce((s, [, c]) => s + (Number(c.duracionMin) || 0), 0);
  return { total: cl.length, vistas, minutos, pct: cl.length ? Math.round(vistas * 100 / cl.length) : 0 };
}

const botonesAdmin = (tipo, mid, cid, i, n) => `
  <span class="ct-acciones">
    <button type="button" class="ct-icono" data-act="${tipo}-arriba" data-m="${mid}" data-c="${cid || ''}" ${i === 0 ? 'disabled' : ''} title="Subir">▲</button>
    <button type="button" class="ct-icono" data-act="${tipo}-abajo" data-m="${mid}" data-c="${cid || ''}" ${i === n - 1 ? 'disabled' : ''} title="Bajar">▼</button>
    <button type="button" class="ct-icono" data-act="${tipo}-editar" data-m="${mid}" data-c="${cid || ''}" title="Editar">✏️</button>
    <button type="button" class="ct-icono" data-act="${tipo}-borrar" data-m="${mid}" data-c="${cid || ''}" title="Borrar">🗑️</button>
  </span>`;

function pintar() {
  const cont = el('contenidos-contenido');
  if (!cont) return;
  if (estado.vista !== 'leccion') {
    if (desuscribirComentarios) { desuscribirComentarios(); desuscribirComentarios = null; }
    if (desuscribirValoraciones) { desuscribirValoraciones(); desuscribirValoraciones = null; }
    pararSeguimiento();
    scriptsPlayer.forEach(s => s.remove());
    scriptsPlayer = [];
  }
  const modulos = visibles();
  const actual = estado.moduloId ? modulos.find(([id]) => id === estado.moduloId) : null;
  if (estado.vista !== 'modulos' && (!actual || moduloBloqueado(actual[1]))) irAlTablero();
  if (estado.vista === 'leccion' && !(actual[1].clases && actual[1].clases[estado.claseId])) estado.vista = 'modulo';

  if (estado.vista === 'modulos') cont.innerHTML = vistaModulos(modulos);
  else if (estado.vista === 'modulo') cont.innerHTML = vistaModulo(actual[0], actual[1]);
  else cont.innerHTML = vistaLeccion(actual[0], actual[1], estado.claseId);

  if (estado.vista === 'leccion') {
    const clase = actual[1].clases[estado.claseId];
    pararSeguimiento();
    const jugador = montarReproductor(el('ct-player'), clase.vturb);
    escucharComentarios(estado.claseId);
    escucharValoraciones(estado.claseId);
    if (jugador) {
      const miToken = ++tokenSeguimiento;
      const claseSeg = estado.claseId;
      iniciarSeguimiento(jugador, claseSeg, (Number(clase.duracionMin) || 0) * 60, mostrarVisto).then(detener => {
        // Si mientras tanto cambió la lección, se cancela esta medición.
        if (miToken !== tokenSeguimiento || estado.vista !== 'leccion' || estado.claseId !== claseSeg) { if (detener) detener(); }
        else detenerSeguimiento = detener;
      }).catch(err => console.warn('No se pudo iniciar la medición del video:', err));
    }
    // El director abre una lección sin duración: se mide con este mismo reproductor y se guarda.
    const cid = estado.claseId, mid = actual[0], programa = estado.programa;
    if (jugador && estado.esDirector && !(Number(clase.duracionMin) > 0) && !duracionIntentada.has(cid)) {
      duracionIntentada.add(cid);
      minutosDesdeReproductor(jugador).then(async min => {
        if (!min) return;
        await guardarDuracion(programa, mid, cid, min);
        const titulo = document.querySelector('.ct-lec__titulo');
        if (estado.claseId === cid && titulo && !titulo.querySelector('.ct-etq')) {
          titulo.insertAdjacentHTML('beforeend', ` <span class="ct-etq" style="vertical-align:middle;">${ICONO_RELOJ} ${formatoDuracion(min)}</span>`);
        }
      }).catch(err => console.warn('No se pudo medir el video:', err));
    }
  } else {
    detectarDuracionesFaltantes();
  }
}
function irAlTablero() { estado.modoSeleccion = false; estado.seleccion.clear(); estado.vista = 'modulos'; estado.moduloId = null; estado.claseId = null; }

/* --- Pantalla 1: tablero de módulos --- */
function vistaModulos(modulos) {
  const tabs = estado.verTodo ? `<div class="ct-tabs">${PROGRAMAS_CONTENIDO.map(p =>
    `<button type="button" class="ct-tab${p === estado.programa ? ' is-active' : ''}" data-programa="${p}">${escaparHtml(etiquetaPrograma(p))}</button>`).join('')}</div>` : '';
  const nota = estado.programa === 'comun' ? '<p class="text-soft" style="margin:0 0 12px;">Lo que subas aquí aparece automáticamente al comienzo de los 4 programas (OPEN, BEGIN, NEXT y eXIT). Súbelo una sola vez.</p>' : '';
  const nuevo = nota + (estado.esDirector ? `<div class="ct-admin-barra"><button type="button" class="btn btn--primary" id="ct-nuevo-modulo">+ Nuevo módulo</button> ${botonModoSeleccion()}</div>${estado.modoSeleccion ? barraMasiva() : ''}` : '');
  const tarjetas = modulos.length
    ? `<div class="ct-grid">${modulos.map(([mid, m], i) => tarjetaModulo(mid, m, i, modulos.length)).join('')}</div>`
    : `<div class="panel"><div class="panel__body"><p class="text-soft" style="margin:0;">${estado.esDirector ? (estado.programa === 'comun' ? 'Aún no hay base común. Crea el primer módulo con “+ Nuevo módulo”.' : 'Este programa aún no tiene módulos. Crea el primero con “+ Nuevo módulo”.') : estado.verTodo ? 'Este programa aún no tiene módulos.' : 'Pronto verás aquí los contenidos de tu programa.'}</p></div></div>`;
  return `${tabs}${nuevo}${tarjetas}`;
}

function tarjetaModulo(mid, m, i, n) {
  const bloq = moduloBloqueado(m);
  const p = progresoDeModulo(m);
  const img = urlSegura(m.portadaUrl) ? `<img src="${escaparHtml(m.portadaUrl)}" alt="">` : '<div class="ct-card__vacia">📚</div>';
  const etqs = [
    m.publicado === false ? '<span class="ct-etq">Borrador</span>' : '',
    m._origen === 'comun' && estado.programa !== 'comun' ? '<span class="ct-etq">🌐 Base común</span>' : '',
    estado.verTodo && (Number(m.desdeFase) || 0) > 0 ? `<span class="ct-etq">${escaparHtml(TEXTOS_FASE[m.desdeFase] || '')}</span>` : '',
    bloq ? `<span class="ct-etq">🔒 ${escaparHtml(TEXTOS_FASE[m.desdeFase] || '')}</span>` : ''
  ].join('');
  return `
    <article${arrastrable()} class="ct-card${bloq ? ' is-bloqueado' : ''}${estado.seleccion.has(mid) ? ' is-sel' : ''}" data-act="${bloq ? 'bloqueado' : 'ir-modulo'}" data-m="${mid}" data-fase="${escaparHtml(TEXTOS_FASE[m.desdeFase] || '')}">
      <div class="ct-card__img">${img}
        <div class="ct-card__etqs">${etqs}</div>
        ${puedeEditar(m) ? (estado.modoSeleccion ? `<label class="ct-sel"><input type="checkbox" ${estado.seleccion.has(mid) ? 'checked' : ''} tabindex="-1"></label>` : `<div class="ct-card__admin">${botonesAdmin('mod', mid, '', i, n)}</div>`) : ''}
      </div>
      <p class="ct-card__titulo">${escaparHtml(m.titulo || 'Módulo sin título')}</p>
      ${m.descripcion ? `<p class="ct-card__desc">${escaparHtml(m.descripcion)}</p>` : ''}
      <p class="ct-card__meta">📚 ${p.total} ${p.total === 1 ? 'lección' : 'lecciones'}${p.minutos ? ` · ⏱ ${formatoDuracion(p.minutos)}` : ''}</p>
      <div class="ct-card__prog"><div class="ct-barra"><span style="width:${p.pct}%"></span></div><b>${p.pct}%</b></div>
    </article>`;
}

/* --- Pantalla 2: lecciones del módulo --- */
function vistaModulo(mid, m) {
  const clases = clasesDe(m);
  const prog = progresoDeModulo(m);
  const filas = clases.map(([cid, c], j) => {
    const vista = !!estado.progreso[cid];
    return `
    <div${arrastrable()} class="ct-fila${estado.seleccion.has(cid) ? ' is-sel' : ''}" data-act="abrir" data-m="${mid}" data-c="${cid}">
      <span class="ct-fila__num">${j + 1}</span>
      ${urlSegura(c.portadaUrl) ? `<img class="ct-portada ct-portada--mini" src="${escaparHtml(c.portadaUrl)}" alt="">` : ''}
      <span class="ct-fila__titulo">${escaparHtml(c.titulo || 'Lección sin título')}
        ${c.publicado === false ? '<span class="ct-etq ct-etq--borrador">Borrador</span>' : ''}
        ${m._origen === 'comun' && c.excluirDe && PROGRAMAS_REALES.some(p => c.excluirDe[p]) ? `<span class="ct-etq">No va en: ${PROGRAMAS_REALES.filter(p => c.excluirDe[p]).map(p => escaparHtml(programaLabel(p))).join(', ')}</span>` : ''}
        ${(c.materiales && Object.keys(c.materiales).length) ? '<span title="Tiene material">📎</span>' : ''}</span>
      ${Number(c.duracionMin) > 0 ? `<span class="ct-fila__dur">${ICONO_RELOJ} ${Number(c.duracionMin)} minutos</span>` : ''}
      <span class="ct-fila__estado${vista ? ' is-vista' : ''}" data-est="${cid}">${vista ? ICONO_CHECK : ICONO_PLAY}</span>
      ${puedeEditar(m) ? (estado.modoSeleccion ? `<label class="ct-sel ct-sel--fila"><input type="checkbox" ${estado.seleccion.has(cid) ? 'checked' : ''} tabindex="-1"></label>` : botonesAdmin('cla', mid, cid, j, clases.length)) : ''}
    </div>`;
  }).join('');
  return `
    <button type="button" class="ct-volver" data-act="volver-modulos">← Todos los módulos</button>
    <div class="ct-modhead">
      ${urlSegura(m.portadaUrl) ? `<img class="ct-portada" src="${escaparHtml(m.portadaUrl)}" alt="">` : ''}
      <div><h3 style="margin:0 0 4px;">${escaparHtml(m.titulo || '')}</h3>
        ${m.descripcion ? `<p class="text-soft" style="margin:0;">${textoMultilinea(m.descripcion)}</p>` : ''}
        <p class="text-soft" style="margin:6px 0 0; font-size:13px;">${clases.length} ${clases.length === 1 ? 'lección' : 'lecciones'}${prog.minutos ? ` · ⏱ ${formatoDuracion(prog.minutos)}` : ''} · ${prog.pct}% completado</p>
        <div class="ct-barra" style="max-width:320px; margin-top:8px;"><span style="width:${prog.pct}%"></span></div></div>
    </div>
    <div class="ct-filas">${filas || '<div class="panel"><div class="panel__body"><p class="text-soft" style="margin:0;">Aún no hay lecciones en este módulo.</p></div></div>'}</div>
    ${puedeEditar(m) ? `<div class="ct-admin-barra"><button type="button" class="btn btn--primary ct-nueva-clase" data-act="cla-nueva" data-m="${mid}">+ Nueva lección</button> ${botonModoSeleccion()}</div>${estado.modoSeleccion ? barraMasiva() : ''}` : ''}`;
}

/* --- Pantalla 3: la lección (video a la izquierda, lista del módulo a la derecha) --- */
function formatoDuracion(min) {
  min = Math.round(Number(min) || 0);
  if (min <= 0) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

function avatarHtml(foto, nombre, grande) {
  const url = urlSegura(foto);
  const clase = `ct-av${grande ? ' ct-av--lg' : ''}`;
  return url ? `<img class="${clase}" src="${escaparHtml(url)}" alt="">`
    : `<span class="${clase}">${escaparHtml(String(nombre || '?').trim().charAt(0).toUpperCase())}</span>`;
}

function vistaLeccion(mid, m, cid) {
  const clases = clasesDe(m);
  const idx = clases.findIndex(([id]) => id === cid);
  const clase = clases[idx][1];
  const ant = idx > 0 ? clases[idx - 1][0] : null;
  const sig = idx < clases.length - 1 ? clases[idx + 1][0] : null;
  const materiales = Object.values(clase.materiales || {}).filter(mt => mt && urlSegura(mt.url));
  const vista = !!estado.progreso[cid];
  const fav = !!estado.favoritos[cid];
  const dur = formatoDuracion(clase.duracionMin);

  const acciones = `
    <div class="ct-lec__acciones">
      <div class="ct-estrellas" id="ct-estrellas">${[1, 2, 3, 4, 5].map(n =>
        `<button type="button" class="ct-estrella" data-act="valorar" data-c="${cid}" data-n="${n}" title="${n} de 5">★</button>`).join('')}</div>
      <span class="ct-estrellas__info" id="ct-valoracion-info"></span>
      <span class="ct-lec__espacio"></span>
      <button type="button" class="ct-btn-txt${fav ? ' is-on' : ''}" id="ct-fav" data-act="favorito" data-c="${cid}">${fav ? '♥ Favorita' : '♡ Favoritar'}</button>
      <button type="button" class="ct-btn-txt${vista ? ' is-on' : ''}" id="ct-concluir" data-act="concluir" data-c="${cid}">${vista ? '✓ Concluida' : '○ No concluida'}</button>
      ${puedeEditar(m) ? `<button type="button" class="ct-btn-txt" data-act="cla-editar" data-m="${mid}" data-c="${cid}">✏️ Editar</button>` : ''}
    </div>`;

  const lista = clases.map(([id, c], j) => `
    <div class="ct-lado__item${id === cid ? ' is-actual' : ''}" data-act="abrir" data-m="${mid}" data-c="${id}">
      <span class="ct-lado__num">${j + 1}</span>
      <span class="ct-lado__txt">${escaparHtml(c.titulo || 'Lección sin título')}${Number(c.duracionMin) > 0 ? `<small class="ct-lado__dur">${ICONO_RELOJ} ${formatoDuracion(c.duracionMin)}</small>` : ''}</span>
      <span class="ct-lado__est${estado.progreso[id] ? ' is-vista' : ''}" data-est="${id}">${estado.progreso[id] ? ICONO_CHECK : ICONO_PLAY}</span>
    </div>`).join('');

  return `
    <button type="button" class="ct-volver" data-act="volver-modulo" data-m="${mid}">← ${escaparHtml(m.titulo || 'Módulo')}</button>
    <div class="ct-lec">
      <div class="ct-lec__main">
        <div class="ct-lec__cab">
          <h3 class="ct-lec__titulo">${idx + 1} | ${escaparHtml(clase.titulo || '')}${dur ? ` <span class="ct-etq" style="vertical-align:middle;">⏱ ${dur}</span>` : ''}</h3>
          <div class="ct-lec__nav">
            <button type="button" class="ct-link" data-act="abrir" data-m="${mid}" data-c="${ant || ''}" ${ant ? '' : 'disabled'}>‹ Anterior</button>
            <button type="button" class="ct-link" data-act="abrir" data-m="${mid}" data-c="${sig || ''}" ${sig ? '' : 'disabled'}>Próxima ›</button>
          </div>
        </div>
        <div class="ct-player" id="ct-player"></div>
        <div class="panel ct-lec__panel"><div class="panel__body">
          ${clase.descripcion ? `<p class="ct-materiales__t">Descripción de la lección</p><p class="ct-visor__desc" style="margin:6px 0 0;">${textoMultilinea(clase.descripcion)}</p>` : ''}
          ${acciones}
          ${clase.vturb ? '<p class="ct-visto" id="ct-visto"></p>' : ''}
          <div class="ct-com-nuevo">
            ${avatarHtml(estado.miFoto, getCurrentUserNombre(), true)}
            <textarea id="ct-comentario-texto" maxlength="1000" rows="1" placeholder="Agregar comentario"></textarea>
            <button type="button" class="ct-com-enviar" data-act="com-enviar" data-c="${cid}" title="Publicar">➤</button>
          </div>
          <div id="ct-comentarios-lista" class="ct-com-lista"><p class="text-soft" style="margin:0;">Cargando...</p></div>
        </div></div>
      </div>
      <aside class="panel ct-lado">
        <div class="ct-lado__tabs">
          <button type="button" class="ct-lado__tab is-active" data-act="tab" data-t="videos">Videos</button>
          <button type="button" class="ct-lado__tab" data-act="tab" data-t="downloads">Downloads</button>
        </div>
        <div class="panel__body">
          <div data-pane="videos">
            <p class="ct-lado__mod">📚 ${escaparHtml(m.titulo || '')}</p>
            <div class="ct-lado__lista">${lista}</div>
          </div>
          <div data-pane="downloads" class="hidden">
            ${materiales.length ? materiales.map(mt => `<a class="ct-material" style="display:block; margin-bottom:8px;" href="${escaparHtml(mt.url)}" target="_blank" rel="noopener noreferrer">📄 ${escaparHtml(mt.nombre || 'Material')}</a>`).join('')
              : '<p class="text-soft" style="margin:0;">Esta lección no tiene material para descargar.</p>'}
          </div>
        </div>
      </aside>
    </div>`;
}

/* ---------- Comentarios de la clase (con respuestas) ---------- */

let comentariosActuales = [];

function cabeceraComentario(cid, c, yo) {
  const nombre = String(c.nombre || 'Usuario');
  const puedeBorrar = estado.esDirector || c.autorId === yo;
  const fecha = c.fecha ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(c.fecha)) : '';
  return `<p class="ct-com__nombre">${escaparHtml(nombre)}
    ${NOMBRES_ROL_COMENTARIO[c.rol] && c.rol !== 'alumno' ? `<span class="ct-etq">${NOMBRES_ROL_COMENTARIO[c.rol]}</span>` : ''}
    <span class="ct-com__fecha">${escaparHtml(fecha)}</span>
    ${puedeBorrar ? `<button type="button" class="ct-icono" data-act="com-borrar" data-c="${cid}" data-k="${escaparHtml(c.k)}" title="Borrar">🗑️</button>` : ''}</p>`;
}

function escucharComentarios(cid) {
  if (desuscribirComentarios) desuscribirComentarios();
  const lista = el('ct-comentarios-lista');
  if (!lista) return;
  const consulta = query(ref(db, `comentariosClases/${cid}`), limitToLast(300));
  desuscribirComentarios = onValue(consulta, snap => {
    const yo = auth.currentUser ? auth.currentUser.uid : null;
    const items = Object.entries(snap.exists() ? snap.val() : {}).map(([k, c]) => ({ ...c, k })).filter(c => !ocultarParaAlumno(c));
    comentariosActuales = items;
    const ids = new Set(items.map(x => x.k));
    const raices = items.filter(x => !x.padreId || !ids.has(x.padreId)).sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
    const hijas = pid => items.filter(x => x.padreId === pid).sort((a, b) => (a.fecha || 0) - (b.fecha || 0));

    // Conserva las respuestas que alguien está escribiendo.
    const abiertas = {};
    lista.querySelectorAll('.ct-com__form:not(.hidden)').forEach(f => { abiertas[f.dataset.form] = f.querySelector('textarea').value; });

    lista.innerHTML = raices.length ? raices.map(r => `
      <div class="ct-com">
        ${avatarHtml(r.fotoUrl, r.nombre, true)}
        <div class="ct-com__cuerpo">
          ${cabeceraComentario(cid, r, yo)}
          <p class="ct-com__texto">${textoMultilinea(r.texto)}</p>
          <button type="button" class="ct-com__resp" data-act="com-responder" data-k="${escaparHtml(r.k)}">Responder</button>
          <div class="ct-com__resps">${hijas(r.k).map(h => `
            <div class="ct-com ct-com--resp">
              ${avatarHtml(h.fotoUrl, h.nombre, true)}
              <div class="ct-com__cuerpo">${cabeceraComentario(cid, h, yo)}<p class="ct-com__texto">${textoMultilinea(h.texto)}</p></div>
            </div>`).join('')}</div>
          <div class="ct-com__form hidden" data-form="${escaparHtml(r.k)}">
            <textarea maxlength="1000" rows="1" placeholder="Escribe una respuesta..."></textarea>
            <button type="button" class="ct-com-enviar" data-act="com-resp-enviar" data-c="${cid}" data-k="${escaparHtml(r.k)}" title="Responder">➤</button>
          </div>
        </div>
      </div>`).join('') : '<p class="text-soft" style="margin:0;">Aún no hay comentarios. ¡Sé el primero!</p>';

    Object.entries(abiertas).forEach(([k, texto]) => {
      const f = lista.querySelector(`.ct-com__form[data-form="${CSS.escape(k)}"]`);
      if (f) { f.classList.remove('hidden'); f.querySelector('textarea').value = texto; }
    });
  }, err => {
    console.error('No se pudieron leer los comentarios:', err);
    lista.innerHTML = '<p class="text-soft" style="margin:0;">No se pudieron cargar los comentarios.</p>';
  });
}

async function enviarComentario(cid, caja, boton, padreId) {
  const texto = caja ? caja.value.trim() : '';
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!texto || !uid) return;
  boton.disabled = true;
  try {
    const datos = {
      autorId: uid,
      nombre: (getCurrentUserNombre() || 'Usuario').slice(0, 120),
      rol: getCurrentRole(),
      texto: texto.slice(0, 1000),
      fecha: Date.now(),
      ...marcaDemo()
    };
    if (urlSegura(estado.miFoto) && estado.miFoto.length <= 600) datos.fotoUrl = estado.miFoto;
    if (padreId) datos.padreId = padreId;
    await set(push(ref(db, `comentariosClases/${cid}`)), datos);
    caja.value = '';
    if (padreId) caja.closest('.ct-com__form').classList.add('hidden');
  } catch (err) {
    console.error('No se pudo publicar el comentario:', err);
    alert('No se pudo publicar el comentario. Intenta de nuevo.');
  }
  boton.disabled = false;
}

async function borrarComentario(cid, k) {
  if (!confirm('¿Borrar este comentario?')) return;
  if (estado.esDirector) {
    // El director borra también las respuestas del comentario.
    const cambios = { [k]: null };
    comentariosActuales.filter(x => x.padreId === k).forEach(x => { cambios[x.k] = null; });
    await update(ref(db, `comentariosClases/${cid}`), cambios);
  } else {
    await remove(ref(db, `comentariosClases/${cid}/${k}`));
  }
}

/* ---------- Valoración con estrellas ---------- */

// La valoración se guarda bajo el uid propio; en modo demo, bajo el id del Alumno Demo (así no se mezcla).
const claveValoracion = () => (esModoDemo() && estado.clave) ? estado.clave : (auth.currentUser ? auth.currentUser.uid : null);

function escucharValoraciones(cid) {
  if (desuscribirValoraciones) desuscribirValoraciones();
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  desuscribirValoraciones = onValue(ref(db, `valoracionesClases/${cid}`), snap => {
    // Las valoraciones del Alumno Demo no cuentan para los alumnos reales.
    const todas = Object.fromEntries(Object.entries(snap.exists() ? snap.val() : {}).filter(([k]) => !ocultarParaAlumno({ alumnoId: k })));
    const notas = Object.values(todas).map(Number).filter(n => n >= 1 && n <= 5);
    const mia = Number(todas[claveValoracion()]) || 0;
    const cont = el('ct-estrellas');
    if (cont) {
      cont.dataset.mia = String(mia);
      cont.querySelectorAll('.ct-estrella').forEach(b => b.classList.toggle('is-on', Number(b.dataset.n) <= mia));
    }
    const info = el('ct-valoracion-info');
    if (info) {
      info.textContent = notas.length
        ? `${(notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(1)} · ${notas.length} ${notas.length === 1 ? 'valoración' : 'valoraciones'}`
        : 'Sin valoraciones';
    }
  }, err => console.warn('No se pudieron leer las valoraciones:', err));
}

async function valorar(cid, n) {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;
  const mia = Number((el('ct-estrellas') || {}).dataset?.mia) || 0;
  try {
    // Tocar otra vez la misma nota la quita.
    await set(ref(db, `valoracionesClases/${cid}/${claveValoracion()}`), mia === n ? null : n);
    if (mia !== n) marcarValoracion(cid);   // para el ranking: cuenta solo la primera vez en cada lección
  } catch (err) {
    console.error('No se pudo guardar la valoración:', err);
    alert('No se pudo guardar tu valoración. Intenta de nuevo.');
  }
}

/* ---------- Favorito y concluida ---------- */

async function alternarFavorito(cid, boton) {
  if (!estado.clave) return;
  boton.disabled = true;
  try {
    const nueva = !estado.favoritos[cid];
    await set(ref(db, `favoritosClases/${estado.clave}/${cid}`), nueva ? true : null);
    if (nueva) estado.favoritos[cid] = true; else delete estado.favoritos[cid];
    boton.textContent = nueva ? '♥ Favorita' : '♡ Favoritar';
    boton.classList.toggle('is-on', nueva);
  } catch (err) {
    console.error('No se pudo guardar el favorito:', err);
    alert('No se pudo guardar. Intenta de nuevo.');
  }
  boton.disabled = false;
}

async function alternarVista(cid, boton) {
  if (!estado.clave) return;
  boton.disabled = true;
  try {
    const nueva = estado.progreso[cid] ? null : Date.now();
    await set(ref(db, `progresoClases/${estado.clave}/${cid}`), nueva);
    if (nueva) { estado.progreso[cid] = nueva; marcarClaseConcluida(cid); } else delete estado.progreso[cid];
    // Se actualiza solo lo necesario para no reiniciar el video.
    boton.textContent = nueva ? '✓ Concluida' : '○ No concluida';
    boton.classList.toggle('is-on', !!nueva);
    document.querySelectorAll(`[data-est="${cid}"]`).forEach(e => {
      e.innerHTML = nueva ? ICONO_CHECK : ICONO_PLAY;
      e.classList.toggle('is-vista', !!nueva);
    });
  } catch (err) {
    console.error('No se pudo guardar el progreso:', err);
    alert('No se pudo guardar. Intenta de nuevo.');
  }
  boton.disabled = false;
}

/* ---------- Administración (director) ---------- */

function modal(titulo, cuerpoHtml, onGuardar) {
  document.getElementById('ct-modal')?.remove();
  const ov = document.createElement('div');
  ov.className = 'modal-overlay is-visible';
  ov.id = 'ct-modal';
  ov.innerHTML = `
    <div class="modal-card" style="max-width:560px;">
      <div class="modal-card__header"><h3 style="margin:0;">${escaparHtml(titulo)}</h3>
        <button type="button" class="btn btn--ghost" data-cerrar style="padding:8px 14px; line-height:1;">✕</button></div>
      <div class="modal-card__body">${cuerpoHtml}
        <p id="ct-modal-error" class="hidden" style="color:#C0392B; margin:12px 0 0; font-size:13px;"></p>
        <div style="display:flex; gap:8px; margin-top:16px;"><button type="button" class="btn btn--primary" data-guardar>Guardar</button>
          <button type="button" class="btn btn--ghost" data-cerrar>Cancelar</button></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const cerrar = () => ov.remove();
  ov.querySelectorAll('[data-cerrar]').forEach(b => b.addEventListener('click', cerrar));
  const btn = ov.querySelector('[data-guardar]');
  btn.addEventListener('click', async () => {
    const err = ov.querySelector('#ct-modal-error');
    err.classList.add('hidden');
    btn.disabled = true;
    try {
      await onGuardar(ov);
      cerrar();
      await recargarDatos();
      pintar();
    } catch (e) {
      console.error(e);
      const detalle = e.code ? ` (${e.code.startsWith('storage/') ? 'al subir un archivo' : 'al guardar los datos'}: ${e.code})` : '';
      err.textContent = e.mensaje || `No se pudo guardar. Intenta de nuevo.${detalle}`;
      err.classList.remove('hidden');
      btn.disabled = false;
    }
  });
  return ov;
}
const fallo = mensaje => Object.assign(new Error(mensaje), { mensaje });
const val = (ov, id) => ov.querySelector(id).value.trim();

function siguienteOrden(obj) {
  return Object.values(obj || {}).reduce((mx, x) => Math.max(mx, Number(x.orden) || 0), 0) + 1;
}

/* --- Portada horizontal 16:9: la imagen elegida se recorta al centro y se reduce a 1280×720 --- */
function recortar16x9(archivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const W = 1280, H = 720;
      let sw = img.width, sh = img.width * 9 / 16;
      if (sh > img.height) { sh = img.height; sw = img.height * 16 / 9; }
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      canvas.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo procesar la imagen')), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

function htmlCampoPortada(actual) {
  return `<div class="field mb-16"><label>Portada (horizontal 16:9)</label>
    <div class="ct-portada-prev" id="ct-p-prev">${urlSegura(actual.url) ? `<img src="${escaparHtml(actual.url)}" alt="">` : '<span>Sin portada</span>'}</div>
    <div style="display:flex; gap:8px; margin-top:6px;">
      <button type="button" class="btn btn--ghost" id="ct-p-elegir" style="font-size:12px;">Elegir imagen</button>
      <button type="button" class="btn btn--ghost" id="ct-p-quitar" style="font-size:12px;">Quitar</button></div>
    <input type="file" id="ct-p-file" accept="image/*" class="hidden">
    <p class="text-soft" style="font-size:12px; margin:4px 0 0;">Se recorta sola al centro en formato 16:9.</p></div>`;
}

function activarPortada(ov) {
  const est = { blob: null, quitar: false };
  const prev = ov.querySelector('#ct-p-prev');
  const input = ov.querySelector('#ct-p-file');
  ov.querySelector('#ct-p-elegir').addEventListener('click', () => input.click());
  ov.querySelector('#ct-p-quitar').addEventListener('click', () => {
    est.blob = null; est.quitar = true;
    prev.innerHTML = '<span>Sin portada</span>';
  });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return alert('Elige una imagen (JPG o PNG).');
    try {
      est.blob = await recortar16x9(f); est.quitar = false;
      prev.innerHTML = '';
      const im = document.createElement('img');
      im.src = URL.createObjectURL(est.blob);
      prev.appendChild(im);
    } catch (e) { alert('No se pudo procesar la imagen. Prueba con otra.'); }
  });
  return est;
}

// Sube/quita la portada según lo elegido y deja los campos listos para guardar.
// Las copias (Enviar a otro programa) comparten los mismos archivos: solo se borra el archivo si nadie más lo usa.
// propias = cuántas veces lo nombra el elemento que se está cambiando y que aún está guardado.
async function borrarArchivoSiLibre(ruta, propias = 0) {
  if (!ruta) return;
  try {
    const s = await get(ref(db, 'contenidos'));
    const usos = s.exists() ? JSON.stringify(s.val()).split(JSON.stringify(ruta)).length - 1 : 0;
    if (usos > propias) return;
  } catch (e) { return; }
  try { await deleteObject(storageRef(storage, ruta)); } catch (e) { /* ya no estaba */ }
}

async function aplicarPortada(est, actual, rutaBase, campos) {
  const borrarAnterior = async () => { await borrarArchivoSiLibre(actual.ruta, 1); };
  if (est.blob) {
    const ruta = `${rutaBase}_${Date.now()}.jpg`;
    const sref = storageRef(storage, ruta);
    await uploadBytes(sref, est.blob, { contentType: 'image/jpeg' });
    campos.portadaUrl = await getDownloadURL(sref);
    campos.portadaRuta = ruta;
    await borrarAnterior();
  } else if (est.quitar) {
    campos.portadaUrl = null;
    campos.portadaRuta = null;
    await borrarAnterior();
  }
}

function editarModulo(mid) {
  const m = mid ? estado.datos[mid] : null;
  const portadaActual = { url: m && m.portadaUrl, ruta: m && m.portadaRuta };
  const prog = origenDe(mid);
  const nuevoId = mid || push(ref(db, `contenidos/${prog}`)).key;
  const opcionesFase = Object.entries(TEXTOS_FASE).map(([k, t]) =>
    `<option value="${k}" ${(Number(m && m.desdeFase) || 0) === Number(k) ? 'selected' : ''}>${t}</option>`).join('');
  let portada;
  const ovM = modal(m ? 'Editar módulo' : 'Nuevo módulo', `
    ${htmlCampoPortada(portadaActual)}
    <div class="field mb-16"><label>Título</label><input id="ct-m-titulo" maxlength="120" value="${escaparHtml(m ? m.titulo : '')}"></div>
    <div class="field mb-16"><label>Descripción (opcional)</label><textarea id="ct-m-desc" maxlength="600">${escaparHtml(m ? m.descripcion || '' : '')}</textarea></div>
    <div class="field mb-16"><label>Se desbloquea para el alumno</label><select id="ct-m-fase">${opcionesFase}</select></div>
    <label style="display:flex; gap:8px; align-items:center; font-size:13.5px;"><input type="checkbox" id="ct-m-pub" ${!m || m.publicado !== false ? 'checked' : ''}> Publicado (visible para los alumnos)</label>`,
  async ov => {
    const titulo = val(ov, '#ct-m-titulo');
    if (!titulo) throw fallo('Escribe el título del módulo.');
    const campos = { titulo, descripcion: val(ov, '#ct-m-desc'), desdeFase: Number(ov.querySelector('#ct-m-fase').value), publicado: ov.querySelector('#ct-m-pub').checked };
    await aplicarPortada(portada, portadaActual, `contenidos-portadas/${prog}/${nuevoId}`, campos);
    if (mid) await update(ref(db, `contenidos/${prog}/${mid}`), campos);
    else await set(ref(db, `contenidos/${prog}/${nuevoId}`), { ...campos, orden: siguienteOrden(estado.datos) });
  });
  portada = activarPortada(ovM);
}

function editarClase(mid, cid) {
  const c = cid ? estado.datos[mid].clases[cid] : null;
  let materiales = { ...(c && c.materiales ? c.materiales : {}) };
  const quitados = [];
  const nuevos = [];
  const portadaActual = { url: c && c.portadaUrl, ruta: c && c.portadaRuta };
  const prog = origenDe(mid);
  const claseId = cid || push(ref(db, `contenidos/${prog}/${mid}/clases`)).key;
  let portada;
  const ov = modal(c ? 'Editar clase' : 'Nueva clase', `
    ${htmlCampoPortada(portadaActual)}
    <div class="field mb-16"><label>Título</label><input id="ct-c-titulo" maxlength="140" value="${escaparHtml(c ? c.titulo : '')}"></div>
    <div class="field mb-16"><label>Duración del video (minutos)</label><input id="ct-c-dur" type="number" min="0" max="600" value="${c && c.duracionMin ? Number(c.duracionMin) : ''}"></div>
    <div class="field mb-16"><label>Descripción (opcional)</label><textarea id="ct-c-desc" maxlength="2000">${escaparHtml(c ? c.descripcion || '' : '')}</textarea></div>
    <div class="field mb-16"><label>Código de inserción de Vturb</label>
      <textarea id="ct-c-embed" placeholder="Pega aquí el código JS del video (botón &lt;/&gt; en Vturb)" style="min-height:90px; font-family:monospace; font-size:12px;"></textarea>
      <p class="text-soft" style="font-size:12px; margin:4px 0 0;">${c && c.vturb ? '✓ Ya tiene un video. Pega un código nuevo solo si quieres cambiarlo.' : 'Debe incluir la etiqueta vturb-smartplayer y el script de converteai.net.'}</p></div>
    <div class="field mb-16"><label>Materiales (PDF)</label><div id="ct-c-mats"></div>
      <button type="button" class="btn btn--ghost" id="ct-c-addmat" style="font-size:12px; margin-top:6px;">+ Agregar PDF</button>
      <input type="file" id="ct-c-file" accept="application/pdf,.pdf" class="hidden"></div>
    ${prog === 'comun' ? `<div class="field mb-16"><label>Aparece en estos programas</label><div style="display:flex; gap:14px; flex-wrap:wrap; font-size:13.5px;">${PROGRAMAS_REALES.map(p => `<label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" class="ct-c-prog" data-p="${p}" ${excluidaDe(c, p) ? '' : 'checked'}> ${escaparHtml(programaLabel(p))}</label>`).join('')}</div><p class="text-soft" style="font-size:12px; margin:4px 0 0;">Desmarca un programa para sacar esta lección de ahí (el resto de la base común sigue).</p></div>` : ''}
    <label style="display:flex; gap:8px; align-items:center; font-size:13.5px;"><input type="checkbox" id="ct-c-pub" ${!c || c.publicado !== false ? 'checked' : ''}> Publicada (visible para los alumnos)</label>`,
  async ov => {
    const titulo = val(ov, '#ct-c-titulo');
    if (!titulo) throw fallo('Escribe el título de la clase.');
    const campos = { titulo, descripcion: val(ov, '#ct-c-desc'), publicado: ov.querySelector('#ct-c-pub').checked };
    if (prog === 'comun') {
      const fuera = {};
      ov.querySelectorAll('.ct-c-prog').forEach(x => { if (!x.checked) fuera[x.dataset.p] = true; });
      campos.excluirDe = Object.keys(fuera).length ? fuera : null;
    }
    campos.duracionMin = Number(val(ov, '#ct-c-dur')) > 0 ? Math.round(Number(val(ov, '#ct-c-dur'))) : null;
    const codigo = ov.querySelector('#ct-c-embed').value.trim();
    // Si se cambia el video y la duración no se tocó a mano, se vuelve a medir sola.
    if (codigo && c && Number(c.duracionMin) > 0 && campos.duracionMin === Number(c.duracionMin)) {
      campos.duracionMin = null;
      duracionIntentada.delete(cid);
    }
    if (codigo) {
      const v = parsearEmbedVturb(codigo);
      if (!v) throw fallo('No pude leer el código de Vturb. Copia el código JS completo (con <vturb-smartplayer> y el script de converteai.net).');
      campos.vturb = v;
    }
    const base = `contenidos/${prog}/${mid}/clases/${claseId}`;
    await aplicarPortada(portada, portadaActual, `contenidos-portadas/${prog}/${claseId}`, campos);
    // Sube los PDF nuevos y registra los que quedan.
    for (const n of nuevos) {
      if (!materiales[n.clave]) continue;
      const ruta = `contenidos-materiales/${prog}/${claseId}/${Date.now()}_${n.archivo.name.replace(/[^\w.\-]+/g, '_')}`;
      const sref = storageRef(storage, ruta);
      await uploadBytes(sref, n.archivo, { contentType: 'application/pdf' });
      materiales[n.clave] = { nombre: n.archivo.name, url: await getDownloadURL(sref), ruta };
    }
    campos.materiales = Object.keys(materiales).length ? materiales : null;
    if (cid) await update(ref(db, base), campos);
    else await set(ref(db, base), { ...campos, orden: siguienteOrden(estado.datos[mid].clases) });
    for (const ruta of quitados) await borrarArchivoSiLibre(ruta, 0);
  });

  portada = activarPortada(ov);
  const pintarMats = () => {
    ov.querySelector('#ct-c-mats').innerHTML = Object.entries(materiales).map(([k, mt]) =>
      `<div style="display:flex; justify-content:space-between; gap:8px; font-size:13px; padding:4px 0;"><span>📄 ${escaparHtml(mt.nombre || 'PDF')}</span><button type="button" class="ct-icono" data-quitar="${k}" title="Quitar">✕</button></div>`).join('')
      || '<p class="text-soft" style="font-size:12.5px; margin:0;">Sin materiales.</p>';
    ov.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.quitar;
      if (materiales[k] && materiales[k].ruta) quitados.push(materiales[k].ruta);
      delete materiales[k];
      pintarMats();
    }));
  };
  pintarMats();
  const input = ov.querySelector('#ct-c-file');
  ov.querySelector('#ct-c-addmat').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (f.type !== 'application/pdf') return alert('Solo se pueden subir archivos PDF.');
    if (f.size > TAMANO_MAXIMO_PDF) return alert('El PDF pesa más de 25 MB.');
    const clave = `nuevo${Date.now()}`;
    nuevos.push({ clave, archivo: f });
    materiales[clave] = { nombre: f.name };
    pintarMats();
  });
}

// Arrastrar y soltar: deja `idArrastrado` antes o después de `idDestino` entre sus hermanos.
async function reordenarArrastrando(tipo, mid, idArrastrado, idDestino, despues) {
  const hermanos = tipo === 'mod' ? ordenar(estado.datos).filter(([, x]) => x._origen === origenDe(mid)) : clasesDe(estado.datos[mid]);
  const lista = hermanos.map(([id]) => id).filter(id => id !== idArrastrado);
  const i = lista.indexOf(idDestino);
  if (i < 0 || !hermanos.some(([id]) => id === idArrastrado)) return;
  lista.splice(despues ? i + 1 : i, 0, idArrastrado);
  const base = tipo === 'mod' ? `contenidos/${origenDe(mid)}` : `contenidos/${origenDe(mid)}/${mid}/clases`;
  const cambios = {};
  lista.forEach((id, k) => { cambios[`${id}/orden`] = k + 1; });
  await update(ref(db, base), cambios);
  await recargarDatos();
  pintar();
}

async function mover(tipo, mid, cid, delta) {
  const hermanos = tipo === 'mod' ? ordenar(estado.datos).filter(([, x]) => x._origen === origenDe(mid)) : clasesDe(estado.datos[mid]);
  const idActual = tipo === 'mod' ? mid : cid;
  const i = hermanos.findIndex(([id]) => id === idActual);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= hermanos.length) return;
  [hermanos[i], hermanos[j]] = [hermanos[j], hermanos[i]];
  const base = tipo === 'mod' ? `contenidos/${origenDe(mid)}` : `contenidos/${origenDe(mid)}/${mid}/clases`;
  const cambios = {};
  hermanos.forEach(([id], k) => { cambios[`${id}/orden`] = k + 1; });
  await update(ref(db, base), cambios);
  await recargarDatos();
  pintar();
}

async function borrar(tipo, mid, cid) {
  const nombre = tipo === 'mod' ? estado.datos[mid].titulo : estado.datos[mid].clases[cid].titulo;
  const extra = tipo === 'mod' ? ' y todas sus clases' : '';
  if (!confirm(`¿Borrar "${nombre}"${extra}? No se puede deshacer.`)) return;
  await borrarUno(tipo, mid, cid);
  if (tipo === 'mod') irAlTablero();
  else if (estado.claseId === cid) { estado.vista = 'modulo'; estado.claseId = null; }
  await recargarDatos();
  pintar();
}

async function borrarUno(tipo, mid, cid, conservarDatos = false) {
  const clases = tipo === 'mod' ? Object.values(estado.datos[mid].clases || {}) : [estado.datos[mid].clases[cid]];
  const rutas = tipo === 'mod' && estado.datos[mid].portadaRuta ? [estado.datos[mid].portadaRuta] : [];
  for (const c of clases) {
    if (c.portadaRuta) rutas.push(c.portadaRuta);
    for (const mt of Object.values(c.materiales || {})) if (mt && mt.ruta) rutas.push(mt.ruta);
  }
  const idsClases = tipo === 'mod' ? Object.keys(estado.datos[mid].clases || {}) : [cid];
  for (const id of conservarDatos ? [] : idsClases) {
    try { await remove(ref(db, `comentariosClases/${id}`)); } catch (e) { /* sin comentarios */ }
    try { await remove(ref(db, `valoracionesClases/${id}`)); } catch (e) { /* sin valoraciones */ }
  }
  const prog = origenDe(mid);
  await remove(ref(db, tipo === 'mod' ? `contenidos/${prog}/${mid}` : `contenidos/${prog}/${mid}/clases/${cid}`));
  for (const ruta of rutas) await borrarArchivoSiLibre(ruta, 0);   // después de quitarlo, por si una copia usa el mismo archivo
}

/* ---------- Editar / Replicar: acciones masivas sobre módulos o lecciones ---------- */

function seleccionables() {
  const modulos = visibles();
  if (estado.vista === 'modulos') return { tipo: 'mod', mid: null, ids: modulos.filter(([, m]) => puedeEditar(m)).map(([id]) => id) };
  const a = modulos.find(([id]) => id === estado.moduloId);
  return { tipo: 'cla', mid: estado.moduloId, ids: a && puedeEditar(a[1]) ? clasesDe(a[1]).map(([id]) => id) : [] };
}

function barraMasiva() {
  const { ids } = seleccionables();
  const n = estado.seleccion.size;
  const dis = n ? '' : ' disabled';
  const todos = ids.length > 0 && ids.every(id => estado.seleccion.has(id));
  const destinos = ['open', 'begin', 'next', 'exit'].filter(p => p !== estado.programa)
    .map(p => '<button type="button" class="btn btn--ghost" data-act="masiva" data-a="enviar:' + p + '"' + dis + '>Enviar a ' + escaparHtml(programaLabel(p)) + '</button>').join('');
  const base = estado.programa !== 'comun' ? '<button type="button" class="btn btn--ghost" data-act="masiva" data-a="enviar:comun"' + dis + '>Enviar a todos (Base)</button>' : '';
  return '<div class="ct-masiva">' +
    '<label class="ct-masiva__todos"><input type="checkbox" data-act="sel-todos" ' + (todos ? 'checked' : '') + '> Todos</label>' +
    '<span class="ct-masiva__n">' + n + ' seleccionado' + (n === 1 ? '' : 's') + '</span>' +
    '<button type="button" class="btn btn--ghost" data-act="masiva" data-a="eliminar"' + dis + '>Eliminar</button>' +
    '<button type="button" class="btn btn--ghost" data-act="masiva" data-a="ocultar"' + dis + '>Ocultar</button>' +
    '<button type="button" class="btn btn--ghost" data-act="masiva" data-a="publicar"' + dis + '>Publicar</button>' +
    destinos + base + '</div>';
}

const botonModoSeleccion = () => '<button type="button" class="btn btn--ghost" data-act="sel-modo">' + (estado.modoSeleccion ? '✕ Terminar' : '☑ Editar / Replicar') + '</button>';

function alternarSeleccion(id) {
  const { ids } = seleccionables();
  if (!ids.includes(id)) return;
  if (estado.seleccion.has(id)) estado.seleccion.delete(id); else estado.seleccion.add(id);
  pintar();
}

function copiaLimpia(obj, paraBase) {
  const c = JSON.parse(JSON.stringify(obj));
  delete c._origen; delete c.orden;
  if (!paraBase) delete c.excluirDe;
  return c;
}

// Copia módulos o lecciones al programa destino (los archivos se comparten; el avance y los comentarios empiezan de cero).
// conservarIds (al mover a la Base): las lecciones mantienen su id, así sus comentarios, estrellas y avance siguen ahí.
async function enviarA(destino, tipo, mid, ids, conservarIds = false) {
  const snap = await get(ref(db, 'contenidos/' + destino));
  const dest = snap.exists() ? snap.val() : {};
  const cambios = {};
  const base = 'contenidos/' + destino;
  const paraBase = destino === 'comun';
  const clasesCopia = clases => {
    const out = {};
    let k = 0;
    clasesDe({ clases }).forEach(([cid, c]) => { out[conservarIds ? cid : push(ref(db, base)).key] = { ...copiaLimpia(c, paraBase), orden: ++k }; });
    return out;
  };
  if (tipo === 'mod') {
    let orden = siguienteOrden(dest);
    for (const id of ids) {
      const m = estado.datos[id];
      const { clases, ...resto } = copiaLimpia(m, paraBase);
      cambios[push(ref(db, base)).key] = { ...resto, orden: orden++, ...(clases ? { clases: clasesCopia(m.clases) } : {}) };
    }
  } else {
    const origen = estado.datos[mid];
    const titulo = String(origen.titulo || '').trim().toLowerCase();
    let destMid = Object.keys(dest).find(k => dest[k] && String(dest[k].titulo || '').trim().toLowerCase() === titulo);
    if (!destMid) {
      destMid = push(ref(db, base)).key;
      const { clases, ...resto } = copiaLimpia(origen, paraBase);
      cambios[destMid] = { ...resto, orden: siguienteOrden(dest) };
    }
    let orden = siguienteOrden(dest[destMid] && dest[destMid].clases);
    for (const id of ids) {
      const nueva = conservarIds ? id : push(ref(db, base)).key;
      cambios[destMid + '/clases/' + nueva] = { ...copiaLimpia(origen.clases[id], paraBase), orden: orden++ };
    }
  }
  await update(ref(db, base), cambios);
}

async function accionMasiva(a) {
  const { tipo, mid } = seleccionables();
  let ids = [...estado.seleccion];
  // Lo que ya es de la Base común no se "envía a la Base" (se borraría el original).
  if (a === 'enviar:comun') ids = ids.filter(id => origenDe(tipo === 'mod' ? id : mid) !== 'comun');
  if (!ids.length) { if (a === 'enviar:comun') alert('Eso ya está en la Base común.'); return; }
  const n = ids.length;
  const que = tipo === 'mod' ? (n === 1 ? 'módulo' : 'módulos') : (n === 1 ? 'lección' : 'lecciones');
  const rutaDe = id => tipo === 'mod' ? id : mid + '/clases/' + id;
  if (a === 'eliminar') {
    if (!confirm('¿Eliminar ' + n + ' ' + que + (tipo === 'mod' ? ' con todas sus lecciones' : '') + '? No se puede deshacer.')) return;
    for (const id of ids) await borrarUno(tipo, tipo === 'mod' ? id : mid, tipo === 'mod' ? null : id);
  } else if (a === 'ocultar' || a === 'publicar') {
    const porOrigen = {};
    ids.forEach(id => {
      const o = origenDe(tipo === 'mod' ? id : mid);
      (porOrigen[o] = porOrigen[o] || {})[rutaDe(id) + '/publicado'] = a === 'publicar';
    });
    for (const [o, cambios] of Object.entries(porOrigen)) await update(ref(db, 'contenidos/' + o), cambios);
  } else if (a.startsWith('enviar:')) {
    const destino = a.slice(7);
    const nombreDestino = destino === 'comun' ? 'todos los programas (Base común)' : programaLabel(destino);
    const mover = destino === 'comun';
    if (!confirm('¿Enviar ' + n + ' ' + que + ' a ' + nombreDestino + '?' + (mover ? ' Se mueven a la Base común y conservan sus comentarios, estrellas y avance.' : ' Se copian (los originales se quedan donde están).'))) return;
    await enviarA(destino, tipo, mid, ids, mover);
    if (mover) for (const id of ids) await borrarUno(tipo, tipo === 'mod' ? id : mid, tipo === 'mod' ? null : id, true);
    alert('Listo: ' + n + ' ' + que + ' enviado' + (n === 1 ? '' : 's') + ' a ' + nombreDestino + '.');
  }
  estado.seleccion.clear();
  await recargarDatos();
  pintar();
}

/* ---------- Eventos ---------- */

const contEl = el('contenidos-contenido');
if (contEl) {
  contEl.addEventListener('click', async ev => {
    const tab = ev.target.closest('.ct-tab');
    if (tab) { estado.programa = tab.dataset.programa; irAlTablero(); await recargarDatos(); pintar(); return; }
    if (ev.target.closest('#ct-nuevo-modulo')) { editarModulo(null); return; }
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    ev.preventDefault();
    ev.stopPropagation();
    const { act, m, c } = b.dataset;
    try {
      if (estado.modoSeleccion && (act === 'ir-modulo' || act === 'abrir' || act === 'bloqueado')) { alternarSeleccion(act === 'abrir' ? c : m); return; }
      if (act === 'sel-modo') { estado.modoSeleccion = !estado.modoSeleccion; estado.seleccion.clear(); pintar(); return; }
      if (act === 'sel-todos') { const { ids } = seleccionables(); if (ids.every(id => estado.seleccion.has(id))) estado.seleccion.clear(); else ids.forEach(id => estado.seleccion.add(id)); pintar(); return; }
      if (act === 'masiva') { b.disabled = true; try { await accionMasiva(b.dataset.a); } finally { b.disabled = false; } return; }
      if (act === 'abrir') { if (c) irA('leccion', m, c); }
      else if (act === 'ir-modulo') irA('modulo', m);
      else if (act === 'volver-modulos') irA('modulos');
      else if (act === 'volver-modulo') irA('modulo', m);
      else if (act === 'bloqueado') alert(`Este módulo se desbloquea cuando llegues a la ${b.dataset.fase || 'fase indicada'}.`);
      else if (act === 'concluir') await alternarVista(c, b);
      else if (act === 'tab') {
        contEl.querySelectorAll('.ct-lado__tab').forEach(x => x.classList.toggle('is-active', x === b));
        contEl.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.t));
      }
      else if (act === 'mod-editar') editarModulo(m);
      else if (act === 'mod-arriba') await mover('mod', m, null, -1);
      else if (act === 'mod-abajo') await mover('mod', m, null, 1);
      else if (act === 'mod-borrar') await borrar('mod', m);
      else if (act === 'cla-nueva') editarClase(m, null);
      else if (act === 'cla-editar') editarClase(m, c);
      else if (act === 'cla-arriba') await mover('cla', m, c, -1);
      else if (act === 'cla-abajo') await mover('cla', m, c, 1);
      else if (act === 'cla-borrar') await borrar('cla', m, c);
      else if (act === 'com-enviar') await enviarComentario(c, el('ct-comentario-texto'), b, null);
      else if (act === 'com-borrar') await borrarComentario(c, b.dataset.k);
      else if (act === 'com-responder') {
        const f = contEl.querySelector(`.ct-com__form[data-form="${CSS.escape(b.dataset.k)}"]`);
        if (f) { f.classList.toggle('hidden'); if (!f.classList.contains('hidden')) f.querySelector('textarea').focus(); }
      }
      else if (act === 'com-resp-enviar') await enviarComentario(c, b.closest('.ct-com__form').querySelector('textarea'), b, b.dataset.k);
      else if (act === 'favorito') await alternarFavorito(c, b);
      else if (act === 'valorar') await valorar(c, Number(b.dataset.n));
    } catch (err) {
      console.error(err);
      alert('No se pudo completar la acción. Intenta de nuevo.' + (err && (err.code || err.message) ? ' (' + (err.code || err.message) + ')' : ''));
    }
  });
}

// Arrastrar módulos (entre los de su mismo grupo) y lecciones (dentro de su módulo).
let arrastre = null;
const itemArrastrable = ev => ev.target.closest && ev.target.closest('[draggable="true"][data-act]');
const infoItem = it => it.dataset.act === 'ir-modulo' || it.dataset.act === 'bloqueado'
  ? { tipo: 'mod', id: it.dataset.m, mid: it.dataset.m } : { tipo: 'cla', id: it.dataset.c, mid: it.dataset.m };
const compatible = (a, b) => a.tipo === b.tipo && a.id !== b.id && (a.tipo === 'mod' ? origenDe(a.id) === origenDe(b.id) : a.mid === b.mid);
const despuesDe = (ev, it, tipo) => {
  const r = it.getBoundingClientRect();
  return tipo === 'mod' ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
};
const limpiarMarcas = () => contEl && contEl.querySelectorAll('.ct-drop-antes, .ct-drop-despues, .is-arrastrando').forEach(x => x.classList.remove('ct-drop-antes', 'ct-drop-despues', 'is-arrastrando'));
if (contEl) {
  contEl.addEventListener('dragstart', ev => {
    const it = itemArrastrable(ev);
    if (!it || !estado.esDirector || estado.modoSeleccion) return;
    arrastre = infoItem(it);
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', arrastre.id); } catch (e) { /* sin datos */ }
    it.classList.add('is-arrastrando');
  });
  contEl.addEventListener('dragover', ev => {
    const it = itemArrastrable(ev);
    if (!arrastre || !it || !compatible(arrastre, infoItem(it))) return;
    ev.preventDefault();
    const despues = despuesDe(ev, it, arrastre.tipo);
    contEl.querySelectorAll('.ct-drop-antes, .ct-drop-despues').forEach(x => x.classList.remove('ct-drop-antes', 'ct-drop-despues'));
    it.classList.add(despues ? 'ct-drop-despues' : 'ct-drop-antes');
  });
  contEl.addEventListener('drop', async ev => {
    const it = itemArrastrable(ev);
    const a = arrastre;
    arrastre = null;
    if (!a || !it || !compatible(a, infoItem(it))) { limpiarMarcas(); return; }
    ev.preventDefault();
    const destino = infoItem(it);
    const despues = despuesDe(ev, it, a.tipo);
    limpiarMarcas();
    try { await reordenarArrastrando(a.tipo, a.mid, a.id, destino.id, despues); }
    catch (err) { console.error(err); alert('No se pudo cambiar el orden. Intenta de nuevo.'); }
  });
  contEl.addEventListener('dragend', () => { arrastre = null; limpiarMarcas(); });
}

// Enter publica el comentario (Shift+Enter hace un salto de línea).
if (contEl) {
  contEl.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.shiftKey && ev.target && ev.target.id === 'ct-comentario-texto') {
      ev.preventDefault();
      const enviar = contEl.querySelector('[data-act="com-enviar"]');
      if (enviar) enviar.click();
    }
  });
}

document.querySelectorAll('.nav-item[data-nav="contenidos"]').forEach(item => {
  item.addEventListener('click', cargarContenidos);
});
