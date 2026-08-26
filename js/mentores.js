/* ============================================================
   mentores.js
   Rol Mentor: gestión de cuentas (Director), Dashboard del
   mentor (KPI por programa + matriz de alumnos activos con
   detalle expandible), y su propio perfil (foto + NPS resumido).

   El NPS resumido y la creación de mentorías con link quedan
   para la próxima etapa — acá solo el placeholder ya conectado
   a la UI, para no reprocesar todo de nuevo después.
   ============================================================ */

import { db, auth, storage, firebaseConfig } from './firebase-config.js';
import { ref, get, set, update, push } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecundaria, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getCurrentRole, setNav } from './main.js';
import { programaLabel } from './ciclos.js';

export const PLACEHOLDER_FOTO_PERFIL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#E4E7EC"/><circle cx="40" cy="32" r="14" fill="#9AA4B2"/><ellipse cx="40" cy="70" rx="24" ry="18" fill="#9AA4B2"/></svg>'
);

/* --- Compatibilidad: cuentas viejas tienen "rol" (string), las nuevas
       tienen "roles" (objeto con varios a la vez). --- */
function normalizarRoles(perfil) {
  if (perfil.roles && typeof perfil.roles === 'object') return { ...perfil.roles };
  if (perfil.rol) return { [perfil.rol]: true };
  return {};
}
function tieneRol(perfil, rol) {
  return !!normalizarRoles(perfil)[rol];
}

const FASE_LABELS = { fase1: 'Fase 1', fase2: 'Fase 2', fase3: 'Fase 3', fase4: 'Fase 4' };
const TEMAS_BOX = ['Mentalidad', 'Estrategia', 'META ADS', 'Contenido Orgánico', 'CopyWriting', 'Ventas', 'Energía', 'Planificación', 'Identidad Visual', 'Diseño', 'Redes Sociales', 'Google ADS', 'Herramientas y Software'];
const URL_REDES = {
  Instagram: u => `https://instagram.com/${u.replace(/^@/, '')}`,
  Facebook: u => `https://facebook.com/${u.replace(/^@/, '')}`,
  TikTok: u => `https://tiktok.com/@${u.replace(/^@/, '')}`,
  YouTube: u => `https://youtube.com/@${u.replace(/^@/, '')}`,
  LinkedIn: u => `https://linkedin.com/in/${u.replace(/^@/, '')}`,
  Otro: u => (u.startsWith('http') ? u : `https://${u}`)
};
function urlRed(plataforma, usuario) {
  const fn = URL_REDES[plataforma] || URL_REDES.Otro;
  return fn((usuario || '').trim());
}
function formatFechaCorta(fechaStr) {
  if (!fechaStr) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(fechaStr + 'T00:00:00'));
}
function generarPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 10; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  return pass;
}

/* ============================================================
   DIRECTOR: gestión de cuentas de mentor
   ============================================================ */
