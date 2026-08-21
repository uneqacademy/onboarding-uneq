/* ============================================================
   test.js — Test Brújula de Claridad (metodología 2E)
   Fuente: Jotform oficial de UNEQ Mentoring.

   cargarTestParaCiclo(cicloId) la llama alumnos.js cada vez que
   se abre la ficha de un alumno. Cada test que se guarda queda
   como una entrada nueva en /ciclos/{cicloId}/tests/{testId} —
   nunca se sobreescribe, así se puede ver la evolución del
   alumno test a test. Si el ciclo ya tiene tests guardados, se
   muestra el historial (con el más reciente seleccionado); si
   no, se muestra el wizard interactivo desde cero.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, set, push } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import html2canvas from "https://esm.sh/html2canvas@1.4.1";

const root = document.getElementById('test-wizard-root');

const SECCIONES = [
  {
    key: 'fase1',
    titulo: 'Fase 1 · Claridad y Fundamentos (Tu ADN)',
    nota: 'Mide tus cimientos internos, tu propósito y la energía desde la cual creas tu negocio.',
    tipo: 'promedio',
    preguntas: [
      { id: 'f1_1', texto: '¿Cuán clara tienes la "misión" o el "para qué" profundo de tu negocio, más allá de ganar dinero?', ancla0: 'No lo he pensado', ancla10: "Tengo un 'para qué' definido que guía todas mis decisiones" },
      { id: 'f1_2', texto: '¿Tienes plena conciencia de tus dones, talentos únicos y la historia que te hace diferente a cualquier otra persona en tu mercado?', ancla0: 'No sé qué me hace diferente', ancla10: 'Tengo total claridad de mi diferenciación y la comunico' },
      { id: 'f1_3', texto: '¿Tienes una visión clara y motivadora de lo que quieres construir y cómo quieres que tu negocio impacte al mundo en 3-5 años?', ancla0: 'Voy día a día', ancla10: 'Tengo una visión clara, escrita e inspiradora' },
      { id: 'f1_4', texto: '¿Cómo es tu energía y mentalidad actual sobre "vender" tu servicio?', ancla0: 'Me carga. Siento que persigo, molesto o manipulo. Soy malo/a para vender.', ancla10: 'Me encanta. Es un acto de servicio, se me da natural y fluye con coherencia.' },
    ],
  },
  {
    key: 'saboteadores',
    titulo: 'Saboteadores Internos',
    nota: 'De 0 a 10, ¿qué tanto sientes que cada uno frena tus decisiones o acciones en tu negocio HOY?',
    tipo: 'barras',
    ancla0: 'No me afecta en absoluto',
    ancla10: 'Me bloquea constantemente',
    preguntas: [
      { id: 'sab_perfeccionista', texto: 'El PERFECCIONISTA — miedo a fallar, retocar sin fin, no lanzar', label: 'Perfeccionista' },
      { id: 'sab_procrastinador', texto: 'El PROCRASTINADOR — evadir lo importante, dejar para después', label: 'Procrastinador' },
      { id: 'sab_comparador', texto: 'El COMPARADOR — sentirse menos al ver a otros, "todos lo hacen mejor"', label: 'Comparador' },
      { id: 'sab_disperso', texto: 'El DISPERSO — "objeto brillante", saltar de idea en idea sin enfocar ni terminar', label: 'Disperso' },
      { id: 'sab_controlador', texto: 'El CONTROLADOR — necesidad de hacerlo todo tú, no delegar, no confiar', label: 'Controlador' },
      { id: 'sab_victima', texto: 'El VÍCTIMA — todo lo malo que me pasa es culpa de otros, no me hago responsable', label: 'Víctima' },
    ],
  },
  {
    key: 'bloqueosVenta',
    titulo: 'Bloqueos de Venta',
    nota: 'De 0 a 10, ¿qué tanto sientes que cada uno frena tu expansión y crecimiento HOY?',
    tipo: 'barras',
    ancla0: 'No me afecta en absoluto',
    ancla10: 'Me bloquea constantemente',
    preguntas: [
      { id: 'bv_rogar', texto: 'No quiero rogar, parecer vende humo o insistente', label: 'Miedo a "rogar"' },
      { id: 'bv_dinero', texto: 'Siento que les quito parte de su dinero importante para otras cosas al comprarme', label: 'Culpa por el dinero' },
      { id: 'bv_expectativas', texto: 'Me da miedo no poder cumplir expectativas o entregar lo prometido', label: 'Miedo a no cumplir' },
      { id: 'bv_perseguir', texto: 'No quiero ni me gusta perseguir o convencer a las personas', label: 'Rechazo a "perseguir"' },
      { id: 'bv_aburrir', texto: 'Mis clientes se aburrirán de mí si vendo todos los días', label: 'Miedo a aburrir' },
    ],
  },
  {
    key: 'fase2',
    titulo: 'Fase 2 · Cliente Soñado y Propuesta Única de Valor (Tu Conexión)',
    nota: 'Mide tu claridad para definir a quién sirves, qué transformación ofreces y la energía de esa conexión.',
    tipo: 'promedio',
    preguntas: [
      { id: 'f2_1', texto: '¿Has definido un nicho de mercado específico, rentable y alineado con tu propósito y tu "para qué"?', ancla0: 'Le hablo a todo el mundo / No me atrevo a elegir un nicho por miedo a perder clientes', ancla10: 'Tengo un nicho 100% definido, sé dónde encontrarlo y me encanta servirle' },
      { id: 'f2_2', texto: '¿Qué tan profundo es tu entendimiento de tu "Cliente Soñado" (Avatar) a nivel psicográfico?', ancla0: 'Solo sé sus datos demográficos (ej: mujer, 30-40)', ancla10: 'Entiendo sus miedos, deseos, valores y las frases exactas que usa' },
      { id: 'f2_3', texto: '¿Tienes una "Promesa" o Propuesta Única de Valor clara, que comunica la transformación específica que tu cliente logra contigo?', ancla0: "Vendo 'sesiones', 'cursos' o 'consultorías' (el vehículo)", ancla10: 'Tengo una frase clara del RESULTADO/TRANSFORMACIÓN que me diferencia radicalmente' },
      { id: 'f2_4', texto: '¿Tienes absoluta claridad de tu "Anti-Cliente" (a quién NO ayudas) y aplicas filtros claros?', ancla0: "Me cuesta decir 'no' / Acepto a casi cualquiera que esté dispuesto a pagar", ancla10: 'Tengo un manifiesto claro de mi cliente ideal y rechazo a quienes no están alineados' },
      { id: 'f2_5', texto: '¿Qué tan consciente eres de que tu negocio es un espejo de tu propia energía y mentalidad?', ancla0: 'No lo había pensado / No veo la conexión clara', ancla10: 'Lo integro al 100%. Debo vibrar y actuar desde ahí primero' },
    ],
  },
  {
    key: 'fase3',
    titulo: 'Fase 3 · Oferta y Método (Tu Puente de Transformación)',
    nota: 'Mide la estructura de tu producto/servicio: el "puente" tangible que mueve a tu cliente del punto A al punto B.',
    tipo: 'promedio',
    preguntas: [
      { id: 'f3_1', texto: '¿Tienes un producto o servicio claramente estructurado y "empaquetado", listo para vender?', ancla0: "Solo ideas sueltas / Vendo 'horas' o 'sesiones' sueltas sin estructura clara", ancla10: 'Tengo un programa/servicio empaquetado, con nombre, precio y estructura definidos' },
      { id: 'f3_2', texto: '¿Has desarrollado un "Método Propio" que forma la columna vertebral de tu producto?', ancla0: 'No tengo un método, entrego lo que sé en el momento según lo que surge', ancla10: 'Tengo un método propio, quizás con nombre y fases claras' },
      { id: 'f3_3', texto: '¿Tu producto está 100% diseñado como el "puente" del Punto A al Punto B que definiste en la Fase 2?', ancla0: 'Tiene mucha información, pero no estoy seguro/a si es el puente más directo', ancla10: 'Cada módulo/sesión es un paso intencional. No hay "relleno"' },
      { id: 'f3_4', texto: 'Siendo 100% honesto/a, ¿cuál es la intención principal con la que fue creado tu producto/servicio?', ancla0: "La intención principal es vender, generar ingresos y que 'funcione' para mí", ancla10: 'Está diseñado para la transformación real del cliente; la venta es consecuencia' },
      { id: 'f3_5', texto: '¿Cuánta energía y gozo sientes al entregar tu producto/servicio y ver los resultados de tus clientes?', ancla0: 'Es agotador / Termino drenado/a / Me frustro si no hay resultados rápido', ancla10: '¡Me llena de energía! Me emociono genuinamente con sus avances' },
    ],
  },
  {
    key: 'fase4',
    titulo: 'Fase 4 · Acción Alineada y Sistemas (Tu Voz al Mundo)',
    nota: 'Mide cómo comunicas tu valor y qué sistemas usas para atraer a tu cliente y vender tu oferta.',
    tipo: 'promedio',
    preguntas: [
      { id: 'f4_1', texto: '¿Tienes un sistema o "embudo" de ventas claro para vender tu oferta, y qué tan conforme estás con sus resultados?', ancla0: 'No tengo sistema, es al azar / no me ha dado los resultados que esperaba', ancla10: 'Tengo un sistema claro, predecible, y estoy conforme con los resultados' },
      { id: 'f4_2', texto: '¿Cómo es tu energía y claridad mental al momento de implementar acciones estratégicas para vender?', ancla0: "Confusión, agobio, es un 'deber ser'. No disfruto el proceso, me drena", ancla10: 'Claridad, foco, disfruto el proceso, ejecuto desde la certeza' },
      { id: 'f4_3', texto: '¿Qué tan creativo/a y auténtico/a te sientes al momento de comunicar tu mensaje y tu oferta?', ancla0: "Me siento 'tieso/a' o genérico/a, siento que copio a otros", ancla10: 'Me siento 100% auténtico/a. La creatividad fluye' },
      { id: 'f4_4', texto: '¿Cuál es tu nivel de conocimiento o comodidad con las campañas de publicidad pagada (Meta Ads)?', ancla0: 'Es un misterio total / me da miedo / he perdido dinero / dependo de un tercero', ancla10: 'Entiendo la lógica estratégica, cómodo/a delegándola o ejecutándola' },
      { id: 'f4_5', texto: '¿Cómo es tu relación general con la tecnología de marketing (IA, automatizaciones, email marketing, etc.)?', ancla0: "Me abruma / lo evito / me siento 'negado/a' para la tecnología", ancla10: 'En calma, la veo como aliada para escalar' },
    ],
  },
];

const TOTAL_PASOS = SECCIONES.length + 1; // + resumen final

function respuestasPorDefecto() {
  const respuestas = {};
  SECCIONES.forEach(sec => sec.preguntas.forEach(p => { respuestas[p.id] = 5; }));
  return respuestas;
}

let historial = [];              // todos los tests guardados de este ciclo, más reciente primero
let testSeleccionadoId = null;   // cuál se muestra en el detalle, dentro del historial
let state = { stepIndex: 0, respuestas: respuestasPorDefecto(), modo: 'wizard' };
let cicloIdActual = null;

/* --- Llamada desde alumnos.js cada vez que se abre una ficha --- */
export async function cargarTestParaCiclo(cicloId) {
  cicloIdActual = cicloId;
  if (!root) return;

  if (!cicloId) {
    root.innerHTML = '';
    return;
  }

  const snap = await get(ref(db, `ciclos/${cicloId}/tests`));
  historial = [];
  if (snap.exists()) {
    Object.entries(snap.val()).forEach(([id, datos]) => historial.push({ id, ...datos }));
    historial.sort((a, b) => b.completadoAt - a.completadoAt);
  }

  if (historial.length > 0) {
    testSeleccionadoId = historial[0].id;
    state = { stepIndex: 0, respuestas: respuestasPorDefecto(), modo: 'historial' };
  } else {
    testSeleccionadoId = null;
    state = { stepIndex: 0, respuestas: respuestasPorDefecto(), modo: 'wizard' };
  }
  render();
}

