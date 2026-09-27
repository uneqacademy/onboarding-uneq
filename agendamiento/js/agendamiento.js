/* ============================================================
   agendamiento.js — página pública (sin login) del lead. Ya conecta
   a Firebase de verdad: lee agendamiento/cuposPublicos y
   agendamiento/config/preguntas (lectura pública, sin sesión), y
   para reservar/confirmar escribe una "solicitud" y espera el
   resultado que escribe la Cloud Function — mismo patrón que
   arreglar-correo.html, porque este proyecto no puede tener
   funciones HTTPS públicas nuevas (política de Google Cloud).

   Con ?token=XXX en la URL entra en modo reagendar/cancelar.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, push, set, onValue, off } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

const ZONA_VIEWER = Intl.DateTimeFormat().resolvedOptions().timeZone;
const params = new URLSearchParams(window.location.search);
const tokenAccion = params.get('token');

const els = {};
['ag-vista-cargando', 'ag-vista-calendario', 'ag-vista-preguntas', 'ag-vista-confirmacion', 'ag-vista-accion', 'ag-vista-resultado', 'ag-vista-error',
 'ag-cal-mes', 'ag-cal-grid', 'ag-cal-prev', 'ag-cal-next', 'ag-horarios-bloque', 'ag-horarios-fecha', 'ag-horarios-grid', 'ag-tz-nota',
 'ag-reserva-timer', 'ag-preguntas-resumen', 'ag-form-preguntas', 'ag-btn-volver-horarios', 'ag-btn-confirmar',
 'ag-conf-fecha', 'ag-conf-hora', 'ag-btn-agregar-calendario', 'ag-btn-whatsapp-dudas',
 'ag-accion-fecha', 'ag-accion-hora', 'ag-btn-ir-reagendar', 'ag-btn-cancelar-cita',
 'ag-resultado-icono', 'ag-resultado-titulo', 'ag-resultado-texto', 'ag-resultado-whatsapp'
].forEach(id => { els[id] = document.getElementById(id); });

function mostrarVista(id) {
  ['ag-vista-cargando', 'ag-vista-calendario', 'ag-vista-preguntas', 'ag-vista-confirmacion', 'ag-vista-accion', 'ag-vista-resultado', 'ag-vista-error'].forEach(v => {
    els[v].classList.toggle('hidden', v !== id);
  });
  document.querySelectorAll('.ag-paso').forEach((el, idx) => {
    const activoIdx = { 'ag-vista-calendario': 0, 'ag-vista-preguntas': 1, 'ag-vista-confirmacion': 2 }[id];
    el.classList.toggle('is-hecho', activoIdx !== undefined && idx < activoIdx);
    el.classList.toggle('is-activo', idx === activoIdx);
  });
}
function mostrarError(texto) { els['ag-vista-error'].textContent = texto; mostrarVista('ag-vista-error'); }

/* --- Escribe una solicitud y espera su "resultado" (mismo patrón que arreglar-correo.html) --- */
function pedirYEsperar(nodo, datos, timeoutMs = 20000) {
  return new Promise(async (resolve, reject) => {
    const solicitudRef = push(ref(db, nodo));
    await set(solicitudRef, { ...datos, createdAt: Date.now() });
    const timeoutId = setTimeout(() => { off(solicitudRef); reject(new Error('Se demoró demasiado. Intenta de nuevo.')); }, timeoutMs);
    onValue(solicitudRef, (snap) => {
      const val = snap.val();
      if (!val || !val.resultado) return;
      clearTimeout(timeoutId); off(solicitudRef);
      resolve(val.resultado);
    });
  });
}

let configGlobal = { general: {}, preguntas: {} };
let diaElegido = null, mesVisible = new Date();
let holdActual = null; // { holdId, claveSlot, expiraEn }
let holdIntervalo = null;
let modoReagendar = false;

