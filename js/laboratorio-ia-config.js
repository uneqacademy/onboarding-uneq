/* ============================================================
   laboratorio-ia-config.js — Configuración > Laboratorio IA (solo Director)
   El Director Académico edita TODO lo del Laboratorio sin tocar código:
   - tope diario de generaciones por alumno
   - preguntas de cada ficha (agregar, quitar, reordenar, marcar opcionales)
   - etapas del funnel (nombre, descripción, desde qué fase, formatos, objetivo)
   - formatos (cantidad de propuestas, estructura e instrucción)
   - prompts internos de la IA (sistema, bienvenida, borrador de ficha, generación)
   Lo que se guarda: laboratorioIA/config y laboratorioIA/prompts (solo director).
   Los prompts solo se guardan si difieren del original, así las mejoras del
   original llegan solas a lo que no se tocó. "Restaurar" vuelve a lo original.
   La forma de la respuesta de la IA (JSON) la fija el servidor: no se edita.
   ============================================================ */

import { db, app } from './firebase-config.js';
import { escaparHtml } from './util-html.js';
import { ref, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";

const functions = getFunctions(app);
const pedirConfig = httpsCallable(functions, 'laboratorioConfigDirector', { timeout: 30000 });
const esc = escaparHtml;
const cuerpo = () => document.getElementById('labcfg-cuerpo');

const NOMBRES_PROMPT = {
  sistema: ['Personalidad y reglas generales de la IA', 'Se usa en TODO: bienvenida, borrador de ficha y contenidos. Define cómo habla y qué no debe hacer.'],
  bienvenida: ['Frase de bienvenida', 'Cómo debe ser la frase cálida que ve el alumno arriba al entrar al Laboratorio.'],
  fichaBorrador: ['Borrador de la ficha', 'Cómo debe redactar la IA el borrador de las respuestas de la ficha a partir de los hitos y notas del copiloto.'],
  generacion: ['Generación de contenidos', 'Instrucción general al crear Reels, carruseles, DMs y WhatsApp. El objetivo de cada etapa y la estructura de cada formato se editan más arriba.']
};
const ETIQUETAS_FICHA = { fase1: 'Ficha 1', fase2: 'Ficha 2', fase3: 'Ficha 3' };

let cfg = null;      // configuración efectiva en pantalla
let porDefecto = null;

function opcionesFase(sel) {
  return [1, 2, 3, 4].map(n => `<option value="${n}" ${Number(sel) === n ? 'selected' : ''}>Fase ${n}</option>`).join('');
}

function pintar() {
  const el = cuerpo();
  if (!el) return;
  const base = cfg.base;
  el.innerHTML = `
    <p class="text-soft mb-16" style="font-size:13px;">Todo lo que ves aquí lo puedes cambiar. Los cambios valen desde la próxima vez que un alumno use el Laboratorio.</p>

    <div class="labcfg-sub" style="margin-top:0;">General</div>
    <div class="labcfg-bloque">
      <div class="field" style="max-width:260px; margin:0;"><label>Generaciones por día por alumno</label>
        <input type="number" min="1" max="100" data-lc="limiteDia" value="${esc(cfg.limiteDia)}"></div>
    </div>

    <div class="labcfg-sub">Fichas (las preguntas que responde el alumno)</div>
    ${base.secciones.map(s => {
      const p = cfg.preguntas[s];
      return `
      <div class="labcfg-bloque" data-sec="${s}">
        <div class="labcfg-fila">
          <div class="field" style="margin:0;"><label>${ETIQUETAS_FICHA[s]}: título</label><input type="text" data-f="titulo" value="${esc(p.titulo)}" maxlength="80"></div>
          <div class="field" style="margin:0;"><label>Se activa desde</label><select data-f="desdeFase">${opcionesFase(p.desdeFase)}</select></div>
          <span></span>
        </div>
        <div class="field"><label>Descripción (la ve el alumno)</label><input type="text" data-f="descripcion" value="${esc(p.descripcion)}" maxlength="300"></div>
        <label style="font-size:12.5px; font-weight:600;">Preguntas</label>
        ${p.items.map((i, n) => `
          <div class="labcfg-fila" data-i="${n}" data-id="${esc(i.id)}">
            <input type="text" data-f="pregunta" placeholder="Pregunta" value="${esc(i.pregunta)}" maxlength="300">
            <input type="text" data-f="ayuda" placeholder="Ayuda (opcional)" value="${esc(i.ayuda)}" maxlength="300">
            <span style="display:flex; gap:4px; align-items:center; white-space:nowrap;">
              <label style="font-size:12px; display:flex; gap:3px; align-items:center;"><input type="checkbox" data-f="opcional" ${i.opcional ? 'checked' : ''}> opcional</label>
              <button type="button" class="btn btn--ghost labcfg-mini" data-act="up" title="Subir">↑</button>
              <button type="button" class="btn btn--ghost labcfg-mini" data-act="down" title="Bajar">↓</button>
              <button type="button" class="btn btn--ghost labcfg-mini" data-act="del" title="Quitar">✕</button>
            </span>
          </div>`).join('')}
        <button type="button" class="btn btn--ghost labcfg-mini" data-act="add" data-sec="${s}">+ Agregar pregunta</button>
      </div>`;
    }).join('')}

    <div class="labcfg-sub">Etapas del funnel</div>
    ${base.etapas.map(id => {
      const e = cfg.etapas[id];
      return `
      <div class="labcfg-bloque" data-et="${id}">
        <div class="labcfg-fila">
          <div class="field" style="margin:0;"><label>Nombre</label><input type="text" data-f="nombre" value="${esc(e.nombre)}" maxlength="40"></div>
          <div class="field" style="margin:0;"><label>Se activa desde</label><select data-f="desdeFase">${opcionesFase(e.desdeFase)}</select></div>
          <label style="font-size:13px; display:flex; gap:5px; align-items:center; margin-top:22px;"><input type="checkbox" data-f="activa" ${e.activa ? 'checked' : ''}> Activa</label>
        </div>
        <div class="field"><label>Descripción (la ve el alumno)</label><input type="text" data-f="descripcion" value="${esc(e.descripcion)}" maxlength="300"></div>
        <label style="font-size:12.5px; font-weight:600;">Formatos que genera</label>
        <div class="labcfg-checks">${base.formatos.map(f => `<label><input type="checkbox" data-f="formato" value="${f}" ${e.formatos.includes(f) ? 'checked' : ''}> ${esc(cfg.formatos[f].nombre)}</label>`).join('')}</div>
        <label style="font-size:12.5px; font-weight:600;">Fichas que debe tener aprobadas</label>
        <div class="labcfg-checks">${base.secciones.map(s => `<label><input type="checkbox" data-f="ficha" value="${s}" ${e.requiereFichas.includes(s) ? 'checked' : ''}> ${esc(cfg.preguntas[s].titulo)}</label>`).join('')}</div>
        <div class="field"><label>Objetivo de la etapa (instrucción para la IA)</label><textarea data-f="objetivo" rows="3" maxlength="1500">${esc(e.objetivo)}</textarea></div>
      </div>`;
    }).join('')}

    <div class="labcfg-sub">Formatos</div>
    ${base.formatos.map(id => {
      const f = cfg.formatos[id];
      return `
      <div class="labcfg-bloque" data-fo="${id}">
        <div class="labcfg-fila">
          <div class="field" style="margin:0;"><label>Nombre</label><input type="text" data-f="nombre" value="${esc(f.nombre)}" maxlength="40"></div>
          <div class="field" style="margin:0;"><label>Propuestas por clic (1 a 6)</label><input type="number" min="1" max="6" data-f="cantidad" value="${esc(f.cantidad)}"></div>
          <span></span>
        </div>
        <div class="field"><label>Estructura de cada propuesta (secciones separadas por «;», en orden)</label><input type="text" data-f="estructura" value="${esc(f.estructura)}" maxlength="600"></div>
        <div class="field"><label>Instrucción para la IA</label><textarea data-f="instruccion" rows="3" maxlength="1500">${esc(f.instruccion)}</textarea></div>
      </div>`;
    }).join('')}

    <div class="labcfg-sub">Instrucciones internas de la IA (prompts)</div>
    ${Object.keys(NOMBRES_PROMPT).map(k => `
      <div class="labcfg-bloque">
        <label style="font-size:13px; font-weight:700;">${esc(NOMBRES_PROMPT[k][0])}</label>
        <p class="text-soft" style="font-size:12.5px; margin:2px 0 6px;">${esc(NOMBRES_PROMPT[k][1])}</p>
        <textarea data-prompt="${k}" rows="${k === 'sistema' ? 12 : 6}" maxlength="8000">${esc(cfg.prompts[k])}</textarea>
        <button type="button" class="btn btn--ghost labcfg-mini" data-act="restaurar-prompt" data-k="${k}" style="margin-top:6px;">Restaurar el original</button>
      </div>`).join('')}

    <p id="labcfg-error" class="hidden" style="color:#C0392B; font-size:13px;"></p>
    <div class="labcfg-acciones">
      <button type="button" class="btn btn--primary" id="labcfg-guardar">Guardar cambios</button>
      <button type="button" class="btn btn--ghost" id="labcfg-restaurar-todo">Restaurar todo a lo original</button>
    </div>`;
  conectar(el);
}

/* Lee lo que hay en pantalla y lo deja en `cfg` */
function leer() {
  const el = cuerpo();
  cfg.limiteDia = Number(el.querySelector('[data-lc="limiteDia"]').value) || cfg.limiteDia;
  el.querySelectorAll('[data-sec]').forEach(bloque => {
    if (!bloque.matches('.labcfg-bloque')) return;
    const p = cfg.preguntas[bloque.dataset.sec];
    p.titulo = bloque.querySelector('[data-f="titulo"]').value.trim();
    p.descripcion = bloque.querySelector('[data-f="descripcion"]').value.trim();
    p.desdeFase = Number(bloque.querySelector('[data-f="desdeFase"]').value);
    p.items = [...bloque.querySelectorAll('.labcfg-fila[data-i]')].map(fila => ({
      id: fila.dataset.id,
      pregunta: fila.querySelector('[data-f="pregunta"]').value.trim(),
      ayuda: fila.querySelector('[data-f="ayuda"]').value.trim(),
      opcional: fila.querySelector('[data-f="opcional"]').checked
    }));
  });
  el.querySelectorAll('[data-et]').forEach(bloque => {
    const e = cfg.etapas[bloque.dataset.et];
    e.nombre = bloque.querySelector('[data-f="nombre"]').value.trim();
    e.descripcion = bloque.querySelector('[data-f="descripcion"]').value.trim();
    e.desdeFase = Number(bloque.querySelector('[data-f="desdeFase"]').value);
    e.activa = bloque.querySelector('[data-f="activa"]').checked;
    e.formatos = [...bloque.querySelectorAll('[data-f="formato"]:checked')].map(c => c.value);
    e.requiereFichas = [...bloque.querySelectorAll('[data-f="ficha"]:checked')].map(c => c.value);
    e.objetivo = bloque.querySelector('[data-f="objetivo"]').value.trim();
  });
  el.querySelectorAll('[data-fo]').forEach(bloque => {
    const f = cfg.formatos[bloque.dataset.fo];
    f.nombre = bloque.querySelector('[data-f="nombre"]').value.trim();
    f.cantidad = Number(bloque.querySelector('[data-f="cantidad"]').value) || f.cantidad;
    f.estructura = bloque.querySelector('[data-f="estructura"]').value.trim();
    f.instruccion = bloque.querySelector('[data-f="instruccion"]').value.trim();
  });
  el.querySelectorAll('[data-prompt]').forEach(t => { cfg.prompts[t.dataset.prompt] = t.value; });
}

function mostrarError(texto) {
  const e = document.getElementById('labcfg-error');
  e.textContent = texto;
  e.classList.remove('hidden');
}

function validar() {
  for (const s of cfg.base.secciones) {
    const p = cfg.preguntas[s];
    if (!p.titulo) return `La ${ETIQUETAS_FICHA[s]} necesita un título.`;
    if (!p.items.length || p.items.some(i => !i.pregunta)) return `Revisa las preguntas de la ${ETIQUETAS_FICHA[s]}: no pueden quedar vacías ni sin preguntas.`;
  }
  for (const id of cfg.base.etapas) {
    const e = cfg.etapas[id];
    if (!e.nombre) return 'Cada etapa necesita un nombre.';
    if (!e.formatos.length) return `La etapa «${e.nombre}» necesita al menos un formato.`;
  }
  for (const id of cfg.base.formatos) {
    const f = cfg.formatos[id];
    if (!f.nombre || !f.estructura) return 'Cada formato necesita nombre y estructura.';
    if (!(f.cantidad >= 1 && f.cantidad <= 6)) return `Las propuestas de «${f.nombre}» deben ser entre 1 y 6.`;
  }
  if (!(cfg.limiteDia >= 1 && cfg.limiteDia <= 100)) return 'El tope diario debe estar entre 1 y 100.';
  if (!cfg.prompts.sistema.trim()) return 'La personalidad general de la IA no puede quedar vacía (usa «Restaurar el original»).';
  return '';
}

let delegadoListo = false;

function conectar(el) {
  // El clic delegado se registra una sola vez (el contenido se repinta, el contenedor no).
  if (!delegadoListo) {
    delegadoListo = true;
    el.addEventListener('click', alHacerClic);
  }
  conectarBotones();
}

async function alHacerClic(ev) {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'restaurar-prompt') {
      leer();
      cfg.prompts[b.dataset.k] = porDefecto.prompts[b.dataset.k];
      pintar();
      return;
    }
    if (act === 'add') {
      leer();
      cfg.preguntas[b.dataset.sec].items.push({ id: 'p' + Date.now().toString(36), pregunta: '', ayuda: '', opcional: false });
      pintar();
      return;
    }
    const fila = b.closest('.labcfg-fila[data-i]');
    if (!fila) return;
    leer();
    const sec = b.closest('[data-sec]').dataset.sec;
    const items = cfg.preguntas[sec].items;
    const n = Number(fila.dataset.i);
    if (act === 'del') {
      if (items.length <= 1) return;
      items.splice(n, 1);
    } else if (act === 'up' && n > 0) {
      [items[n - 1], items[n]] = [items[n], items[n - 1]];
    } else if (act === 'down' && n < items.length - 1) {
      [items[n + 1], items[n]] = [items[n], items[n + 1]];
    }
    pintar();
}

