/* ============================================================
   laboratorio-ia-guia.js — Configuración > Laboratorio IA: guía para la IA (solo Director)
   Aquí el Director Académico le enseña a la IA cómo debe entregar el resultado:
   - GENERAL: el contexto completo del funnel de UNEQ.
   - Por ETAPA (Atracción, Conexión, Encuentro, Venta): teoría y significado,
     estructura técnica (duración, estructura del copy, etc.) y qué evitar.
   - ARCHIVOS por sección: ejemplos en video o audio, PDF, Word, imágenes o texto.
     Se suben a Storage y una función los lee UNA vez con IA y guarda lo que entendió
     (transcripción, estructura, por qué funciona). Cada generación usa ese texto.
   - PROBAR: genera una etapa con una persona de ejemplo, sin guardar nada ni gastar
     el tope de nadie, para ver cómo le está quedando la guía.
   Datos: laboratorioIA/guia/{general|atraccion|conexion|encuentro|venta} (solo Director).
   ============================================================ */

import { db, app, storage } from './firebase-config.js';
import { escaparHtml } from './util-html.js';
import { ref, get, set, update, push, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";
import { getCurrentRole } from './main.js';
import { htmlPiezas, conectarCopiar } from './laboratorio-ia.js';

const functions = getFunctions(app);
const probarEtapa = httpsCallable(functions, 'laboratorioProbarEtapa', { timeout: 175000 });
const esc = escaparHtml;
const cuerpo = () => document.getElementById('labg-cuerpo');

const SCOPES = [
  { id: 'general', nombre: 'General del funnel' },
  { id: 'atraccion', nombre: 'Atracción' },
  { id: 'conexion', nombre: 'Conexión' },
  { id: 'encuentro', nombre: 'Encuentro' },
  { id: 'venta', nombre: 'Venta' }
];
const FORMATOS = [['todos', 'Todos los formatos'], ['reel', 'Reels'], ['carrusel', 'Carruseles'], ['dm', 'DMs'], ['whatsapp', 'WhatsApp']];
const EXT_ACEPTADAS = '.mp4,.mov,.webm,.avi,.mpeg,.mpg,.wmv,.m4v,.3gp,.mp3,.wav,.m4a,.aac,.ogg,.flac,.pdf,.docx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv';
const EXT_MEDIA = ['mp4', 'mov', 'webm', 'avi', 'mpeg', 'mpg', 'wmv', 'm4v', '3gp', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];
const MAX_MEDIA_MB = 200;
const MAX_DOC_MB = 30;

let scopeActual = 'general';
let datos = {};          // laboratorioIA/guia completo
let temporizador = null;

const extension = (n) => String(n || '').toLowerCase().split('.').pop();
function iconoArchivo(nombre) {
  const e = extension(nombre);
  if (['mp4', 'mov', 'webm', 'avi', 'mpeg', 'mpg', 'wmv', 'm4v', '3gp'].includes(e)) return '🎬';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(e)) return '🎧';
  if (e === 'pdf') return '📕';
  if (e === 'docx') return '📘';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(e)) return '🖼️';
  return '📄';
}
function pesoLegible(bytes) {
  if (!bytes) return '';
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function archivosDe(scope) {
  const a = (datos[scope] && datos[scope].archivos) || {};
  return Object.entries(a).map(([id, v]) => ({ id, ...v })).sort((x, y) => (x.creadoEn || 0) - (y.creadoEn || 0));
}

function htmlArchivo(a) {
  const estado = a.estado === 'listo'
    ? '<span class="lab-badge lab-badge--ok">Leído ✓</span>'
    : a.estado === 'error'
      ? '<span class="lab-badge labg-badge-error">No se pudo leer</span>'
      : '<span class="lab-badge lab-badge--pend"><span class="lab-spinner labg-spin"></span> Leyendo…</span>';
  const formato = (FORMATOS.find(f => f[0] === (a.formato || 'todos')) || FORMATOS[0])[1];
  return `
    <div class="labg-archivo" data-id="${esc(a.id)}">
      <div class="labg-archivo__cab">
        <span class="labg-archivo__icono">${iconoArchivo(a.nombre)}</span>
        <div class="labg-archivo__info">
          <strong>${esc(a.nombre)}</strong>
          <span class="text-soft">${esc(pesoLegible(a.tamano))} · ${esc(formato)}${a.nota ? ' · ' + esc(a.nota) : ''}</span>
        </div>
        ${estado}
      </div>
      ${a.estado === 'error' ? `<p class="lab-error">${esc(a.error || 'No se pudo procesar el archivo.')}</p>` : ''}
      ${a.estado === 'listo' ? `<details class="labg-analisis"><summary>Ver lo que entendió la IA</summary><div class="labg-analisis__texto">${esc(a.analisis)}</div></details>` : ''}
      <div class="labg-archivo__acciones">
        ${a.estado !== 'procesando' ? '<button type="button" class="btn btn--ghost labcfg-mini" data-act="releer">Volver a leer</button>' : ''}
        <button type="button" class="btn btn--ghost labcfg-mini" data-act="quitar">Quitar</button>
      </div>
    </div>`;
}

function pintar() {
  const el = cuerpo();
  if (!el) return;
  const s = scopeActual;
  const g = datos[s] || {};
  const esGeneral = s === 'general';
  const nombre = SCOPES.find(x => x.id === s).nombre;
  el.innerHTML = `
    <p class="text-soft mb-16" style="font-size:13px;">Aquí le enseñas a la IA cómo entregar los mejores resultados: el contexto del funnel, la teoría de cada etapa, la estructura técnica y ejemplos reales. Mientras más claro y completo, mejores propuestas recibirán los alumnos. Los archivos los lee la IA una sola vez.</p>
    <div class="labg-tabs">${SCOPES.map(x => `<button type="button" class="labg-tab ${x.id === s ? 'is-activa' : ''}" data-scope="${x.id}">${esc(x.nombre)}</button>`).join('')}</div>

    <div class="labcfg-bloque">
      ${esGeneral ? `
        <div class="field"><label>Contexto completo del funnel de UNEQ</label>
          <p class="text-soft labg-ayuda">Explica cómo piensan el funnel de punta a punta: qué es cada etapa y cómo se conectan, a quién le hablan, qué buscan lograr, el tono de la marca, lo que nunca hay que hacer. Esto lo lee la IA en TODAS las etapas.</p>
          <textarea data-f="contexto" rows="14" maxlength="30000">${esc(g.contexto || '')}</textarea></div>`
      : `
        <div class="field"><label>Teoría y significado de ${esc(nombre)}</label>
          <p class="text-soft labg-ayuda">Qué es esta etapa, para qué sirve, qué significan sus objetivos y cómo se mide. (El objetivo corto de la etapa se edita arriba, en «Etapas del funnel».)</p>
          <textarea data-f="teoria" rows="8" maxlength="12000">${esc(g.teoria || '')}</textarea></div>
        <div class="field"><label>Estructura técnica de las piezas</label>
          <p class="text-soft labg-ayuda">Todo lo técnico: duración ideal (por ejemplo, Reels de 30 a 45 segundos), estructura del copy, número de láminas, largo de los textos, cómo abrir y cómo cerrar, uso del llamado a la acción, etc.</p>
          <textarea data-f="estructura" rows="8" maxlength="12000">${esc(g.estructura || '')}</textarea></div>
        <div class="field"><label>Qué evitar y errores comunes</label>
          <textarea data-f="evitar" rows="4" maxlength="12000">${esc(g.evitar || '')}</textarea></div>`}
      <p id="labg-error" class="hidden lab-error"></p>
      <div class="labcfg-acciones">
        <button type="button" class="btn btn--primary" id="labg-guardar">Guardar ${esc(nombre)}</button>
        ${esGeneral ? '' : '<button type="button" class="btn btn--ghost" id="labg-probar">Probar esta etapa con una persona de ejemplo</button>'}
      </div>
    </div>

    <div class="labcfg-sub">Archivos de ${esGeneral ? 'guía general' : 'ejemplo de ' + esc(nombre)}</div>
    <p class="text-soft labg-ayuda">Sube videos o audios de ejemplo, PDF, Word (.docx), imágenes o textos. La IA los lee y aprende su estructura y estilo. Videos y audios hasta ${MAX_MEDIA_MB} MB; el resto hasta ${MAX_DOC_MB} MB. En «Aplica a» puedes decir si es un ejemplo solo para Reels, solo para carruseles, etc.</p>
    <div id="labg-lista">${archivosDe(s).map(htmlArchivo).join('') || '<p class="text-soft">Todavía no hay archivos aquí.</p>'}</div>
    <div class="labcfg-bloque labg-subir">
      <div class="labcfg-fila">
        <div class="field" style="margin:0;"><label>Aplica a</label><select id="labg-formato">${FORMATOS.map(f => `<option value="${f[0]}">${esc(f[1])}</option>`).join('')}</select></div>
        <div class="field" style="margin:0;"><label>Nota para la IA (opcional)</label><input type="text" id="labg-nota" maxlength="300" placeholder="Ej.: Reel que mejor nos funcionó para ganar seguidores"></div>
        <span></span>
      </div>
      <input type="file" id="labg-archivo" accept="${EXT_ACEPTADAS}" class="hidden">
      <button type="button" class="btn btn--ghost" id="labg-elegir">+ Subir archivo</button>
      <div id="labg-progreso" class="labg-progreso hidden"><div class="labg-progreso__barra"><div id="labg-progreso-relleno"></div></div><span id="labg-progreso-texto" class="text-soft"></span></div>
    </div>
    <div id="labg-prueba"></div>`;
  conectar();
  programarRefresco();
}

function mostrarError(texto) {
  const e = document.getElementById('labg-error');
  e.textContent = texto;
  e.classList.remove('hidden');
}

function programarRefresco() {
  clearTimeout(temporizador);
  if (!archivosDe(scopeActual).some(a => a.estado === 'procesando')) return;
  temporizador = setTimeout(async () => {
    if (!document.getElementById('labg-lista')) return;
    await recargarArchivos();
    // Si algo sigue procesándose, el repintado de la lista vuelve a programar otro chequeo.
    programarRefresco();
  }, 6000);
}

async function recargarArchivos() {
  const snap = await get(ref(db, `laboratorioIA/guia/${scopeActual}/archivos`));
  datos[scopeActual] = { ...(datos[scopeActual] || {}), archivos: snap.exists() ? snap.val() : {} };
  const lista = document.getElementById('labg-lista');
  if (lista) lista.innerHTML = archivosDe(scopeActual).map(htmlArchivo).join('') || '<p class="text-soft">Todavía no hay archivos aquí.</p>';
}

function conectar() {
  const el = cuerpo();
  el.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
    leerTextos();
    scopeActual = b.dataset.scope;
    pintar();
  }));

  document.getElementById('labg-guardar').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const original = btn.textContent;
    btn.disabled = true;
    try {
      leerTextos();
      const g = datos[scopeActual] || {};
      const campos = scopeActual === 'general' ? { contexto: g.contexto || '' } : { teoria: g.teoria || '', estructura: g.estructura || '', evitar: g.evitar || '' };
      await update(ref(db, `laboratorioIA/guia/${scopeActual}`), campos);
      btn.textContent = 'Guardado ✓';
      setTimeout(() => { btn.textContent = original; }, 2000);
    } catch (err) {
      console.error('No se pudo guardar la guía:', err);
      mostrarError('No se pudo guardar. Revisa que las reglas de Firebase estén publicadas e intenta de nuevo.');
    } finally {
      btn.disabled = false;
    }
  });

  const btnProbar = document.getElementById('labg-probar');
  if (btnProbar) btnProbar.addEventListener('click', async () => {
    const destino = document.getElementById('labg-prueba');
    leerTextos();
    btnProbar.disabled = true;
    destino.innerHTML = '<div class="lab-cargando"><span class="lab-spinner"></span> Generando una prueba con una persona de ejemplo… (puede tardar hasta un minuto)</div>';
    try {
      // Lo que está escrito en pantalla se guarda antes, para probar exactamente lo que ves.
      const g = datos[scopeActual] || {};
      await update(ref(db, `laboratorioIA/guia/${scopeActual}`), { teoria: g.teoria || '', estructura: g.estructura || '', evitar: g.evitar || '' });
      const r = await probarEtapa({ etapa: scopeActual });
      const res = r.data;
      destino.innerHTML = `
        <div class="labcfg-sub">Prueba de ${esc(res.etapaNombre)} (persona de ejemplo; no se guarda)</div>
        ${res.incompleta ? '<p class="lab-aviso">Uno de los formatos no se pudo generar esta vez.</p>' : ''}
        ${htmlPiezas(res.piezas, { reel: { nombre: 'Reels' }, carrusel: { nombre: 'Carruseles' }, dm: { nombre: 'DMs' }, whatsapp: { nombre: 'WhatsApp' } })}`;
      conectarCopiar(destino, res.piezas);
    } catch (err) {
      destino.innerHTML = `<p class="lab-error">${esc((err && err.message) || 'No se pudo generar la prueba.')}</p>`;
    } finally {
      btnProbar.disabled = false;
    }
  });

  document.getElementById('labg-elegir').addEventListener('click', () => document.getElementById('labg-archivo').click());
  document.getElementById('labg-archivo').addEventListener('change', subirArchivo);

  document.getElementById('labg-lista').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('.labg-archivo').dataset.id;
    const a = archivosDe(scopeActual).find(x => x.id === id);
    if (!a) return;
    b.disabled = true;
    try {
      if (b.dataset.act === 'quitar') {
        if (!confirm(`¿Quitar «${a.nombre}» de la guía? La IA dejará de usarlo.`)) { b.disabled = false; return; }
        await remove(ref(db, `laboratorioIA/guia/${scopeActual}/archivos/${id}`));
        if (a.storagePath) { try { await deleteObject(storageRef(storage, a.storagePath)); } catch (e) { /* ya no estaba */ } }
      } else {
        await update(ref(db, `laboratorioIA/guia/${scopeActual}/archivos/${id}`), { estado: 'procesando', error: null });
      }
      await recargarArchivos();
      programarRefresco();
    } catch (err) {
      console.error('No se pudo actualizar el archivo:', err);
      b.disabled = false;
      alert('No se pudo completar la acción. Intenta de nuevo.');
    }
  });
}