function render() {
  if (!root) return;
  if (state.modo === 'historial') {
    root.innerHTML = renderHistorial();
  } else if (state.stepIndex < SECCIONES.length) {
    root.innerHTML = renderPaso();
  } else {
    root.innerHTML = renderResumenNuevo();
  }
  bindEventos();
}

function renderPaso() {
  const seccion = SECCIONES[state.stepIndex];
  const paso = state.stepIndex + 1;
  const pct = Math.round((paso / TOTAL_PASOS) * 100);

  const preguntasHtml = seccion.preguntas.map(p => {
    const valor = state.respuestas[p.id];
    const ancla0 = p.ancla0 || seccion.ancla0;
    const ancla10 = p.ancla10 || seccion.ancla10;
    return `
      <div class="test-question">
        <div class="test-question__text">${p.texto}</div>
        <div class="test-slider-row">
          <input type="range" min="0" max="10" step="1" value="${valor}" data-qid="${p.id}">
          <div class="test-slider-value" data-qvalue="${p.id}">${valor}</div>
        </div>
        <div class="test-slider-labels"><span>${ancla0}</span><span>${ancla10}</span></div>
      </div>`;
  }).join('');

  const puedeVolver = historial.length > 0;

  return `
    <div class="panel">
      <div class="panel__body">
        <div class="wizard-header">
          <div class="wizard-header__top">
            <span class="wizard-header__step">Paso ${paso} de ${TOTAL_PASOS}</span>
            <span class="wizard-header__save" id="wizard-save-indicator">Guardado (local) ✓</span>
          </div>
          <div class="wizard-progress-track"><div class="wizard-progress-fill" style="width:${pct}%"></div></div>
        </div>
        <h3 class="wizard-title">${seccion.titulo}</h3>
        <p class="wizard-subtitle">${seccion.nota}</p>
        ${preguntasHtml}
        <div class="wizard-footer">
          <button class="btn btn--ghost" id="btn-test-prev" ${state.stepIndex === 0 && !puedeVolver ? 'disabled' : ''}>← ${state.stepIndex === 0 ? 'Volver al historial' : 'Anterior'}</button>
          <button class="btn btn--primary" id="btn-test-next">Siguiente →</button>
        </div>
      </div>
    </div>`;
}