/* --- Calendario público --- */
async function cargarCupos() {
  const snap = await get(ref(db, 'agendamiento/cuposPublicos'));
  return snap.exists() ? snap.val() : {};
}
function claveFecha(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

async function iniciarCalendario() {
  const [genSnap, preguntasSnap, cupos] = await Promise.all([
    get(ref(db, 'agendamiento/config/general')), get(ref(db, 'agendamiento/config/preguntas')), cargarCupos()
  ]);
  configGlobal.general = genSnap.exists() ? genSnap.val() : {};
  configGlobal.preguntas = preguntasSnap.exists() ? Object.entries(preguntasSnap.val() || {}) : [];
  configGlobal.cupos = cupos;
  renderCalendario();
  mostrarVista('ag-vista-calendario');
}

function renderCalendario() {
  const mesTxt = mesVisible.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  els['ag-cal-mes'].textContent = mesTxt.charAt(0).toUpperCase() + mesTxt.slice(1);

  const primerDiaMes = new Date(mesVisible.getFullYear(), mesVisible.getMonth(), 1);
  const diasEnMes = new Date(mesVisible.getFullYear(), mesVisible.getMonth() + 1, 0).getDate();
  const offsetInicio = (primerDiaMes.getDay() + 6) % 7;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  let html = '';
  for (let i = 0; i < offsetInicio; i++) html += '<div class="ag-cal-dia ag-vacio"></div>';
  for (let d = 1; d <= diasEnMes; d++) {
    const fecha = new Date(mesVisible.getFullYear(), mesVisible.getMonth(), d);
    const clave = claveFecha(fecha);
    const horas = configGlobal.cupos[clave];
    const hayCupo = horas && Object.values(horas).some(c => c > 0) && fecha >= hoy;
    const esSeleccionado = diaElegido === clave;
    html += `<button type="button" class="ag-cal-dia ${hayCupo ? 'ag-disponible' : ''} ${esSeleccionado ? 'ag-seleccionado' : ''}" ${hayCupo ? `data-fecha="${clave}"` : 'disabled'}>${d}</button>`;
  }
  els['ag-cal-grid'].innerHTML = html;
  els['ag-cal-prev'].disabled = mesVisible <= new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  els['ag-cal-grid'].querySelectorAll('[data-fecha]').forEach(btn => {
    btn.addEventListener('click', () => { diaElegido = btn.dataset.fecha; renderCalendario(); renderHorarios(); });
  });
}
function renderHorarios() {
  const horas = configGlobal.cupos[diaElegido] || {};
  const fechaObj = new Date(diaElegido + 'T00:00:00');
  els['ag-horarios-fecha'].textContent = fechaObj.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  const entradas = Object.entries(horas).filter(([, c]) => c > 0).sort((a, b) => Number(a[0]) - Number(b[0]));
  els['ag-horarios-grid'].innerHTML = entradas.map(([ms]) => {
    const hora = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_VIEWER }).format(new Date(Number(ms)));
    return `<button type="button" class="ag-horario-btn" data-ms="${ms}">${hora}</button>`;
  }).join('');
  els['ag-tz-nota'].textContent = `Horarios en tu hora local (${ZONA_VIEWER.replace('_', ' ')}).`;
  els['ag-horarios-bloque'].classList.remove('hidden');
  els['ag-horarios-grid'].querySelectorAll('[data-ms]').forEach(btn => {
    btn.addEventListener('click', () => seleccionarHorario(Number(btn.dataset.ms)));
  });
}

