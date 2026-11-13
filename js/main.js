/* ============================================================
   main.js — Navegación y UI del app-shell.
   El rol real (director|coach) lo determina auth.js a partir de
   /usuarios/{uid}. Este archivo expone applyRole()/showLogin() y
   varios helpers que alumnos.js/ciclos.js usan para pintar la UI.
   ============================================================ */

import { escaparHtml } from './util-html.js';

let currentRole = null;
let currentNombre = '';
let currentRolesDisponibles = [];
let candadoBloqueado = false;

// Inserta el isotipo de UNEQ Mentoring donde corresponda
document.querySelectorAll('[data-brand-mark]').forEach(el => {
  const tpl = document.getElementById('tpl-brand-mark');
  el.appendChild(tpl.content.cloneNode(true));
});

const NOMBRES_ROL = {
  director: 'Director/a Académico', coach: 'Copiloto', mentor: 'Mentor/a', alumno: 'Alumno/a',
  directorComercial: 'Director/a Comercial', closer: 'Closer'
};

// Vistas que viven en el módulo de agendamiento (otra página, misma sesión).
export const RUTAS_AGENDAMIENTO = {
  directorComercial: 'agendamiento/director-comercial.html',
  closer: 'agendamiento/closer.html'
};

export function applyRole(role, nombre, rolesDisponibles) {
  currentRole = role;
  currentNombre = nombre;
  currentRolesDisponibles = (rolesDisponibles && rolesDisponibles.length) ? rolesDisponibles : [role];

  document.body.classList.toggle('tema-alumno-oscuro', role === 'alumno');
  // La estética por nivel (tema-begin) la pone alumno-portal.js al
  // conocer el programa; cualquier otro rol la quita.
  if (role !== 'alumno') document.body.classList.remove('tema-begin', 'tema-open', 'tema-exit');

  document.querySelectorAll('[data-role="director"]').forEach(el => {
    el.classList.toggle('hidden', role !== 'director');
  });
  document.querySelectorAll('[data-role="coach"]').forEach(el => {
    el.classList.toggle('hidden', role !== 'coach');
  });
  document.querySelectorAll('[data-role="mentor"]').forEach(el => {
    el.classList.toggle('hidden', role !== 'mentor');
  });
  document.querySelectorAll('[data-role="alumno"]').forEach(el => {
    el.classList.toggle('hidden', role !== 'alumno');
  });

  // "Alumnos" (el nav-item, la lista/ficha completa) es solo para
  // director/coach/mentor — un alumno tiene su propio Dashboard aparte.
  // En la vista alumno, "Buscar actualización" y "Cerrar sesión" pasan al menú
  // lateral (la barra de arriba queda solo con marca, campanita y foto).
  const accionesAlumno = document.getElementById('sidebar-acciones-alumno');
  const barraDerecha = document.querySelector('.topbar__right');
  if (accionesAlumno && barraDerecha) {
    ['btn-buscar-actualizacion', 'btn-logout'].forEach(id => {
      const boton = document.getElementById(id);
      if (boton) (role === 'alumno' ? accionesAlumno : barraDerecha).appendChild(boton);
    });
    accionesAlumno.classList.toggle('hidden', role !== 'alumno');
  }

  const navAlumnos = document.querySelector('.nav-item[data-nav="alumnos"]');
  if (navAlumnos) navAlumnos.classList.toggle('hidden', role === 'alumno');

  // "BOX Inteligente" existe para mentor (responde) y alumno (pregunta,
  // ahora igual para todos los programas — solo cambian los topes
  // semanales, ver LIMITES_BOX_POR_PROGRAMA en alumno-portal.js).
  const navBox = document.querySelector('.nav-item[data-nav="box-consultas"]');
  if (navBox) {
    navBox.classList.toggle('hidden', !(role === 'mentor' || role === 'alumno'));
    if (role === 'mentor') navBox.textContent = 'BOX Inteligente';
  }

  // "Mis Hitos" — solo alumno (su propio progreso y lo que él mismo
  // publicó). Comentar/reaccionar en lo de otros ahora vive en
  // "Comunidad UNEQ", visible para todos los roles.
  const navHitos = document.querySelector('.nav-item[data-nav="mis-hitos"]');
  if (navHitos) navHitos.classList.toggle('hidden', role !== 'alumno');

  const navComunidadUneq = document.querySelector('.nav-item[data-nav="comunidad-uneq"]');
  if (navComunidadUneq) navComunidadUneq.classList.remove('hidden');

  // Ranking: lo ve todo el mundo (los alumnos además ven su propio lugar).
  const navRanking = document.querySelector('.nav-item[data-nav="ranking"]');
  if (navRanking) navRanking.classList.remove('hidden');

  // Contenidos (clases): por ahora solo el staff (el director las administra; mentores y
  // copilotos las ven). Los alumnos NO la ven hasta que esté lista al 100%.
  const navContenidos = document.querySelector('.nav-item[data-nav="contenidos"]');
  // El Alumno Demo (modo demo) también la ve, para poder presentarla.
  if (navContenidos) navContenidos.classList.toggle('hidden', !(['director', 'mentor', 'coach'].includes(role) || (role === 'alumno' && esModoDemo())));

  const navLaboratorio = document.querySelector('.nav-item[data-nav="laboratorio-ia"]');
  if (navLaboratorio) navLaboratorio.classList.toggle('hidden', !(['director', 'coach'].includes(role) || (role === 'alumno' && (LABORATORIO_ABIERTO_A_ALUMNOS || esModoDemo()))));

  const navMentoriasMentor = document.querySelector('.nav-item[data-nav="mentorias-mentor"]');
  if (navMentoriasMentor) navMentoriasMentor.classList.toggle('hidden', role !== 'mentor');

  const navMiClonIA = document.querySelector('.nav-item[data-nav="mi-clon-ia"]');
  if (navMiClonIA) navMiClonIA.classList.toggle('hidden', role !== 'mentor');

  const navMisDatos = document.querySelector('.nav-item[data-nav="mis-datos"]');
  if (navMisDatos) navMisDatos.classList.toggle('hidden', role === 'alumno');

  const tabPago = document.querySelector('.tab[data-tab="pago"]');
  if (tabPago) tabPago.classList.toggle('hidden', role !== 'director');

  document.getElementById('sidebar-user-info').innerHTML =
    `Sesión: <strong style="color:#fff;">${escaparHtml(nombre)}</strong><br>Rol: ${(role === 'director' && esSubdirectora()) ? 'Sub-directora' : (NOMBRES_ROL[role] || role)}`;

  renderSelectorRol();

  document.querySelectorAll('.btn-unlock-cuota').forEach(btn => btn.classList.toggle('hidden', role !== 'director'));

  document.getElementById('view-splash').classList.add('hidden');
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  setNav('dashboard');
}