/* Guarda en memoria lo que hay escrito en los cuadros de texto (sin tocar Firebase) */
function leerTextos() {
  const el = cuerpo();
  if (!el) return;
  const g = datos[scopeActual] = datos[scopeActual] || {};
  el.querySelectorAll('textarea[data-f]').forEach(t => { g[t.dataset.f] = t.value.trim(); });
}

async function subirArchivo(ev) {
  const input = ev.currentTarget;
  const archivo = input.files[0];
  input.value = '';
  if (!archivo) return;
  const ext = extension(archivo.name);
  const esMedia = EXT_MEDIA.includes(ext);
  const maxMb = esMedia ? MAX_MEDIA_MB : MAX_DOC_MB;
  if (!EXT_ACEPTADAS.split(',').includes('.' + ext)) { alert('Formato no admitido. Usa video, audio, PDF, Word (.docx), imagen o texto. Si es un Word antiguo (.doc), guárdalo como .docx.'); return; }
  if (archivo.size > maxMb * 1024 * 1024) { alert(`El archivo pesa más de ${maxMb} MB. Elige uno más liviano.`); return; }

  const scope = scopeActual;
  const formato = document.getElementById('labg-formato').value;
  const nota = document.getElementById('labg-nota').value.trim();
  const prog = document.getElementById('labg-progreso');
  const relleno = document.getElementById('labg-progreso-relleno');
  const texto = document.getElementById('labg-progreso-texto');
  const btn = document.getElementById('labg-elegir');
  btn.disabled = true;
  prog.classList.remove('hidden');
  relleno.style.width = '0%';
  texto.textContent = 'Subiendo…';
  try {
    const nuevoRef = push(ref(db, `laboratorioIA/guia/${scope}/archivos`));
    const nombreSeguro = archivo.name.replace(/[^\w.\-() ]+/g, '_');
    const storagePath = `laboratorio-guia/${scope}/${nuevoRef.key}_${nombreSeguro}`;
    const tarea = uploadBytesResumable(storageRef(storage, storagePath), archivo);
    await new Promise((resolve, reject) => {
      tarea.on('state_changed', s => {
        const p = Math.round((s.bytesTransferred / s.totalBytes) * 100);
        relleno.style.width = p + '%';
        texto.textContent = `Subiendo… ${p}%`;
      }, reject, resolve);
    });
    const url = await getDownloadURL(tarea.snapshot.ref);
    await set(nuevoRef, { nombre: archivo.name, url, storagePath, tamano: archivo.size, formato, nota, estado: 'procesando', creadoEn: Date.now() });
    document.getElementById('labg-nota').value = '';
    await recargarArchivos();
    programarRefresco();
  } catch (err) {
    console.error('No se pudo subir el archivo de la guía:', err);
    alert('No se pudo subir el archivo. Revisa que las reglas de Storage estén publicadas e intenta de nuevo.');
  } finally {
    btn.disabled = false;
    prog.classList.add('hidden');
  }
}

export async function cargarGuiaLaboratorio() {
  if (getCurrentRole() !== 'director') return;
  const el = cuerpo();
  if (!el) return;
  el.innerHTML = '<p class="text-soft">Cargando…</p>';
  try {
    const snap = await get(ref(db, 'laboratorioIA/guia'));
    datos = snap.exists() ? snap.val() : {};
    pintar();
  } catch (err) {
    console.error('No se pudo cargar la guía del Laboratorio:', err);
    el.innerHTML = '<p style="color:#C0392B; font-size:13px;">No se pudo cargar. Puede que falte publicar las reglas de Firebase.</p>';
  }
}

document.querySelectorAll('.nav-item[data-nav="configuracion"]').forEach(item => {
  item.addEventListener('click', cargarGuiaLaboratorio);
});
