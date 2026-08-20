/* ============================================================
   alumnos.js
   CRUD de alumnos, listas dinámicas por rol, y carga/guardado
   de la Ficha de Alumno (Datos Generales + Ciclo Actual).
   Las transiciones de estado viven en ciclos.js.
   ============================================================ */

import { db, auth } from './firebase-config.js';
import {
  ref, get, set, update, push
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import {
  PROGRAMAS, programaLabel, estadoProcesoLabel,
  crearCiclo, iniciarOnboardingSiCorresponde, generarAcuerdoYEnviarRevision,
  marcarEnviadoParaFirma, marcarFirmaProcesada, toggleCandado, renderStepper, renderAcciones
} from './ciclos.js';
import { showView, marcarNavActivo, setNav, setCandado, getCurrentRole, getCurrentUserNombre } from './main.js';
import { cargarTestParaCiclo } from './test.js';
import { cargarAcuerdoParaCiclo } from './pagos.js';
import './respaldo.js';

let coachesMap = {};       // uid -> nombre, solo se llena para el director
let currentAlumnoId = null;
let currentCicloId = null;
let bloqueoActual = false;

function capitalizar(texto) {
  if (!texto) return '';
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatFecha(fechaStr) {
  if (!fechaStr) return '—';
  const fecha = new Date(fechaStr + 'T00:00:00');
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(fecha);
}

function claseBadgeEstadoAlumno(estado) {
  if (estado === 'en_proceso_matricula') return 'badge--pendiente';
  if (estado === 'pausado') return 'badge--pausado';
  if (estado === 'egresado') return 'badge--egresado';
  if (estado === 'abandono') return 'badge--impaga';
  return 'badge--activo';
}

function labelEstadoAlumno(estado) {
  if (estado === 'en_proceso_matricula') return 'En Proceso de Matrícula';
  if (estado === 'pausado') return 'Pausado';
  if (estado === 'egresado') return 'Egresado';
  if (estado === 'abandono') return 'Abandono';
  return 'Activo';
}

function proximaCuotaPendiente(cuotas) {
  const pendientes = cuotas.filter(c => c.estado !== 'pagada' && c.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha));
  return pendientes.length ? formatFecha(pendientes[0].fecha) : '—';
}

function estadoPagoDeAcuerdo(acuerdo) {
  if (!acuerdo || !acuerdo.cuotas || Object.keys(acuerdo.cuotas).length === 0) {
    return { texto: '—', clase: '', proxCuota: '—' };
  }
  const cuotas = Object.values(acuerdo.cuotas);
  if (cuotas.some(c => c.estado === 'impaga')) {
    return { texto: 'Impaga', clase: 'badge--impaga', proxCuota: proximaCuotaPendiente(cuotas) };
  }
  if (cuotas.every(c => c.estado === 'pagada')) {
    return { texto: 'Al día', clase: 'badge--pagada', proxCuota: '—' };
  }
  return { texto: 'Pendiente', clase: 'badge--pendiente', proxCuota: proximaCuotaPendiente(cuotas) };
}

function poblarSelectCoaches(selectEl, selectedCoachId) {
  selectEl.innerHTML = '';
  Object.entries(coachesMap).forEach(([uid, nombre]) => {
    const opt = document.createElement('option');
    opt.value = uid;
    opt.textContent = nombre;
    if (uid === selectedCoachId) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

async function cargarCoaches() {
  const snap = await get(ref(db, 'usuarios'));
  coachesMap = {};
  if (snap.exists()) {
    Object.entries(snap.val()).forEach(([uid, u]) => {
      if (u.rol === 'coach') coachesMap[uid] = u.nombre || u.email;
    });
  }
  const selectNuevoAlumno = document.getElementById('nuevo-alumno-coach');
  if (selectNuevoAlumno) poblarSelectCoaches(selectNuevoAlumno, null);
}

/* --- Construye una fila <tr> de alumno, con columnas según el contexto --- */
function crearFilaAlumno(alumnoId, alumno, ciclo, columnas, acuerdo) {
  const tr = document.createElement('tr');
  tr.className = 'row-alumno';

  const nombreCompleto = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim() || '(sin nombre)';
  const coachNombre = ciclo ? (coachesMap[ciclo.coachId] || '—') : '—';
  const programa = ciclo ? programaLabel(ciclo.programa) : '—';
  const estadoProceso = ciclo ? estadoProcesoLabel(ciclo.estadoProceso) : '—';
  const estadoAlumno = ciclo ? ciclo.estadoAlumno : 'activo';

  let html = `<td>${nombreCompleto}</td>`;
  if (columnas.coach) html += `<td>${coachNombre}</td>`;
  html += `<td>${programa}</td><td>${estadoProceso}</td>`;
  html += `<td><span class="badge ${claseBadgeEstadoAlumno(estadoAlumno)}">${labelEstadoAlumno(estadoAlumno)}</span></td>`;
  if (columnas.fechas) {
    html += `<td>${formatFecha(ciclo && ciclo.fechaIngreso)}</td><td>${formatFecha(ciclo && ciclo.fechaEgreso)}</td>`;
  }
  if (columnas.pago) {
    const montoTexto = acuerdo && acuerdo.montoTotal ? `${acuerdo.montoTotal} ${acuerdo.moneda || ''}`.trim() : '—';
    const estadoPago = estadoPagoDeAcuerdo(acuerdo);
    html += `<td>${estadoPago.proxCuota}</td><td>${montoTexto}</td><td><span class="badge ${estadoPago.clase}">${estadoPago.texto}</span></td>`;
  }
  tr.innerHTML = html;
  tr.addEventListener('click', () => abrirFicha(alumnoId));
  return tr;
}

/* --- Recarga las 4 tablas de alumnos según el rol de la sesión actual --- */
export async function cargarListasAlumnos() {
  const role = getCurrentRole();
  const promesas = [get(ref(db, 'alumnos')), get(ref(db, 'ciclos'))];
  if (role === 'director') promesas.push(get(ref(db, 'acuerdosPago')));

  const [alumnosSnap, ciclosSnap, acuerdosSnap] = await Promise.all(promesas);
  const alumnos = alumnosSnap.exists() ? alumnosSnap.val() : {};
  const ciclos = ciclosSnap.exists() ? ciclosSnap.val() : {};
  const acuerdos = (acuerdosSnap && acuerdosSnap.exists()) ? acuerdosSnap.val() : {};
  const uid = auth.currentUser ? auth.currentUser.uid : null;

  const tbodyDashDirector = document.getElementById('tabla-alumnos-dashboard-director');
  const tbodyDashCoach = document.getElementById('tabla-alumnos-dashboard-coach');
  const tbodyDirector = document.getElementById('tabla-alumnos-director');
  const tbodyCoach = document.getElementById('tabla-alumnos-coach');
  [tbodyDashDirector, tbodyDashCoach, tbodyDirector, tbodyCoach].forEach(t => { if (t) t.innerHTML = ''; });

  Object.entries(alumnos).forEach(([alumnoId, alumno]) => {
    const ciclo = alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
    const acuerdo = alumno.cicloActualId ? acuerdos[alumno.cicloActualId] : null;

    if (role === 'director') {
      if (tbodyDashDirector) tbodyDashDirector.appendChild(crearFilaAlumno(alumnoId, alumno, ciclo, { coach: true, fechas: false, pago: true }, acuerdo));
      if (tbodyDirector) tbodyDirector.appendChild(crearFilaAlumno(alumnoId, alumno, ciclo, { coach: true, fechas: true, pago: false }));
    } else if (role === 'coach') {
      if (!ciclo || ciclo.coachId !== uid) return;
      if (tbodyDashCoach) tbodyDashCoach.appendChild(crearFilaAlumno(alumnoId, alumno, ciclo, { coach: false, fechas: false, pago: false }));
      if (tbodyCoach) tbodyCoach.appendChild(crearFilaAlumno(alumnoId, alumno, ciclo, { coach: false, fechas: true, pago: false }));
    }
  });
}

/* --- Abre la ficha de un alumno con sus datos reales --- */
async function abrirFicha(alumnoId) {
  const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
  if (!alumnoSnap.exists()) return;
  const alumno = alumnoSnap.val();

  currentAlumnoId = alumnoId;
  currentCicloId = alumno.cicloActualId || null;

  let ciclo = null;
  if (currentCicloId) {
    const cicloSnap = await get(ref(db, `ciclos/${currentCicloId}`));
    ciclo = cicloSnap.exists() ? cicloSnap.val() : null;
  }

  const role = getCurrentRole();

  // Siempre resetea a "Datos Generales" al abrir una ficha — evita que quede
  // pegada una pestaña restringida (ej. Pago) de una sesión o alumno anterior.
  document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.toggle('is-active', t.dataset.tab === 'datos'));
  document.querySelectorAll('.tab-panel[data-panel]').forEach(p => p.classList.toggle('is-active', p.dataset.panel === 'datos'));

  document.getElementById('ficha-nombre-alumno').textContent = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim() || '(sin nombre)';
  document.getElementById('ficha-rut').textContent = alumno.rut || '—';
  document.getElementById('ficha-programa').textContent = ciclo ? programaLabel(ciclo.programa) : '—';
  document.getElementById('ficha-coach-nombre').textContent = ciclo
    ? (role === 'coach' ? getCurrentUserNombre() : (coachesMap[ciclo.coachId] || '—'))
    : '—';

  const badge = document.getElementById('ficha-badge-estado');
  const estadoAlumno = ciclo ? ciclo.estadoAlumno : 'activo';
  badge.textContent = labelEstadoAlumno(estadoAlumno);
  badge.className = 'badge ' + claseBadgeEstadoAlumno(estadoAlumno);

  document.getElementById('datos-nombre').value = alumno.nombre || '';
  document.getElementById('datos-apellido').value = alumno.apellido || '';
  document.getElementById('datos-rut').value = alumno.rut || '';
  document.getElementById('datos-fecha-nacimiento').value = alumno.fechaNacimiento || '';
  document.getElementById('datos-genero').value = alumno.genero || 'Femenino';
  document.getElementById('datos-telefono').value = alumno.telefono || '';
  document.getElementById('datos-direccion').value = alumno.direccion || '';
  document.getElementById('datos-ocupacion').value = alumno.ocupacion || '';

  const selectCoach = document.getElementById('ciclo-coach');
  if (role === 'director') {
    poblarSelectCoaches(selectCoach, ciclo ? ciclo.coachId : null);
    selectCoach.disabled = false;
  } else {
    selectCoach.innerHTML = `<option>${getCurrentUserNombre()}</option>`;
    selectCoach.disabled = true;
  }

  if (ciclo) {
    document.getElementById('ciclo-programa').value = ciclo.programa || 'begin';
    document.getElementById('ciclo-fecha-ingreso').value = ciclo.fechaIngreso || '';
    document.getElementById('ciclo-fecha-egreso').value = ciclo.fechaEgreso || '';
    document.getElementById('ciclo-facturacion-actual').value = ciclo.facturacionActual || '';
    document.getElementById('ciclo-objetivo-facturacion').value = ciclo.objetivoFacturacion || '';
    document.getElementById('ciclo-situacion-personal').value = ciclo.situacionPersonal || '';
    document.getElementById('ciclo-objetivos-personales').value = ciclo.objetivosPersonales || '';
  }

  const estadoProceso = ciclo ? ciclo.estadoProceso : 'asignado';
  document.getElementById('ficha-stepper').innerHTML = renderStepper(estadoProceso);
  renderAcciones(estadoProceso, role);

  await cargarTestParaCiclo(currentCicloId);
  await cargarAcuerdoParaCiclo(currentCicloId);

  const panelCandado = document.getElementById('panel-candado');
  if (ciclo && ciclo.estadoProceso === 'matricula_finalizada') {
    bloqueoActual = !!ciclo.bloqueoCoach;
    setCandado(bloqueoActual);
  } else {
    bloqueoActual = false;
    panelCandado.classList.add('hidden');
  }

  showView('view-ficha-alumno');
  marcarNavActivo('alumnos');
  document.getElementById('topbar-title').textContent = 'Ficha de Alumno';
}

/* ============================================================
   Listeners (se enganchan una sola vez al cargar el módulo)
   ============================================================ */

const btnCrearAlumno = document.getElementById('btn-crear-alumno');
if (btnCrearAlumno) {
  btnCrearAlumno.addEventListener('click', async () => {
    const errorEl = document.getElementById('nuevo-alumno-error');
    errorEl.classList.add('hidden');

    const nombre = document.getElementById('nuevo-alumno-nombre').value.trim();
    const apellido = document.getElementById('nuevo-alumno-apellido').value.trim();
    const programa = document.getElementById('nuevo-alumno-programa').value;
    const coachId = document.getElementById('nuevo-alumno-coach').value;
    const monto = document.getElementById('nuevo-alumno-monto').value.trim();
    const moneda = document.getElementById('nuevo-alumno-moneda').value;
    const descuento = document.getElementById('nuevo-alumno-descuento').value.trim();
    const abono = document.getElementById('nuevo-alumno-abono').value.trim();

    if (!nombre || !apellido || !coachId) {
      errorEl.textContent = 'Completa nombre, apellido y coach asignado.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnCrearAlumno.disabled = true;
    btnCrearAlumno.textContent = 'Creando...';

    try {
      const cuotas = {};
      document.querySelectorAll('#tabla-cuotas-nuevo tbody tr').forEach(row => {
        const inputs = row.querySelectorAll('input');
        const fecha = inputs[0].value;
        const montoCuota = inputs[1].value.trim();
        if (fecha || montoCuota) {
          const cuotaId = push(ref(db)).key;
          cuotas[cuotaId] = { fecha, monto: montoCuota, estado: 'pendiente' };
        }
      });

      const alumnoRef = push(ref(db, 'alumnos'));
      const alumnoId = alumnoRef.key;
      await set(alumnoRef, {
        nombre, apellido,
        rut: '', fechaNacimiento: '', genero: '', telefono: '', direccion: '', ocupacion: '', fotoUrl: '',
        coachId,
        cicloActualId: null,
        ciclosAnteriores: [],
        createdAt: Date.now()
      });

      await crearCiclo({
        alumnoId, coachId, programa,
        acuerdoPago: { montoTotal: monto, moneda, descuento, abono, saldo: monto, cuotas, pdfUrl: '' }
      });

      ['nuevo-alumno-nombre', 'nuevo-alumno-apellido', 'nuevo-alumno-monto', 'nuevo-alumno-descuento', 'nuevo-alumno-abono']
        .forEach(id => { document.getElementById(id).value = ''; });

      await cargarListasAlumnos();
      setNav('alumnos');
    } catch (err) {
      errorEl.textContent = 'Error al crear el alumno. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
    } finally {
      btnCrearAlumno.disabled = false;
      btnCrearAlumno.textContent = 'Crear Alumno y Asignar Coach';
    }
  });
}

const btnGuardarDatos = document.getElementById('btn-guardar-datos');
if (btnGuardarDatos) {
  btnGuardarDatos.addEventListener('click', async () => {
    if (!currentAlumnoId) return;
    btnGuardarDatos.disabled = true;
    try {
      await update(ref(db, `alumnos/${currentAlumnoId}`), {
        nombre: document.getElementById('datos-nombre').value.trim(),
        apellido: document.getElementById('datos-apellido').value.trim(),
        rut: document.getElementById('datos-rut').value.trim(),
        fechaNacimiento: document.getElementById('datos-fecha-nacimiento').value,
        genero: document.getElementById('datos-genero').value,
        telefono: document.getElementById('datos-telefono').value.trim(),
        direccion: document.getElementById('datos-direccion').value.trim(),
        ocupacion: document.getElementById('datos-ocupacion').value.trim()
      });
      if (currentCicloId) await iniciarOnboardingSiCorresponde(currentCicloId);
      await abrirFicha(currentAlumnoId);
      await cargarListasAlumnos();
    } finally {
      btnGuardarDatos.disabled = false;
    }
  });
}

const btnGuardarCiclo = document.getElementById('btn-guardar-ciclo');
if (btnGuardarCiclo) {
  btnGuardarCiclo.addEventListener('click', async () => {
    if (!currentCicloId) return;
    btnGuardarCiclo.disabled = true;
    try {
      const datos = {
        facturacionActual: document.getElementById('ciclo-facturacion-actual').value.trim(),
        objetivoFacturacion: document.getElementById('ciclo-objetivo-facturacion').value.trim(),
        situacionPersonal: document.getElementById('ciclo-situacion-personal').value.trim(),
        objetivosPersonales: document.getElementById('ciclo-objetivos-personales').value.trim()
      };
      if (getCurrentRole() === 'director') {
        datos.coachId = document.getElementById('ciclo-coach').value;
      }
      await update(ref(db, `ciclos/${currentCicloId}`), datos);
      await iniciarOnboardingSiCorresponde(currentCicloId);
      await abrirFicha(currentAlumnoId);
      await cargarListasAlumnos();
    } finally {
      btnGuardarCiclo.disabled = false;
    }
  });
}

const btnGenerarAcuerdo = document.getElementById('btn-generar-acuerdo');
if (btnGenerarAcuerdo) {
  btnGenerarAcuerdo.addEventListener('click', async () => {
    if (!currentCicloId) return;
    btnGenerarAcuerdo.disabled = true;
    // TODO (pdf-acuerdo.js): generar el PDF real acá, con los datos de
    // alumno + ciclo + acuerdoPago ya reunidos, y guardar su URL en
    // acuerdosPago/{cicloId}/pdfUrl — este es el "Coach genera el acuerdo"
    // del proceso original. El director solo lo revisa después, no lo genera.
    await generarAcuerdoYEnviarRevision(currentCicloId);
    await abrirFicha(currentAlumnoId);
    await cargarListasAlumnos();
    btnGenerarAcuerdo.disabled = false;
  });
}

const btnEnviarRevision = document.getElementById('btn-enviar-a-revision');
if (btnEnviarRevision) {
  btnEnviarRevision.addEventListener('click', async () => {
    if (!currentCicloId) return;
    btnEnviarRevision.disabled = true;
    await marcarEnviadoParaFirma(currentCicloId);
    await abrirFicha(currentAlumnoId);
    await cargarListasAlumnos();
    btnEnviarRevision.disabled = false;
  });
}

const btnFirmaProcesada = document.getElementById('btn-marcar-firma-procesada');
if (btnFirmaProcesada) {
  btnFirmaProcesada.addEventListener('click', async () => {
    if (!currentCicloId) return;
    const fecha = document.getElementById('input-fecha-firma').value;
    if (!fecha) { alert('Selecciona la fecha real de la firma.'); return; }
    btnFirmaProcesada.disabled = true;
    await marcarFirmaProcesada(currentCicloId, fecha);
    await abrirFicha(currentAlumnoId);
    await cargarListasAlumnos();
    btnFirmaProcesada.disabled = false;
  });
}

const btnToggleCandado = document.getElementById('btn-toggle-candado');
if (btnToggleCandado) {
  btnToggleCandado.addEventListener('click', async () => {
    if (!currentCicloId) return;
    bloqueoActual = !bloqueoActual;
    setCandado(bloqueoActual);
    await toggleCandado(currentCicloId, bloqueoActual);
  });
}

/* --- Autocompleta el Monto Total según el programa elegido.
       CLP: usa el precio base directo. USD: usa el tipo de cambio manual
       que ingresa el director (precioClp / tipoCambio). --- */
function autocompletarMontoNuevoAlumno() {
  const selectPrograma = document.getElementById('nuevo-alumno-programa');
  const selectMoneda = document.getElementById('nuevo-alumno-moneda');
  const inputMonto = document.getElementById('nuevo-alumno-monto');
  const inputTipoCambio = document.getElementById('nuevo-alumno-tipo-cambio');
  const campoTipoCambio = document.getElementById('campo-tipo-cambio');
  if (!selectPrograma || !selectMoneda || !inputMonto) return;

  const programa = PROGRAMAS[selectPrograma.value];
  if (!programa) return;

  if (selectMoneda.value === 'CLP') {
    if (campoTipoCambio) campoTipoCambio.classList.add('hidden');
    inputMonto.value = programa.precioClp.toLocaleString('es-CL');
  } else if (selectMoneda.value === 'USD') {
    if (campoTipoCambio) campoTipoCambio.classList.remove('hidden');
    const tipoCambio = parseFloat(inputTipoCambio ? inputTipoCambio.value : '');
    if (tipoCambio > 0) {
      inputMonto.value = (programa.precioClp / tipoCambio).toFixed(2);
    }
  }
}
const selectNuevoAlumnoPrograma = document.getElementById('nuevo-alumno-programa');
const selectNuevoAlumnoMoneda = document.getElementById('nuevo-alumno-moneda');
const inputNuevoAlumnoTipoCambio = document.getElementById('nuevo-alumno-tipo-cambio');
if (selectNuevoAlumnoPrograma) selectNuevoAlumnoPrograma.addEventListener('change', autocompletarMontoNuevoAlumno);
if (selectNuevoAlumnoMoneda) selectNuevoAlumnoMoneda.addEventListener('change', autocompletarMontoNuevoAlumno);
if (inputNuevoAlumnoTipoCambio) inputNuevoAlumnoTipoCambio.addEventListener('input', autocompletarMontoNuevoAlumno);
autocompletarMontoNuevoAlumno(); // prefill inicial (Begin · CLP por defecto)

const btnEliminarAlumno = document.getElementById('btn-eliminar-alumno');
if (btnEliminarAlumno) {
  btnEliminarAlumno.addEventListener('click', async () => {
    if (!currentAlumnoId) return;
    const nombre = document.getElementById('ficha-nombre-alumno').textContent;
    const confirmado = confirm(
      `⚠️ Vas a eliminar a "${nombre}" junto con su ciclo, acuerdo de pago y tests guardados. ` +
      `Esta acción NO se puede deshacer y se pierden todos esos datos. ¿Confirmas que quieres eliminarlo?`
    );
    if (!confirmado) return;

    btnEliminarAlumno.disabled = true;
    try {
      const cicloIdAEliminar = currentCicloId;
      await set(ref(db, `alumnos/${currentAlumnoId}`), null);
      if (cicloIdAEliminar) {
        await set(ref(db, `ciclos/${cicloIdAEliminar}`), null);
        await set(ref(db, `acuerdosPago/${cicloIdAEliminar}`), null);
      }
      await cargarListasAlumnos();
      setNav('alumnos');
    } finally {
      btnEliminarAlumno.disabled = false;
    }
  });
}

/* --- Llamado desde auth.js apenas se confirma el rol tras el login --- */
export async function initAlumnosModule() {
  if (getCurrentRole() === 'director') {
    await cargarCoaches();
  }
  await cargarListasAlumnos();
}

// Refresca las tablas cada vez que se navega a Dashboard o Alumnos —
// evita que quede mostrando datos viejos si otro rol cambió algo mientras tanto.
document.querySelectorAll('.nav-item[data-nav]').forEach(item => {
  item.addEventListener('click', () => {
    if (item.dataset.nav === 'dashboard' || item.dataset.nav === 'alumnos') {
      cargarListasAlumnos();
    }
  });
});