/* --- Si la cuenta tiene más de un rol, muestra un selector para cambiar
       de vista sin cerrar sesión. Al cambiar, dispara "rolCambiado" para
       que alumnos.js recargue los datos del rol nuevo. --- */
function renderSelectorRol() {
  const cont = document.getElementById('selector-rol-container');
  if (!cont) return;

  if (currentRolesDisponibles.length <= 1) {
    cont.classList.add('hidden');
    cont.innerHTML = '';
    return;
  }

  cont.classList.remove('hidden');
  const opciones = currentRolesDisponibles
    .map(r => `<option value="${r}" style="color:#1B2A4A; background:#fff;" ${r === currentRole ? 'selected' : ''}>${NOMBRES_ROL[r] || r}</option>`)
    .join('');
  cont.innerHTML = `
    <label style="display:block; font-size:11px; color:rgba(255,255,255,0.45); margin-bottom:4px;">Viendo como</label>
    <select id="selector-rol-activo" style="width:100%; background:transparent; color:#fff; border:1px solid rgba(255,255,255,0.25); border-radius:6px; padding:6px;">
      ${opciones}
    </select>`;

  document.getElementById('selector-rol-activo').addEventListener('change', (ev) => {
    if (RUTAS_AGENDAMIENTO[ev.target.value]) {
      window.location.href = RUTAS_AGENDAMIENTO[ev.target.value];
      return;
    }
    applyRole(ev.target.value, currentNombre, currentRolesDisponibles);
    document.dispatchEvent(new CustomEvent('rolCambiado'));
  });
}

