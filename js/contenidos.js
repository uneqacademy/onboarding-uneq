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
import { ref, get, set, push, update, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getCurrentRole } from './main.js';
import { programaLabel } from './ciclos.js';
import { faseMaximaChecklist } from './hitos.js';

const PROGRAMAS_CONTENIDO = ['open', 'begin', 'next', 'exit'];
const TAMANO_MAXIMO_PDF = 25 * 1024 * 1024;
const TEXTOS_FASE = { 0: 'Desde el inicio', 1: 'Fase 1', 2: 'Fase 2', 3: 'Fase 3', 4: 'Fase 4' };

const estado = {
  programa: null,
  datos: {},          // { moduloId: { titulo, ..., clases: { claseId: {...} } } }
  progreso: {},       // { claseId: timestamp }
  alumnoId: null,
  faseMax: 0,
  esDirector: false,
  claseAbierta: null  // { moduloId, claseId }
};
let cargaActual = 0;
let scriptsPlayer = [];

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
}

/* ---------- Datos ---------- */

function ordenar(obj) {
  return Object.entries(obj || {})
    .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0) || a[0].localeCompare(b[0]));
}
const clasesDe = modulo => ordenar(modulo.clases);

async function resolverAlumno() {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  estado.alumnoId = null; estado.faseMax = 0; estado.progreso = {};
  if (!uid) return null;
  const mapa = await get(ref(db, `alumnoPorAuthUid/${uid}`));
  if (!mapa.exists()) return null;
  estado.alumnoId = mapa.val();
  const alumno = await get(ref(db, `alumnos/${estado.alumnoId}`));
  const cicloId = alumno.exists() ? alumno.val().cicloActualId : null;
  if (!cicloId) return null;
  const ciclo = await get(ref(db, `ciclos/${cicloId}`));
  if (!ciclo.exists()) return null;
  estado.faseMax = faseMaximaChecklist(ciclo.val());
  const prog = await get(ref(db, `progresoClases/${estado.alumnoId}`));
  estado.progreso = prog.exists() ? prog.val() : {};
  return ciclo.val().programa || null;
}