function conectarBotones() {
  document.getElementById('labcfg-guardar').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    leer();
    const problema = validar();
    if (problema) { mostrarError(problema); return; }
    document.getElementById('labcfg-error').classList.add('hidden');
    btn.disabled = true;
    try {
      const guardarConfig = {
        limiteDia: cfg.limiteDia,
        preguntas: cfg.preguntas,
        etapas: cfg.etapas,
        formatos: cfg.formatos
      };
      const prompts = {};
      Object.keys(NOMBRES_PROMPT).forEach(k => { if (cfg.prompts[k].trim() !== porDefecto.prompts[k].trim()) prompts[k] = cfg.prompts[k].trim(); });
      await set(ref(db, 'laboratorioIA/config'), guardarConfig);
      await set(ref(db, 'laboratorioIA/prompts'), Object.keys(prompts).length ? prompts : null);
      btn.textContent = 'Guardado ✓';
      setTimeout(() => { btn.textContent = 'Guardar cambios'; }, 2000);
    } catch (err) {
      console.error('No se pudo guardar la configuración del Laboratorio:', err);
      mostrarError('No se pudo guardar. Revisa que las reglas de Firebase estén publicadas e intenta de nuevo.');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('labcfg-restaurar-todo').addEventListener('click', async () => {
    if (!confirm('Se borrarán TODOS tus cambios del Laboratorio IA (preguntas, etapas, formatos y prompts) y se volverá a lo original. Las fichas y contenidos de los alumnos no se tocan. ¿Continuar?')) return;
    try {
      await set(ref(db, 'laboratorioIA/config'), null);
      await set(ref(db, 'laboratorioIA/prompts'), null);
      await cargarConfigLaboratorio();
    } catch (err) {
      console.error('No se pudo restaurar:', err);
      mostrarError('No se pudo restaurar. Intenta de nuevo.');
    }
  });
}

export async function cargarConfigLaboratorio() {
  const el = cuerpo();
  if (!el) return;
  el.innerHTML = '<p class="text-soft">Cargando…</p>';
  try {
    const r = await pedirConfig({});
    cfg = r.data;
    porDefecto = r.data.porDefecto;
    pintar();
  } catch (err) {
    console.error('No se pudo cargar la configuración del Laboratorio:', err);
    el.innerHTML = '<p style="color:#C0392B; font-size:13px;">No se pudo cargar. Puede que la función aún no esté publicada.</p>';
  }
}

document.querySelectorAll('.nav-item[data-nav="configuracion"]').forEach(item => {
  item.addEventListener('click', cargarConfigLaboratorio);
});
