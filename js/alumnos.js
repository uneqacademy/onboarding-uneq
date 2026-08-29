/* ============================================================
   alumnos.js
   CRUD de alumnos, listas dinámicas por rol, y carga/guardado
   de la Ficha de Alumno (Datos Generales + Ciclo Actual).
   Las transiciones de estado viven en ciclos.js.
   ============================================================ */

import { db, auth, storage } from './firebase-config.js';
import {
  ref, get, set, update, push
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import {
  ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import {
  PROGRAMAS, programaLabel, estadoProcesoLabel,
  crearCiclo, iniciarOnboardingSiCorresponde, generarAcuerdoYEnviarRevision,
  marcarEnviadoParaFirma, marcarFirmaProcesada, toggleCandado, renderStepper, renderAcciones
} from './ciclos.js';
import { showView, marcarNavActivo, setNav, setCandado, aplicarBloqueoCamposFicha, getCurrentRole, getCurrentUserNombre, getCurrentRolesDisponibles, applyRole } from './main.js';
import { cargarTestParaCiclo, hayTestCompletado } from './test.js';
import { cargarAcuerdoParaCiclo } from './pagos.js';
import { cargarBitacoraParaCiclo } from './bitacora.js';
import { generarPdfAcuerdo } from './pdf-acuerdo.js';
import './respaldo.js';
import { cargarMiEvaluacionCoach } from './coaches.js';
import { cargarDashboardMentor, cargarAlumnosMentor, cargarPerfilMentor, cargarMentoriasView, cargarBoxMentor } from './mentores.js';
import { cargarSesionesBeginCoach } from './dashboard-coach.js';
import { actualizarBotonAccesoAlumno, cargarDashboardAlumno } from './alumno-portal.js';
import './configuracion.js';
import './mis-datos.js';
import './informe-ia.js';

let coachesMap = {};       // uid -> nombre, solo se llena para el director
let currentAlumnoId = null;
let currentCicloId = null;
let bloqueoActual = false;
let estadoProcesoActual = null;

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

const FASE_METODOLOGIA_LABELS = { fase1: 'Fase 1', fase2: 'Fase 2', fase3: 'Fase 3', fase4: 'Fase 4' };
function faseMetodologiaLabel(fase) {
  return FASE_METODOLOGIA_LABELS[fase] || 'Sin definir';
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

/* --- Edad automática, según Fecha de Nacimiento vs. hoy --- */
function calcularEdad(fechaNacStr) {
  if (!fechaNacStr) return '';
  const nacimiento = new Date(fechaNacStr + 'T00:00:00');
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const noHaCumplidoAunEsteAnio = (hoy.getMonth() < nacimiento.getMonth()) ||
    (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate());
  if (noHaCumplidoAunEsteAnio) edad--;
  return edad >= 0 ? edad : '';
}

function actualizarEdad() {
  const fecha = document.getElementById('datos-fecha-nacimiento').value;
  document.getElementById('datos-edad').value = fecha ? `${calcularEdad(fecha)} años` : '';
}

const inputFechaNacimiento = document.getElementById('datos-fecha-nacimiento');
if (inputFechaNacimiento) inputFechaNacimiento.addEventListener('change', actualizarEdad);

/* --- Ocupación: muestra el campo de especialidad solo para las que lo piden --- */
const OCUPACIONES_CON_ESPECIALIDAD = ['Coach', 'Terapeuta', 'Ingeniero/a', 'Consultor/a', 'Otro'];

/* --- Foto de perfil del alumno (Storage) --- */
export const PLACEHOLDER_FOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#E4E7EC"/><circle cx="40" cy="32" r="14" fill="#9AA4B2"/><ellipse cx="40" cy="70" rx="24" ry="18" fill="#9AA4B2"/></svg>'
);

const btnCambiarFoto = document.getElementById('btn-cambiar-foto');
const inputFoto = document.getElementById('datos-foto-input');
if (btnCambiarFoto && inputFoto) {
  btnCambiarFoto.addEventListener('click', () => { if (!btnCambiarFoto.disabled) inputFoto.click(); });
  inputFoto.addEventListener('change', async () => {
    const file = inputFoto.files[0];
    if (!file || !currentAlumnoId) return;
    btnCambiarFoto.disabled = true;
    const textoOriginal = btnCambiarFoto.textContent;
    btnCambiarFoto.textContent = 'Subiendo...';
    try {
      const archivoRef = storageRef(storage, `fotos-alumnos/${currentAlumnoId}`);
      await uploadBytes(archivoRef, file);
      const url = await getDownloadURL(archivoRef);
      await update(ref(db, `alumnos/${currentAlumnoId}`), { fotoUrl: url });
      await abrirFicha(currentAlumnoId);
      await cargarListasAlumnos();
    } catch (err) {
      alert('No se pudo subir la foto. Intenta de nuevo.');
      btnCambiarFoto.disabled = false;
    } finally {
      btnCambiarFoto.textContent = textoOriginal;
      inputFoto.value = '';
    }
  });
}


/* --- Redes sociales: se escribe el usuario, la URL se arma sola --- */
const PLATAFORMAS_REDES = ['Instagram', 'Facebook', 'TikTok', 'YouTube', 'LinkedIn', 'Otro'];

const URL_REDES = {
  Instagram: u => `https://instagram.com/${u.replace(/^@/, '')}`,
  Facebook: u => `https://facebook.com/${u.replace(/^@/, '')}`,
  TikTok: u => `https://tiktok.com/@${u.replace(/^@/, '')}`,
  YouTube: u => `https://youtube.com/@${u.replace(/^@/, '')}`,
  LinkedIn: u => `https://linkedin.com/in/${u.replace(/^@/, '')}`,
  Otro: u => (u.startsWith('http') ? u : `https://${u}`)
};

function construirUrlRed(plataforma, usuario) {
  if (!usuario) return '';
  const fn = URL_REDES[plataforma] || URL_REDES.Otro;
  return fn(usuario.trim());
}

function agregarFilaRedSocial(entrada) {
  const tbody = document.getElementById('tabla-redes-sociales-body');
  if (!tbody) return;
  const tr = document.createElement('tr');
  const opciones = PLATAFORMAS_REDES.map(p =>
    `<option value="${p}" ${entrada && entrada.plataforma === p ? 'selected' : ''}>${p}</option>`
  ).join('');
  tr.innerHTML = `
    <td><select class="red-social-plataforma">${opciones}</select></td>
    <td><input class="red-social-usuario" placeholder="usuario o URL" value="${entrada ? (entrada.usuario || '') : ''}"></td>
    <td><a href="#" class="btn btn--ghost red-social-visitar" target="_blank" rel="noopener" style="font-size:11px; padding:4px 8px;">Visitar Perfil</a></td>
    <td><button class="btn btn--danger red-social-quitar" style="font-size:11px; padding:4px 8px;">Quitar</button></td>`;
  tbody.appendChild(tr);

  const selectPlataforma = tr.querySelector('.red-social-plataforma');
  const inputUsuario = tr.querySelector('.red-social-usuario');
  const linkVisitar = tr.querySelector('.red-social-visitar');

  function actualizarLink() {
    const url = construirUrlRed(selectPlataforma.value, inputUsuario.value);
    linkVisitar.href = url || '#';
  }
  actualizarLink();
  selectPlataforma.addEventListener('change', actualizarLink);
  inputUsuario.addEventListener('input', actualizarLink);
  tr.querySelector('.red-social-quitar').addEventListener('click', () => tr.remove());
}

const btnAgregarRedSocial = document.getElementById('btn-agregar-red-social');
if (btnAgregarRedSocial) btnAgregarRedSocial.addEventListener('click', () => agregarFilaRedSocial());


function validarDatosGenerales(alumno) {
  const faltantes = [];
  const check = (valor, id) => { if (!valor || !valor.toString().trim()) faltantes.push(id); };
  if (!alumno) return ['datos-nombre', 'datos-apellido', 'datos-rut', 'datos-fecha-nacimiento', 'datos-genero', 'datos-telefono', 'datos-email', 'datos-ocupacion', 'datos-direccion-calle', 'datos-direccion-numero', 'datos-direccion-comuna', 'datos-direccion-region', 'datos-direccion-pais'];
  const dir = alumno.direccion || {};
  check(alumno.nombre, 'datos-nombre');
  check(alumno.apellido, 'datos-apellido');
  check(alumno.rut, 'datos-rut');
  check(alumno.fechaNacimiento, 'datos-fecha-nacimiento');
  check(alumno.genero, 'datos-genero');
  check(alumno.telefono, 'datos-telefono');
  check(alumno.email, 'datos-email');
  check(alumno.ocupacion, 'datos-ocupacion');
  check(dir.calle, 'datos-direccion-calle');
  check(dir.numero, 'datos-direccion-numero');
  check(dir.comuna, 'datos-direccion-comuna');
  check(dir.region, 'datos-direccion-region');
  check(dir.pais, 'datos-direccion-pais');
  if (OCUPACIONES_CON_ESPECIALIDAD.includes(alumno.ocupacion) && !alumno.ocupacionEspecialidad) faltantes.push('datos-ocupacion-especialidad');
  return faltantes;
}

function datosGeneralesCompletos(alumno) {
  return validarDatosGenerales(alumno).length === 0;
}

function validarCiclo(ciclo) {
  const faltantes = [];
  const check = (valor, id) => { if (!valor || !valor.toString().trim()) faltantes.push(id); };
  if (!ciclo) return ['ciclo-facturacion-actual', 'ciclo-objetivo-facturacion', 'ciclo-situacion-personal', 'ciclo-objetivos-personales'];
  check(ciclo.facturacionActual, 'ciclo-facturacion-actual');
  check(ciclo.objetivoFacturacion, 'ciclo-objetivo-facturacion');
  check(ciclo.situacionPersonal, 'ciclo-situacion-personal');
  check(ciclo.objetivosPersonales, 'ciclo-objetivos-personales');
  return faltantes;
}

function cicloCompleto(ciclo) {
  return validarCiclo(ciclo).length === 0;
}

function marcarCamposFaltantes(ids) {
  document.querySelectorAll('.tab-panel[data-panel="datos"] input, .tab-panel[data-panel="datos"] select, .tab-panel[data-panel="ciclo"] input, .tab-panel[data-panel="ciclo"] textarea')
    .forEach(el => { el.style.border = ''; el.style.backgroundColor = ''; });
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.border = '1.5px solid #C0392B'; el.style.backgroundColor = '#FDEDED'; }
  });
}

