/* ============================================================
   agendamiento-mock.js — VISTA PREVIA con datos de prueba.
   Implementa el flujo completo del lado del lead (calendario →
   horarios → preguntas → confirmación) para revisar la experiencia
   antes de conectarlo a Firebase real. Nada de esto llama a la base
   de datos todavía: "cargarConfigMock" y "cargarDisponibilidadMock"
   son los dos puntos que se van a reemplazar por lecturas reales de
   agendamiento/config y agendamiento/disponibilidad en la fase 4 del
   diseño (DISENO-AGENDAMIENTO.md), sin tocar el resto del archivo.
   ============================================================ */

const ZONA_VIEWER = Intl.DateTimeFormat().resolvedOptions().timeZone;
const DURACION_HOLD_MS = 10 * 60 * 1000;

/* --- "Base de datos" de prueba --- */
function cargarConfigMock() {
  return {
    duracionMinutos: 45,
    anticipacionMinimaHoras: 2,
    diasMaximoFuturo: 14,
    whatsappDudasNumero: '56900000000', // reemplazar por el número real
    preguntas: [
      { id: 'q1', tipo: 'texto_corto', texto: '¿En qué rubro o industria trabaja tu negocio?', obligatoria: true },
      { id: 'q2', tipo: 'seleccion_unica', texto: '¿Cuál es tu principal desafío hoy?', obligatoria: true,
        opciones: ['Conseguir clientes', 'Cerrar ventas', 'Organizar el equipo', 'Otro'] },
      { id: 'q3', tipo: 'numero', texto: '¿Cuántas ventas hiciste el mes pasado, aprox.?', obligatoria: false },
      { id: 'q4', tipo: 'texto_largo', texto: 'Cuéntanos brevemente qué te gustaría lograr', obligatoria: true }
    ]
  };
}

// Genera cupos de prueba: 2 a 4 bloques por día hábil, algunos días
// llenos (sin cupo) para poder ver ambos estados en el calendario.
function cargarDisponibilidadMock(config) {
  const dias = {};
  const ahora = new Date();
  for (let i = 0; i < config.diasMaximoFuturo + 3; i++) {
    const fecha = new Date(ahora);
    fecha.setDate(fecha.getDate() + i);
    const diaSemana = fecha.getDay(); // 0 domingo ... 6 sábado
    if (diaSemana === 0 || diaSemana === 6) continue; // sin fines de semana en esta prueba
    const clave = claveFecha(fecha);
    const lleno = (i % 5 === 3); // un día de cada cinco, lleno a propósito
    const horas = [10, 11, 12, 15, 16, 17].filter((_, idx) => !lleno && (i + idx) % 3 !== 2);
    if (!horas.length && !lleno) continue;
    dias[clave] = horas.map(h => {
      const inicio = new Date(fecha); inicio.setHours(h, 0, 0, 0);
      return { inicioMs: inicio.getTime(), cuposLibres: lleno ? 0 : (1 + ((h + i) % 3)) };
    });
  }
  return dias;
}