async function cargarMentoresView() {
  if (getCurrentRole() !== 'director') return;
  const tbody = document.getElementById('tabla-mentores-body');
  if (!tbody) return;

  const [usuariosSnap, npsMentoriasSnap] = await Promise.all([
    get(ref(db, 'usuarios')),
    get(ref(db, 'npsMentorias'))
  ]);
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
  const npsMentoriasTodos = npsMentoriasSnap.exists() ? npsMentoriasSnap.val() : {};
  tbody.innerHTML = '';

  Object.entries(usuarios)
    .filter(([, u]) => tieneRol(u, 'mentor'))
    .forEach(([uid, mentor]) => {
      const { promedio, total } = calcularNpsResumenMentor(npsMentoriasTodos[uid]);
      const npsTexto = promedio !== null ? `${promedio.toFixed(1)} ★ (${total})` : '—';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${mentor.nombre || ''}</td>
        <td>${mentor.email || ''}</td>
        <td><span class="badge ${mentor.activo === false ? 'badge--impaga' : 'badge--activo'}">${mentor.activo === false ? 'Inactivo' : 'Activo'}</span></td>
        <td>${npsTexto}</td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn--ghost btn-gestionar-roles-mentor" style="font-size:11px; padding:4px 8px;">Roles</button>
          <button class="btn btn--ghost btn-editar-datos-mentor" style="font-size:11px; padding:4px 8px;">Editar Datos</button>
          <button class="btn btn--ghost btn-restablecer-password-mentor" style="font-size:11px; padding:4px 8px;">Restablecer Contraseña</button>
          <button class="btn btn--ghost btn-eliminar-mentor" style="font-size:11px; padding:4px 8px;">Eliminar</button>
        </td>`;
      tbody.appendChild(tr);

      tr.querySelector('.btn-restablecer-password-mentor').addEventListener('click', (ev) => enviarResetPasswordMentor(mentor.email, ev.target));

      let filaEditarDatosMentor = null;
      tr.querySelector('.btn-editar-datos-mentor').addEventListener('click', () => {
        if (filaEditarDatosMentor) { filaEditarDatosMentor.remove(); filaEditarDatosMentor = null; return; }
        filaEditarDatosMentor = document.createElement('tr');
        filaEditarDatosMentor.innerHTML = `
          <td colspan="5" style="background:#F7F8FA; padding:14px 16px;">
            <div class="field-grid mb-16">
              <div class="field"><label>Nombre</label><input class="edit-nombre-mentor" value="${mentor.nombre || ''}"></div>
              <div class="field"><label>Correo</label><input class="edit-email-mentor" type="email" value="${mentor.email || ''}"></div>
              <div class="field"><label>Teléfono</label><input class="edit-telefono-mentor" value="${mentor.telefono || ''}"></div>
            </div>
            <button class="btn btn--primary btn-guardar-datos-mentor" style="font-size:11px; padding:4px 10px;">Guardar</button>
          </td>`;
        tr.insertAdjacentElement('afterend', filaEditarDatosMentor);

        filaEditarDatosMentor.querySelector('.btn-guardar-datos-mentor').addEventListener('click', async () => {
          await update(ref(db, `usuarios/${uid}`), {
            nombre: filaEditarDatosMentor.querySelector('.edit-nombre-mentor').value.trim(),
            email: filaEditarDatosMentor.querySelector('.edit-email-mentor').value.trim(),
            telefono: filaEditarDatosMentor.querySelector('.edit-telefono-mentor').value.trim()
          });
          await cargarMentoresView();
        });
      });

      let filaRolesMentor = null;
      tr.querySelector('.btn-gestionar-roles-mentor').addEventListener('click', () => {
        if (filaRolesMentor) { filaRolesMentor.remove(); filaRolesMentor = null; return; }
        const rolesActuales = normalizarRoles(mentor);
        filaRolesMentor = document.createElement('tr');
        filaRolesMentor.innerHTML = `
          <td colspan="5" style="background:#F7F8FA; padding:14px 16px;">
            <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
              <label style="font-weight:400;"><input type="checkbox" class="chk-rol-mentor-m" ${rolesActuales.mentor ? 'checked' : ''}> Mentor</label>
              <label style="font-weight:400;"><input type="checkbox" class="chk-rol-coach-m" ${rolesActuales.coach ? 'checked' : ''}> Coach</label>
              <span class="text-soft" style="font-size:12px;">El rol Director se asigna aparte, en Firebase Console.</span>
              <button class="btn btn--primary btn-guardar-roles-mentor" style="font-size:11px; padding:4px 10px;">Guardar</button>
            </div>
          </td>`;
        tr.insertAdjacentElement('afterend', filaRolesMentor);

        filaRolesMentor.querySelector('.btn-guardar-roles-mentor').addEventListener('click', async () => {
          const nuevosRoles = {
            ...rolesActuales,
            mentor: filaRolesMentor.querySelector('.chk-rol-mentor-m').checked,
            coach: filaRolesMentor.querySelector('.chk-rol-coach-m').checked
          };
          if (!Object.values(nuevosRoles).some(Boolean)) {
            alert('Debe quedar con al menos un rol activo. Para sacarle todos los accesos, usa "Eliminar".');
            return;
          }
          await update(ref(db, `usuarios/${uid}`), { roles: nuevosRoles, rol: null });
          await cargarMentoresView();
        });
      });

      tr.querySelector('.btn-eliminar-mentor').addEventListener('click', async () => {
        const confirmado = confirm(`¿Eliminar a ${mentor.nombre || mentor.email}? Ya no va a poder entrar a la app.`);
        if (!confirmado) return;
        await set(ref(db, `usuarios/${uid}`), null);
        await cargarMentoresView();
      });
    });
}

const btnCrearMentor = document.getElementById('btn-crear-mentor');
if (btnCrearMentor) {
  btnCrearMentor.addEventListener('click', async () => {
    const errorEl = document.getElementById('nuevo-mentor-error');
    errorEl.classList.add('hidden');
    document.getElementById('panel-mentor-creado').classList.add('hidden');
    const nombre = document.getElementById('nuevo-mentor-nombre').value.trim();
    const email = document.getElementById('nuevo-mentor-email').value.trim();
    const tambienCoach = document.getElementById('nuevo-mentor-tambien-coach').checked;

    if (!nombre || !email) {
      errorEl.textContent = 'Completa nombre y correo.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnCrearMentor.disabled = true;
    btnCrearMentor.textContent = 'Creando...';

    try {
      const usuariosSnap = await get(ref(db, 'usuarios'));
      const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
      const existente = Object.entries(usuarios).find(([, u]) => (u.email || '').toLowerCase() === email.toLowerCase());

      if (existente) {
        const [uidExistente, datosExistente] = existente;
        const rolesNuevos = { ...normalizarRoles(datosExistente), mentor: true };
        if (tambienCoach) rolesNuevos.coach = true;
        await update(ref(db, `usuarios/${uidExistente}`), { roles: rolesNuevos, rol: null });

        document.getElementById('nuevo-mentor-nombre').value = '';
        document.getElementById('nuevo-mentor-email').value = '';
        document.getElementById('nuevo-mentor-tambien-coach').checked = false;
        alert(`${datosExistente.nombre || email} ya tenía una cuenta — se le agregó el rol de Mentor${tambienCoach ? ' y Coach' : ''} a la misma cuenta, sin generar contraseña nueva.`);
        await cargarMentoresView();
        return;
      }

      const password = generarPassword();
      let secundaria = null;
      try {
        secundaria = initializeApp(firebaseConfig, 'crear-mentor-' + Date.now());
        const authSecundaria = getAuth(secundaria);
        const credencial = await createUserWithEmailAndPassword(authSecundaria, email, password);
        const nuevoUid = credencial.user.uid;
        await signOutSecundaria(authSecundaria);

        const roles = { mentor: true };
        if (tambienCoach) roles.coach = true;
        await set(ref(db, `usuarios/${nuevoUid}`), { nombre, email, roles, activo: true });

        document.getElementById('nuevo-mentor-nombre').value = '';
        document.getElementById('nuevo-mentor-email').value = '';
        document.getElementById('nuevo-mentor-tambien-coach').checked = false;
        document.getElementById('mentor-creado-email').value = email;
        document.getElementById('mentor-creado-password').value = password;
        document.getElementById('panel-mentor-creado').classList.remove('hidden');

        await cargarMentoresView();
      } finally {
        if (secundaria) await deleteApp(secundaria);
      }
    } catch (err) {
      errorEl.textContent = err.code === 'auth/email-already-in-use'
        ? 'Ese correo ya tiene una cuenta creada.'
        : 'No se pudo crear la cuenta. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
    } finally {
      btnCrearMentor.disabled = false;
      btnCrearMentor.textContent = 'Crear Cuenta de Mentor';
    }
  });
}

const btnCopiarPasswordMentor = document.getElementById('btn-copiar-password-mentor');
if (btnCopiarPasswordMentor) {
  btnCopiarPasswordMentor.addEventListener('click', () => {
    const valor = document.getElementById('mentor-creado-password').value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(valor)
        .then(() => { btnCopiarPasswordMentor.textContent = '¡Copiada! ✓'; setTimeout(() => { btnCopiarPasswordMentor.textContent = 'Copiar contraseña'; }, 1500); })
        .catch(() => alert('No se pudo copiar automático — selecciónala manualmente del campo.'));
    }
  });
}

async function enviarResetPasswordMentor(email, boton) {
  if (!email) return;
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Enviando...';
  try {
    await sendPasswordResetEmail(auth, email);
    alert(`Listo — Firebase le mandó un correo a ${email} con un link para que elija su nueva contraseña.`);
  } catch (err) {
    alert('No se pudo enviar el correo. Revisa que el email esté bien escrito.');
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

document.querySelectorAll('.nav-item[data-nav="mentores"]').forEach(item => {
  item.addEventListener('click', cargarMentoresView);
});

/* ============================================================
   MENTOR: Dashboard (solo KPIs) y Alumnos (matriz con filtros)
   ============================================================ */
function renderDetalleAlumnoMentor(alumno, ciclo) {
  const dir = alumno.direccion || {};
  const direccionTexto = [[dir.calle, dir.numero].filter(Boolean).join(' '), dir.departamento, dir.comuna, dir.region, dir.pais]
    .filter(Boolean).join(', ') || '—';
  const redes = alumno.redesSociales ? Object.values(alumno.redesSociales) : [];
  const redesHtml = redes.length
    ? redes.map(r => `<a href="${urlRed(r.plataforma, r.usuario)}" target="_blank" rel="noopener">${r.plataforma}</a>`).join(' · ')
    : '—';

  return `
    <td colspan="7" style="background:#F7F8FA; padding:16px;">
      <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px 20px; font-size:13px;">
        <div><strong>Correo:</strong> ${alumno.email || '—'}</div>
        <div><strong>Cumpleaños:</strong> ${formatFechaCorta(alumno.fechaNacimiento)}</div>
        <div><strong>País:</strong> ${dir.pais || '—'}</div>
        <div><strong>Teléfono:</strong> ${alumno.telefono || '—'}</div>
        <div><strong>Ocupación:</strong> ${alumno.ocupacion || '—'}${alumno.ocupacionEspecialidad ? ` (${alumno.ocupacionEspecialidad})` : ''}</div>
        <div><strong>Ingreso / Egreso:</strong> ${formatFechaCorta(ciclo.fechaIngreso)} — ${formatFechaCorta(ciclo.fechaEgreso)}</div>
        <div><strong>Facturación actual:</strong> ${ciclo.facturacionActual || '—'}</div>
        <div><strong>Objetivo facturación:</strong> ${ciclo.objetivoFacturacion || '—'}</div>
        <div><strong>Dirección:</strong> ${direccionTexto}</div>
        <div style="grid-column: span 3;"><strong>Situación actual:</strong> ${ciclo.situacionPersonal || '—'}</div>
        <div style="grid-column: span 3;"><strong>Objetivos futuros:</strong> ${ciclo.objetivosPersonales || '—'}</div>
        <div style="grid-column: span 3;"><strong>Redes sociales:</strong> ${redesHtml}</div>
      </div>
    </td>`;
}

export async function cargarDashboardMentor() {
  if (getCurrentRole() !== 'mentor') return;
  const [alumnosSnap, ciclosSnap] = await Promise.all([get(ref(db, 'alumnos')), get(ref(db, 'ciclos'))]);
  const alumnos = alumnosSnap.exists() ? alumnosSnap.val() : {};
  const ciclos = ciclosSnap.exists() ? ciclosSnap.val() : {};

  let begin = 0, next = 0, exit = 0;
  Object.values(alumnos).forEach(alumno => {
    const ciclo = alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
    if (!ciclo || ciclo.estadoAlumno !== 'activo') return;
    if (ciclo.programa === 'begin') begin++;
    else if (ciclo.programa === 'next') next++;
    else if (ciclo.programa === 'exit') exit++;
  });

  const setTexto = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTexto('kpi-mentor-begin', begin);
  setTexto('kpi-mentor-next', next);
  setTexto('kpi-mentor-exit', exit);
  setTexto('kpi-mentor-total', begin + next + exit);
}

let alumnosMentorCache = []; // [{ alumno, ciclo, nombreCompleto, coachNombre }]

export async function cargarAlumnosMentor() {
  if (getCurrentRole() !== 'mentor') return;
  const tbody = document.getElementById('tabla-matriz-mentor');
  if (!tbody) return;

  const [alumnosSnap, ciclosSnap, usuariosSnap] = await Promise.all([
    get(ref(db, 'alumnos')),
    get(ref(db, 'ciclos')),
    get(ref(db, 'usuarios'))
  ]);
  const alumnos = alumnosSnap.exists() ? alumnosSnap.val() : {};
  const ciclos = ciclosSnap.exists() ? ciclosSnap.val() : {};
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};

  alumnosMentorCache = Object.values(alumnos)
    .map(alumno => {
      const ciclo = alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
      if (!ciclo || ciclo.estadoAlumno !== 'activo') return null;
      const coachNombre = ciclo.coachId && usuarios[ciclo.coachId] ? (usuarios[ciclo.coachId].nombre || usuarios[ciclo.coachId].email) : '—';
      const nombreCompleto = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim() || '(sin nombre)';
      return { alumno, ciclo, nombreCompleto, coachNombre };
    })
    .filter(Boolean);

  renderMatrizMentor();
}

function renderMatrizMentor() {
  const tbody = document.getElementById('tabla-matriz-mentor');
  if (!tbody) return;

  const filtroNombre = (document.getElementById('filtro-mentor-nombre')?.value || '').toLowerCase();
  const filtroPrograma = document.getElementById('filtro-mentor-programa')?.value || '';
  const filtroFase = document.getElementById('filtro-mentor-fase')?.value || '';
  const filtroCoach = (document.getElementById('filtro-mentor-coach')?.value || '').toLowerCase();

  tbody.innerHTML = '';

  alumnosMentorCache
    .filter(item => {
      if (filtroNombre && !item.nombreCompleto.toLowerCase().includes(filtroNombre)) return false;
      if (filtroPrograma && item.ciclo.programa !== filtroPrograma) return false;
      if (filtroFase) {
        const faseActual = item.ciclo.faseMetodologia || 'sin-definir';
        if (faseActual !== filtroFase) return false;
      }
      if (filtroCoach && !item.coachNombre.toLowerCase().includes(filtroCoach)) return false;
      return true;
    })
    .forEach(({ alumno, ciclo, nombreCompleto, coachNombre }) => {
      const fase = FASE_LABELS[ciclo.faseMetodologia] || 'Sin definir';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><img src="${alumno.fotoUrl || PLACEHOLDER_FOTO_PERFIL}" alt="" style="width:28px; height:28px; border-radius:50%; object-fit:cover;"></td>
        <td>${nombreCompleto}</td>
        <td>${programaLabel(ciclo.programa)}</td>
        <td>${fase}</td>
        <td>${coachNombre}</td>
        <td><span class="badge badge--activo">Activo</span></td>
        <td><button class="btn btn--ghost btn-ver-mas-alumno" style="font-size:11px; padding:4px 8px;">Ver más</button></td>`;
      tbody.appendChild(tr);

      let filaDetalle = null;
      tr.querySelector('.btn-ver-mas-alumno').addEventListener('click', () => {
        if (filaDetalle) { filaDetalle.remove(); filaDetalle = null; return; }
        filaDetalle = document.createElement('tr');
        filaDetalle.innerHTML = renderDetalleAlumnoMentor(alumno, ciclo);
        tr.insertAdjacentElement('afterend', filaDetalle);
      });
    });
}

