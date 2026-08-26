/* ============================================================
   main.js — Navegación y UI del app-shell.
   El rol real (director|coach) lo determina auth.js a partir de
   /usuarios/{uid}. Este archivo expone applyRole()/showLogin() y
   varios helpers que alumnos.js/ciclos.js usan para pintar la UI.
   ============================================================ */

let currentRole = null;
let currentNombre = '';
let currentRolesDisponibles = [];
let candadoBloqueado = false;

// Inserta el ícono de marca (brújula) donde corresponda
document.querySelectorAll('[data-brand-mark]').forEach(el => {
  const tpl = document.getElementById('tpl-brand-mark');
  el.appendChild(tpl.content.cloneNode(true));
});

const NOMBRES_ROL = { director: 'Director/a Académico', coach: 'Coach', mentor: 'Mentor/a', alumno: 'Alumno/a' };

export function applyRole(role, nombre, rolesDisponibles) {
  currentRole = role;
  currentNombre = nombre;
  currentRolesDisponibles = (rolesDisponibles && rolesDisponibles.length) ? rolesDisponibles : [role];

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
  const navAlumnos = document.querySelector('.nav-item[data-nav="alumnos"]');
  if (navAlumnos) navAlumnos.classList.toggle('hidden', role === 'alumno');

  // "BOX de Consultas" existe para mentor (responde) y alumno (pregunta).
  const navBox = document.querySelector('.nav-item[data-nav="box-consultas"]');
  if (navBox) navBox.classList.toggle('hidden', !(role === 'mentor' || role === 'alumno'));

  const navMisDatos = document.querySelector('.nav-item[data-nav="mis-datos"]');
  if (navMisDatos) navMisDatos.classList.toggle('hidden', role === 'alumno');

  const tabPago = document.querySelector('.tab[data-tab="pago"]');
  if (tabPago) tabPago.classList.toggle('hidden', role !== 'director');

  document.getElementById('sidebar-user-info').innerHTML =
    `Sesión: <strong style="color:#fff;">${nombre}</strong><br>Rol: ${NOMBRES_ROL[role] || role}`;

  renderSelectorRol();

  document.querySelectorAll('.btn-unlock-cuota').forEach(btn => btn.classList.toggle('hidden', role !== 'director'));

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
    applyRole(ev.target.value, currentNombre, currentRolesDisponibles);
    document.dispatchEvent(new CustomEvent('rolCambiado'));
  });
}

export function showLogin() {
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('view-login').classList.remove('hidden');
  currentRole = null;
  currentNombre = '';
}

export function getCurrentRole() { return currentRole; }
export function getCurrentUserNombre() { return currentNombre; }

// --- Router simple entre secciones del menú lateral ---
export function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}

export function marcarNavActivo(section) {
  document.querySelectorAll('.nav-item[data-nav]').forEach(i =>
    i.classList.toggle('is-active', i.dataset.nav === section));
}

export function setNav(section) {
  marcarNavActivo(section);

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
    document.getElementById('topbar-title').textContent = 'Coaches';
  } else if (section === 'mentores') {
    showView('view-mentores');
    document.getElementById('topbar-title').textContent = 'Mentores';
  } else if (section === 'box-consultas') {
    showView(currentRole === 'alumno' ? 'view-box-alumno' : 'view-box-mentor');
    document.getElementById('topbar-title').textContent = 'BOX de Consultas';
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
    document.getElementById('topbar-title').textContent = 'Mi Ficha Alumno';
  } else if (section === 'preguntas-vivo') {
    showView('view-preguntas-vivo');
    document.getElementById('topbar-title').textContent = 'Preguntas en Vivo';
  } else if (section === 'soporte-alumnos') {
    showView('view-soporte-alumnos');
    document.getElementById('topbar-title').textContent = 'Soporte Alumnos';
  } else if (section === 'preguntas-comunidad') {
    showView('view-preguntas-comunidad');
    document.getElementById('topbar-title').textContent = 'Preguntas de la Comunidad';
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
  document.getElementById('topbar-title').textContent = 'Nuevo Coach';
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
export function aplicarBloqueoCamposFicha(bloqueado) {
  document.querySelectorAll(
    '.tab-panel[data-panel="datos"] input, .tab-panel[data-panel="datos"] select,' +
    '.tab-panel[data-panel="ciclo"] textarea, .tab-panel[data-panel="ciclo"] input:not(:disabled)'
  ).forEach(el => {
    if (el.id === 'datos-foto-input') return;
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
    ? 'Bloqueados para evitar ediciones accidentales del coach. El director puede desbloquearlos cuando lo necesite.'
    : 'Campos editables. Vuelve a bloquear cuando termines la corrección.';
  if (toggleBtn) toggleBtn.textContent = bloqueado ? 'Desbloquear' : 'Bloquear';

  aplicarBloqueoCamposFicha(bloqueado);
}

// --- CANDADO B (cuotas pagadas quedan fijas) se reactiva cuando construyamos
//     la edición completa de Acuerdo de Pago en pagos.js — la pestaña hoy es
//     de solo lectura.