export function showLogin() {
  try { sessionStorage.removeItem(CLAVE_SECCION); } catch (err) { /* no pasa nada */ }
  Object.keys(CLAVES_SUB).forEach(borrarSub);
  terminarRestauracion();
  document.body.classList.remove('tema-alumno-oscuro', 'tema-begin', 'tema-open', 'tema-exit', 'modo-demo', 'es-subdirectora');
  document.getElementById('view-splash').classList.add('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('view-login').classList.remove('hidden');
  currentRole = null;
  currentNombre = '';
}

export function getCurrentRole() { return currentRole; }

// Sub-directora: en pantalla funciona como el director (rol "director"), pero sin Pagos, contratos
// (acuerdo, firma) ni Configuración. Se marca con la clase "es-subdirectora" en <body>; el CSS
// esconde todo lo que lleve "solo-director-pleno" y setNav no la deja entrar a esas secciones.
const SECCIONES_SOLO_DIRECTOR_PLENO = ['pagos', 'configuracion'];
export function esSubdirectora() { return document.body.classList.contains('es-subdirectora'); }
export function marcarSubdirectora(si) { document.body.classList.toggle('es-subdirectora', !!si); }

// Laboratorio IA: los alumnos NO lo ven hasta que la dueña avise (cambiar a true para abrirlo).
// Mientras tanto lo ven director y copilotos, y el Alumno Demo para poder probarlo.
export const LABORATORIO_ABIERTO_A_ALUMNOS = false;
// "Modo demo": director, copiloto o mentor viendo la app como Alumno Demo (lo marca alumnos.js).
export function esModoDemo() { return document.body.classList.contains('modo-demo'); }
export function getCurrentUserNombre() { return currentNombre; }
export function getCurrentRolesDisponibles() { return currentRolesDisponibles; }

// --- Router simple entre secciones del menú lateral ---
export function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}

/* --- Menú lateral en celular (cajón deslizante) --- */
function cerrarSidebarMovil() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('is-open');
  if (overlay) overlay.classList.remove('is-visible');
}

const btnHamburger = document.getElementById('btn-hamburger');
if (btnHamburger) {
  btnHamburger.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.add('is-open');
    if (overlay) overlay.classList.add('is-visible');
  });
}

const sidebarOverlay = document.getElementById('sidebar-overlay');
if (sidebarOverlay) sidebarOverlay.addEventListener('click', cerrarSidebarMovil);

// Cierra el menú solo al elegir una sección — así en celular no queda tapando la pantalla
document.querySelectorAll('.nav-item[data-nav]').forEach(item => {
  item.addEventListener('click', cerrarSidebarMovil);
});

export function marcarNavActivo(section) {
  document.querySelectorAll('.nav-item[data-nav]').forEach(i =>
    i.classList.toggle('is-active', i.dataset.nav === section));
}

/* --- Recordar la sección al actualizar la página ---
   Se guarda en sessionStorage (sobrevive a recargar la página o la app, y se borra al cerrar
   sesión). Se lee una sola vez al cargar el módulo, antes de que el login lleve al Dashboard. */
const CLAVE_SECCION = 'uneq.seccionActiva';
let seccionGuardadaAlCargar = null;
try { seccionGuardadaAlCargar = JSON.parse(sessionStorage.getItem(CLAVE_SECCION) || 'null'); } catch (err) { /* sin almacenamiento: siempre al Dashboard */ }

// Estado más fino que la sección (modo demo, ficha de alumno abierta, pantalla de Contenidos): también sobrevive al F5.
const CLAVES_SUB = { demo: 'uneq.demo', ficha: 'uneq.ficha', contenidos: 'uneq.contenidos' };
const subAlCargar = {};
Object.entries(CLAVES_SUB).forEach(([k, clave]) => {
  try { subAlCargar[k] = JSON.parse(sessionStorage.getItem(clave) || 'null'); } catch (err) { subAlCargar[k] = null; }
});
export function guardarSub(k, valor) { try { sessionStorage.setItem(CLAVES_SUB[k], JSON.stringify(valor)); } catch (err) { /* no pasa nada */ } }
export function borrarSub(k) { try { sessionStorage.removeItem(CLAVES_SUB[k]); } catch (err) { /* no pasa nada */ } }
// Lo que había al cargar la página; se entrega una sola vez (solo vale justo después de recargar).
export function consumirSub(k) { const v = subAlCargar[k] || null; subAlCargar[k] = null; return v; }