['filtro-mentor-nombre', 'filtro-mentor-coach'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', renderMatrizMentor);
});
['filtro-mentor-programa', 'filtro-mentor-fase'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', renderMatrizMentor);
});

document.querySelectorAll('.nav-item[data-nav="dashboard"]').forEach(item => {
  item.addEventListener('click', cargarDashboardMentor);
});
document.querySelectorAll('.nav-item[data-nav="alumnos"]').forEach(item => {
  item.addEventListener('click', cargarAlumnosMentor);
});

/* ============================================================
   MENTOR: mi perfil (foto + NPS resumido — el NPS real llega
   con las mentorías, en la próxima etapa)
   ============================================================ */
function calcularNpsResumenMentor(npsMentoriasData) {
  if (!npsMentoriasData) return { promedio: null, total: 0 };
  const todasLasEntradas = Object.values(npsMentoriasData).flatMap(m => Object.values(m));
  const puntajes = todasLasEntradas.map(e => e.puntaje).filter(p => typeof p === 'number');
  if (!puntajes.length) return { promedio: null, total: 0 };
  return { promedio: puntajes.reduce((a, b) => a + b, 0) / puntajes.length, total: puntajes.length };
}

export async function cargarPerfilMentor() {
  if (getCurrentRole() !== 'mentor') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const preview = document.getElementById('mentor-foto-preview');
  if (!uid || !preview) return;

  const [usuarioSnap, npsSnap] = await Promise.all([
    get(ref(db, `usuarios/${uid}`)),
    get(ref(db, `npsMentorias/${uid}`))
  ]);
  const datos = usuarioSnap.exists() ? usuarioSnap.val() : {};
  preview.src = datos.fotoUrl || PLACEHOLDER_FOTO_PERFIL;

  const previewIA = document.getElementById('mentor-foto-ia-preview');
  if (previewIA) previewIA.src = datos.fotoIA || PLACEHOLDER_FOTO_PERFIL;

  const instruccionesEl = document.getElementById('mentor-instrucciones-estilo');
  if (instruccionesEl) instruccionesEl.value = datos.instruccionesEstilo || '';

  const { promedio, total } = calcularNpsResumenMentor(npsSnap.exists() ? npsSnap.val() : null);
  const npsEl = document.getElementById('mentor-nps-resumen');
  if (npsEl) npsEl.textContent = promedio !== null ? `${promedio.toFixed(1)} ★ (${total})` : 'Aún sin evaluaciones';

  const bioTextarea = document.getElementById('mentor-bio');
  const bioTexto = document.getElementById('mentor-bio-texto');
  const btnGuardarBio = document.getElementById('btn-guardar-bio-mentor');
  const btnEditarBio = document.getElementById('btn-editar-bio-mentor');
  if (bioTextarea) {
    bioTextarea.value = datos.bio || '';
    const tieneBio = !!(datos.bio && datos.bio.trim());
    if (bioTexto) {
      bioTexto.textContent = datos.bio || 'Aún no has escrito tu presentación.';
      bioTexto.classList.toggle('hidden', !tieneBio);
    }
    bioTextarea.classList.toggle('hidden', tieneBio);
    bioTextarea.disabled = tieneBio;
    if (btnGuardarBio) btnGuardarBio.classList.toggle('hidden', tieneBio);
    if (btnEditarBio) btnEditarBio.classList.toggle('hidden', !tieneBio);
  }

  const temasCont = document.getElementById('mentor-temas-checkboxes');
  const temasListaEl = document.getElementById('mentor-temas-lista');
  const btnEditarTemas = document.getElementById('btn-editar-temas-mentor');
  const btnGuardarTemasEl = document.getElementById('btn-guardar-temas-mentor');
  if (temasCont) {
    const temasGuardados = datos.temas || {};
    temasCont.innerHTML = TEMAS_BOX.map(t => `
      <label style="font-weight:400; display:flex; align-items:center; gap:6px;">
        <input type="checkbox" class="chk-tema-mentor" value="${t}" ${temasGuardados[t] ? 'checked' : ''}> ${t}
      </label>`).join('');

    const hayTemasGuardados = Object.keys(temasGuardados).length > 0;
    if (temasListaEl) {
      temasListaEl.textContent = Object.keys(temasGuardados).join(', ') || 'Sin temáticas elegidas aún.';
      temasListaEl.classList.toggle('hidden', !hayTemasGuardados);
    }
    temasCont.classList.toggle('hidden', hayTemasGuardados);
    if (btnGuardarTemasEl) btnGuardarTemasEl.classList.toggle('hidden', hayTemasGuardados);
    if (btnEditarTemas) btnEditarTemas.classList.toggle('hidden', !hayTemasGuardados);
  }
}