function renderResumenContenido(respuestas) {
  return `
    <div class="panel mb-16">
      <div class="panel__body">
        <div class="result-panel-title">Promedios por Fase</div>
        <div class="result-panel-sub">Escala 0 (recién comenzando) a 10 (100% dominado)</div>
        <div class="kpi-grid" style="margin-bottom:0;">
          <div class="kpi-card"><div class="kpi-card__label">Fase 1 · Claridad y Fundamentos</div><div class="kpi-card__value accent">${promedioDe(respuestas, 'fase1')}</div></div>
          <div class="kpi-card"><div class="kpi-card__label">Fase 2 · Cliente Soñado</div><div class="kpi-card__value accent">${promedioDe(respuestas, 'fase2')}</div></div>
          <div class="kpi-card"><div class="kpi-card__label">Fase 3 · Oferta y Método</div><div class="kpi-card__value accent">${promedioDe(respuestas, 'fase3')}</div></div>
          <div class="kpi-card"><div class="kpi-card__label">Fase 4 · Acción y Sistemas</div><div class="kpi-card__value accent">${promedioDe(respuestas, 'fase4')}</div></div>
        </div>
      </div>
    </div>
    <div class="panel mb-16">
      <div class="panel__body">
        <div class="result-panel-title">Saboteadores Internos</div>
        <div class="result-panel-sub">0 = no me afecta · 10 = me bloquea constantemente</div>
        ${renderBarrasDe(respuestas, 'saboteadores')}
      </div>
    </div>
    <div class="panel mb-16">
      <div class="panel__body">
        <div class="result-panel-title">Bloqueos de Venta</div>
        <div class="result-panel-sub">0 = no me afecta · 10 = me bloquea constantemente</div>
        ${renderBarrasDe(respuestas, 'bloqueosVenta')}
      </div>
    </div>`;
}

