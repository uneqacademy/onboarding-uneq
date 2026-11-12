/* ============================================================
   analisis-test.js — Análisis con IA de cada Test Brújula
   - Botón "REALIZAR ANÁLISIS" en cada test; al generarlo pasa a "VER ANÁLISIS".
   - Lo ven el alumno (sus tests), su copiloto y el director.
   - La función en la nube `analizarTestBrujula` genera el texto una sola vez y lo guarda en
     ciclos/{cicloId}/tests/{testId}/analisis. Acá se muestra como informe visual y se baja en PDF o PNG.
   ============================================================ */
import { app } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";
import { escaparHtml } from './util-html.js';
import { getCurrentRole } from './main.js';

const analizarTestFn = httpsCallable(getFunctions(app), 'analizarTestBrujula', { timeout: 150000 });

const FASES = {
  fase1: { n: 'Fase 1', nombre: 'Claridad y Fundamentos', color: '#8B5CF6' },
  fase2: { n: 'Fase 2', nombre: 'Cliente Soñado', color: '#0EA5E9' },
  fase3: { n: 'Fase 3', nombre: 'Oferta y Método', color: '#EC4899' },
  fase4: { n: 'Fase 4', nombre: 'Acción y Sistemas', color: '#10B981' }
};
const SABOTEADORES = [
  ['sab_perfeccionista', 'Perfeccionista'], ['sab_procrastinador', 'Procrastinador'], ['sab_comparador', 'Comparador'],
  ['sab_disperso', 'Disperso'], ['sab_controlador', 'Controlador'], ['sab_victima', 'Víctima']
];
const BLOQUEOS = [
  ['bv_rogar', 'Miedo a "rogar"'], ['bv_dinero', 'Culpa por el dinero'], ['bv_expectativas', 'Miedo a no cumplir'],
  ['bv_perseguir', 'Rechazo a "perseguir"'], ['bv_aburrir', 'Miedo a aburrir']
];

// Tests conocidos por la pantalla que los muestra: testId -> { cicloId, nombreCompleto, test }
const registro = new Map();

export function registrarTestsAnalisis(cicloId, tests, nombreCompleto) {
  (tests || []).forEach(t => { if (t && t.id) registro.set(t.id, { cicloId, nombreCompleto: nombreCompleto || '', test: t }); });
}

function textoBoton(test) { return test && test.analisis && test.analisis.datos ? 'VER ANÁLISIS' : 'REALIZAR ANÁLISIS'; }

export function botonAnalisisHtml(test) {
  return `<button type="button" class="btn btn--accent btn-analisis-test" data-test-id="${escaparHtml(test.id)}" style="font-size:12px; padding:6px 12px; white-space:nowrap;">${textoBoton(test)}</button>`;
}