const btnEditarTemasMentor = document.getElementById('btn-editar-temas-mentor');
if (btnEditarTemasMentor) {
  btnEditarTemasMentor.addEventListener('click', () => {
    document.getElementById('mentor-temas-lista').classList.add('hidden');
    document.getElementById('mentor-temas-checkboxes').classList.remove('hidden');
    document.getElementById('btn-guardar-temas-mentor').classList.remove('hidden');
    btnEditarTemasMentor.classList.add('hidden');
  });
}

const btnGuardarTemasMentor = document.getElementById('btn-guardar-temas-mentor');
if (btnGuardarTemasMentor) {
  btnGuardarTemasMentor.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid) return;
    btnGuardarTemasMentor.disabled = true;
    try {
      const temas = {};
      document.querySelectorAll('.chk-tema-mentor:checked').forEach(chk => { temas[chk.value] = true; });
      await update(ref(db, `usuarios/${uid}`), { temas });
      await cargarPerfilMentor();
    } finally {
      btnGuardarTemasMentor.disabled = false;
    }
  });
}

const btnGuardarBioMentor = document.getElementById('btn-guardar-bio-mentor');
if (btnGuardarBioMentor) {
  btnGuardarBioMentor.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const bio = document.getElementById('mentor-bio').value.trim();
    if (!uid || !bio) { alert('Escribe tu presentación antes de guardar.'); return; }
    btnGuardarBioMentor.disabled = true;
    try {
      await update(ref(db, `usuarios/${uid}`), { bio });
      await cargarPerfilMentor();
    } finally {
      btnGuardarBioMentor.disabled = false;
    }
  });
}

