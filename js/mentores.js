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
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecundaria } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getCurrentRole, setNav } from './main.js';
import { programaLabel } from './ciclos.js';

export const PLACEHOLDER_FOTO_PERFIL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#E4E7EC"/><circle cx="40" cy="32" r="14" fill="#9AA4B2"/><ellipse cx="40" cy="70" rx="24" ry="18" fill="#9AA4B2"/></svg>'
);

const FASE_LABELS = { fase1: 'Fase 1', fase2: 'Fase 2', fase3: 'Fase 3', fase4: 'Fase 4' };
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

  const snap = await get(ref(db, 'usuarios'));
  const usuarios = snap.exists() ? snap.val() : {};
  tbody.innerHTML = '';

  Object.entries(usuarios)
    .filter(([, u]) => u.rol === 'mentor')
    .forEach(([uid, mentor]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${mentor.nombre || ''}</td>
        <td>${mentor.email || ''}</td>
        <td><span class="badge ${mentor.activo === false ? 'badge--impaga' : 'badge--activo'}">${mentor.activo === false ? 'Inactivo' : 'Activo'}</span></td>
        <td><button class="btn btn--ghost btn-eliminar-mentor" style="font-size:11px; padding:4px 8px;">Eliminar</button></td>`;
      tbody.appendChild(tr);

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

    if (!nombre || !email) {
      errorEl.textContent = 'Completa nombre y correo.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnCrearMentor.disabled = true;
    btnCrearMentor.textContent = 'Creando...';
    const password = generarPassword();
    let secundaria = null;
    try {
      secundaria = initializeApp(firebaseConfig, 'crear-mentor-' + Date.now());
      const authSecundaria = getAuth(secundaria);
      const credencial = await createUserWithEmailAndPassword(authSecundaria, email, password);
      const nuevoUid = credencial.user.uid;
      await signOutSecundaria(authSecundaria);

      await set(ref(db, `usuarios/${nuevoUid}`), { nombre, email, rol: 'mentor', activo: true });

      document.getElementById('nuevo-mentor-nombre').value = '';
      document.getElementById('nuevo-mentor-email').value = '';
      document.getElementById('mentor-creado-email').value = email;
      document.getElementById('mentor-creado-password').value = password;
      document.getElementById('panel-mentor-creado').classList.remove('hidden');

      await cargarMentoresView();
    } catch (err) {
      errorEl.textContent = err.code === 'auth/email-already-in-use'
        ? 'Ese correo ya tiene una cuenta creada.'
        : 'No se pudo crear la cuenta. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
    } finally {
      if (secundaria) await deleteApp(secundaria);
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

  const { promedio, total } = calcularNpsResumenMentor(npsSnap.exists() ? npsSnap.val() : null);
  const npsEl = document.getElementById('mentor-nps-resumen');
  if (npsEl) npsEl.textContent = promedio !== null ? `${promedio.toFixed(1)} ★ (${total})` : 'Aún sin evaluaciones';

  const bioTextarea = document.getElementById('mentor-bio');
  const btnGuardarBio = document.getElementById('btn-guardar-bio-mentor');
  const btnEditarBio = document.getElementById('btn-editar-bio-mentor');
  if (bioTextarea) {
    bioTextarea.value = datos.bio || '';
    const tieneBio = !!(datos.bio && datos.bio.trim());
    bioTextarea.disabled = tieneBio;
    if (btnGuardarBio) btnGuardarBio.classList.toggle('hidden', tieneBio);
    if (btnEditarBio) btnEditarBio.classList.toggle('hidden', !tieneBio);
  }
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
      tr.innerHTML = `
        <td>${m.tema || ''}</td>
        <td>${formatFechaCorta(m.fecha)}</td>
        <td>${m.hora || '—'}</td>
        <td>${m.link ? `<a href="${m.link}" target="_blank" rel="noopener">Ir al link</a>` : '—'}</td>
        <td>${promedioTexto}</td>
        <td><button class="btn btn--ghost btn-copiar-link-nps-mentoria" style="font-size:11px; padding:4px 8px;">Copiar Link NPS</button></td>`;
      tbody.appendChild(tr);

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