/* --- Hold + preguntas (agenda nueva) --- */
async function seleccionarHorario(inicioMs) {
  mostrarVista('ag-vista-cargando');
  try {
    const resultado = await pedirYEsperar('agendamiento/solicitudesHold', { claveSlot: String(inicioMs) });
    if (resultado.estado !== 'ok') {
      alert('Ese horario ya no está disponible. Elige otro.');
      configGlobal.cupos = await cargarCupos();
      renderCalendario();
      if (modoReagendar) mostrarVista('ag-vista-calendario'); else { renderHorarios(); mostrarVista('ag-vista-calendario'); }
      return;
    }
    if (modoReagendar) {
      await confirmarReagendo(inicioMs, resultado.holdId);
      return;
    }
    holdActual = { holdId: resultado.holdId, claveSlot: String(inicioMs), expiraEn: resultado.expiraEn, inicioMs };
    iniciarHold();
  } catch (err) {
    mostrarError('No pudimos procesar tu reserva. Intenta de nuevo en un momento.');
  }
}
async function confirmarReagendo(inicioMs, holdId) {
  mostrarVista('ag-vista-cargando');
  try {
    const resultado = await pedirYEsperar('agendamiento/solicitudesAccion', {
      token: tokenAccion, accion: 'reagendar', nuevaClaveSlot: String(inicioMs), nuevoHoldId: holdId
    });
    if (resultado.estado !== 'ok') {
      alert(resultado.mensaje || 'No se pudo reagendar. Intenta de nuevo.');
      configGlobal.cupos = await cargarCupos();
      renderCalendario(); mostrarVista('ag-vista-calendario');
      return;
    }
    mostrarConfirmacion(resultado);
  } catch (err) {
    mostrarError('No se pudo reagendar. Intenta de nuevo en un momento.');
  }
}
function iniciarHold() {
  clearInterval(holdIntervalo);
  renderPreguntas();
  mostrarVista('ag-vista-preguntas');
  actualizarTimerHold();
  holdIntervalo = setInterval(actualizarTimerHold, 1000);
}
function actualizarTimerHold() {
  const restante = holdActual.expiraEn - Date.now();
  if (restante <= 0) {
    clearInterval(holdIntervalo);
    alert('Se acabó el tiempo para completar la reserva. Ese horario quedó libre de nuevo — elige uno para seguir.');
    volverACalendario();
    return;
  }
  const m = Math.floor(restante / 60000), s = Math.floor((restante % 60000) / 1000);
  els['ag-reserva-timer'].textContent = `${m}:${String(s).padStart(2, '0')}`;
}
async function volverACalendario() {
  clearInterval(holdIntervalo);
  holdActual = null;
  configGlobal.cupos = await cargarCupos();
  renderCalendario();
  mostrarVista('ag-vista-calendario');
}