const btnEditarBioMentor = document.getElementById('btn-editar-bio-mentor');
if (btnEditarBioMentor) {
  btnEditarBioMentor.addEventListener('click', () => {
    document.getElementById('mentor-bio-texto').classList.add('hidden');
    document.getElementById('mentor-bio').classList.remove('hidden');
    document.getElementById('mentor-bio').disabled = false;
    document.getElementById('btn-guardar-bio-mentor').classList.remove('hidden');
    btnEditarBioMentor.classList.add('hidden');
  });
}

const btnCambiarFotoMentor = document.getElementById('btn-cambiar-foto-mentor');
const inputFotoMentor = document.getElementById('mentor-foto-input');
if (btnCambiarFotoMentor && inputFotoMentor) {
  btnCambiarFotoMentor.addEventListener('click', () => { if (!btnCambiarFotoMentor.disabled) inputFotoMentor.click(); });
  inputFotoMentor.addEventListener('change', async () => {
    const file = inputFotoMentor.files[0];
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!file || !uid) return;
    btnCambiarFotoMentor.disabled = true;
    const textoOriginal = btnCambiarFotoMentor.textContent;
    btnCambiarFotoMentor.textContent = 'Subiendo...';
    try {
      const archivoRef = storageRef(storage, `fotos-perfil/${uid}`);
      await uploadBytes(archivoRef, file);
      const url = await getDownloadURL(archivoRef);
      await update(ref(db, `usuarios/${uid}`), { fotoUrl: url });
      document.getElementById('mentor-foto-preview').src = url;
    } catch (err) {
      alert('No se pudo subir la foto. Intenta de nuevo.');
    } finally {
      btnCambiarFotoMentor.disabled = false;
      btnCambiarFotoMentor.textContent = textoOriginal;
      inputFotoMentor.value = '';
    }
  });
}

export { cargarMentoresView };

/* ============================================================
   MENTOR: Mis Mentorías (crear con link de acceso + link de NPS
   por sesión, automático)
   ============================================================ */
function construirLinkNpsMentoria(mentorId, mentoriaId, tema) {
  const url = new URL('nps-mentoria.html', window.location.href);
  url.searchParams.set('mentor', mentorId);
  url.searchParams.set('mentoria', mentoriaId);
  url.searchParams.set('tema', tema);
  return url.href;
}