function claveFecha(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/* --- Estado de la sesión de agendamiento --- */
const estado = {
  config: null,
  disponibilidad: null,
  mesVisible: new Date(),
  diaElegido: null,
  slotElegido: null,
  holdVenceEn: null,
  holdIntervalo: null,
  respuestas: {}
};

const els = {};
['ag-vista-cargando', 'ag-vista-calendario', 'ag-vista-preguntas', 'ag-vista-confirmacion', 'ag-vista-error',
 'ag-cal-mes', 'ag-cal-grid', 'ag-cal-prev', 'ag-cal-next', 'ag-horarios-bloque', 'ag-horarios-fecha', 'ag-horarios-grid', 'ag-tz-nota',
 'ag-reserva-timer', 'ag-preguntas-resumen', 'ag-form-preguntas', 'ag-btn-volver-horarios', 'ag-btn-confirmar',
 'ag-conf-fecha', 'ag-conf-hora', 'ag-btn-agregar-calendario', 'ag-btn-whatsapp-dudas'
].forEach(id => { els[id] = document.getElementById(id); });

function mostrarVista(id) {
  ['ag-vista-cargando', 'ag-vista-calendario', 'ag-vista-preguntas', 'ag-vista-confirmacion', 'ag-vista-error'].forEach(v => {
    els[v].classList.toggle('hidden', v !== id);
  });
  document.querySelectorAll('.ag-paso').forEach((el, idx) => {
    const activoIdx = { 'ag-vista-calendario': 0, 'ag-vista-preguntas': 1, 'ag-vista-confirmacion': 2 }[id];
    el.classList.toggle('is-hecho', activoIdx !== undefined && idx < activoIdx);
    el.classList.toggle('is-activo', idx === activoIdx);
  });
}

/* --- Calendario --- */
function renderCalendario() {
  const mes = estado.mesVisible;
  const mesTxt = mes.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  els['ag-cal-mes'].textContent = mesTxt.charAt(0).toUpperCase() + mesTxt.slice(1);

  const primerDiaMes = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const diasEnMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
  const offsetInicio = (primerDiaMes.getDay() + 6) % 7; // lunes = 0

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const limiteFuturo = new Date(hoy); limiteFuturo.setDate(limiteFuturo.getDate() + estado.config.diasMaximoFuturo);

  let html = '';
  for (let i = 0; i < offsetInicio; i++) html += '<div class="ag-cal-dia ag-vacio"></div>';
  for (let d = 1; d <= diasEnMes; d++) {
    const fecha = new Date(mes.getFullYear(), mes.getMonth(), d);
    const clave = claveFecha(fecha);
    const slots = estado.disponibilidad[clave] || [];
    const hayCupo = slots.some(s => s.cuposLibres > 0) && fecha >= hoy && fecha <= limiteFuturo;
    const esSeleccionado = estado.diaElegido === clave;
    html += `<button type="button" class="ag-cal-dia ${hayCupo ? 'ag-disponible' : ''} ${esSeleccionado ? 'ag-seleccionado' : ''}" ${hayCupo ? `data-fecha="${clave}"` : 'disabled'}>${d}</button>`;
  }
  els['ag-cal-grid'].innerHTML = html;

  const primerMesPosible = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  els['ag-cal-prev'].disabled = mes.getFullYear() === primerMesPosible.getFullYear() && mes.getMonth() === primerMesPosible.getMonth();
  els['ag-cal-next'].disabled = new Date(mes.getFullYear(), mes.getMonth() + 1, 1) > limiteFuturo;

  els['ag-cal-grid'].querySelectorAll('[data-fecha]').forEach(btn => {
    btn.addEventListener('click', () => { estado.diaElegido = btn.dataset.fecha; renderCalendario(); renderHorarios(); });
  });
}

function renderHorarios() {
  const slots = (estado.disponibilidad[estado.diaElegido] || []).filter(s => s.cuposLibres > 0).sort((a, b) => a.inicioMs - b.inicioMs);
  const fechaObj = new Date(estado.diaElegido + 'T00:00:00');
  els['ag-horarios-fecha'].textContent = fechaObj.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  els['ag-horarios-grid'].innerHTML = slots.map(s => {
    const hora = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_VIEWER }).format(new Date(s.inicioMs));
    return `<button type="button" class="ag-horario-btn" data-inicio="${s.inicioMs}">${hora}</button>`;
  }).join('');
  els['ag-tz-nota'].textContent = `Horarios en tu hora local (${ZONA_VIEWER.replace('_', ' ')}).`;
  els['ag-horarios-bloque'].classList.remove('hidden');

  els['ag-horarios-grid'].querySelectorAll('[data-inicio]').forEach(btn => {
    btn.addEventListener('click', () => {
      els['ag-horarios-grid'].querySelectorAll('.ag-horario-btn').forEach(b => b.classList.remove('is-elegido'));
      btn.classList.add('is-elegido');
      estado.slotElegido = Number(btn.dataset.inicio);
      iniciarHold();
    });
  });
}

/* --- Hold de 10 minutos --- */
function iniciarHold() {
  estado.holdVenceEn = Date.now() + DURACION_HOLD_MS;
  clearInterval(estado.holdIntervalo);
  renderPreguntas();
  mostrarVista('ag-vista-preguntas');
  actualizarTimerHold();
  estado.holdIntervalo = setInterval(actualizarTimerHold, 1000);
}
function actualizarTimerHold() {
  const restanteMs = estado.holdVenceEn - Date.now();
  if (restanteMs <= 0) {
    clearInterval(estado.holdIntervalo);
    alert('Se acabó el tiempo para completar la reserva. Ese horario quedó libre de nuevo — elige uno para seguir.');
    volverACalendario();
    return;
  }
  const m = Math.floor(restanteMs / 60000);
  const s = Math.floor((restanteMs % 60000) / 1000);
  els['ag-reserva-timer'].textContent = `${m}:${String(s).padStart(2, '0')}`;
}
function volverACalendario() {
  clearInterval(estado.holdIntervalo);
  estado.slotElegido = null;
  mostrarVista('ag-vista-calendario');
}

/* --- Preguntas dinámicas --- */
function renderPreguntas() {
  const fechaObj = new Date(estado.slotElegido);
  const fechaTxt = fechaObj.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  const horaTxt = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_VIEWER }).format(fechaObj);
  els['ag-preguntas-resumen'].textContent = `Tu llamada: ${fechaTxt}, ${horaTxt} hrs.`;

  const camposFijos = `
    <div class="ag-field"><label>Nombre completo <span class="ag-req">*</span></label><input type="text" name="nombre" required></div>
    <div class="ag-field"><label>Correo <span class="ag-req">*</span></label><input type="email" name="correo" required></div>
    <div class="ag-field"><label>Teléfono (con WhatsApp) <span class="ag-req">*</span></label><input type="tel" name="telefono" required></div>
  `;
  const preguntasHtml = estado.config.preguntas.map(p => renderPregunta(p)).join('');
  els['ag-form-preguntas'].innerHTML = camposFijos + preguntasHtml;

  els['ag-form-preguntas'].querySelectorAll('.ag-opcion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const contenedor = btn.closest('[data-pregunta-id]');
      const multiple = contenedor.dataset.multiple === '1';
      if (!multiple) contenedor.querySelectorAll('.ag-opcion-btn').forEach(b => b.classList.remove('is-elegida'));
      btn.classList.toggle('is-elegida');
    });
  });
}