function renderPregunta(p) {
  const req = p.obligatoria ? '<span class="ag-req">*</span>' : '<span style="color:var(--color-ink-soft); font-weight:400;">(opcional)</span>';
  if (p.tipo === 'texto_corto' || p.tipo === 'numero' || p.tipo === 'telefono' || p.tipo === 'correo') {
    const tipoInput = { numero: 'number', telefono: 'tel', correo: 'email' }[p.tipo] || 'text';
    return `<div class="ag-field"><label>${p.texto} ${req}</label><input type="${tipoInput}" name="${p.id}" ${p.obligatoria ? 'required' : ''}></div>`;
  }
  if (p.tipo === 'texto_largo') return `<div class="ag-field"><label>${p.texto} ${req}</label><textarea name="${p.id}" ${p.obligatoria ? 'required' : ''}></textarea></div>`;
  if (p.tipo === 'si_no') {
    return `<div class="ag-field" data-pregunta-id="${p.id}" data-multiple="0"><label>${p.texto} ${req}</label><div class="ag-opciones">${['Sí', 'No'].map(o => `<button type="button" class="ag-opcion-btn">${o}</button>`).join('')}</div></div>`;
  }
  if (p.tipo === 'seleccion_unica' || p.tipo === 'seleccion_multiple') {
    const multiple = p.tipo === 'seleccion_multiple';
    return `<div class="ag-field" data-pregunta-id="${p.id}" data-multiple="${multiple ? '1' : '0'}"><label>${p.texto} ${req}</label><div class="ag-opciones">${(p.opciones || []).map(o => `<button type="button" class="ag-opcion-btn">${o}</button>`).join('')}</div></div>`;
  }
  return '';
}
function renderPreguntas() {
  const fechaTxt = new Date(holdActual.inicioMs).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  const horaTxt = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_VIEWER }).format(new Date(holdActual.inicioMs));
  els['ag-preguntas-resumen'].textContent = `Tu llamada: ${fechaTxt}, ${horaTxt} hrs.`;
  const camposFijos = `
    <div class="ag-field"><label>Nombre completo <span class="ag-req">*</span></label><input type="text" name="nombre" required></div>
    <div class="ag-field"><label>Correo <span class="ag-req">*</span></label><input type="email" name="correo" required></div>
    <div class="ag-field"><label>Teléfono (con WhatsApp) <span class="ag-req">*</span></label><input type="tel" name="telefono" required></div>`;
  const listaPreguntas = configGlobal.preguntas.map(([, p]) => p).sort((a, b) => (a.orden || 0) - (b.orden || 0));
  els['ag-form-preguntas'].innerHTML = camposFijos + listaPreguntas.map(renderPregunta).join('');
  els['ag-form-preguntas'].querySelectorAll('.ag-opcion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cont = btn.closest('[data-pregunta-id]');
      if (cont.dataset.multiple !== '1') cont.querySelectorAll('.ag-opcion-btn').forEach(b => b.classList.remove('is-elegida'));
      btn.classList.toggle('is-elegida');
    });
  });
}
els['ag-btn-volver-horarios'].addEventListener('click', volverACalendario);
els['ag-form-preguntas'].addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const listaPreguntas = configGlobal.preguntas.map(([id, p]) => ({ id, ...p }));
  const respuestas = {};
  let faltaAlguna = false;
  els['ag-form-preguntas'].querySelectorAll('[data-pregunta-id]').forEach(cont => {
    const p = listaPreguntas.find(x => x.id === cont.dataset.preguntaId);
    const elegidas = [...cont.querySelectorAll('.ag-opcion-btn.is-elegida')].map(b => b.textContent);
    if (p.obligatoria && !elegidas.length) { cont.style.outline = '1.5px solid var(--color-danger)'; faltaAlguna = true; }
    else { cont.style.outline = 'none'; if (elegidas.length) respuestas[p.texto] = elegidas.join(', '); }
  });
  if (faltaAlguna) { alert('Falta responder alguna pregunta obligatoria.'); return; }

  const datos = new FormData(els['ag-form-preguntas']);
  const nombre = datos.get('nombre'), correo = datos.get('correo'), telefono = datos.get('telefono');
  listaPreguntas.forEach(p => {
    if (['texto_corto', 'texto_largo', 'numero', 'telefono', 'correo'].includes(p.tipo)) {
      const v = datos.get(p.id); if (v) respuestas[p.texto] = v;
    }
  });

  els['ag-btn-confirmar'].disabled = true; els['ag-btn-confirmar'].textContent = 'Confirmando…';
  try {
    const resultado = await pedirYEsperar('agendamiento/solicitudesConfirmar', {
      holdId: holdActual.holdId, claveSlot: holdActual.claveSlot, nombre, correo, telefono, respuestas
    });
    clearInterval(holdIntervalo);
    if (resultado.estado !== 'ok') { alert(resultado.mensaje || 'No se pudo confirmar. Intenta de nuevo.'); volverACalendario(); return; }
    mostrarConfirmacion(resultado);
  } catch (err) {
    alert('No se pudo confirmar. Intenta de nuevo.');
  } finally {
    els['ag-btn-confirmar'].disabled = false; els['ag-btn-confirmar'].textContent = 'Confirmar agenda';
  }
});