async function cargarMentoriasView() {
  if (getCurrentRole() !== 'mentor') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const tbody = document.getElementById('tabla-mentorias-body');
  if (!uid || !tbody) return;

  const [mentoriasSnap, npsSnap] = await Promise.all([
    get(ref(db, `mentorias/${uid}`)),
    get(ref(db, `npsMentorias/${uid}`))
  ]);
  const mentorias = mentoriasSnap.exists() ? mentoriasSnap.val() : {};
  const npsTodas = npsSnap.exists() ? npsSnap.val() : {};

  tbody.innerHTML = '';
  Object.entries(mentorias)
    .sort((a, b) => (b[1].fecha || '').localeCompare(a[1].fecha || ''))
    .forEach(([mentoriaId, m]) => {
      const entradas = npsTodas[mentoriaId] ? Object.values(npsTodas[mentoriaId]) : [];
      const puntajes = entradas.map(e => e.puntaje).filter(p => typeof p === 'number');
      const promedioTexto = puntajes.length
        ? `${(puntajes.reduce((a, b) => a + b, 0) / puntajes.length).toFixed(1)} ★ (${puntajes.length})`
        : '—';

      const tr = document.createElement('tr');
      const noDictada = m.estado === 'no_dictada';
      tr.innerHTML = `
        <td>${m.tema || ''}</td>
        <td>${formatFechaCorta(m.fecha)}</td>
        <td>${m.hora || '—'}</td>
        <td>${m.link ? `<a href="${m.link}" target="_blank" rel="noopener">Ir al link</a>` : '—'}</td>
        <td>${promedioTexto}</td>
        <td>
          ${m.resumenUrl ? `<a href="${m.resumenUrl}" target="_blank" rel="noopener">Ver Resumen ↗</a><br>` : ''}
          <button class="btn btn--ghost btn-subir-resumen" style="font-size:11px; padding:4px 8px; margin-top:4px;">${m.resumenUrl ? 'Reemplazar' : 'Subir Resumen'}</button>
          <input type="file" class="input-resumen-mentoria hidden" accept=".doc,.docx">
        </td>
        <td><button class="btn btn--ghost btn-ver-preguntas-vivo" style="font-size:11px; padding:4px 8px;">Ver Preguntas</button></td>
        <td><button class="btn btn--ghost btn-copiar-link-nps-mentoria" style="font-size:11px; padding:4px 8px;">Copiar Link NPS</button></td>
        <td>
          <button class="btn btn--ghost btn-toggle-no-dictada" style="font-size:11px; padding:4px 8px; ${noDictada ? 'color:#C0392B;' : ''}" ${noDictada ? 'disabled' : ''}>${noDictada ? '✓ No Dictada' : 'Marcar No Dictada'}</button>
        </td>`;
      tbody.appendChild(tr);

      if (!noDictada) {
        tr.querySelector('.btn-toggle-no-dictada').addEventListener('click', async () => {
          const confirmado = confirm('¿Marcar esta sesión como "No Dictada"? Esta acción no se puede deshacer — si necesitas agendarla de nuevo, tendrás que crear una mentoría nueva.');
          if (!confirmado) return;
          await update(ref(db, `mentorias/${uid}/${mentoriaId}`), { estado: 'no_dictada' });
          await cargarMentoriasView();
        });
      }

      let filaPreguntasVivo = null;
      tr.querySelector('.btn-ver-preguntas-vivo').addEventListener('click', async () => {
        if (filaPreguntasVivo) { filaPreguntasVivo.remove(); filaPreguntasVivo = null; return; }
        const snap = await get(ref(db, `preguntasVivo/${uid}/${mentoriaId}`));
        const preguntasObj = snap.exists() ? snap.val() : {};
        const preguntas = Object.entries(preguntasObj).sort((a, b) => a[1].createdAt - b[1].createdAt);
        filaPreguntasVivo = document.createElement('tr');
        filaPreguntasVivo.innerHTML = `
          <td colspan="9" style="background:#F7F8FA; padding:14px 16px;">
            ${preguntas.length ? preguntas.map(([preguntaId, p]) => `
              <div class="pregunta-vivo-item" data-pregunta-id="${preguntaId}" style="padding:8px 0; border-bottom:0.5px solid var(--border); font-size:13px;">
                <strong>${p.alumnoNombre || 'Alumno'}</strong>
                <p style="margin:4px 0;">${p.texto || ''}</p>
                ${(p.imagenes || []).map(url => `<img src="${url}" alt="" style="max-width:120px; border-radius:6px; margin:4px 4px 0 0;">`).join('')}
                ${p.revisada
                  ? '<span class="badge badge--activo" style="font-size:10px;">✓ Revisada</span>'
                  : '<button type="button" class="btn btn--ghost btn-marcar-revisada" style="font-size:11px; padding:3px 8px;">Marcar Revisada</button>'}
              </div>`).join('') : '<p class="text-soft" style="font-size:13px;">Aún no hay preguntas para esta sesión.</p>'}
          </td>`;
        tr.insertAdjacentElement('afterend', filaPreguntasVivo);

        filaPreguntasVivo.querySelectorAll('.btn-marcar-revisada').forEach(btn => {
          btn.addEventListener('click', async () => {
            const item = btn.closest('.pregunta-vivo-item');
            const preguntaId = item.dataset.preguntaId;
            btn.disabled = true;
            try {
              await update(ref(db, `preguntasVivo/${uid}/${mentoriaId}/${preguntaId}`), { revisada: true });
              btn.outerHTML = '<span class="badge badge--activo" style="font-size:10px;">✓ Revisada</span>';
            } catch (err) {
              alert('No se pudo marcar. Intenta de nuevo.');
              btn.disabled = false;
            }
          });
        });
      });

      const btnSubirResumen = tr.querySelector('.btn-subir-resumen');
      const inputResumen = tr.querySelector('.input-resumen-mentoria');
      btnSubirResumen.addEventListener('click', () => inputResumen.click());
      inputResumen.addEventListener('change', async () => {
        const file = inputResumen.files[0];
        if (!file) return;
        const textoOriginal = btnSubirResumen.textContent;
        btnSubirResumen.disabled = true;
        btnSubirResumen.textContent = 'Subiendo...';
        try {
          const archivoRef = storageRef(storage, `resumenes-mentorias/${uid}/${mentoriaId}`);
          await uploadBytes(archivoRef, file);
          const url = await getDownloadURL(archivoRef);
          await update(ref(db, `mentorias/${uid}/${mentoriaId}`), { resumenUrl: url });
          await cargarMentoriasView();
        } catch (err) {
          alert('No se pudo subir el resumen. Intenta de nuevo.');
          btnSubirResumen.disabled = false;
          btnSubirResumen.textContent = textoOriginal;
        }
      });

      tr.querySelector('.btn-copiar-link-nps-mentoria').addEventListener('click', () => {
        const url = construirLinkNpsMentoria(uid, mentoriaId, m.tema || '');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url)
            .then(() => alert('Link copiado — mándalo a los asistentes al terminar la sesión.'))
            .catch(() => prompt('Copia este link manualmente:', url));
        } else {
          prompt('Copia este link manualmente:', url);
        }
      });
    });
}

const btnAgregarMentoria = document.getElementById('btn-agregar-mentoria');
if (btnAgregarMentoria) {
  btnAgregarMentoria.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const tema = document.getElementById('mentoria-tema').value.trim();
    const fecha = document.getElementById('mentoria-fecha').value;
    const hora = document.getElementById('mentoria-hora').value;
    const link = document.getElementById('mentoria-link').value.trim();

    if (!uid || !tema || !fecha) {
      alert('Completa al menos el Tema y la Fecha.');
      return;
    }

    btnAgregarMentoria.disabled = true;
    try {
      const nuevaRef = push(ref(db, `mentorias/${uid}`));
      await set(nuevaRef, { tema, fecha, hora, link, createdAt: Date.now() });

      document.getElementById('mentoria-tema').value = '';
      document.getElementById('mentoria-fecha').value = '';
      document.getElementById('mentoria-hora').value = '';
      document.getElementById('mentoria-link').value = '';

      await cargarMentoriasView();
    } finally {
      btnAgregarMentoria.disabled = false;
    }
  });
}

document.querySelectorAll('.nav-item[data-nav="dashboard"]').forEach(item => {
  item.addEventListener('click', cargarMentoriasView);
});

export { cargarMentoriasView };

/* ============================================================
   MENTOR: BOX de Consultas — recibe preguntas de alumnos y
   responde con texto, audio o imagen.
   ============================================================ */
function renderRespuestaMentorIA(preguntaId, p, mentorId) {
  const r = p.respuesta;
  if (!r) return '<p class="text-soft" style="font-size:13px;">El Mentor IA todavía no responde esta pregunta.</p>';

  const ESTADO_LABELS = { sin_revisar: 'Sin Revisar', confirmada: 'Confirmada', intervenida: 'Intervenida' };
  const ESTADO_CLASES = { sin_revisar: 'badge--impaga', confirmada: 'badge--activo', intervenida: 'badge--activo' };
  const estado = r.estadoRevision || 'sin_revisar';

  return `
    <div style="margin-top:8px; padding:10px; background:#F7F8FA; border-radius:8px;">
      <div class="flex-between" style="margin-bottom:6px;">
        <strong style="font-size:12px;">Respuesta del Mentor IA</strong>
        <span class="badge ${ESTADO_CLASES[estado]}" style="font-size:10px;">${ESTADO_LABELS[estado]}</span>
      </div>
      <p class="respuesta-texto-actual" style="margin:4px 0;">${r.texto || ''}</p>
      <div class="acciones-revision" style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
        <button type="button" class="btn btn--ghost btn-confirmar-respuesta" style="font-size:11px; padding:4px 8px;">✓ Confirmar sin cambios</button>
        <button type="button" class="btn btn--ghost btn-complementar-respuesta" style="font-size:11px; padding:4px 8px;">✏️ Complementar / Editar</button>
      </div>
    </div>`;
}