function renderPregunta(p) {
  const req = p.obligatoria ? '<span class="ag-req">*</span>' : '<span style="color:var(--color-ink-soft); font-weight:400;">(opcional)</span>';
  if (p.tipo === 'texto_corto' || p.tipo === 'numero') {
    return `<div class="ag-field"><label>${p.texto} ${req}</label><input type="${p.tipo === 'numero' ? 'number' : 'text'}" name="${p.id}" ${p.obligatoria ? 'required' : ''}></div>`;
  }
  if (p.tipo === 'texto_largo') {
    return `<div class="ag-field"><label>${p.texto} ${req}</label><textarea name="${p.id}" ${p.obligatoria ? 'required' : ''}></textarea></div>`;
  }
  if (p.tipo === 'seleccion_unica' || p.tipo === 'seleccion_multiple') {
    const multiple = p.tipo === 'seleccion_multiple';
    return `<div class="ag-field" data-pregunta-id="${p.id}" data-multiple="${multiple ? '1' : '0'}">
      <label>${p.texto} ${req}</label>
      <div class="ag-opciones">${p.opciones.map(o => `<button type="button" class="ag-opcion-btn">${o}</button>`).join('')}</div>
    </div>`;
  }
  return '';
}

els['ag-btn-volver-horarios'].addEventListener('click', volverACalendario);
els['ag-form-preguntas'].addEventListener('submit', (ev) => {
  ev.preventDefault();
  // Validar selección única/múltiple obligatoria (los botones no son <input>, así que HTML5 no los valida solo)
  let faltaAlguna = false;
  els['ag-form-preguntas'].querySelectorAll('[data-pregunta-id]').forEach(cont => {
    const preguntaId = cont.dataset.preguntaId;
    const def = estado.config.preguntas.find(p => p.id === preguntaId);
    const elegidas = [...cont.querySelectorAll('.ag-opcion-btn.is-elegida')].map(b => b.textContent);
    if (def.obligatoria && !elegidas.length) { cont.style.outline = '1.5px solid var(--color-danger)'; faltaAlguna = true; }
    else { cont.style.outline = 'none'; estado.respuestas[preguntaId] = elegidas; }
  });
  if (faltaAlguna) { alert('Falta responder alguna pregunta obligatoria.'); return; }

  const datos = new FormData(els['ag-form-preguntas']);
  for (const [k, v] of datos.entries()) estado.respuestas[k] = v;
  confirmarAgenda();
});

/* --- Confirmación --- */
function confirmarAgenda() {
  clearInterval(estado.holdIntervalo);
  // En la versión real: acá se escribe la solicitud en Firebase (citas/),
  // el servidor asigna closer por rotación, crea el evento+Meet, y esta
  // pantalla espera el resultado (mismo patrón que arreglar-correo.html).
  const fechaObj = new Date(estado.slotElegido);
  els['ag-conf-fecha'].textContent = fechaObj.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  els['ag-conf-hora'].textContent = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_VIEWER }).format(fechaObj) + ' hrs';

  const numeroWa = estado.config.whatsappDudasNumero;
  els['ag-btn-whatsapp-dudas'].href = `https://wa.me/${numeroWa}?text=${encodeURIComponent('Hola, tengo una duda sobre mi llamada agendada.')}`;

  els['ag-btn-agregar-calendario'].onclick = () => descargarIcs(fechaObj, estado.config.duracionMinutos);

  mostrarVista('ag-vista-confirmacion');
}

function descargarIcs(fechaInicio, duracionMinutos) {
  const fechaFin = new Date(fechaInicio.getTime() + duracionMinutos * 60000);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UNEQ Mentoring//Agendamiento//ES', 'BEGIN:VEVENT',
    `UID:${Date.now()}@uneqacademy.com`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(fechaInicio)}`,
    `DTEND:${fmt(fechaFin)}`,
    'SUMMARY:Llamada con UNEQ Mentoring',
    'DESCRIPTION:Tu llamada agendada con el equipo de UNEQ. El link de la videollamada llega por correo.',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'llamada-uneq.ics'; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

els['ag-cal-prev'].addEventListener('click', () => { estado.mesVisible.setMonth(estado.mesVisible.getMonth() - 1); renderCalendario(); });
els['ag-cal-next'].addEventListener('click', () => { estado.mesVisible.setMonth(estado.mesVisible.getMonth() + 1); renderCalendario(); });

/* --- Arranque --- */
(function init() {
  estado.config = cargarConfigMock();
  estado.disponibilidad = cargarDisponibilidadMock(estado.config);
  renderCalendario();
  mostrarVista('ag-vista-calendario');
})();