// Mientras se restaura, la pantalla de carga tapa la app: así no se ve pasar por el Dashboard ni por pantallas a medio cargar.
if ((seccionGuardadaAlCargar && seccionGuardadaAlCargar.section !== 'dashboard') || subAlCargar.demo || subAlCargar.ficha) {
  document.body.classList.add('restaurando');
  setTimeout(() => terminarRestauracion(), 12000);   // por si algo falla: nunca dejar la app tapada
}
export function terminarRestauracion() { document.body.classList.remove('restaurando'); }

const restauradores = {};
export function registrarRestauradores(r) { Object.assign(restauradores, r); }

// Se llama al terminar de entrar a la app: vuelve al modo demo, la sección y la ficha en que se estaba.
export async function restaurarEstadoGuardado() {
  try {
    const demo = subAlCargar.demo; subAlCargar.demo = null;
    if (demo && ['director', 'coach', 'mentor'].includes(currentRole) && restauradores.demo) await restauradores.demo(demo);
    restaurarSeccionGuardada();
    const ficha = consumirSub('ficha');
    if (ficha && ficha.alumnoId && currentRole !== 'alumno' && restauradores.ficha) await restauradores.ficha(ficha);
    await new Promise(r => setTimeout(r, 250));   // deja que la sección pinte su "Cargando…" antes de destapar
  } catch (err) {
    console.warn('No se pudo restaurar la vista anterior:', err);
  } finally {
    terminarRestauracion();
  }
}

function guardarSeccionActiva(section) {
  if (!currentRole || ![...document.querySelectorAll('.nav-item[data-nav]')].some(i => i.dataset.nav === section)) return;
  try { sessionStorage.setItem(CLAVE_SECCION, JSON.stringify({ role: currentRole, section })); } catch (err) { /* no pasa nada */ }
}

// Se llama una vez que terminó de entrar a la app. Se "toca" el ítem del menú, así se ejecuta
// también la carga de datos de esa sección (igual que si la persona hubiera hecho clic).
export function restaurarSeccionGuardada() {
  const guardada = seccionGuardadaAlCargar;
  seccionGuardadaAlCargar = null;
  if (!guardada || guardada.role !== currentRole || guardada.section === 'dashboard') return false;
  const item = [...document.querySelectorAll('.nav-item[data-nav]')].find(i => i.dataset.nav === guardada.section);
  if (!item || item.classList.contains('hidden')) return false;
  item.click();
  return true;
}