function actualizarCampoEspecialidad() {
  const ocupacion = document.getElementById('datos-ocupacion').value;
  const campo = document.getElementById('campo-ocupacion-especialidad');
  campo.classList.toggle('hidden', !OCUPACIONES_CON_ESPECIALIDAD.includes(ocupacion));
}

const selectOcupacion = document.getElementById('datos-ocupacion');
if (selectOcupacion) selectOcupacion.addEventListener('change', actualizarCampoEspecialidad);

/* --- Teléfono internacional con banderita (librería intl-tel-input).
       Se inicializa recién al abrir una ficha (no al cargar la página,
       para no afectar el login), y protegida: si la librería falla,
       el campo sigue funcionando como texto normal. --- */
let itiTelefono = null;

function initTelefonoWidgetSiCorresponde() {
  if (itiTelefono) return;
  const input = document.getElementById('datos-telefono');
  if (!input || typeof window.intlTelInput !== 'function') return;
  try {
    itiTelefono = window.intlTelInput(input, {
      initialCountry: 'cl',
      preferredCountries: ['cl', 'ar', 'pe', 'mx', 'co'],
      separateDialCode: true
    });
  } catch (err) {
    itiTelefono = null;
  }
}

function setTelefono(valor) {
  initTelefonoWidgetSiCorresponde();
  if (itiTelefono) {
    itiTelefono.setNumber(valor || '');
  } else {
    const input = document.getElementById('datos-telefono');
    if (input) input.value = valor || '';
  }
}

function getTelefono() {
  if (itiTelefono) return itiTelefono.getNumber() || '';
  const input = document.getElementById('datos-telefono');
  return input ? input.value.trim() : '';
}


function parsearMontoCLP(valor) {
  if (typeof valor === 'number') return valor;
  if (!valor) return 0;
  const limpio = valor.toString().replace(/\./g, '').replace(',', '.');
  return parseFloat(limpio) || 0;
}

function formatMontoPorMoneda(totalesPorMoneda) {
  const partes = Object.entries(totalesPorMoneda)
    .filter(([, monto]) => monto > 0)
    .map(([moneda, monto]) => `${monto.toLocaleString('es-CL')} ${moneda}`);
  return partes.length ? partes.join(' · ') : '$0';
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
      const tieneRolCoach = (u.roles && typeof u.roles === 'object') ? u.roles.coach === true : u.rol === 'coach';
      if (tieneRolCoach) coachesMap[uid] = u.nombre || u.email;
    });
  }
  const selectNuevoAlumno = document.getElementById('nuevo-alumno-coach');
  if (selectNuevoAlumno) poblarSelectCoaches(selectNuevoAlumno, null);
}

// Refresca la lista de coaches cada vez que se abre "Nuevo Alumno" — evita que
// quede desactualizada si se agregó un coach después del login, sin recargar.
const btnNuevoAlumnoRefrescaCoaches = document.getElementById('btn-nuevo-alumno');
if (btnNuevoAlumnoRefrescaCoaches) {
  btnNuevoAlumnoRefrescaCoaches.addEventListener('click', () => {
    if (getCurrentRole() === 'director') cargarCoaches();
  });
}