function renderResumenNuevo() {
  return `
    ${renderResumenContenido(state.respuestas)}
    <div class="wizard-footer" style="border-top:none; padding-top:0;">
      <button class="btn btn--ghost" id="btn-test-prev">← Anterior</button>
      <button class="btn btn--accent" id="btn-test-guardar">Guardar resultado del test</button>
    </div>`;
}

function renderHistorial() {
  const filas = historial.map(t => {
    const fecha = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(t.completadoAt));
    const esActiva = t.id === testSeleccionadoId;
    return `<tr class="row-alumno fila-test-historial" data-test-id="${t.id}" style="${esActiva ? 'background:var(--color-accent-soft);' : ''}">
      <td>${fecha}${esActiva ? ' <span class="text-soft">(viendo)</span>' : ''}</td>
      <td>${t.promedios.fase1}</td><td>${t.promedios.fase2}</td>
      <td>${t.promedios.fase3}</td><td>${t.promedios.fase4}</td>
    </tr>`;
  }).join('');

  const seleccionado = historial.find(t => t.id === testSeleccionadoId) || historial[0];
  const fechaSeleccionado = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(seleccionado.completadoAt));

  return `
    <div class="panel mb-16">
      <div class="panel__header flex-between">
        <h3>Historial de Tests (${historial.length})</h3>
        <button class="btn btn--accent" id="btn-test-nuevo">+ Nuevo Test</button>
      </div>
      <div class="panel__body" style="padding:0;">
        <table class="data-table">
          <thead><tr><th>Fecha</th><th>Fase 1</th><th>Fase 2</th><th>Fase 3</th><th>Fase 4</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </div>
    <div class="flex-between mb-16">
      <p class="text-soft" style="margin:0;">Detalle del test seleccionado — haz clic en otra fila del historial para comparar.</p>
      <button class="btn btn--ghost" id="btn-descargar-imagen-test">Descargar Imagen (JPG)</button>
    </div>
    <div id="test-captura-imagen" style="background:#fff; padding:12px;">
      <h3 style="margin:0 0 4px;">${document.getElementById('ficha-nombre-alumno') ? document.getElementById('ficha-nombre-alumno').textContent.trim() : ''}</h3>
      <p class="text-soft" style="margin:0 0 16px;">Test Brújula — ${fechaSeleccionado}</p>
      ${renderResumenContenido(seleccionado.respuestas)}
    </div>`;
}