export function setNav(section) {
  if (esSubdirectora() && SECCIONES_SOLO_DIRECTOR_PLENO.includes(section)) section = 'dashboard';
  marcarNavActivo(section);
  document.body.classList.toggle('vista-ranking', section === 'ranking'); // fondo del espacio solo en el Ranking
  guardarSeccionActiva(section);
  borrarSub('ficha');                                  // salir a otra sección cierra la ficha abierta
  if (section !== 'contenidos') borrarSub('contenidos');

  if (section === 'dashboard') {
    const vista = currentRole === 'director' ? 'view-dashboard-director'
      : currentRole === 'mentor' ? 'view-dashboard-mentor'
      : currentRole === 'alumno' ? 'view-dashboard-alumno'
      : 'view-dashboard-coach';
    showView(vista);
    document.getElementById('topbar-title').textContent = 'Dashboard';
  } else if (section === 'alumnos') {
    const vista = currentRole === 'director' ? 'view-alumnos-director'
      : currentRole === 'mentor' ? 'view-alumnos-mentor'
      : 'view-alumnos-coach';
    showView(vista);
    document.getElementById('topbar-title').textContent = 'Alumnos';
  } else if (section === 'coaches') {
    showView('view-coaches');
    document.getElementById('topbar-title').textContent = 'Copilotos';
  } else if (section === 'pre-onboarding') {
    showView('view-pre-onboarding');
    document.getElementById('topbar-title').textContent = 'Pre-Onboarding';
  } else if (section === 'mentores') {
    showView('view-mentores');
    document.getElementById('topbar-title').textContent = 'Mentores';
  } else if (section === 'box-consultas') {
    showView(currentRole === 'alumno' ? 'view-box-alumno' : 'view-box-mentor');
    document.getElementById('topbar-title').textContent = 'BOX Inteligente';
  } else if (section === 'mis-datos') {
    showView('view-mis-datos');
    document.getElementById('topbar-title').textContent = 'Mis Datos';
  } else if (section === 'rendimiento-ia') {
    showView('view-rendimiento-ia');
    document.getElementById('topbar-title').textContent = 'Rendimiento IA';
  } else if (section === 'configuracion') {
    showView('view-configuracion');
    document.getElementById('topbar-title').textContent = 'Configuración';
  } else if (section === 'bitacora-alumno') {
    showView('view-bitacora-alumno');
    document.getElementById('topbar-title').textContent = 'Mi Bitácora';
  } else if (section === 'test-alumno') {
    showView('view-test-alumno');
    document.getElementById('topbar-title').textContent = 'Mi Test Brújula';
  } else if (section === 'ficha-alumno-propia') {
    showView('view-ficha-alumno-propia');
    document.getElementById('topbar-title').textContent = 'Mi Ficha Personal';
  } else if (section === 'preguntas-vivo') {
    showView('view-preguntas-vivo');
    document.getElementById('topbar-title').textContent = 'Sesiones en Vivo';
  } else if (section === 'soporte-alumnos') {
    showView('view-soporte-alumnos');
    document.getElementById('topbar-title').textContent = 'Soporte Alumnos';
  } else if (section === 'comunidad-uneq') {
    showView('view-comunidad-uneq');
    document.getElementById('topbar-title').textContent = 'Comunidad UNEQ';
  } else if (section === 'pagos') {
    showView('view-pagos');
    document.getElementById('topbar-title').textContent = 'Pagos';
  } else if (section === 'contenidos') {
    showView('view-contenidos');
    document.getElementById('topbar-title').textContent = 'Contenidos';
  } else if (section === 'laboratorio-ia') {
    showView('view-laboratorio-ia');
    document.getElementById('topbar-title').textContent = 'Laboratorio IA';
  } else if (section === 'ranking') {
    showView('view-ranking');
    document.getElementById('topbar-title').textContent = 'Ranking';
  } else if (section === 'mis-hitos') {
    showView('view-mis-hitos');
    document.getElementById('topbar-title').textContent = 'Mis Hitos';
  } else if (section === 'mentorias-mentor') {
    showView('view-mentorias');
    document.getElementById('topbar-title').textContent = 'Mis Mentorías';
  } else if (section === 'mi-clon-ia') {
    showView('view-mi-clon-ia');
    document.getElementById('topbar-title').textContent = 'Mi Clon IA';
  }
}

document.querySelectorAll('.nav-item[data-nav]').forEach(item => {
  item.addEventListener('click', () => setNav(item.dataset.nav));
});