function mostrarConfirmacion(resultado) {
  els['ag-conf-fecha'].textContent = new Date(resultado.inicioMs).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONA_VIEWER });
  els['ag-conf-hora'].textContent = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_VIEWER }).format(new Date(resultado.inicioMs)) + ' hrs';
  els['ag-btn-whatsapp-dudas'].href = `https://wa.me/${resultado.whatsappDudasNumero}?text=${encodeURIComponent('Hola, tengo una duda sobre mi llamada agendada.')}`;
  els['ag-btn-agregar-calendario'].onclick = () => descargarIcs(resultado.inicioMs, resultado.duracionMinutos);
  mostrarVista('ag-vista-confirmacion');
}
function descargarIcs(inicioMs, duracionMinutos) {
  const fin = new Date(inicioMs + duracionMinutos * 60000);
  const fmt = (d) => new Date(d).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UNEQ Mentoring//Agendamiento//ES', 'BEGIN:VEVENT',
    `UID:${inicioMs}@uneqacademy.com`, `DTSTAMP:${fmt(Date.now())}`, `DTSTART:${fmt(inicioMs)}`, `DTEND:${fmt(fin)}`,
    'SUMMARY:Llamada con UNEQ Mentoring', 'DESCRIPTION:Tu llamada agendada con el equipo de UNEQ.', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'llamada-uneq.ics'; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

els['ag-cal-prev'].addEventListener('click', () => { mesVisible.setMonth(mesVisible.getMonth() - 1); renderCalendario(); });
els['ag-cal-next'].addEventListener('click', () => { mesVisible.setMonth(mesVisible.getMonth() + 1); renderCalendario(); });

/* --- Modo reagendar / cancelar (?token=) --- */
async function iniciarModoAccion() {
  mostrarVista('ag-vista-cargando');
  try {
    const resultado = await pedirYEsperar('agendamiento/solicitudesAccion', { token: tokenAccion, accion: 'consultar' });
    if (resultado.estado !== 'ok') { mostrarError(resultado.mensaje || 'Este link ya no es válido.'); return; }
    if (resultado.citaEstado !== 'agendada') { mostrarError('Esta cita ya no está activa (fue cancelada o reagendada anteriormente).'); return; }

    els['ag-accion-fecha'].textContent = new Date(resultado.inicioMs).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONA_VIEWER });
    els['ag-accion-hora'].textContent = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_VIEWER }).format(new Date(resultado.inicioMs)) + ' hrs';
    els['ag-btn-ir-reagendar'].disabled = !!resultado.reagendoUsado;
    if (resultado.reagendoUsado) els['ag-btn-ir-reagendar'].textContent = 'Ya usaste tu opción de reagendar';
    mostrarVista('ag-vista-accion');

    els['ag-btn-ir-reagendar'].onclick = async () => {
      if (resultado.reagendoUsado) return;
      modoReagendar = true;
      await iniciarCalendario();
    };
    els['ag-btn-cancelar-cita'].onclick = async () => {
      if (!confirm('¿Seguro que quieres cancelar tu llamada con UNEQ?')) return;
      mostrarVista('ag-vista-cargando');
      const r = await pedirYEsperar('agendamiento/solicitudesAccion', { token: tokenAccion, accion: 'cancelar' });
      mostrarResultadoAccion(r.estado === 'ok', r.mensaje || 'Tu cita fue cancelada.');
    };
  } catch (err) {
    mostrarError('No pudimos cargar tu cita. Intenta de nuevo en un momento.');
  }
}
function mostrarResultadoAccion(ok, texto) {
  els['ag-resultado-icono'].textContent = ok ? '✓' : '✕';
  els['ag-resultado-icono'].style.background = ok ? 'var(--color-accent-soft)' : 'var(--color-danger-soft)';
  els['ag-resultado-icono'].style.color = ok ? 'var(--color-accent)' : 'var(--color-danger)';
  els['ag-resultado-titulo'].textContent = ok ? '¡Listo!' : 'No pudimos hacerlo';
  els['ag-resultado-texto'].textContent = texto;
  if (!ok) {
    els['ag-resultado-whatsapp'].classList.remove('hidden');
    els['ag-resultado-whatsapp'].href = `https://wa.me/${configGlobal.general.whatsappDudasNumero || ''}`;
  }
  mostrarVista('ag-vista-resultado');
}

/* --- Arranque --- */
(async function init() {
  if (tokenAccion) { await iniciarModoAccion(); return; }
  await iniciarCalendario();
})();