export function hayTestCompletado() {
  return historial.length > 0;
}

function renderBarrasDe(respuestas, seccionKey) {
  const sec = SECCIONES.find(s => s.key === seccionKey);
  return sec.preguntas.map(p => {
    const valor = respuestas[p.id];
    const nivel = valor <= 3 ? 'level-low' : valor <= 6 ? 'level-mid' : 'level-high';
    return `
      <div class="bar-chart-row">
        <div class="bar-label">${p.label}</div>
        <div class="bar-track"><div class="bar-fill ${nivel}" style="width:${valor * 10}%"></div></div>
        <div class="bar-value">${valor}</div>
      </div>`;
  }).join('');
}

function promedioDe(respuestas, seccionKey) {
  const sec = SECCIONES.find(s => s.key === seccionKey);
  const vals = sec.preguntas.map(p => respuestas[p.id]);
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

function volverAlHistorial() {
  if (historial.length === 0) return;
  testSeleccionadoId = historial[0].id;
  state.modo = 'historial';
  render();
}

function bindEventos() {
  const btnDescargarImagenTest = document.getElementById('btn-descargar-imagen-test');
  if (btnDescargarImagenTest) {
    btnDescargarImagenTest.addEventListener('click', async () => {
      btnDescargarImagenTest.disabled = true;
      btnDescargarImagenTest.textContent = 'Generando...';
      try {
        const nodo = document.getElementById('test-captura-imagen');
        const canvas = await html2canvas(nodo, { backgroundColor: '#ffffff', scale: 2 });
        const nombreAlumno = (document.getElementById('ficha-nombre-alumno')?.textContent || 'alumno').trim();
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/jpeg', 0.95);
        a.download = `test-brujula-${nombreAlumno}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        alert('No se pudo generar la imagen. Intenta de nuevo.');
      } finally {
        btnDescargarImagenTest.disabled = false;
        btnDescargarImagenTest.textContent = 'Descargar Imagen (JPG)';
      }
    });
  }

  root.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', () => {
      const qid = input.dataset.qid;
      state.respuestas[qid] = parseInt(input.value, 10);
      root.querySelector(`[data-qvalue="${qid}"]`).textContent = input.value;

      const indicador = document.getElementById('wizard-save-indicator');
      if (indicador) {
        indicador.classList.add('is-visible');
        clearTimeout(indicador._timeout);
        indicador._timeout = setTimeout(() => indicador.classList.remove('is-visible'), 1200);
      }
    });
  });

  const btnPrev = document.getElementById('btn-test-prev');
  const btnNext = document.getElementById('btn-test-next');
  const btnGuardar = document.getElementById('btn-test-guardar');
  const btnNuevo = document.getElementById('btn-test-nuevo');

  if (btnPrev) btnPrev.addEventListener('click', () => {
    if (state.stepIndex === 0) { volverAlHistorial(); return; }
    state.stepIndex--; render();
  });
  if (btnNext) btnNext.addEventListener('click', () => { state.stepIndex++; render(); });

  if (btnNuevo) btnNuevo.addEventListener('click', () => {
    state = { stepIndex: 0, respuestas: respuestasPorDefecto(), modo: 'wizard' };
    render();
  });

  if (btnGuardar) btnGuardar.addEventListener('click', async () => {
    if (!cicloIdActual) return;
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando...';

    const promedios = {
      fase1: parseFloat(promedioDe(state.respuestas, 'fase1')),
      fase2: parseFloat(promedioDe(state.respuestas, 'fase2')),
      fase3: parseFloat(promedioDe(state.respuestas, 'fase3')),
      fase4: parseFloat(promedioDe(state.respuestas, 'fase4'))
    };

    const nuevoRef = push(ref(db, `ciclos/${cicloIdActual}/tests`));
    await set(nuevoRef, { respuestas: state.respuestas, promedios, completadoAt: Date.now() });

    await cargarTestParaCiclo(cicloIdActual); // recarga el historial completo y selecciona el nuevo
  });

  root.querySelectorAll('.fila-test-historial').forEach(row => {
    row.addEventListener('click', () => {
      testSeleccionadoId = row.dataset.testId;
      render();
    });
  });
}