export async function cargarBoxMentor() {
  if (getCurrentRole() !== 'mentor') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const contenedor = document.getElementById('box-mentor-contenido');
  if (!uid || !contenedor) return;

  const snap = await get(ref(db, `box/${uid}`));
  const preguntas = snap.exists() ? Object.entries(snap.val()) : [];
  preguntas.sort((a, b) => b[1].createdAt - a[1].createdAt);

  const filtroEstadoEl = document.getElementById('box-mentor-filtro-estado');
  const filtroAlumnoEl = document.getElementById('box-mentor-filtro-alumno');
  const filtroDesdeEl = document.getElementById('box-mentor-filtro-desde');
  const filtroHastaEl = document.getElementById('box-mentor-filtro-hasta');

  if (filtroAlumnoEl && !filtroAlumnoEl.dataset.cargado) {
    const alumnos = [...new Map(preguntas.map(([, p]) => [p.alumnoId, p.alumnoNombre || 'Alumno'])).entries()];
    filtroAlumnoEl.innerHTML = '<option value="">Todos</option>' + alumnos.map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join('');
    filtroAlumnoEl.dataset.cargado = '1';
  }

  function render() {
    const fEstado = filtroEstadoEl ? filtroEstadoEl.value : '';
    const fAlumno = filtroAlumnoEl ? filtroAlumnoEl.value : '';
    const fDesde = filtroDesdeEl && filtroDesdeEl.value ? new Date(filtroDesdeEl.value + 'T00:00:00').getTime() : null;
    const fHasta = filtroHastaEl && filtroHastaEl.value ? new Date(filtroHastaEl.value + 'T23:59:59').getTime() : null;

    const filtradas = preguntas.filter(([, p]) => {
      const estado = (p.respuesta && p.respuesta.estadoRevision) || 'sin_revisar';
      return (!fEstado || estado === fEstado) &&
        (!fAlumno || p.alumnoId === fAlumno) &&
        (!fDesde || p.createdAt >= fDesde) &&
        (!fHasta || p.createdAt <= fHasta) &&
        !!p.respuesta; // solo mostramos las que ya tienen respuesta del Mentor IA
    });

    if (!filtradas.length) {
      contenedor.innerHTML = '<p class="text-soft">No hay preguntas con ese filtro.</p>';
      return;
    }

    contenedor.innerHTML = '';
    filtradas.forEach(([preguntaId, p]) => {
      const fecha = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(p.createdAt));
      const bloque = document.createElement('div');
      bloque.style.cssText = 'padding:14px 0; border-bottom:0.5px solid var(--border);';
      bloque.innerHTML = `
        <strong>${p.alumnoNombre || 'Alumno'}</strong> <span class="text-soft" style="font-size:12px;">— ${fecha}</span>
        <p style="margin:6px 0;">${p.pregunta || ''}</p>
        ${(p.imagenes || []).map(url => `<img src="${url}" alt="" style="max-width:120px; border-radius:6px; margin:0 4px 6px 0;">`).join('')}
        ${renderRespuestaMentorIA(preguntaId, p, uid)}
      `;
      contenedor.appendChild(bloque);

      const btnConfirmar = bloque.querySelector('.btn-confirmar-respuesta');
      const btnComplementar = bloque.querySelector('.btn-complementar-respuesta');

      if (btnConfirmar) {
        btnConfirmar.addEventListener('click', async () => {
          btnConfirmar.disabled = true;
          try {
            await update(ref(db, `box/${uid}/${preguntaId}/respuesta`), { estadoRevision: 'confirmada', revisadoEn: Date.now() });
            await cargarBoxMentor();
          } catch (err) {
            alert('No se pudo confirmar. Intenta de nuevo.');
            btnConfirmar.disabled = false;
          }
        });
      }

      if (btnComplementar) {
        btnComplementar.addEventListener('click', () => {
          const contenedorRespuesta = bloque.querySelector('.acciones-revision').parentElement;
          const textoActual = p.respuesta.texto || '';
          contenedorRespuesta.innerHTML = `
            <textarea class="texto-edicion-respuesta">${textoActual}</textarea>
            <div style="margin-top:8px; display:flex; gap:8px;">
              <button type="button" class="btn btn--primary btn-guardar-complemento" style="font-size:11px; padding:4px 10px;">Guardar</button>
              <button type="button" class="btn btn--ghost btn-cancelar-complemento" style="font-size:11px; padding:4px 10px;">Cancelar</button>
            </div>`;

          contenedorRespuesta.querySelector('.btn-cancelar-complemento').addEventListener('click', () => cargarBoxMentor());
          contenedorRespuesta.querySelector('.btn-guardar-complemento').addEventListener('click', async (ev) => {
            const nuevoTexto = contenedorRespuesta.querySelector('.texto-edicion-respuesta').value.trim();
            if (!nuevoTexto) { alert('La respuesta no puede quedar vacía.'); return; }
            ev.target.disabled = true;
            try {
              await update(ref(db, `box/${uid}/${preguntaId}/respuesta`), {
                texto: nuevoTexto,
                estadoRevision: 'intervenida',
                revisadoEn: Date.now()
              });
              await cargarBoxMentor();
            } catch (err) {
              alert('No se pudo guardar. Intenta de nuevo.');
              ev.target.disabled = false;
            }
          });
        });
      }
    });
  }

  render();
  if (filtroEstadoEl) filtroEstadoEl.onchange = render;
  if (filtroAlumnoEl) filtroAlumnoEl.onchange = render;
  if (filtroDesdeEl) filtroDesdeEl.onchange = render;
  if (filtroHastaEl) filtroHastaEl.onchange = render;
}

document.querySelectorAll('.nav-item[data-nav="box-consultas"]').forEach(item => {
  item.addEventListener('click', cargarBoxMentor);
});