export async function cargarContenidos() {
  const role = getCurrentRole();
  const cont = el('contenidos-contenido');
  if (!cont || !['alumno', 'director'].includes(role)) return;
  const id = ++cargaActual;
  estado.esDirector = role === 'director';
  estado.claseAbierta = null;
  cont.innerHTML = '<p class="text-soft">Cargando...</p>';
  try {
    if (estado.esDirector) {
      if (!estado.programa) estado.programa = 'begin';
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
  const snap = await get(ref(db, `contenidos/${estado.programa}`));
  estado.datos = snap.exists() ? snap.val() : {};
}

/* ---------- Pintado ---------- */

function moduloBloqueado(m) {
  return !estado.esDirector && (Number(m.desdeFase) || 0) > estado.faseMax;
}
function visibles() {
  // Para el alumno: solo módulos y clases publicados.
  return ordenar(estado.datos)
    .filter(([, m]) => estado.esDirector || m.publicado !== false)
    .map(([id, m]) => [id, {
      ...m,
      clases: Object.fromEntries(clasesDe(m).filter(([, c]) => estado.esDirector || c.publicado !== false))
    }]);
}

function pintar() {
  const cont = el('contenidos-contenido');
  const modulos = visibles();
  const abiertos = new Set([...cont.querySelectorAll('details.ct-modulo[open]')].map(d => d.dataset.modulo));
  const primeraVez = !cont.querySelector('.ct-modulos');

  let total = 0, vistas = 0;
  modulos.forEach(([, m]) => {
    if (moduloBloqueado(m)) return;
    clasesDe(m).forEach(([cid]) => { total++; if (estado.progreso[cid]) vistas++; });
  });
  const pct = total ? Math.round(vistas * 100 / total) : 0;

  const tabs = estado.esDirector ? `<div class="ct-tabs">${PROGRAMAS_CONTENIDO.map(p =>
    `<button type="button" class="ct-tab${p === estado.programa ? ' is-active' : ''}" data-programa="${p}">${escaparHtml(programaLabel(p))}</button>`).join('')}</div>` : '';

  const progreso = !estado.esDirector ? `
    <div class="ct-progreso">
      <div class="ct-progreso__texto"><strong>${vistas}</strong> de <strong>${total}</strong> clases vistas · ${pct}%</div>
      <div class="ct-barra"><span style="width:${pct}%"></span></div>
    </div>` : `<div class="ct-admin-barra"><button type="button" class="btn btn--primary" id="ct-nuevo-modulo">+ Nuevo módulo</button></div>`;

  const listaHtml = modulos.length ? modulos.map(([mid, m], i) => htmlModulo(mid, m, i, modulos.length, primeraVez || abiertos.has(mid))).join('')
    : `<div class="panel"><div class="panel__body"><p class="text-soft" style="margin:0;">${estado.esDirector ? 'Este programa aún no tiene módulos. Crea el primero con “+ Nuevo módulo”.' : 'Pronto verás aquí las clases de tu programa.'}</p></div></div>`;

  cont.innerHTML = `${tabs}${progreso}
    <div class="panel ct-visor hidden" id="ct-visor"></div>
    <div class="ct-modulos">${listaHtml}</div>`;
  if (estado.claseAbierta) abrirClase(estado.claseAbierta.moduloId, estado.claseAbierta.claseId, false);
}

function htmlModulo(mid, m, i, n, abierto) {
  const bloqueado = moduloBloqueado(m);
  const clases = clasesDe(m);
  const vistasM = clases.filter(([cid]) => estado.progreso[cid]).length;
  const borrador = m.publicado === false ? '<span class="ct-etq ct-etq--borrador">Borrador</span>' : '';
  const fase = estado.esDirector && (Number(m.desdeFase) || 0) > 0 ? `<span class="ct-etq">${TEXTOS_FASE[m.desdeFase]}</span>` : '';
  const admin = estado.esDirector ? `
    <span class="ct-acciones" data-stop>
      <button type="button" class="ct-icono" data-act="mod-arriba" data-m="${mid}" ${i === 0 ? 'disabled' : ''} title="Subir">▲</button>
      <button type="button" class="ct-icono" data-act="mod-abajo" data-m="${mid}" ${i === n - 1 ? 'disabled' : ''} title="Bajar">▼</button>
      <button type="button" class="ct-icono" data-act="mod-editar" data-m="${mid}" title="Editar módulo">✏️</button>
      <button type="button" class="ct-icono" data-act="mod-borrar" data-m="${mid}" title="Borrar módulo">🗑️</button>
    </span>` : '';

  let cuerpo;
  if (bloqueado) {
    cuerpo = `<p class="ct-bloqueado">🔒 Este módulo se desbloquea cuando llegues a la <strong>${escaparHtml(TEXTOS_FASE[m.desdeFase] || '')}</strong>.</p>`;
  } else {
    cuerpo = `${m.descripcion ? `<p class="text-soft ct-desc-mod">${textoMultilinea(m.descripcion)}</p>` : ''}
      <ul class="ct-clases">${clases.map(([cid, c], j) => `
        <li class="ct-clase" data-clase="${cid}" data-m="${mid}">
          <button type="button" class="ct-clase__abrir" data-act="abrir" data-m="${mid}" data-c="${cid}">
            <span class="ct-check${estado.progreso[cid] ? ' is-vista' : ''}">${estado.progreso[cid] ? '✓' : ''}</span>
            <span class="ct-clase__titulo">${escaparHtml(c.titulo || 'Clase sin título')}</span>
            ${c.publicado === false ? '<span class="ct-etq ct-etq--borrador">Borrador</span>' : ''}
            ${(c.materiales && Object.keys(c.materiales).length) ? '<span class="ct-clip" title="Tiene material">📎</span>' : ''}
          </button>
          ${estado.esDirector ? `<span class="ct-acciones">
            <button type="button" class="ct-icono" data-act="cla-arriba" data-m="${mid}" data-c="${cid}" ${j === 0 ? 'disabled' : ''} title="Subir">▲</button>
            <button type="button" class="ct-icono" data-act="cla-abajo" data-m="${mid}" data-c="${cid}" ${j === clases.length - 1 ? 'disabled' : ''} title="Bajar">▼</button>
            <button type="button" class="ct-icono" data-act="cla-editar" data-m="${mid}" data-c="${cid}" title="Editar clase">✏️</button>
            <button type="button" class="ct-icono" data-act="cla-borrar" data-m="${mid}" data-c="${cid}" title="Borrar clase">🗑️</button>
          </span>` : ''}
        </li>`).join('')}</ul>
      ${!clases.length && !estado.esDirector ? '<p class="text-soft" style="margin:0;">Aún no hay clases en este módulo.</p>' : ''}
      ${estado.esDirector ? `<button type="button" class="btn btn--ghost ct-nueva-clase" data-act="cla-nueva" data-m="${mid}">+ Nueva clase</button>` : ''}`;
  }
  return `
    <details class="panel ct-modulo${bloqueado ? ' is-bloqueado' : ''}" data-modulo="${mid}" ${abierto ? 'open' : ''}>
      <summary class="ct-modulo__cab">
        <span class="ct-modulo__num">${i + 1}</span>
        <span class="ct-modulo__titulo">${escaparHtml(m.titulo || 'Módulo sin título')}</span>
        ${borrador}${fase}
        ${bloqueado ? '<span class="ct-etq">🔒</span>' : `<span class="ct-modulo__cuenta">${estado.esDirector ? clases.length : vistasM}/${clases.length}</span>`}
        ${admin}
      </summary>
      <div class="panel__body">${cuerpo}</div>
    </details>`;
}

/* ---------- Visor de clase ---------- */

function abrirClase(mid, cid, desplazar = true) {
  const modulo = estado.datos[mid];
  const clase = modulo && modulo.clases && modulo.clases[cid];
  const visor = el('ct-visor');
  if (!clase || !visor) return;
  estado.claseAbierta = { moduloId: mid, claseId: cid };
  const lista = visibles().flatMap(([m, mod]) => moduloBloqueado(mod) ? [] : clasesDe(mod).map(([c]) => [m, c]));
  const idx = lista.findIndex(([m, c]) => m === mid && c === cid);
  const ant = idx > 0 ? lista[idx - 1] : null;
  const sig = idx >= 0 && idx < lista.length - 1 ? lista[idx + 1] : null;
  const materiales = Object.entries(clase.materiales || {}).filter(([, mt]) => mt && typeof mt.url === 'string' && mt.url.startsWith('https://'));
  const vista = !!estado.progreso[cid];

  visor.classList.remove('hidden');
  visor.innerHTML = `
    <div class="panel__body">
      <p class="ct-visor__modulo">${escaparHtml(modulo.titulo || '')}</p>
      <h3 class="ct-visor__titulo">${escaparHtml(clase.titulo || '')}</h3>
      <div class="ct-player" id="ct-player"></div>
      ${clase.descripcion ? `<p class="ct-visor__desc">${textoMultilinea(clase.descripcion)}</p>` : ''}
      ${materiales.length ? `<div class="ct-materiales"><p class="ct-materiales__t">Material de la clase</p>${materiales.map(([, mt]) =>
        `<a class="ct-material" href="${escaparHtml(mt.url)}" target="_blank" rel="noopener noreferrer">📄 ${escaparHtml(mt.nombre || 'Material')}</a>`).join('')}</div>` : ''}
      <div class="ct-visor__pie">
        <button type="button" class="btn btn--ghost" id="ct-ant" ${ant ? '' : 'disabled'}>← Anterior</button>
        ${!estado.esDirector ? `<button type="button" class="btn ${vista ? 'btn--ghost' : 'btn--accent'}" id="ct-marcar">${vista ? '✓ Vista (desmarcar)' : 'Marcar como vista'}</button>` : ''}
        <button type="button" class="btn btn--ghost" id="ct-sig" ${sig ? '' : 'disabled'}>Siguiente →</button>
        <button type="button" class="btn btn--ghost" id="ct-cerrar-visor">Cerrar</button>
      </div>
    </div>`;
  montarReproductor(el('ct-player'), clase.vturb);
  if (ant) el('ct-ant').addEventListener('click', () => abrirClase(ant[0], ant[1]));
  if (sig) el('ct-sig').addEventListener('click', () => abrirClase(sig[0], sig[1]));
  el('ct-cerrar-visor').addEventListener('click', cerrarVisor);
  const marcar = el('ct-marcar');
  if (marcar) marcar.addEventListener('click', () => alternarVista(mid, cid, marcar));
  if (desplazar) visor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cerrarVisor() {
  estado.claseAbierta = null;
  scriptsPlayer.forEach(s => s.remove());
  scriptsPlayer = [];
  const visor = el('ct-visor');
  if (visor) { visor.classList.add('hidden'); visor.innerHTML = ''; }
}

async function alternarVista(mid, cid, boton) {
  if (!estado.alumnoId) return;
  boton.disabled = true;
  try {
    const nueva = estado.progreso[cid] ? null : Date.now();
    await set(ref(db, `progresoClases/${estado.alumnoId}/${cid}`), nueva);
    if (nueva) estado.progreso[cid] = nueva; else delete estado.progreso[cid];
    pintar();
  } catch (err) {
    console.error('No se pudo guardar el progreso:', err);
    alert('No se pudo guardar. Intenta de nuevo.');
    boton.disabled = false;
  }
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
      err.textContent = e.mensaje || 'No se pudo guardar. Intenta de nuevo.';
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

function editarModulo(mid) {
  const m = mid ? estado.datos[mid] : null;
  const opcionesFase = Object.entries(TEXTOS_FASE).map(([k, t]) =>
    `<option value="${k}" ${(Number(m && m.desdeFase) || 0) === Number(k) ? 'selected' : ''}>${t}</option>`).join('');
  modal(m ? 'Editar módulo' : 'Nuevo módulo', `
    <div class="field mb-16"><label>Título</label><input id="ct-m-titulo" maxlength="120" value="${escaparHtml(m ? m.titulo : '')}"></div>
    <div class="field mb-16"><label>Descripción (opcional)</label><textarea id="ct-m-desc" maxlength="600">${escaparHtml(m ? m.descripcion || '' : '')}</textarea></div>
    <div class="field mb-16"><label>Se desbloquea para el alumno</label><select id="ct-m-fase">${opcionesFase}</select></div>
    <label style="display:flex; gap:8px; align-items:center; font-size:13.5px;"><input type="checkbox" id="ct-m-pub" ${!m || m.publicado !== false ? 'checked' : ''}> Publicado (visible para los alumnos)</label>`,
  async ov => {
    const titulo = val(ov, '#ct-m-titulo');
    if (!titulo) throw fallo('Escribe el título del módulo.');
    const campos = { titulo, descripcion: val(ov, '#ct-m-desc'), desdeFase: Number(ov.querySelector('#ct-m-fase').value), publicado: ov.querySelector('#ct-m-pub').checked };
    if (mid) await update(ref(db, `contenidos/${estado.programa}/${mid}`), campos);
    else await set(push(ref(db, `contenidos/${estado.programa}`)), { ...campos, orden: siguienteOrden(estado.datos) });
  });
}

function editarClase(mid, cid) {
  const c = cid ? estado.datos[mid].clases[cid] : null;
  let materiales = { ...(c && c.materiales ? c.materiales : {}) };
  const quitados = [];
  const nuevos = [];
  const ov = modal(c ? 'Editar clase' : 'Nueva clase', `
    <div class="field mb-16"><label>Título</label><input id="ct-c-titulo" maxlength="140" value="${escaparHtml(c ? c.titulo : '')}"></div>
    <div class="field mb-16"><label>Descripción (opcional)</label><textarea id="ct-c-desc" maxlength="2000">${escaparHtml(c ? c.descripcion || '' : '')}</textarea></div>
    <div class="field mb-16"><label>Código de inserción de Vturb</label>
      <textarea id="ct-c-embed" placeholder="Pega aquí el código JS del video (botón &lt;/&gt; en Vturb)" style="min-height:90px; font-family:monospace; font-size:12px;"></textarea>
      <p class="text-soft" style="font-size:12px; margin:4px 0 0;">${c && c.vturb ? '✓ Ya tiene un video. Pega un código nuevo solo si quieres cambiarlo.' : 'Debe incluir la etiqueta vturb-smartplayer y el script de converteai.net.'}</p></div>
    <div class="field mb-16"><label>Materiales (PDF)</label><div id="ct-c-mats"></div>
      <button type="button" class="btn btn--ghost" id="ct-c-addmat" style="font-size:12px; margin-top:6px;">+ Agregar PDF</button>
      <input type="file" id="ct-c-file" accept="application/pdf,.pdf" class="hidden"></div>
    <label style="display:flex; gap:8px; align-items:center; font-size:13.5px;"><input type="checkbox" id="ct-c-pub" ${!c || c.publicado !== false ? 'checked' : ''}> Publicada (visible para los alumnos)</label>`,
  async ov => {
    const titulo = val(ov, '#ct-c-titulo');
    if (!titulo) throw fallo('Escribe el título de la clase.');
    const campos = { titulo, descripcion: val(ov, '#ct-c-desc'), publicado: ov.querySelector('#ct-c-pub').checked };
    const codigo = ov.querySelector('#ct-c-embed').value.trim();
    if (codigo) {
      const v = parsearEmbedVturb(codigo);
      if (!v) throw fallo('No pude leer el código de Vturb. Copia el código JS completo (con <vturb-smartplayer> y el script de converteai.net).');
      campos.vturb = v;
    }
    const claseId = cid || push(ref(db, `contenidos/${estado.programa}/${mid}/clases`)).key;
    const base = `contenidos/${estado.programa}/${mid}/clases/${claseId}`;
    // Sube los PDF nuevos y registra los que quedan.
    for (const n of nuevos) {
      if (!materiales[n.clave]) continue;
      const ruta = `contenidos-materiales/${estado.programa}/${claseId}/${Date.now()}_${n.archivo.name.replace(/[^\w.\-]+/g, '_')}`;
      const sref = storageRef(storage, ruta);
      await uploadBytes(sref, n.archivo, { contentType: 'application/pdf' });
      materiales[n.clave] = { nombre: n.archivo.name, url: await getDownloadURL(sref), ruta };
    }
    campos.materiales = Object.keys(materiales).length ? materiales : null;
    if (cid) await update(ref(db, base), campos);
    else await set(ref(db, base), { ...campos, orden: siguienteOrden(estado.datos[mid].clases) });
    for (const ruta of quitados) { try { await deleteObject(storageRef(storage, ruta)); } catch (e) { /* ya no estaba */ } }
  });

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

async function mover(tipo, mid, cid, delta) {
  const hermanos = tipo === 'mod' ? ordenar(estado.datos) : clasesDe(estado.datos[mid]);
  const idActual = tipo === 'mod' ? mid : cid;
  const i = hermanos.findIndex(([id]) => id === idActual);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= hermanos.length) return;
  [hermanos[i], hermanos[j]] = [hermanos[j], hermanos[i]];
  const base = tipo === 'mod' ? `contenidos/${estado.programa}` : `contenidos/${estado.programa}/${mid}/clases`;
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
  const clases = tipo === 'mod' ? Object.values(estado.datos[mid].clases || {}) : [estado.datos[mid].clases[cid]];
  for (const c of clases) {
    for (const mt of Object.values(c.materiales || {})) {
      if (mt && mt.ruta) { try { await deleteObject(storageRef(storage, mt.ruta)); } catch (e) { /* ya no estaba */ } }
    }
  }
  await remove(ref(db, tipo === 'mod' ? `contenidos/${estado.programa}/${mid}` : `contenidos/${estado.programa}/${mid}/clases/${cid}`));
  if (estado.claseAbierta && (tipo === 'mod' || estado.claseAbierta.claseId === cid)) cerrarVisor();
  await recargarDatos();
  pintar();
}

/* ---------- Eventos ---------- */

const contEl = el('contenidos-contenido');
if (contEl) {
  contEl.addEventListener('click', async ev => {
    const tab = ev.target.closest('.ct-tab');
    if (tab) { estado.programa = tab.dataset.programa; cerrarVisor(); await recargarDatos(); pintar(); return; }
    if (ev.target.closest('#ct-nuevo-modulo')) { editarModulo(null); return; }
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    ev.preventDefault();
    ev.stopPropagation();
    const { act, m, c } = b.dataset;
    try {
      if (act === 'abrir') abrirClase(m, c);
      else if (act === 'mod-editar') editarModulo(m);
      else if (act === 'mod-arriba') await mover('mod', m, null, -1);
      else if (act === 'mod-abajo') await mover('mod', m, null, 1);
      else if (act === 'mod-borrar') await borrar('mod', m);
      else if (act === 'cla-nueva') editarClase(m, null);
      else if (act === 'cla-editar') editarClase(m, c);
      else if (act === 'cla-arriba') await mover('cla', m, c, -1);
      else if (act === 'cla-abajo') await mover('cla', m, c, 1);
      else if (act === 'cla-borrar') await borrar('cla', m, c);
    } catch (err) {
      console.error(err);
      alert('No se pudo completar la acción. Intenta de nuevo.');
    }
  });
}

document.querySelectorAll('.nav-item[data-nav="contenidos"]').forEach(item => {
  item.addEventListener('click', cargarContenidos);
});