/* ---------- Informe visual ---------- */
function parrafos(texto) {
  return String(texto || '').split(/\n\s*\n|\\n\\n/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${escaparHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}
function lista(items, clase) {
  const arr = (Array.isArray(items) ? items : []).map(x => String(x || '').trim()).filter(Boolean);
  return arr.length ? `<ul class="${clase}">${arr.map(x => `<li>${escaparHtml(x)}</li>`).join('')}</ul>` : '';
}
function nivel(v) { return v <= 3 ? '#16A34A' : v <= 6 ? '#F59E0B' : '#DC2626'; }

function barras(respuestas, items, destacarMax) {
  const valores = items.map(([id]) => Number((respuestas || {})[id]));
  const max = Math.max(...valores.filter(v => !isNaN(v)));
  return items.map(([id, label], i) => {
    const v = valores[i];
    if (isNaN(v)) return '';
    const esTop = destacarMax && v === max;
    return `<div class="an-barra${esTop ? ' an-barra--top' : ''}">
      <span class="an-barra__label">${escaparHtml(label)}${esTop ? ' ★' : ''}</span>
      <span class="an-barra__pista"><span style="width:${v * 10}%; background:${nivel(v)};"></span></span>
      <span class="an-barra__valor">${v}</span>
    </div>`;
  }).join('');
}

function claveFase(v) { const m = String(v || '').match(/[1-4]/); return m ? `fase${m[0]}` : ''; }

function informeHtml(analisis, test, nombreCompleto) {
  const d = analisis.datos || {};
  const p = test.promedios || {};
  const fecha = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(test.completadoAt));
  const nombre = nombreCompleto || analisis.nombre || '';
  const fort = claveFase(d.fases && d.fases.fortaleza);
  const crit = claveFase(d.fases && d.fases.critica);
  const mensajePorFase = {};
  ((d.fases && d.fases.detalle) || []).forEach(x => { const k = claveFase(x.fase); if (k) mensajePorFase[k] = x.mensaje; });

  const gauges = Object.entries(FASES).map(([k, f]) => {
    const v = Number(p[k]) || 0;
    const etiqueta = k === fort ? '<span class="an-chip an-chip--ok">💪 Fortaleza</span>' : k === crit ? '<span class="an-chip an-chip--alerta">🎯 Atención</span>' : '';
    return `<div class="an-fase">
      <div class="an-fase__top"><strong style="color:${f.color};">${f.n}</strong>${etiqueta}</div>
      <div class="an-fase__nombre">${f.nombre}</div>
      <div class="an-fase__valor" style="color:${f.color};">${v.toFixed(1)}<small>/10</small></div>
      <div class="an-fase__pista"><span style="width:${v * 10}%; background:${f.color};"></span></div>
    </div>`;
  }).join('');

  const filasFases = Object.entries(FASES).map(([k, f]) => mensajePorFase[k]
    ? `<div class="an-fila-fase"><span class="an-punto" style="background:${f.color};"></span><div><strong>${f.n} · ${f.nombre}</strong><br><span>${escaparHtml(mensajePorFase[k])}</span></div></div>` : '').join('');

  const pasos = (d.pasos || []).map((s, i) => `<div class="an-paso"><span class="an-paso__n">${i + 1}</span><div><strong>${escaparHtml(s.titulo || '')}</strong><p>${escaparHtml(s.detalle || '')}</p></div></div>`).join('');

  return `
  <div class="an-hoja" id="analisis-captura">
    <div class="an-portada">
      <div class="an-portada__sup">TEST BRÚJULA · ANÁLISIS PERSONALIZADO</div>
      <h2>${escaparHtml(nombre)}</h2>
      <div class="an-portada__sub">Programa ${escaparHtml(analisis.programa || '')} · ${fecha}</div>
    </div>
    ${d.saludo ? `<div class="an-saludo">${escaparHtml(d.saludo)}</div>` : ''}

    <h3 class="an-titulo">📊 Tus 4 fases de un vistazo</h3>
    <div class="an-fases">${gauges}</div>

    <div class="an-seccion an-seccion--1">
      <div class="an-seccion__cab"><span class="an-seccion__n">1</span><div><small>PRINCIPAL SABOTEADOR INTERNO</small><h3>${escaparHtml(d.saboteador.titulo || 'Tu principal saboteador')}</h3></div></div>
      <div class="an-etiqueta">Hoy te frena: <strong>${escaparHtml(d.saboteador.principal || '')}</strong></div>
      <div class="an-barras">${barras(test.respuestas, SABOTEADORES, true)}</div>
      <div class="an-texto">${parrafos(d.saboteador.texto)}</div>
      ${lista(d.saboteador.senales, 'an-chips') ? `<p class="an-sub">Cómo se nota en tu día a día</p>${lista(d.saboteador.senales, 'an-chips')}` : ''}
      ${d.saboteador.costo ? `<div class="an-callout an-callout--costo"><strong>💸 El costo de no gestionarlo</strong><br>${escaparHtml(d.saboteador.costo)}</div>` : ''}
    </div>

    <div class="an-seccion an-seccion--2">
      <div class="an-seccion__cab"><span class="an-seccion__n">2</span><div><small>BLOQUEOS FRENTE A LA VENTA</small><h3>${escaparHtml(d.bloqueos.titulo || 'Tus bloqueos frente a la venta')}</h3></div></div>
      <div class="an-etiqueta">Tu mayor bloqueo: <strong>${escaparHtml(d.bloqueos.principal || '')}</strong></div>
      <div class="an-barras">${barras(test.respuestas, BLOQUEOS, true)}</div>
      <div class="an-texto">${parrafos(d.bloqueos.texto)}</div>
      ${lista(d.bloqueos.creencias, 'an-citas') ? `<p class="an-sub">Creencias que hoy pesan</p>${lista(d.bloqueos.creencias, 'an-citas')}` : ''}
      ${d.bloqueos.conexion ? `<div class="an-callout"><strong>🔗 La conexión</strong><br>${escaparHtml(d.bloqueos.conexion)}</div>` : ''}
    </div>

    <div class="an-seccion an-seccion--3">
      <div class="an-seccion__cab"><span class="an-seccion__n">3</span><div><small>ESTADO ACTUAL EN LAS 4 FASES · METODOLOGÍA 2E</small><h3>Dónde estás en el camino</h3></div></div>
      <div class="an-texto">${parrafos(d.fases.texto)}</div>
      <div class="an-fila-fases">${filasFases}</div>
      ${d.fases.puntoDelCamino ? `<div class="an-callout an-callout--camino"><strong>🧭 Tu punto en el camino</strong><br>${escaparHtml(d.fases.puntoDelCamino)}</div>` : ''}
    </div>

    <div class="an-seccion an-seccion--4">
      <div class="an-seccion__cab"><span class="an-seccion__n">4</span><div><small>PRÓXIMOS PASOS RECOMENDADOS</small><h3>Lo que puedes empezar hoy</h3></div></div>
      <div class="an-pasos">${pasos}</div>
    </div>

    ${d.mensajeFinal ? `<div class="an-final">🚀 ${escaparHtml(d.mensajeFinal)}</div>` : ''}
    <div class="an-pie">Análisis generado con IA a partir de tu Test Brújula · UNEQ</div>
  </div>`;
}

/* ---------- Ventana del informe + descargas ---------- */
function cerrarModal() { document.getElementById('analisis-modal')?.remove(); }

async function capturar() {
  const { default: html2canvas } = await import('https://esm.sh/html2canvas@1.4.1');
  const nodo = document.getElementById('analisis-captura');
  return html2canvas(nodo, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
}
function nombreArchivo(nombre) { return `analisis-test-brujula-${String(nombre || 'alumno').trim().replace(/[^\p{L}\p{N}]+/gu, '-')}`; }

async function descargarPng(nombre) {
  const canvas = await capturar();
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${nombreArchivo(nombre)}.png`;
  document.body.appendChild(a); a.click(); a.remove();
}
async function descargarPdf(nombre) {
  const canvas = await capturar();
  const { jsPDF } = await import('https://esm.sh/jspdf@4.2.1');
  const ancho = 210;
  const alto = Math.max(297, (canvas.height * ancho) / canvas.width);
  // Una sola página continua (sin cortes en medio de una tarjeta).
  const doc = new jsPDF({ unit: 'mm', format: [ancho, alto], orientation: 'portrait' });
  doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, ancho, (canvas.height * ancho) / canvas.width);
  doc.save(`${nombreArchivo(nombre)}.pdf`);
}

function abrirModal(testId) {
  const info = registro.get(testId);
  if (!info || !info.test.analisis) return;
  cerrarModal();
  const nombre = info.nombreCompleto || info.test.analisis.nombre || '';
  const esDirector = getCurrentRole() === 'director';
  const modal = document.createElement('div');
  modal.id = 'analisis-modal';
  modal.className = 'an-modal';
  modal.innerHTML = `
    <div class="an-modal__caja">
      <div class="an-modal__barra">
        <strong>Análisis del Test Brújula</strong>
        <span class="an-modal__acciones">
          <button type="button" class="btn btn--primary" data-an="pdf">⬇ PDF</button>
          <button type="button" class="btn btn--primary" data-an="png">⬇ PNG</button>
          ${esDirector ? '<button type="button" class="btn btn--ghost" data-an="regenerar" title="Genera un análisis nuevo con IA">↻ Regenerar</button>' : ''}
          <button type="button" class="btn btn--ghost" data-an="cerrar" aria-label="Cerrar">✕</button>
        </span>
      </div>
      <div class="an-modal__cuerpo">${informeHtml(info.test.analisis, info.test, nombre)}</div>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener('click', async (ev) => {
    if (ev.target === modal) return cerrarModal();
    const btn = ev.target.closest('[data-an]');
    if (!btn) return;
    const accion = btn.dataset.an;
    if (accion === 'cerrar') return cerrarModal();
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Generando...';
    try {
      if (accion === 'png') await descargarPng(nombre);
      else if (accion === 'pdf') await descargarPdf(nombre);
      else if (accion === 'regenerar') {
        if (!confirm('Se generará un análisis nuevo y reemplazará al actual. ¿Continuar?')) { btn.disabled = false; btn.textContent = original; return; }
        await generar(testId, true);
        abrirModal(testId);
        return;
      }
    } catch (err) {
      console.error(err);
      alert(accion === 'regenerar' ? 'No se pudo regenerar el análisis. Intenta de nuevo.' : 'No se pudo generar el archivo. Intenta de nuevo.');
    }
    btn.disabled = false; btn.textContent = original;
  });
}

async function generar(testId, regenerar) {
  const info = registro.get(testId);
  const res = await analizarTestFn({ cicloId: info.cicloId, testId, regenerar: !!regenerar });
  info.test.analisis = res.data.analisis;
  document.querySelectorAll(`.btn-analisis-test[data-test-id="${CSS.escape(testId)}"]`).forEach(b => { b.textContent = textoBoton(info.test); });
}

// Captura: el clic en el botón no debe activar la fila/tarjeta que lo contiene.
document.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('.btn-analisis-test');
  if (!btn) return;
  ev.stopPropagation();
  const testId = btn.dataset.testId;
  const info = registro.get(testId);
  if (!info) return;
  if (info.test.analisis && info.test.analisis.datos) { abrirModal(testId); return; }
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'ANALIZANDO…';
  try {
    await generar(testId, false);
    abrirModal(testId);
  } catch (err) {
    console.error('No se pudo generar el análisis:', err);
    const msg = err && err.message && !/internal/i.test(err.message) ? err.message : 'No se pudo generar el análisis. Intenta de nuevo en un momento.';
    alert(msg);
    btn.textContent = original;
  } finally {
    btn.disabled = false;
  }
}, true);

document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrarModal(); });