/* ============================================================
   Mentor IA — foto exclusiva, instrucciones de estilo, y
   conocimiento adicional (texto libre o archivos). Todo esto
   alimenta al Mentor IA del BOX de Consultas junto con lo
   automático (resúmenes, respuestas validadas, presentación,
   temáticas).
   ============================================================ */
const btnCambiarFotoIaMentor = document.getElementById('btn-cambiar-foto-ia-mentor');
const inputFotoIaMentor = document.getElementById('mentor-foto-ia-input');
if (btnCambiarFotoIaMentor && inputFotoIaMentor) {
  btnCambiarFotoIaMentor.addEventListener('click', () => inputFotoIaMentor.click());
  inputFotoIaMentor.addEventListener('change', async () => {
    const file = inputFotoIaMentor.files[0];
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!file || !uid) return;
    btnCambiarFotoIaMentor.disabled = true;
    try {
      const archivoRef = storageRef(storage, `fotos-perfil-ia/${uid}`);
      await uploadBytes(archivoRef, file);
      const url = await getDownloadURL(archivoRef);
      await update(ref(db, `usuarios/${uid}`), { fotoIA: url });
      document.getElementById('mentor-foto-ia-preview').src = url;
    } catch (err) {
      alert('No se pudo subir la foto. Intenta de nuevo.');
    } finally {
      btnCambiarFotoIaMentor.disabled = false;
      inputFotoIaMentor.value = '';
    }
  });
}

const btnGuardarInstruccionesMentor = document.getElementById('btn-guardar-instrucciones-mentor');
if (btnGuardarInstruccionesMentor) {
  btnGuardarInstruccionesMentor.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid) return;
    btnGuardarInstruccionesMentor.disabled = true;
    try {
      await update(ref(db, `usuarios/${uid}`), {
        instruccionesEstilo: document.getElementById('mentor-instrucciones-estilo').value.trim()
      });
      alert('Instrucciones guardadas.');
    } finally {
      btnGuardarInstruccionesMentor.disabled = false;
    }
  });
}

/* --- Conocimiento Adicional: texto libre o archivo, con título --- */
let archivoConocimientoSeleccionado = null;
const btnAdjuntarArchivoConocimiento = document.getElementById('btn-adjuntar-archivo-conocimiento');
const inputArchivoConocimiento = document.getElementById('input-archivo-conocimiento');
if (btnAdjuntarArchivoConocimiento && inputArchivoConocimiento) {
  btnAdjuntarArchivoConocimiento.addEventListener('click', () => inputArchivoConocimiento.click());
  inputArchivoConocimiento.addEventListener('change', () => {
    archivoConocimientoSeleccionado = inputArchivoConocimiento.files[0] || null;
    document.getElementById('conocimiento-archivo-nombre').textContent = archivoConocimientoSeleccionado ? `📄 ${archivoConocimientoSeleccionado.name}` : '';
  });
}

async function cargarConocimientoMentor() {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const listadoEl = document.getElementById('conocimiento-listado');
  if (!uid || !listadoEl) return;

  const snap = await get(ref(db, `conocimientoMentor/${uid}`));
  const entradas = snap.exists() ? Object.entries(snap.val()) : [];
  entradas.sort((a, b) => b[1].createdAt - a[1].createdAt);

  listadoEl.innerHTML = entradas.length
    ? entradas.map(([entradaId, e]) => `
        <div class="panel mb-16" style="padding:12px;">
          <div class="flex-between">
            <strong style="font-size:13px;">${e.titulo || '(sin título)'}</strong>
            <button type="button" class="btn btn--ghost btn-eliminar-conocimiento" data-id="${entradaId}" style="font-size:11px; padding:2px 8px;">Eliminar</button>
          </div>
          ${e.texto ? `<p style="margin:6px 0 0; font-size:13px;">${e.texto}</p>` : ''}
          ${e.archivoUrl ? `<a href="${e.archivoUrl}" target="_blank" rel="noopener" style="font-size:12px;">📄 ${e.archivoNombre || 'Ver archivo'}</a>` : ''}
        </div>`).join('')
    : '<p class="text-soft">Aún no has agregado conocimiento adicional.</p>';

  listadoEl.querySelectorAll('.btn-eliminar-conocimiento').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmado = confirm('¿Eliminar este contenido? Tu Mentor IA ya no lo va a usar.');
      if (!confirmado) return;
      await set(ref(db, `conocimientoMentor/${uid}/${btn.dataset.id}`), null);
      await cargarConocimientoMentor();
    });
  });
}

const btnAgregarConocimiento = document.getElementById('btn-agregar-conocimiento');
if (btnAgregarConocimiento) {
  btnAgregarConocimiento.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const titulo = document.getElementById('conocimiento-titulo').value.trim();
    const texto = document.getElementById('conocimiento-texto').value.trim();
    if (!uid || !titulo || (!texto && !archivoConocimientoSeleccionado)) {
      alert('Escribe un título, y al menos texto o un archivo.');
      return;
    }
    btnAgregarConocimiento.disabled = true;
    try {
      const entradaId = push(ref(db, `conocimientoMentor/${uid}`)).key;
      let archivoUrl = null;
      let archivoNombre = null;
      if (archivoConocimientoSeleccionado) {
        const archivoRef = storageRef(storage, `conocimiento-mentor/${uid}/${entradaId}`);
        await uploadBytes(archivoRef, archivoConocimientoSeleccionado);
        archivoUrl = await getDownloadURL(archivoRef);
        archivoNombre = archivoConocimientoSeleccionado.name;
      }
      await set(ref(db, `conocimientoMentor/${uid}/${entradaId}`), {
        titulo, texto: texto || null, archivoUrl, archivoNombre, createdAt: Date.now()
      });

      document.getElementById('conocimiento-titulo').value = '';
      document.getElementById('conocimiento-texto').value = '';
      document.getElementById('conocimiento-archivo-nombre').textContent = '';
      inputArchivoConocimiento.value = '';
      archivoConocimientoSeleccionado = null;

      await cargarConocimientoMentor();
    } catch (err) {
      alert('No se pudo agregar. Intenta de nuevo.');
    } finally {
      btnAgregarConocimiento.disabled = false;
    }
  });
}

document.querySelectorAll('.nav-item[data-nav="dashboard"]').forEach(item => {
  item.addEventListener('click', cargarConocimientoMentor);
});