/* --- Construye una fila <tr> de alumno, con columnas según el contexto --- */
function crearFilaAlumno(alumnoId, alumno, ciclo, columnas, acuerdo) {
  const tr = document.createElement('tr');
  tr.className = 'row-alumno';

  const nombreCompleto = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim() || '(sin nombre)';
  const coachNombre = ciclo
    ? (ciclo.coachId ? (coachesMap[ciclo.coachId] || '—') : (ciclo.programa === 'begin' ? '🚩 Coach de Cabecera' : '—'))
    : '—';
  const programa = ciclo ? programaLabel(ciclo.programa) : '—';
  const estadoProceso = ciclo ? estadoProcesoLabel(ciclo.estadoProceso) : '—';
  const estadoAlumno = ciclo ? ciclo.estadoAlumno : 'activo';

  let html = `<td><img src="${alumno.fotoUrl || PLACEHOLDER_FOTO}" alt="" style="width:28px; height:28px; border-radius:50%; object-fit:cover; vertical-align:middle; margin-right:8px;">${nombreCompleto}</td>`;
  if (columnas.coach) html += `<td>${coachNombre}</td>`;
  html += `<td>${programa}</td><td>${estadoProceso}</td>`;
  html += `<td><span class="badge ${claseBadgeEstadoAlumno(estadoAlumno)}">${labelEstadoAlumno(estadoAlumno)}</span></td>`;
  if (columnas.fase) {
    html += `<td>${ciclo ? faseMetodologiaLabel(ciclo.faseMetodologia) : '—'}</td>`;
  }
  if (columnas.fechas) {
    html += `<td>${formatFecha(ciclo && ciclo.fechaIngreso)}</td><td>${formatFecha(ciclo && ciclo.fechaEgreso)}</td>`;
  }
  if (columnas.dias) {
    let diasActivo = '—', diasRestantes = '—';
    if (ciclo && ciclo.fechaIngreso) {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const ingreso = new Date(ciclo.fechaIngreso + 'T00:00:00');
      diasActivo = Math.max(0, Math.round((hoy - ingreso) / (1000 * 60 * 60 * 24)));
    }
    if (ciclo && ciclo.fechaEgreso) {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const egreso = new Date(ciclo.fechaEgreso + 'T00:00:00');
      const restantes = Math.round((egreso - hoy) / (1000 * 60 * 60 * 24));
      diasRestantes = restantes < 0 ? 'Vencido' : restantes;
    }
    html += `<td>${diasActivo}</td><td>${diasRestantes}</td>`;
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

  // --- Si soy coach, reviso si tengo el flag de Coach de Cabecera (BEGIN):
  //     me hace ver también, en mi LISTA de alumnos, a todos los de BEGIN
  //     (aunque no tengan coach individual asignado). El conteo/KPI de
  //     arriba NO se toca con esto — se queda solo con Next/eXIT. ---
  let esCoachCabeceraBegin = false;
  if (role === 'coach' && uid) {
    const cabeceraSnap = await get(ref(db, `usuarios/${uid}/coachCabeceraBegin`));
    esCoachCabeceraBegin = cabeceraSnap.exists() && cabeceraSnap.val() === true;
  }

  const tbodyDashDirector = document.getElementById('tabla-alumnos-dashboard-director');
  const tbodyDashCoach = document.getElementById('tabla-alumnos-dashboard-coach');
  const tbodyDirector = document.getElementById('tabla-alumnos-director');
  const tbodyCoach = document.getElementById('tabla-alumnos-coach');
  [tbodyDashDirector, tbodyDashCoach, tbodyDirector, tbodyCoach].forEach(t => { if (t) t.innerHTML = ''; });

  Object.entries(alumnos).forEach(([alumnoId, alumno]) => {
    if (alumno.esDemo) return; // Alumno Demo del director — nunca aparece en listas ni cuenta en nada
    const ciclo = alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
    const acuerdo = alumno.cicloActualId ? acuerdos[alumno.cicloActualId] : null;

    if (role === 'director') {
      if (tbodyDashDirector) tbodyDashDirector.appendChild(crearFilaAlumno(alumnoId, alumno, ciclo, { coach: true, fechas: false, pago: true }, acuerdo));
      if (tbodyDirector) tbodyDirector.appendChild(crearFilaAlumno(alumnoId, alumno, ciclo, { coach: true, fechas: true, pago: false }));
    } else if (role === 'coach') {
      const esMio = ciclo && ciclo.coachId === uid;
      const esBeginDeCabecera = ciclo && ciclo.programa === 'begin' && esCoachCabeceraBegin;
      if (!ciclo || !(esMio || esBeginDeCabecera)) return;
      if (tbodyDashCoach) tbodyDashCoach.appendChild(crearFilaAlumno(alumnoId, alumno, ciclo, { coach: false, fase: true, fechas: true, dias: true, pago: false }));
      if (tbodyCoach) tbodyCoach.appendChild(crearFilaAlumno(alumnoId, alumno, ciclo, { coach: false, fase: true, fechas: true, dias: true, pago: false }));
    }
  });

  const setTexto = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  if (role === 'director') {
    let activos = 0, begin = 0, next = 0, exit = 0, pendientesFirma = 0;
    const porCobrarPorMoneda = {};
    const atrasadoPorMoneda = {};

    Object.values(alumnos).forEach(alumno => {
      if (alumno.esDemo) return;
      const ciclo = alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
      const acuerdo = alumno.cicloActualId ? acuerdos[alumno.cicloActualId] : null;
      if (!ciclo) return;

      if (ciclo.estadoAlumno === 'activo') {
        activos++;
        if (ciclo.programa === 'begin') begin++;
        else if (ciclo.programa === 'next') next++;
        else if (ciclo.programa === 'exit') exit++;
      }
      if (ciclo.estadoProceso === 'enviado_firma' || ciclo.estadoProceso === 'en_revision') pendientesFirma++;

      if (acuerdo) {
        const moneda = acuerdo.moneda || 'CLP';
        const montoTotal = parsearMontoCLP(acuerdo.montoTotal);
        const descuento = parsearMontoCLP(acuerdo.descuento);
        const abono = parsearMontoCLP(acuerdo.abono);
        const saldoBase = montoTotal - descuento - abono;

        const cuotas = acuerdo.cuotas ? Object.values(acuerdo.cuotas) : [];
        const pagado = cuotas.filter(c => c.estado === 'pagada').reduce((s, c) => s + parsearMontoCLP(c.monto), 0);
        const impago = cuotas.filter(c => c.estado === 'impaga').reduce((s, c) => s + parsearMontoCLP(c.monto), 0);

        const porCobrar = Math.max(saldoBase - pagado, 0);
        if (porCobrar > 0) porCobrarPorMoneda[moneda] = (porCobrarPorMoneda[moneda] || 0) + porCobrar;
        if (impago > 0) atrasadoPorMoneda[moneda] = (atrasadoPorMoneda[moneda] || 0) + impago;
      }
    });

    setTexto('kpi-alumnos-activos', activos);
    setTexto('kpi-alumnos-totales', Object.keys(alumnos).length);
    setTexto('kpi-activos-begin', begin);
    setTexto('kpi-activos-next', next);
    setTexto('kpi-activos-exit', exit);
    setTexto('kpi-pendientes-firma', pendientesFirma);
    setTexto('kpi-por-cobrar', formatMontoPorMoneda(porCobrarPorMoneda));
    setTexto('kpi-atrasado', formatMontoPorMoneda(atrasadoPorMoneda));
  } else if (role === 'coach') {
    let activos = 0, enOnboarding = 0, esperandoDirector = 0;
    Object.values(alumnos).forEach(alumno => {
      const ciclo = alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
      if (!ciclo || ciclo.coachId !== uid) return;
      if (ciclo.estadoAlumno === 'activo') activos++;
      if (ciclo.estadoProceso === 'en_onboarding') enOnboarding++;
      if (ciclo.estadoProceso === 'enviado_firma' || ciclo.estadoProceso === 'en_revision') esperandoDirector++;
    });
    setTexto('kpi-coach-alumnos-activos', activos);
    setTexto('kpi-coach-en-onboarding', enOnboarding);
    setTexto('kpi-coach-esperando-director', esperandoDirector);
  }
}

async function renderHistorialCiclos(ciclosAnterioresIds) {
  const contenedor = document.getElementById('historial-ciclos-contenido');
  if (!contenedor) return;

  if (!ciclosAnterioresIds || !ciclosAnterioresIds.length) {
    contenedor.className = 'panel__body text-soft';
    contenedor.textContent = 'Este alumno aún no ha cursado ciclos anteriores. Cuando tome un nuevo nivel, aparecerá aquí el resumen de cada ciclo pasado.';
    return;
  }

  const snaps = await Promise.all(ciclosAnterioresIds.map(id => get(ref(db, `ciclos/${id}`))));
  const ciclosConId = ciclosAnterioresIds
    .map((id, idx) => ({ id, datos: snaps[idx].exists() ? snaps[idx].val() : null }))
    .filter(c => c.datos);

  contenedor.className = 'panel__body';
  contenedor.innerHTML = ciclosConId.map(({ id, datos: c }) => `
    <div style="padding:10px 0; border-bottom:0.5px solid var(--border);">
      <div class="flex-between">
        <div>
          <strong>${programaLabel(c.programa)}</strong>
          <span class="text-soft" style="font-size:12px;"> · ${formatFecha(c.fechaIngreso)} — ${formatFecha(c.fechaEgreso)} · ${labelEstadoAlumno(c.estadoAlumno)}</span>
        </div>
        <button class="btn btn--ghost btn-ver-detalle-historico" data-ciclo-id="${id}" style="font-size:11px; padding:4px 8px;">Ver Detalle</button>
      </div>
      <div class="hidden" id="detalle-historico-${id}" style="margin-top:10px;"></div>
    </div>`).join('') || '<p class="text-soft">Sin datos.</p>';

  contenedor.querySelectorAll('.btn-ver-detalle-historico').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cicloId = btn.dataset.cicloId;
      const panel = document.getElementById(`detalle-historico-${cicloId}`);

      if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        btn.textContent = 'Ver Detalle';
        return;
      }

      btn.textContent = 'Cargando...';
      const [testsSnap, bitacoraSnap] = await Promise.all([
        get(ref(db, `ciclos/${cicloId}/tests`)),
        get(ref(db, `bitacora/${cicloId}`))
      ]);

      const tests = testsSnap.exists() ? Object.values(testsSnap.val()) : [];
      const entradasBitacora = bitacoraSnap.exists() ? Object.values(bitacoraSnap.val()) : [];

      const testsHtml = tests.length
        ? tests.sort((a, b) => b.completadoAt - a.completadoAt).map(t => {
            const fecha = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(t.completadoAt));
            const p = t.promedios || {};
            return `<div style="font-size:13px; padding:4px 0;">${fecha} — Fase1: ${p.fase1 ?? '—'} · Fase2: ${p.fase2 ?? '—'} · Fase3: ${p.fase3 ?? '—'} · Fase4: ${p.fase4 ?? '—'}</div>`;
          }).join('')
        : '<p class="text-soft" style="font-size:13px;">Sin tests registrados en este ciclo.</p>';

      const bitacoraHtml = entradasBitacora.length
        ? entradasBitacora.sort((a, b) => b.createdAt - a.createdAt).map(e => `
            <div style="font-size:13px; padding:6px 0; border-top:0.5px solid var(--border);">
              <strong>${e.titulo || ''}</strong> — ${formatFecha(e.fecha)} · ${e.canal || ''}<br>${e.notas || ''}
            </div>`).join('')
        : '<p class="text-soft" style="font-size:13px;">Sin entradas de bitácora en este ciclo.</p>';

      panel.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
          <div><strong style="font-size:13px;">Tests realizados</strong>${testsHtml}</div>
          <div><strong style="font-size:13px;">Bitácora</strong>${bitacoraHtml}</div>
        </div>`;
      panel.classList.remove('hidden');
      btn.textContent = 'Ocultar Detalle';
    });
  });
}

/* --- Bloqueo general de Datos/Ciclo tras guardar, con botón "Editar" ---
       Director: el botón desbloquea todo. Coach: solo Correo, Teléfono,
       Dirección y Redes Sociales (la Fase tiene su propia regla aparte,
       ver abrirFicha). No se toca ciclo-programa/fechas (siempre fijos)
       ni ciclo-coach (ya lo gobierna su propia regla de rol). */
function aplicarBloqueoDatosCiclo(bloqueado, role) {
  document.querySelectorAll('.tab-panel[data-panel="datos"] input, .tab-panel[data-panel="datos"] select, .tab-panel[data-panel="datos"] textarea')
    .forEach(el => { if (el.id !== 'datos-edad' && el.id !== 'datos-foto-input') el.disabled = bloqueado; });

  document.querySelectorAll('.tab-panel[data-panel="ciclo"] input, .tab-panel[data-panel="ciclo"] textarea')
    .forEach(el => {
      if (['ciclo-fecha-ingreso', 'ciclo-fecha-egreso', 'ciclo-whatsapp-grupo'].includes(el.id)) return;
      el.disabled = bloqueado;
    });

  const selectFase = document.getElementById('ciclo-fase-metodologia');
  if (selectFase) selectFase.disabled = bloqueado;

  if (role === 'director') {
    const selectCoach = document.getElementById('ciclo-coach');
    if (selectCoach) selectCoach.disabled = bloqueado;
  }

  const btnWhatsapp = document.getElementById('ciclo-whatsapp-toggle');
  if (btnWhatsapp) btnWhatsapp.disabled = bloqueado;

  const btnFoto = document.getElementById('btn-cambiar-foto');
  if (btnFoto) btnFoto.disabled = bloqueado;

  document.querySelectorAll('#tabla-redes-sociales-body select, #tabla-redes-sociales-body input, #tabla-redes-sociales-body button')
    .forEach(el => { el.disabled = bloqueado; });
  const btnAgregarRed = document.getElementById('btn-agregar-red-social');
  if (btnAgregarRed) btnAgregarRed.disabled = bloqueado;
}

function habilitarEdicionParcialCoach() {
  ['datos-email', 'datos-telefono', 'datos-direccion-calle', 'datos-direccion-numero',
    'datos-direccion-depto', 'datos-direccion-comuna', 'datos-direccion-region', 'datos-direccion-pais',
    'ciclo-fase-metodologia', 'ciclo-whatsapp-toggle', 'btn-cambiar-foto'
  ].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });

  document.querySelectorAll('#tabla-redes-sociales-body select, #tabla-redes-sociales-body input, #tabla-redes-sociales-body button')
    .forEach(el => { el.disabled = false; });
  const btnAgregarRed = document.getElementById('btn-agregar-red-social');
  if (btnAgregarRed) btnAgregarRed.disabled = false;
}

const btnEditarDatosCiclo = document.getElementById('btn-editar-datos-ciclo');
if (btnEditarDatosCiclo) {
  btnEditarDatosCiclo.addEventListener('click', () => {
    if (getCurrentRole() === 'director') {
      aplicarBloqueoDatosCiclo(false, 'director');
    } else {
      habilitarEdicionParcialCoach();
      if (estadoProcesoActual !== 'matricula_finalizada') {
        document.getElementById('ciclo-fase-metodologia').disabled = true;
      }
    }
    btnEditarDatosCiclo.classList.add('hidden');
  });
}

/* --- Switch visual del grupo de WhatsApp --- */
function actualizarBotonWhatsapp(activo) {
  const btn = document.getElementById('ciclo-whatsapp-toggle');
  const hidden = document.getElementById('ciclo-whatsapp-grupo');
  if (!btn || !hidden) return;
  hidden.value = activo ? 'true' : 'false';
  btn.className = activo ? 'badge badge--activo' : 'badge badge--impaga';
  btn.textContent = activo ? '✓ Ya se unió' : 'Aún no se une al grupo';
  btn.style.cssText = 'cursor:pointer; border:none; margin-top:8px; padding:8px 14px; font-size:13px;';
}

const btnWhatsappToggle = document.getElementById('ciclo-whatsapp-toggle');
if (btnWhatsappToggle) {
  btnWhatsappToggle.addEventListener('click', () => {
    const hidden = document.getElementById('ciclo-whatsapp-grupo');
    actualizarBotonWhatsapp(hidden.value !== 'true');
  });
}


/* --- Abre la ficha de un alumno con sus datos reales --- */
async function abrirFicha(alumnoId) {
  if (getCurrentRole() === 'director') await cargarCoaches();

  const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
  if (!alumnoSnap.exists()) return;
  const alumno = alumnoSnap.val();

  currentAlumnoId = alumnoId;
  currentCicloId = alumno.cicloActualId || null;

  actualizarBotonAccesoAlumno(alumnoId, !!alumno.authUid);

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
  document.getElementById('ficha-foto-alumno').src = alumno.fotoUrl || PLACEHOLDER_FOTO;
  document.getElementById('ficha-rut').textContent = alumno.rut || '—';
  document.getElementById('ficha-programa').textContent = ciclo ? programaLabel(ciclo.programa) : '—';
  document.getElementById('ficha-coach-nombre').textContent = ciclo
    ? (role === 'coach' ? getCurrentUserNombre() : (ciclo.coachId ? (coachesMap[ciclo.coachId] || '—') : (ciclo.programa === 'begin' ? '🚩 Coach de Cabecera' : '—')))
    : '—';

  const badge = document.getElementById('ficha-badge-estado');
  const estadoAlumno = ciclo ? ciclo.estadoAlumno : 'activo';
  badge.textContent = labelEstadoAlumno(estadoAlumno);
  badge.className = 'badge ' + claseBadgeEstadoAlumno(estadoAlumno);

  document.getElementById('datos-foto-preview').src = alumno.fotoUrl || PLACEHOLDER_FOTO;
  document.getElementById('datos-nombre').value = alumno.nombre || '';
  document.getElementById('datos-apellido').value = alumno.apellido || '';
  document.getElementById('datos-rut').value = alumno.rut || '';
  document.getElementById('datos-fecha-nacimiento').value = alumno.fechaNacimiento || '';
  actualizarEdad();
  document.getElementById('datos-genero').value = alumno.genero || 'Femenino';
  setTelefono(alumno.telefono || '');
  document.getElementById('datos-email').value = alumno.email || '';
  const dir = alumno.direccion || {};
  document.getElementById('datos-direccion-calle').value = dir.calle || '';
  document.getElementById('datos-direccion-numero').value = dir.numero || '';
  document.getElementById('datos-direccion-depto').value = dir.departamento || '';
  document.getElementById('datos-direccion-comuna').value = dir.comuna || '';
  document.getElementById('datos-direccion-region').value = dir.region || '';
  document.getElementById('datos-direccion-pais').value = dir.pais || 'Chile';
  document.getElementById('datos-ocupacion').value = alumno.ocupacion || '';
  document.getElementById('datos-ocupacion-especialidad').value = alumno.ocupacionEspecialidad || '';
  actualizarCampoEspecialidad();

  const tbodyRedes = document.getElementById('tabla-redes-sociales-body');
  tbodyRedes.innerHTML = '';
  const redes = alumno.redesSociales ? Object.values(alumno.redesSociales) : [];
  redes.forEach(agregarFilaRedSocial);

  const selectCoach = document.getElementById('ciclo-coach');
  if (role === 'director') {
    poblarSelectCoaches(selectCoach, ciclo ? ciclo.coachId : null);
    selectCoach.disabled = false;
  } else {
    selectCoach.innerHTML = `<option>${getCurrentUserNombre()}</option>`;
    selectCoach.disabled = true;
  }

  // --- Fecha Ingreso/Egreso: el director siempre las puede corregir a
  //     mano (casos especiales, alumnos antiguos que se cargan con su
  //     fecha real) — coach/mentor las ven, pero bloqueadas. Independiente
  //     del bloqueo general de la ficha (ver aplicarBloqueoDatosCiclo). ---
  const inputFechaIngresoCiclo = document.getElementById('ciclo-fecha-ingreso');
  const inputFechaEgresoCiclo = document.getElementById('ciclo-fecha-egreso');
  const puedeEditarFechasCiclo = role === 'director';
  if (inputFechaIngresoCiclo) inputFechaIngresoCiclo.disabled = !puedeEditarFechasCiclo;
  if (inputFechaEgresoCiclo) inputFechaEgresoCiclo.disabled = !puedeEditarFechasCiclo;

  if (ciclo) {
    document.getElementById('ciclo-programa').value = ciclo.programa || 'begin';
    document.getElementById('ciclo-fecha-ingreso').value = ciclo.fechaIngreso || '';
    document.getElementById('ciclo-fecha-egreso').value = ciclo.fechaEgreso || '';
    document.getElementById('ciclo-facturacion-actual').value = ciclo.facturacionActual || '';
    document.getElementById('ciclo-objetivo-facturacion').value = ciclo.objetivoFacturacion || '';
    document.getElementById('ciclo-situacion-personal').value = ciclo.situacionPersonal || '';
    document.getElementById('ciclo-objetivos-personales').value = ciclo.objetivosPersonales || '';
    document.getElementById('ciclo-fase-metodologia').value = ciclo.faseMetodologia || '';
    actualizarBotonWhatsapp(!!ciclo.enGrupoWhatsapp);
  }
  actualizarCampoCoachSegunPrograma('ciclo-programa', 'campo-ciclo-coach', 'aviso-ciclo-begin-sin-coach');

  const estadoProceso = ciclo ? ciclo.estadoProceso : 'asignado';
  estadoProcesoActual = estadoProceso;
  const estadoAlumnoActual = ciclo ? ciclo.estadoAlumno : null;
  document.getElementById('ficha-stepper').innerHTML = renderStepper(estadoProceso);

  document.getElementById('panel-marcar-egresado').classList.toggle('hidden', !(role === 'director' && estadoAlumnoActual === 'activo'));
  document.getElementById('panel-nuevo-ciclo').classList.toggle('hidden', !(role === 'director' && estadoAlumnoActual === 'egresado'));
  if (role === 'director' && estadoAlumnoActual === 'egresado') {
    poblarSelectCoaches(document.getElementById('nuevo-ciclo-coach'), null);
    actualizarCampoCoachSegunPrograma('nuevo-ciclo-programa', 'campo-nuevo-ciclo-coach', 'aviso-nuevo-ciclo-begin-sin-coach');
  }

  await renderHistorialCiclos(alumno.ciclosAnteriores);

  await cargarTestParaCiclo(currentCicloId);
  await cargarAcuerdoParaCiclo(currentCicloId);
  await cargarBitacoraParaCiclo(currentCicloId, estadoProceso === 'matricula_finalizada');

  const listoParaGenerarAcuerdo = datosGeneralesCompletos(alumno) && cicloCompleto(ciclo) && hayTestCompletado();
  renderAcciones(estadoProceso, role, listoParaGenerarAcuerdo);

  // --- Bloqueo general: si Datos+Ciclo ya están completos, se bloquea todo
  //     y aparece "Editar" (alcance según rol). Si aún falta algo, queda
  //     editable para poder completarlo. ---
  const btnEditar = document.getElementById('btn-editar-datos-ciclo');
  const datosCicloCompletos = datosGeneralesCompletos(alumno) && cicloCompleto(ciclo);
  if (datosCicloCompletos) {
    aplicarBloqueoDatosCiclo(true, role);
    btnEditar.classList.remove('hidden');
  } else {
    aplicarBloqueoDatosCiclo(false, role);
    btnEditar.classList.add('hidden');
  }

  // La Fase de la Metodología ahora forma parte del bloqueo general (botón
  // "Editar") — solo se fuerza deshabilitada si aún no corresponde mostrarla
  // (antes de "Proceso de Matrícula Finalizado").
  if (estadoProceso !== 'matricula_finalizada') {
    document.getElementById('ciclo-fase-metodologia').disabled = true;
  }

  // --- Bloqueos de mayor prioridad, exclusivos para el coach (pisan lo de arriba) ---
  const panelCandado = document.getElementById('panel-candado');
  if (role === 'coach' && (estadoProceso === 'enviado_firma' || estadoProceso === 'en_revision')) {
    aplicarBloqueoCamposFicha(true);
    btnEditar.classList.add('hidden');
    panelCandado.classList.add('hidden');
  } else if (ciclo && estadoProceso === 'matricula_finalizada') {
    bloqueoActual = !!ciclo.bloqueoCoach;
    if (role === 'coach') {
      setCandado(bloqueoActual);
    } else {
      panelCandado.classList.add('hidden');
    }
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
    const coachId = programa === 'begin' ? null : document.getElementById('nuevo-alumno-coach').value;
    const monto = document.getElementById('nuevo-alumno-monto').value.trim();
    const moneda = document.getElementById('nuevo-alumno-moneda').value;
    const descuento = document.getElementById('nuevo-alumno-descuento').value.trim();
    const abono = document.getElementById('nuevo-alumno-abono').value.trim();

    if (!nombre || !apellido || (programa !== 'begin' && !coachId)) {
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
    const errorEl = document.getElementById('datos-error');
    errorEl.classList.add('hidden');

    const datosForm = {
      nombre: document.getElementById('datos-nombre').value.trim(),
      apellido: document.getElementById('datos-apellido').value.trim(),
      rut: document.getElementById('datos-rut').value.trim(),
      fechaNacimiento: document.getElementById('datos-fecha-nacimiento').value,
      genero: document.getElementById('datos-genero').value,
      telefono: getTelefono(),
      email: document.getElementById('datos-email').value.trim(),
      direccion: {
        calle: document.getElementById('datos-direccion-calle').value.trim(),
        numero: document.getElementById('datos-direccion-numero').value.trim(),
        departamento: document.getElementById('datos-direccion-depto').value.trim(),
        comuna: document.getElementById('datos-direccion-comuna').value.trim(),
        region: document.getElementById('datos-direccion-region').value.trim(),
        pais: document.getElementById('datos-direccion-pais').value.trim()
      },
      ocupacion: document.getElementById('datos-ocupacion').value,
      ocupacionEspecialidad: document.getElementById('datos-ocupacion-especialidad').value.trim(),
      redesSociales: (() => {
        const redes = {};
        document.querySelectorAll('#tabla-redes-sociales-body tr').forEach((row, idx) => {
          const plataforma = row.querySelector('.red-social-plataforma').value;
          const usuario = row.querySelector('.red-social-usuario').value.trim();
          if (usuario) redes[`r${idx}_${Date.now()}`] = { plataforma, usuario };
        });
        return redes;
      })()
    };

    const faltantesDatos = validarDatosGenerales(datosForm);
    if (faltantesDatos.length > 0) {
      errorEl.textContent = 'Faltan datos por completar — revisa los campos marcados en rojo.';
      errorEl.classList.remove('hidden');
      marcarCamposFaltantes(faltantesDatos);
      return;
    }
    marcarCamposFaltantes([]);

    btnGuardarDatos.disabled = true;
    try {
      await update(ref(db, `alumnos/${currentAlumnoId}`), datosForm);
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
    const errorElCiclo = document.getElementById('ciclo-error');
    errorElCiclo.classList.add('hidden');

    const datos = {
      facturacionActual: document.getElementById('ciclo-facturacion-actual').value.trim(),
      objetivoFacturacion: document.getElementById('ciclo-objetivo-facturacion').value.trim(),
      situacionPersonal: document.getElementById('ciclo-situacion-personal').value.trim(),
      objetivosPersonales: document.getElementById('ciclo-objetivos-personales').value.trim(),
      faseMetodologia: document.getElementById('ciclo-fase-metodologia').value,
      enGrupoWhatsapp: document.getElementById('ciclo-whatsapp-grupo').value === 'true'
    };

    const faltantesCiclo = validarCiclo(datos);
    if (faltantesCiclo.length > 0) {
      errorElCiclo.textContent = 'Faltan datos por completar — revisa los campos marcados en rojo.';
      errorElCiclo.classList.remove('hidden');
      marcarCamposFaltantes(faltantesCiclo);
      return;
    }
    marcarCamposFaltantes([]);

    btnGuardarCiclo.disabled = true;
    try {
      if (getCurrentRole() === 'director') {
        const programaActualCiclo = document.getElementById('ciclo-programa').value;
        datos.coachId = programaActualCiclo === 'begin' ? null : document.getElementById('ciclo-coach').value;
        const fechaIngresoManual = document.getElementById('ciclo-fecha-ingreso').value;
        const fechaEgresoManual = document.getElementById('ciclo-fecha-egreso').value;
        if (fechaIngresoManual) datos.fechaIngreso = fechaIngresoManual;
        if (fechaEgresoManual) datos.fechaEgreso = fechaEgresoManual;
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
    btnGenerarAcuerdo.textContent = 'Generando PDF...';
    try {
      await generarPdfAcuerdo(currentAlumnoId, currentCicloId);
      await generarAcuerdoYEnviarRevision(currentCicloId);
      await abrirFicha(currentAlumnoId);
      await cargarListasAlumnos();
    } catch (err) {
      console.error('Error al generar el PDF del acuerdo:', err);
      alert('No se pudo generar el PDF del acuerdo. Revisa la consola (F12) y mándale el error a Claude. Detalle: ' + (err && err.message ? err.message : err));
    } finally {
      btnGenerarAcuerdo.disabled = false;
      btnGenerarAcuerdo.textContent = 'Generar Acuerdo y Enviar a Revisión';
    }
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
/* --- BEGIN no lleva coach individual (lo ve el Coach de Cabecera) —
       oculta el campo "Coach Asignado" cuando el programa elegido es
       Begin, en los 3 lugares donde se elige programa + coach. --- */
function actualizarCampoCoachSegunPrograma(selectProgramaId, campoCoachId, avisoId) {
  const selectPrograma = document.getElementById(selectProgramaId);
  const campoCoach = document.getElementById(campoCoachId);
  if (!selectPrograma || !campoCoach) return;
  const esBegin = selectPrograma.value === 'begin';
  campoCoach.classList.toggle('hidden', esBegin);
  const aviso = avisoId ? document.getElementById(avisoId) : null;
  if (aviso) aviso.classList.toggle('hidden', !esBegin);
}

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
if (selectNuevoAlumnoPrograma) {
  selectNuevoAlumnoPrograma.addEventListener('change', autocompletarMontoNuevoAlumno);
  selectNuevoAlumnoPrograma.addEventListener('change', () => actualizarCampoCoachSegunPrograma('nuevo-alumno-programa', 'campo-nuevo-alumno-coach', 'aviso-nuevo-alumno-begin-sin-coach'));
}
if (selectNuevoAlumnoMoneda) selectNuevoAlumnoMoneda.addEventListener('change', autocompletarMontoNuevoAlumno);
if (inputNuevoAlumnoTipoCambio) inputNuevoAlumnoTipoCambio.addEventListener('input', autocompletarMontoNuevoAlumno);
autocompletarMontoNuevoAlumno(); // prefill inicial (Begin · CLP por defecto)
actualizarCampoCoachSegunPrograma('nuevo-alumno-programa', 'campo-nuevo-alumno-coach', 'aviso-nuevo-alumno-begin-sin-coach');

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

const btnMarcarEgresado = document.getElementById('btn-marcar-egresado');
if (btnMarcarEgresado) {
  btnMarcarEgresado.addEventListener('click', async () => {
    if (!currentCicloId) return;
    const confirmado = confirm('¿Marcar a este alumno como egresado? Vas a poder iniciarle un ciclo nuevo después sin perder nada del historial.');
    if (!confirmado) return;
    btnMarcarEgresado.disabled = true;
    try {
      await update(ref(db, `ciclos/${currentCicloId}`), { estadoAlumno: 'egresado' });
      await abrirFicha(currentAlumnoId);
      await cargarListasAlumnos();
    } finally {
      btnMarcarEgresado.disabled = false;
    }
  });
}

function autocompletarMontoNuevoCiclo() {
  const selectPrograma = document.getElementById('nuevo-ciclo-programa');
  const selectMoneda = document.getElementById('nuevo-ciclo-moneda');
  const inputMonto = document.getElementById('nuevo-ciclo-monto');
  if (!selectPrograma || !selectMoneda || !inputMonto) return;
  const programa = PROGRAMAS[selectPrograma.value];
  if (selectMoneda.value === 'CLP' && programa) {
    inputMonto.value = programa.precioClp.toLocaleString('es-CL');
  }
}
const selectNuevoCicloPrograma = document.getElementById('nuevo-ciclo-programa');
const selectNuevoCicloMoneda = document.getElementById('nuevo-ciclo-moneda');
if (selectNuevoCicloPrograma) {
  selectNuevoCicloPrograma.addEventListener('change', autocompletarMontoNuevoCiclo);
  selectNuevoCicloPrograma.addEventListener('change', () => actualizarCampoCoachSegunPrograma('nuevo-ciclo-programa', 'campo-nuevo-ciclo-coach', 'aviso-nuevo-ciclo-begin-sin-coach'));
}
if (selectNuevoCicloMoneda) selectNuevoCicloMoneda.addEventListener('change', autocompletarMontoNuevoCiclo);

const btnCrearNuevoCiclo = document.getElementById('btn-crear-nuevo-ciclo');
if (btnCrearNuevoCiclo) {
  btnCrearNuevoCiclo.addEventListener('click', async () => {
    if (!currentAlumnoId || !currentCicloId) return;
    const programa = document.getElementById('nuevo-ciclo-programa').value;
    const coachId = programa === 'begin' ? null : document.getElementById('nuevo-ciclo-coach').value;
    const monto = document.getElementById('nuevo-ciclo-monto').value.trim();
    const moneda = document.getElementById('nuevo-ciclo-moneda').value;

    if (programa !== 'begin' && !coachId) { alert('Selecciona un coach.'); return; }

    btnCrearNuevoCiclo.disabled = true;
    try {
      const cicloQueTermina = currentCicloId;
      const alumnoSnap = await get(ref(db, `alumnos/${currentAlumnoId}`));
      const ciclosAnteriores = (alumnoSnap.exists() && alumnoSnap.val().ciclosAnteriores) || [];
      if (!ciclosAnteriores.includes(cicloQueTermina)) ciclosAnteriores.push(cicloQueTermina);
      await update(ref(db, `alumnos/${currentAlumnoId}`), { ciclosAnteriores });

      await crearCiclo({
        alumnoId: currentAlumnoId, coachId, programa,
        acuerdoPago: { montoTotal: monto, moneda, descuento: '', abono: '', saldo: monto, cuotas: {}, pdfUrl: '' }
      });

      await abrirFicha(currentAlumnoId);
      await cargarListasAlumnos();
    } finally {
      btnCrearNuevoCiclo.disabled = false;
    }
  });
}

/* --- Llamado desde auth.js apenas se confirma el rol tras el login --- */
export async function initAlumnosModule() {
  if (getCurrentRole() === 'director') {
    await cargarCoaches();
    await cargarListasAlumnos();
  } else if (getCurrentRole() === 'coach') {
    await cargarMiEvaluacionCoach();
    await cargarListasAlumnos();
    await cargarSesionesBeginCoach();
  } else if (getCurrentRole() === 'mentor') {
    await cargarDashboardMentor();
    await cargarAlumnosMentor();
    await cargarPerfilMentor();
    await cargarMentoriasView();
    await cargarBoxMentor();
  }
}

document.addEventListener('rolCambiado', () => { initAlumnosModule(); });

// Refresca las tablas y la lista de coaches cada vez que se navega —
// evita que quede mostrando datos viejos si algo cambió mientras tanto
// (ej. un coach eliminado que se quedaba pegado en los desplegables).
document.querySelectorAll('.nav-item[data-nav]').forEach(item => {
  item.addEventListener('click', () => {
    if (item.dataset.nav === 'dashboard' || item.dataset.nav === 'alumnos' || item.dataset.nav === 'coaches') {
      cargarListasAlumnos();
      if (getCurrentRole() === 'director') cargarCoaches();
    }
  });
});

/* ============================================================
   Director — "Ver como Alumno (Demo)": 3 alumnos ficticios fijos
   (uno por programa), auto-creados la primera vez, marcados
   esDemo:true (nunca cuentan en listas/KPIs — ver cargarListasAlumnos
   y las secciones de coaches.js), y con "(BEGIN/NEXT/eXIT)" ya en el
   apellido para que el tag "(DEMO)" se vea solo, en todos lados
   donde se muestre su nombre (BOX, Preguntas en Vivo, etc.) sin tener
   que tocar cada pantalla una por una.
   ============================================================ */
const ETIQUETAS_DEMO = { begin: 'BEGIN', next: 'NEXT', exit: 'eXIT' };
let estadoDirectorAntesDeDemo = null;

async function asegurarAlumnoDemo(programa) {
  const demoId = `demo-${programa}`;
  const alumnoSnap = await get(ref(db, `alumnos/${demoId}`));
  if (alumnoSnap.exists()) return demoId;

  const hoy = new Date().toISOString().slice(0, 10);
  await set(ref(db, `alumnos/${demoId}`), {
    nombre: 'Alumno Demo',
    apellido: `(${ETIQUETAS_DEMO[programa]} · DEMO)`,
    email: `demo-${programa}@uneq.local`,
    cicloActualId: demoId,
    esDemo: true,
    createdAt: Date.now()
  });
  await set(ref(db, `ciclos/${demoId}`), {
    alumnoId: demoId,
    programa,
    coachId: null,
    estadoProceso: 'firma_procesada',
    estadoAlumno: 'activo',
    fechaIngreso: hoy,
    fechaEgreso: hoy,
    facturacionActual: '—',
    objetivoFacturacion: '—',
    situacionPersonal: '—',
    objetivosPersonales: '—',
    esDemo: true,
    createdAt: Date.now()
  });
  return demoId;
}

function mostrarBannerModoDemo(programa) {
  let banner = document.getElementById('banner-modo-demo');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'banner-modo-demo';
    banner.style.cssText = 'background:#E8A33D; color:#1B2333; padding:8px 20px; text-align:center; font-size:13px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:14px; flex-wrap:wrap;';
    const mainCol = document.querySelector('.main');
    if (mainCol) mainCol.prepend(banner);
  }
  banner.innerHTML = `👁️ Viendo como Alumno Demo (${ETIQUETAS_DEMO[programa]}) — esto no es un alumno real, nada de lo que hagas acá cuenta en el sistema.
    <button type="button" id="btn-salir-modo-demo" class="btn btn--ghost" style="font-size:11px; padding:3px 12px; background:#fff;">🔙 Volver a Director</button>`;
  document.getElementById('btn-salir-modo-demo').addEventListener('click', salirModoDemo);
}

function salirModoDemo() {
  const banner = document.getElementById('banner-modo-demo');
  if (banner) banner.remove();
  const uidActual = auth.currentUser ? auth.currentUser.uid : null;
  const restaurar = async () => {
    // CRÍTICO: hay que borrar este mapeo, no solo dejar de usarlo — las
    // reglas de alumnos/ciclos le dan acceso amplio al staff solo cuando
    // su uid NO tiene entrada en alumnoPorAuthUid. Si queda puesto, el
    // director pierde el acceso a los alumnos reales para siempre.
    if (uidActual) await set(ref(db, `alumnoPorAuthUid/${uidActual}`), null);
    if (estadoDirectorAntesDeDemo) {
      applyRole(estadoDirectorAntesDeDemo.rol, estadoDirectorAntesDeDemo.nombre, estadoDirectorAntesDeDemo.roles);
      estadoDirectorAntesDeDemo = null;
    }
    setNav('dashboard');
    document.dispatchEvent(new CustomEvent('rolCambiado'));
  };
  restaurar();
}

async function verComoAlumnoDemo(programa) {
  if (getCurrentRole() !== 'director') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;
  if (!estadoDirectorAntesDeDemo) {
    estadoDirectorAntesDeDemo = { rol: getCurrentRole(), nombre: getCurrentUserNombre(), roles: getCurrentRolesDisponibles() };
  }
  const demoId = await asegurarAlumnoDemo(programa);
  // Sin esto, las reglas de seguridad rechazarían cualquier escritura
  // "como alumno" (preguntas al BOX, Preguntas en Vivo, etc.) — el
  // director sigue autenticado con su propia cuenta, así que esta
  // cuenta necesita, temporalmente, mapear también a este alumno.
  await update(ref(db, 'alumnoPorAuthUid'), { [uid]: demoId });
  applyRole('alumno', `Alumno Demo (${ETIQUETAS_DEMO[programa]})`, ['alumno']);
  mostrarBannerModoDemo(programa);
  await cargarDashboardAlumno(demoId);
  setNav('dashboard');
}

const btnVerDemoBegin = document.getElementById('btn-ver-demo-begin');
if (btnVerDemoBegin) btnVerDemoBegin.addEventListener('click', () => verComoAlumnoDemo('begin'));
const btnVerDemoNext = document.getElementById('btn-ver-demo-next');
if (btnVerDemoNext) btnVerDemoNext.addEventListener('click', () => verComoAlumnoDemo('next'));
const btnVerDemoExit = document.getElementById('btn-ver-demo-exit');
if (btnVerDemoExit) btnVerDemoExit.addEventListener('click', () => verComoAlumnoDemo('exit'));