// --- Tabs dentro de la ficha de alumno ---
document.querySelectorAll('.tab[data-tab]').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.classList.contains('is-locked')) return;
    document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    try { const f = JSON.parse(sessionStorage.getItem(CLAVES_SUB.ficha) || 'null'); if (f) { f.tab = tab.dataset.tab; guardarSub('ficha', f); } } catch (err) { /* no pasa nada */ }
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('is-active'));
    const panel = document.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`);
    if (panel) panel.classList.add('is-active');
  });
});

// --- Crear Alumno (navegación; el guardado real vive en alumnos.js) ---
const btnNuevoAlumno = document.getElementById('btn-nuevo-alumno');
if (btnNuevoAlumno) btnNuevoAlumno.addEventListener('click', () => {
  showView('view-crear-alumno');
  marcarNavActivo('alumnos');
  document.getElementById('topbar-title').textContent = 'Nuevo Alumno';
});

['btn-cancelar-nuevo-alumno', 'btn-cancelar-nuevo-alumno-2'].forEach(id => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', () => setNav('alumnos'));
});

function habilitarQuitarCuota(row) {
  const btn = row.querySelector('.btn--danger');
  if (btn) btn.addEventListener('click', () => row.remove());
}
document.querySelectorAll('#tabla-cuotas-nuevo tbody tr').forEach(habilitarQuitarCuota);

const btnAgregarCuota = document.getElementById('btn-agregar-cuota');
if (btnAgregarCuota) btnAgregarCuota.addEventListener('click', () => {
  const tbody = document.querySelector('#tabla-cuotas-nuevo tbody');
  const row = document.createElement('tr');
  row.innerHTML = `<td><input type="date"></td><td><input placeholder="$0"></td><td><button class="btn btn--danger">Quitar</button></td>`;
  tbody.appendChild(row);
  habilitarQuitarCuota(row);
});

// --- Crear Coach (navegación; la creación real de la cuenta se conecta
//     cuando construyamos dashboard-director.js) ---
const btnNuevoCoach = document.getElementById('btn-nuevo-coach');
if (btnNuevoCoach) btnNuevoCoach.addEventListener('click', () => {
  showView('view-crear-coach');
  marcarNavActivo('coaches');
  document.getElementById('topbar-title').textContent = 'Nuevo Copiloto';
});

const btnCancelarCoach = document.getElementById('btn-cancelar-nuevo-coach');
if (btnCancelarCoach) btnCancelarCoach.addEventListener('click', () => setNav('coaches'));

// --- Crear Mentor (navegación; la creación real vive en mentores.js) ---
const btnNuevoMentor = document.getElementById('btn-nuevo-mentor');
if (btnNuevoMentor) btnNuevoMentor.addEventListener('click', () => {
  showView('view-crear-mentor');
  marcarNavActivo('mentores');
  document.getElementById('topbar-title').textContent = 'Nuevo Mentor';
});

const btnCancelarMentor = document.getElementById('btn-cancelar-nuevo-mentor');
if (btnCancelarMentor) btnCancelarMentor.addEventListener('click', () => setNav('mentores'));

// --- CANDADO A: bloqueo simple post-firma (evita ediciones accidentales del coach).
//     El estado real (bloqueado sí/no) lo decide y persiste ciclos.js/alumnos.js;
//     esta función solo pinta la UI. ---
const CAMPOS_SIEMPRE_EDITABLES_COACH = ['ciclo-facturacion-actual', 'ciclo-objetivo-facturacion', 'ciclo-situacion-personal', 'ciclo-objetivos-personales'];

export function aplicarBloqueoCamposFicha(bloqueado) {
  document.querySelectorAll(
    '.tab-panel[data-panel="datos"] input, .tab-panel[data-panel="datos"] select,' +
    '.tab-panel[data-panel="ciclo"] textarea, .tab-panel[data-panel="ciclo"] input:not(:disabled)'
  ).forEach(el => {
    if (el.id === 'datos-foto-input') return;
    // Facturación Actual, Objetivo Facturación, Situación Personal y
    // Objetivos Personales: el coach los puede editar SIEMPRE, incluso
    // con el candado puesto (candado solo protege el resto).
    if (currentRole === 'coach' && CAMPOS_SIEMPRE_EDITABLES_COACH.includes(el.id)) {
      el.disabled = false;
      return;
    }
    el.disabled = bloqueado && currentRole === 'coach';
  });
}

export function setCandado(bloqueado) {
  candadoBloqueado = bloqueado;
  const panel = document.getElementById('panel-candado');
  if (panel) panel.classList.remove('hidden');

  const titulo = document.getElementById('candado-titulo');
  const descripcion = document.getElementById('candado-descripcion');
  const toggleBtn = document.getElementById('btn-toggle-candado');
  if (titulo) titulo.textContent = bloqueado ? '🔒 Datos bloqueados' : '🔓 Datos editables';
  if (descripcion) descripcion.textContent = bloqueado
    ? 'Bloqueados para evitar ediciones accidentales del copiloto. El director puede desbloquearlos cuando lo necesite.'
    : 'Campos editables. Vuelve a bloquear cuando termines la corrección.';
  if (toggleBtn) toggleBtn.textContent = bloqueado ? 'Desbloquear' : 'Bloquear';

  aplicarBloqueoCamposFicha(bloqueado);
}

// --- CANDADO B (cuotas pagadas quedan fijas) se reactiva cuando construyamos
//     la edición completa de Acuerdo de Pago en pagos.js — la pestaña hoy es
//     de solo lectura.
