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
// Compatible con datos viejos (imagenes: ["url", ...]) y nuevos
// (archivos: [{url, nombre, tipo}, ...]) — mismo patrón que en
// alumno-portal.js, para la vista del mentor.
function renderArchivosAdjuntosMentor(archivos, imagenesLegado) {
  const items = [];
  (archivos || []).forEach(a => items.push(a));
  (imagenesLegado || []).forEach(url => items.push({ url, nombre: 'Imagen', tipo: 'imagen' }));
  if (!items.length) return '';
  return `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">${items.map(a => {
    if (a.tipo === 'imagen') {
      return `<img src="${a.url}" alt="" style="max-width:120px; max-height:120px; border-radius:6px; object-fit:cover;">`;
    }
    const icono = a.tipo === 'pdf' ? '📄' : a.tipo === 'word' ? '📝' : '📎';
    return `<a href="${a.url}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:6px; background:var(--color-surface-alt); padding:6px 12px; border-radius:8px; font-size:12px; text-decoration:none; color:var(--color-ink);">${icono} ${a.nombre || 'Archivo'}</a>`;
  }).join('')}</div>`;
}
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

  const mentoresOrdenados = Object.entries(usuarios)
    .filter(([, u]) => tieneRol(u, 'mentor'))
    .sort(([, a], [, b]) => {
      const oa = typeof a.orden === 'number' ? a.orden : 999;
      const ob = typeof b.orden === 'number' ? b.orden : 999;
      if (oa !== ob) return oa - ob;
      return (a.nombre || '').localeCompare(b.nombre || '', 'es');
    });

  // Si algún mentor todavía no tiene "orden" guardado, se lo asignamos
  // ahora según su posición actual — así las flechas siempre trabajan
  // con números reales y comparables entre todos, nunca con un valor
  // "de mentira" que antes hacía que alguien se pasara de largo al
  // moverse (bug ya corregido, esto es lo que lo previene).
  const backfills = mentoresOrdenados
    .map(([uid, m], idx) => (typeof m.orden !== 'number' ? update(ref(db, `usuarios/${uid}`), { orden: idx }) : null))
    .filter(Boolean);
  if (backfills.length) {
    await Promise.all(backfills);
    return cargarMentoresView();
  }

  mentoresOrdenados
    .forEach(([uid, mentor], idx, listaOrdenada) => {
      const { promedio, total } = calcularNpsResumenMentor(npsMentoriasTodos[uid]);
      const npsTexto = promedio !== null ? `${promedio.toFixed(1)} ★ (${total})` : '—';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn--ghost btn-orden-mentor-arriba" style="font-size:11px; padding:2px 7px;" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn btn--ghost btn-orden-mentor-abajo" style="font-size:11px; padding:2px 7px;" ${idx === listaOrdenada.length - 1 ? 'disabled' : ''}>↓</button>
        </td>
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

      // Gracias al backfill de arriba, acá SIEMPRE hay un número real
      // guardado para cada mentor — ya no hace falta ningún valor de
      // respaldo "inventado", que era justo lo que causaba el bug.
      const intercambiarOrden = async (otroUid) => {
        const otroMentor = listaOrdenada.find(([u]) => u === otroUid)[1];
        await Promise.all([
          update(ref(db, `usuarios/${uid}`), { orden: otroMentor.orden }),
          update(ref(db, `usuarios/${otroUid}`), { orden: mentor.orden })
        ]);
        await cargarMentoresView();
      };

      const btnArriba = tr.querySelector('.btn-orden-mentor-arriba');
      if (btnArriba) btnArriba.addEventListener('click', () => {
        if (idx > 0) intercambiarOrden(listaOrdenada[idx - 1][0]);
      });
      const btnAbajo = tr.querySelector('.btn-orden-mentor-abajo');
      if (btnAbajo) btnAbajo.addEventListener('click', () => {
        if (idx < listaOrdenada.length - 1) intercambiarOrden(listaOrdenada[idx + 1][0]);
      });

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

  await cargarTemasMentoresDirector(usuarios);
}

/* --- Director: ve las temáticas de todos los mentores (solo lectura de
       lo que cada uno ya escribió) y puede sugerirles nuevas. --- */
async function cargarTemasMentoresDirector(usuarios) {
  const cont = document.getElementById('director-temas-mentores-lista');
  if (!cont) return;

  const mentoresEntries = Object.entries(usuarios).filter(([, u]) => tieneRol(u, 'mentor'));
  const sugerenciasSnap = await get(ref(db, 'sugerenciasTemas'));
  const sugerenciasTodas = sugerenciasSnap.exists() ? sugerenciasSnap.val() : {};

  cont.innerHTML = mentoresEntries.map(([uid, mentor]) => {
    const temas = Array.isArray(mentor.temasBox) ? mentor.temasBox : [];
    const sugerenciasMentor = sugerenciasTodas[uid] ? Object.entries(sugerenciasTodas[uid]) : [];
    const pendientes = sugerenciasMentor.filter(([, s]) => s.estado === 'pendiente');
    return `
      <div data-mentor-temas-id="${uid}" style="padding:12px 0; border-bottom:0.5px solid var(--border);">
        <strong>${mentor.nombre || mentor.email}</strong>
        <p class="text-soft" style="font-size:12.5px; margin:4px 0 8px;">
          ${temas.length ? temas.join(', ') : 'Aún no ha agregado ninguna.'}
          ${pendientes.length ? `<br><span style="color:#B8860B;">Sugerencias pendientes: ${pendientes.map(([, s]) => s.texto).join(', ')}</span>` : ''}
        </p>
        <div style="display:flex; gap:8px;">
          <input type="text" class="input-sugerir-tema" placeholder="Sugerir una temática (máx. 2 palabras)..." style="flex:1; font-size:12.5px; padding:6px 10px;">
          <button type="button" class="btn btn--ghost btn-sugerir-tema" style="font-size:11px; padding:6px 12px;">Sugerir</button>
        </div>
      </div>`;
  }).join('') || '<p class="text-soft">Aún no hay mentores.</p>';

  cont.querySelectorAll('[data-mentor-temas-id]').forEach(fila => {
    const uidMentor = fila.dataset.mentorTemasId;
    fila.querySelector('.btn-sugerir-tema').addEventListener('click', async (ev) => {
      const input = fila.querySelector('.input-sugerir-tema');
      const texto = input.value.trim();
      if (!texto) return;
      if (texto.split(/\s+/).length > 2) {
        alert('La temática no puede tener más de 2 palabras.');
        return;
      }
      ev.target.disabled = true;
      try {
        await push(ref(db, `sugerenciasTemas/${uidMentor}`), {
          texto, estado: 'pendiente', creadoPor: auth.currentUser.uid, createdAt: Date.now()
        });
        input.value = '';
        const usuariosActualizados = (await get(ref(db, 'usuarios'))).val() || {};
        await cargarTemasMentoresDirector(usuariosActualizados);
      } catch (err) {
        alert('No se pudo enviar la sugerencia. Intenta de nuevo.');
        ev.target.disabled = false;
      }
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
  const instruccionesTextoEl = document.getElementById('mentor-instrucciones-texto');
  const campoInstruccionesEl = document.getElementById('campo-instrucciones-estilo');
  const btnGuardarInstruccionesEl = document.getElementById('btn-guardar-instrucciones-mentor');
  const btnEditarInstruccionesEl = document.getElementById('btn-editar-instrucciones-mentor');
  if (instruccionesEl) {
    const valorInstrucciones = datos.instruccionesEstilo || '';
    instruccionesEl.value = valorInstrucciones;
    const hayInstrucciones = !!valorInstrucciones.trim();
    if (instruccionesTextoEl) {
      instruccionesTextoEl.textContent = valorInstrucciones;
      instruccionesTextoEl.classList.toggle('hidden', !hayInstrucciones);
    }
    if (campoInstruccionesEl) campoInstruccionesEl.classList.toggle('hidden', hayInstrucciones);
    if (btnGuardarInstruccionesEl) btnGuardarInstruccionesEl.classList.toggle('hidden', hayInstrucciones);
    if (btnEditarInstruccionesEl) btnEditarInstruccionesEl.classList.toggle('hidden', !hayInstrucciones);
  }

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

  const infoPrivadaTextarea = document.getElementById('mentor-info-privada');
  const infoPrivadaTexto = document.getElementById('mentor-info-privada-texto');
  const btnGuardarInfoPrivada = document.getElementById('btn-guardar-info-privada-mentor');
  const btnEditarInfoPrivada = document.getElementById('btn-editar-info-privada-mentor');
  if (infoPrivadaTextarea) {
    infoPrivadaTextarea.value = datos.infoEntrenamientoIA || '';
    const tieneInfoPrivada = !!(datos.infoEntrenamientoIA && datos.infoEntrenamientoIA.trim());
    if (infoPrivadaTexto) {
      infoPrivadaTexto.textContent = datos.infoEntrenamientoIA || 'Aún no has agregado nada acá.';
      infoPrivadaTexto.classList.toggle('hidden', !tieneInfoPrivada);
    }
    infoPrivadaTextarea.classList.toggle('hidden', tieneInfoPrivada);
    infoPrivadaTextarea.disabled = tieneInfoPrivada;
    if (btnGuardarInfoPrivada) btnGuardarInfoPrivada.classList.toggle('hidden', tieneInfoPrivada);
    if (btnEditarInfoPrivada) btnEditarInfoPrivada.classList.toggle('hidden', !tieneInfoPrivada);
  }

  const temasInput = document.getElementById('mentor-temas-input');
  const temasListaEl = document.getElementById('mentor-temas-lista');
  const btnEditarTemas = document.getElementById('btn-editar-temas-mentor');
  const btnGuardarTemasEl = document.getElementById('btn-guardar-temas-mentor');
  if (temasInput) {
    const temasArray = Array.isArray(datos.temasBox) ? datos.temasBox : [];
    temasInput.value = temasArray.join(', ');

    const hayTemasGuardados = temasArray.length > 0;
    if (temasListaEl) {
      if (hayTemasGuardados) {
        const primeras3 = temasArray.slice(0, 3);
        const resto = temasArray.slice(3);
        temasListaEl.innerHTML = `<strong>En Preguntas en Vivo se ve:</strong> ${primeras3.join(', ')}` +
          (resto.length ? `<br><strong>También disponibles para filtros:</strong> ${resto.join(', ')}` : '');
      }
      temasListaEl.classList.toggle('hidden', !hayTemasGuardados);
    }
    temasInput.classList.toggle('hidden', hayTemasGuardados);
    if (btnGuardarTemasEl) btnGuardarTemasEl.classList.toggle('hidden', hayTemasGuardados);
    if (btnEditarTemas) btnEditarTemas.classList.toggle('hidden', !hayTemasGuardados);
  }

  // --- Sugerencias del director: el mentor las ve acá y decide si las acepta ---
  const sugerenciasCont = document.getElementById('mentor-sugerencias-director-cont');
  const sugerenciasListaEl = document.getElementById('mentor-sugerencias-director-lista');
  if (sugerenciasCont && sugerenciasListaEl) {
    const uidMentorActual = auth.currentUser ? auth.currentUser.uid : null;
    if (uidMentorActual) {
      const sugerenciasSnap = await get(ref(db, `sugerenciasTemas/${uidMentorActual}`));
      const sugerencias = sugerenciasSnap.exists()
        ? Object.entries(sugerenciasSnap.val()).filter(([, s]) => s.estado === 'pendiente')
        : [];
      sugerenciasCont.classList.toggle('hidden', sugerencias.length === 0);
      sugerenciasListaEl.innerHTML = sugerencias.map(([id, s]) => `
        <div class="flex-between" data-sugerencia-id="${id}" style="padding:8px 0; border-bottom:0.5px solid var(--border);">
          <span style="font-size:13px;">${s.texto}</span>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn--primary btn-aceptar-sugerencia" style="font-size:11px; padding:4px 10px;">Aceptar</button>
            <button type="button" class="btn btn--ghost btn-rechazar-sugerencia" style="font-size:11px; padding:4px 10px;">Rechazar</button>
          </div>
        </div>`).join('');

      sugerenciasListaEl.querySelectorAll('.btn-aceptar-sugerencia').forEach(btn => {
        btn.addEventListener('click', async () => {
          const fila = btn.closest('[data-sugerencia-id]');
          const id = fila.dataset.sugerenciaId;
          const texto = fila.querySelector('span').textContent;
          btn.disabled = true;
          try {
            const actualSnap = await get(ref(db, `usuarios/${uidMentorActual}/temasBox`));
            const actual = actualSnap.exists() ? actualSnap.val() : [];
            await update(ref(db, `usuarios/${uidMentorActual}`), { temasBox: [...actual, texto] });
            await update(ref(db, `sugerenciasTemas/${uidMentorActual}/${id}`), { estado: 'aceptada' });
            await cargarPerfilMentor();
          } catch (err) {
            alert('No se pudo aceptar. Intenta de nuevo.');
            btn.disabled = false;
          }
        });
      });
      sugerenciasListaEl.querySelectorAll('.btn-rechazar-sugerencia').forEach(btn => {
        btn.addEventListener('click', async () => {
          const fila = btn.closest('[data-sugerencia-id]');
          const id = fila.dataset.sugerenciaId;
          btn.disabled = true;
          try {
            await update(ref(db, `sugerenciasTemas/${uidMentorActual}/${id}`), { estado: 'rechazada' });
            await cargarPerfilMentor();
          } catch (err) {
            alert('No se pudo rechazar. Intenta de nuevo.');
            btn.disabled = false;
          }
        });
      });
    }
  }

  // --- Horario Recurrente (informativo, independiente de las sesiones agendadas) ---
  const horarioRecDia = document.getElementById('mentor-horario-recurrente-dia');
  const horarioRecHora = document.getElementById('mentor-horario-recurrente-hora');
  const horarioRecCampos = document.getElementById('mentor-horario-recurrente-campos');
  const horarioRecTexto = document.getElementById('mentor-horario-recurrente-texto');
  const btnEditarHorarioRec = document.getElementById('btn-editar-horario-recurrente');
  const btnGuardarHorarioRec = document.getElementById('btn-guardar-horario-recurrente');
  if (horarioRecDia && horarioRecHora) {
    const hr = datos.horarioRecurrente || {};
    horarioRecDia.value = hr.dia || '';
    horarioRecHora.value = hr.hora || '';

    const yaGuardado = !!(hr.dia && hr.hora);
    if (horarioRecTexto) {
      horarioRecTexto.textContent = yaGuardado ? `${hr.dia}, ${hr.hora} hrs. ${hr.zonaCreador ? banderaDeZona(hr.zonaCreador) : ''}` : '';
      horarioRecTexto.classList.toggle('hidden', !yaGuardado);
    }
    if (horarioRecCampos) horarioRecCampos.classList.toggle('hidden', yaGuardado);
    if (btnGuardarHorarioRec) btnGuardarHorarioRec.classList.toggle('hidden', yaGuardado);
    if (btnEditarHorarioRec) btnEditarHorarioRec.classList.toggle('hidden', !yaGuardado);
  }
}

const btnEditarTemasMentor = document.getElementById('btn-editar-temas-mentor');
if (btnEditarTemasMentor) {
  btnEditarTemasMentor.addEventListener('click', () => {
    document.getElementById('mentor-temas-lista').classList.add('hidden');
    document.getElementById('mentor-temas-input').classList.remove('hidden');
    document.getElementById('btn-guardar-temas-mentor').classList.remove('hidden');
    btnEditarTemasMentor.classList.add('hidden');
  });
}

function parsearTemasTexto(texto) {
  return texto.split(',').map(t => t.trim()).filter(Boolean);
}

const btnGuardarTemasMentor = document.getElementById('btn-guardar-temas-mentor');
if (btnGuardarTemasMentor) {
  btnGuardarTemasMentor.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid) return;
    const errorEl = document.getElementById('mentor-temas-error');
    errorEl.classList.add('hidden');

    const temas = parsearTemasTexto(document.getElementById('mentor-temas-input').value);
    const conMasDeDosPalabras = temas.filter(t => t.split(/\s+/).length > 2);
    if (conMasDeDosPalabras.length) {
      errorEl.textContent = `Estas temáticas tienen más de 2 palabras — acórtalas: ${conMasDeDosPalabras.join(', ')}`;
      errorEl.classList.remove('hidden');
      return;
    }

    btnGuardarTemasMentor.disabled = true;
    try {
      await update(ref(db, `usuarios/${uid}`), { temasBox: temas });
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

const btnGuardarInfoPrivadaMentor = document.getElementById('btn-guardar-info-privada-mentor');
if (btnGuardarInfoPrivadaMentor) {
  btnGuardarInfoPrivadaMentor.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const infoEntrenamientoIA = document.getElementById('mentor-info-privada').value.trim();
    if (!uid || !infoEntrenamientoIA) { alert('Escribe algo antes de guardar.'); return; }
    btnGuardarInfoPrivadaMentor.disabled = true;
    try {
      await update(ref(db, `usuarios/${uid}`), { infoEntrenamientoIA });
      await cargarPerfilMentor();
    } finally {
      btnGuardarInfoPrivadaMentor.disabled = false;
    }
  });
}

const btnEditarInfoPrivadaMentor = document.getElementById('btn-editar-info-privada-mentor');
if (btnEditarInfoPrivadaMentor) {
  btnEditarInfoPrivadaMentor.addEventListener('click', () => {
    document.getElementById('mentor-info-privada-texto').classList.add('hidden');
    document.getElementById('mentor-info-privada').classList.remove('hidden');
    document.getElementById('mentor-info-privada').disabled = false;
    document.getElementById('btn-guardar-info-privada-mentor').classList.remove('hidden');
    btnEditarInfoPrivadaMentor.classList.add('hidden');
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
        <td>${formatFechaCorta(m.fecha)}${m.exclusivaBegin ? ' <span class="badge badge--activo" style="font-size:9px;" title="Solo la ven alumnos BEGIN">BEGIN</span>' : ''}</td>
        <td>${m.inicioTimestamp ? formatearHorarioParaTabla(m.inicioTimestamp) : (m.hora || '—')}</td>
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
          <td colspan="8" style="background:#F7F8FA; padding:14px 16px;">
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
        const url = construirLinkNpsMentoria(uid, mentoriaId, '');
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

/* ============================================================
   Horarios multi-zona: cada quien agenda en SU hora local (la que
   ya tiene configurada su dispositivo, se detecta sola), y a quien
   sea que lo mire después (mentor, coach, alumno, director, en
   cualquier zona) se le muestra convertido a su propia hora, con
   la de Chile siempre visible como referencia fija (🇨🇱).
   Guardamos inicioTimestamp (instante exacto, sin ambigüedad) +
   zonaCreador, además de fecha/hora en su equivalente Chile (para
   que el resto del sistema, que ya asumía Chile, siga funcionando
   igual sin tocarlo).
   ============================================================ */
function zonaHorariaLocal() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Mapa de zona horaria (IANA) → código de país, cubriendo todo el
// continente americano (norte, centro, sur y caribe). Lo que no
// calce con ningún país de la tabla muestra 🌍 en vez de arriesgar
// una bandera equivocada.
const ZONA_A_PAIS = {
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
  'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Phoenix': 'US', 'America/Detroit': 'US',
  'America/Indiana/Indianapolis': 'US', 'America/Boise': 'US',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA',
  'America/Halifax': 'CA', 'America/St_Johns': 'CA', 'America/Regina': 'CA',
  'America/Mexico_City': 'MX', 'America/Cancun': 'MX', 'America/Tijuana': 'MX', 'America/Monterrey': 'MX',
  'America/Chihuahua': 'MX', 'America/Hermosillo': 'MX', 'America/Mazatlan': 'MX', 'America/Merida': 'MX',
  'America/Guatemala': 'GT', 'America/Belize': 'BZ', 'America/Tegucigalpa': 'HN', 'America/El_Salvador': 'SV',
  'America/Managua': 'NI', 'America/Costa_Rica': 'CR', 'America/Panama': 'PA',
  'America/Havana': 'CU', 'America/Santo_Domingo': 'DO', 'America/Port-au-Prince': 'HT',
  'America/Jamaica': 'JM', 'America/Puerto_Rico': 'PR', 'America/Nassau': 'BS',
  'America/Barbados': 'BB', 'America/Port_of_Spain': 'TT',
  'America/Bogota': 'CO', 'America/Caracas': 'VE', 'America/Guayaquil': 'EC', 'America/Lima': 'PE',
  'America/La_Paz': 'BO', 'America/Santiago': 'CL', 'America/Punta_Arenas': 'CL',
  'America/Argentina/Buenos_Aires': 'AR', 'America/Argentina/Cordoba': 'AR', 'America/Argentina/Mendoza': 'AR',
  'America/Argentina/Salta': 'AR', 'America/Argentina/Ushuaia': 'AR', 'America/Argentina/Rio_Gallegos': 'AR',
  'America/Asuncion': 'PY', 'America/Montevideo': 'UY',
  'America/Sao_Paulo': 'BR', 'America/Manaus': 'BR', 'America/Recife': 'BR', 'America/Fortaleza': 'BR',
  'America/Bahia': 'BR', 'America/Belem': 'BR', 'America/Cuiaba': 'BR', 'America/Campo_Grande': 'BR',
  'America/Porto_Velho': 'BR', 'America/Boa_Vista': 'BR', 'America/Rio_Branco': 'BR', 'America/Araguaina': 'BR', 'America/Maceio': 'BR',
  'America/Guyana': 'GY', 'America/Paramaribo': 'SR', 'America/Cayenne': 'GF'
};
function banderaDeZona(zona) {
  const codigo = ZONA_A_PAIS[zona];
  if (!codigo) return '🌍';
  return codigo.replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function fechaHoraChileDesdeInstante(fechaObj) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(fechaObj);
  const obtener = (tipo) => partes.find(p => p.type === tipo)?.value || '';
  return { fecha: `${obtener('year')}-${obtener('month')}-${obtener('day')}`, hora: `${obtener('hour')}:${obtener('minute')}` };
}

function formatearHoraEnZona(fechaObj, zona) {
  return new Intl.DateTimeFormat('es-CL', { timeZone: zona, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(fechaObj);
}

// Versión compacta para celdas de tabla: solo la hora (sin fecha, esa
// ya va en la columna de al lado), con la de Chile siempre visible.
function formatearHorarioParaTabla(timestampMs) {
  const fechaObj = new Date(timestampMs);
  const soloHora = (zona) => new Intl.DateTimeFormat('es-CL', { timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: false }).format(fechaObj);
  const zonaViewer = zonaHorariaLocal();
  if (zonaViewer === 'America/Santiago') return `${soloHora(zonaViewer)} 🇨🇱`;
  return `${soloHora(zonaViewer)} ${banderaDeZona(zonaViewer)} · ${soloHora('America/Santiago')} 🇨🇱`;
}

// Muestra "Estás agendando a las X tu hora (zona) → equivale a las Y hora Chile"
// apenas se llenan fecha+hora, ANTES de guardar.
function conectarPreviewHorario(idFecha, idHora, idPreview) {
  const inputFecha = document.getElementById(idFecha);
  const inputHora = document.getElementById(idHora);
  const preview = document.getElementById(idPreview);
  if (!inputFecha || !inputHora || !preview) return;

  const actualizar = () => {
    if (!inputFecha.value || !inputHora.value) { preview.classList.add('hidden'); return; }
    const fechaObj = new Date(`${inputFecha.value}T${inputHora.value}`);
    if (isNaN(fechaObj.getTime())) { preview.classList.add('hidden'); return; }
    const zona = zonaHorariaLocal();
    if (zona === 'America/Santiago') {
      preview.textContent = `🇨🇱 ${formatearHoraEnZona(fechaObj, zona)} hora Chile.`;
    } else {
      preview.textContent = `Estás agendando a las ${inputHora.value} ${banderaDeZona(zona)} tu hora (${zona.split('/').pop().replace('_', ' ')}) → equivale a las ${formatearHoraEnZona(fechaObj, 'America/Santiago')} 🇨🇱 hora Chile.`;
    }
    preview.classList.remove('hidden');
  };
  inputFecha.addEventListener('input', actualizar);
  inputHora.addEventListener('input', actualizar);
}
conectarPreviewHorario('mentoria-fecha', 'mentoria-hora', 'mentoria-preview-horario');

const btnAgregarMentoria = document.getElementById('btn-agregar-mentoria');
if (btnAgregarMentoria) {
  btnAgregarMentoria.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const fechaInput = document.getElementById('mentoria-fecha').value;
    const horaInput = document.getElementById('mentoria-hora').value;
    const link = document.getElementById('mentoria-link').value.trim();
    const exclusivaBegin = document.getElementById('mentoria-exclusiva-begin').checked;

    if (!uid || !fechaInput) {
      alert('Completa al menos la Fecha.');
      return;
    }

    btnAgregarMentoria.disabled = true;
    try {
      // La fecha/hora que escribió el mentor se interpreta en SU propia
      // zona (la de su dispositivo) — de ahí sacamos el instante exacto
      // y el equivalente en hora Chile para el resto del sistema.
      const inicioLocal = new Date(`${fechaInput}T${horaInput || '00:00'}`);
      const inicioTimestamp = inicioLocal.getTime();
      const zonaCreador = zonaHorariaLocal();
      const { fecha, hora } = fechaHoraChileDesdeInstante(inicioLocal);

      const nuevaRef = push(ref(db, `mentorias/${uid}`));
      await set(nuevaRef, { fecha, hora, inicioTimestamp, zonaCreador, link, exclusivaBegin, createdAt: Date.now() });

      document.getElementById('mentoria-fecha').value = '';
      document.getElementById('mentoria-hora').value = '';
      document.getElementById('mentoria-link').value = '';
      document.getElementById('mentoria-exclusiva-begin').checked = false;
      document.getElementById('mentoria-preview-horario').classList.add('hidden');

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
   MENTOR: BOX Inteligente — recibe preguntas de alumnos y
   responde con texto, audio o imagen.
   ============================================================ */
const ESTADO_LABELS_BOX = { sin_revisar: 'Sin Revisar', confirmada: 'Confirmada', intervenida: 'Intervenida' };
const ESTADO_CLASES_BOX = { sin_revisar: 'badge--impaga', confirmada: 'badge--activo', intervenida: 'badge--activo' };

function renderRespuestaMentorIA(preguntaId, p, mentorId) {
  const r = p.respuesta;
  if (!r) return '<p class="text-soft" style="font-size:13px;">El Mentor IA todavía no responde esta pregunta.</p>';

  const ESTADO_LABELS = ESTADO_LABELS_BOX;
  const ESTADO_CLASES = ESTADO_CLASES_BOX;
  const estado = r.estadoRevision || 'sin_revisar';

  return `
    <div style="margin-top:8px; padding:10px; background:#F7F8FA; border-radius:8px;">
      <div class="flex-between" style="margin-bottom:6px;">
        <strong style="font-size:12px;">Respuesta del Mentor IA</strong>
        <span class="badge ${ESTADO_CLASES[estado]}" style="font-size:10px;">${ESTADO_LABELS[estado]}</span>
      </div>
      <p class="respuesta-texto-actual" style="margin:4px 0; white-space:pre-wrap;">${r.texto || ''}</p>
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

  const [snap, propioSnap] = await Promise.all([
    get(ref(db, `box/${uid}`)),
    get(ref(db, `usuarios/${uid}/temasBox`))
  ]);
  const preguntas = snap.exists() ? Object.entries(snap.val()) : [];
  const misTemasBox = propioSnap.exists() ? propioSnap.val() : [];
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
      const estado = (p.respuesta && p.respuesta.estadoRevision) || 'sin_revisar';
      const bloque = document.createElement('div');
      bloque.style.cssText = 'padding:14px 0; border-bottom:0.5px solid var(--border); cursor:pointer;';
      bloque.setAttribute('data-fila-box-mentor', '');
      bloque.innerHTML = `
        <div class="flex-between" style="align-items:flex-start; gap:10px;">
          <div style="flex:1; min-width:0;">
            <strong>${p.alumnoNombre || 'Alumno'}</strong> <span class="text-soft" style="font-size:12px;">— ${fecha}</span>
            <p style="margin:6px 0 0;">${p.pregunta || ''}</p>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
            <span class="badge badge--activo" style="font-size:10px; white-space:nowrap;">${p.tematica || 'Sin tema'}</span>
            <span class="badge ${ESTADO_CLASES_BOX[estado]}" style="font-size:10px; white-space:nowrap;">${ESTADO_LABELS_BOX[estado]}</span>
            <span class="text-soft" style="font-size:16px;" data-flecha-box-mentor>▾</span>
          </div>
        </div>
        <div class="hidden" style="margin-top:10px;" data-detalle-box-mentor>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
            <label style="font-size:11px; margin:0;">Temática:</label>
            <select class="select-tematica-pregunta" style="font-size:12px; padding:4px 8px; width:auto;">
              ${misTemasBox.map(t => `<option value="${t}" ${t === p.tematica ? 'selected' : ''}>${t}</option>`).join('')}
              ${p.tematica && !misTemasBox.includes(p.tematica) ? `<option value="${p.tematica}" selected>${p.tematica}</option>` : ''}
            </select>
            <button type="button" class="btn btn--ghost btn-guardar-tematica-pregunta" style="font-size:11px; padding:4px 10px;">Guardar</button>
          </div>
          ${renderArchivosAdjuntosMentor(p.archivos, p.imagenes)}
          ${renderRespuestaMentorIA(preguntaId, p, uid)}
        </div>
      `;
      contenedor.appendChild(bloque);

      const selectTematicaPregunta = bloque.querySelector('.select-tematica-pregunta');
      const btnGuardarTematicaPregunta = bloque.querySelector('.btn-guardar-tematica-pregunta');
      if (btnGuardarTematicaPregunta) {
        btnGuardarTematicaPregunta.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          btnGuardarTematicaPregunta.disabled = true;
          try {
            await update(ref(db, `box/${uid}/${preguntaId}`), { tematica: selectTematicaPregunta.value });
            await cargarBoxMentor();
          } catch (err) {
            alert('No se pudo actualizar la temática. Intenta de nuevo.');
            btnGuardarTematicaPregunta.disabled = false;
          }
        });
      }

      bloque.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-detalle-box-mentor]')) return;
        const detalle = bloque.querySelector('[data-detalle-box-mentor]');
        const flecha = bloque.querySelector('[data-flecha-box-mentor]');
        const ahoraOculto = detalle.classList.toggle('hidden');
        flecha.textContent = ahoraOculto ? '▾' : '▴';
      });

      const btnConfirmar = bloque.querySelector('.btn-confirmar-respuesta');
      const btnComplementar = bloque.querySelector('.btn-complementar-respuesta');

      if (btnConfirmar) {
        btnConfirmar.addEventListener('click', async (ev) => {
          ev.stopPropagation();
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
        btnComplementar.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const contenedorRespuesta = bloque.querySelector('.acciones-revision').parentElement;
          const textoActual = p.respuesta.texto || '';
          contenedorRespuesta.innerHTML = `
            <textarea class="texto-edicion-respuesta" style="min-height:220px;">${textoActual}</textarea>
            <div style="margin-top:8px; display:flex; gap:8px;">
              <button type="button" class="btn btn--primary btn-guardar-complemento" style="font-size:11px; padding:4px 10px;">Guardar</button>
              <button type="button" class="btn btn--ghost btn-cancelar-complemento" style="font-size:11px; padding:4px 10px;">Cancelar</button>
            </div>`;

          contenedorRespuesta.querySelector('.btn-cancelar-complemento').addEventListener('click', (ev2) => {
            ev2.stopPropagation();
            cargarBoxMentor();
          });
          contenedorRespuesta.querySelector('.btn-guardar-complemento').addEventListener('click', async (ev2) => {
            ev2.stopPropagation();
            const nuevoTexto = contenedorRespuesta.querySelector('.texto-edicion-respuesta').value.trim();
            if (!nuevoTexto) { alert('La respuesta no puede quedar vacía.'); return; }
            ev2.target.disabled = true;
            try {
              await update(ref(db, `box/${uid}/${preguntaId}/respuesta`), {
                texto: nuevoTexto,
                estadoRevision: 'intervenida',
                revisadoEn: Date.now()
              });
              await cargarBoxMentor();
            } catch (err) {
              alert('No se pudo guardar. Intenta de nuevo.');
              ev2.target.disabled = false;
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
   BOX DE CONSULTAS BEGIN — bandeja compartida: cualquier mentor puede
   responder cualquier pregunta (primero en escribir, gana).
   Sin IA, respuesta 100% manual.
   ============================================================ */
async function cargarBoxBeginMentor() {
  const listadoEl = document.getElementById('box-begin-mentor-listado');
  if (!listadoEl) return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;

  const snap = await get(ref(db, 'boxBegin'));
  const todas = snap.exists() ? Object.entries(snap.val()) : [];

  const filtroEstadoEl = document.getElementById('box-begin-mentor-filtro-estado');
  const filtroTematicaEl = document.getElementById('box-begin-mentor-filtro-tematica');
  const filtroAlumnoEl = document.getElementById('box-begin-mentor-filtro-alumno');
  const filtroRespondioEl = document.getElementById('box-begin-mentor-filtro-respondio');
  const filtroDesdeEl = document.getElementById('box-begin-mentor-filtro-desde');
  const filtroHastaEl = document.getElementById('box-begin-mentor-filtro-hasta');

  if (filtroTematicaEl) {
    const tematicas = [...new Set(todas.map(([, p]) => p.tematica).filter(Boolean))].sort();
    const valorPrevio = filtroTematicaEl.value;
    filtroTematicaEl.innerHTML = '<option value="">Todas</option>' + tematicas.map(t => `<option value="${t}">${t}</option>`).join('');
    if (tematicas.includes(valorPrevio)) filtroTematicaEl.value = valorPrevio;
  }
  if (filtroAlumnoEl) {
    const alumnos = [...new Map(todas.map(([, p]) => [p.alumnoId, p.alumnoNombre])).entries()];
    const valorPrevio = filtroAlumnoEl.value;
    filtroAlumnoEl.innerHTML = '<option value="">Todos</option>' + alumnos.map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join('');
    filtroAlumnoEl.value = valorPrevio;
  }
  if (filtroRespondioEl) {
    const mentoresQueRespondieron = [...new Map(
      todas.filter(([, p]) => p.respuesta).map(([, p]) => [p.respuesta.mentorId, p.respuesta.mentorNombre])
    ).entries()];
    const valorPrevio = filtroRespondioEl.value;
    filtroRespondioEl.innerHTML = '<option value="">Todos</option>' + mentoresQueRespondieron.map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join('');
    filtroRespondioEl.value = valorPrevio;
  }

  function render() {
    const fEstado = filtroEstadoEl ? filtroEstadoEl.value : 'pendientes';
    const fTematica = filtroTematicaEl ? filtroTematicaEl.value : '';
    const fAlumno = filtroAlumnoEl ? filtroAlumnoEl.value : '';
    const fRespondio = filtroRespondioEl ? filtroRespondioEl.value : '';
    const fDesde = filtroDesdeEl && filtroDesdeEl.value ? new Date(filtroDesdeEl.value + 'T00:00:00').getTime() : null;
    const fHasta = filtroHastaEl && filtroHastaEl.value ? new Date(filtroHastaEl.value + 'T23:59:59').getTime() : null;

    const filtradas = todas
      .filter(([, p]) => {
        if (fEstado === 'pendientes' && p.respuesta) return false;
        if (fEstado === 'respondidas' && !p.respuesta) return false;
        if (fTematica && p.tematica !== fTematica) return false;
        if (fAlumno && p.alumnoId !== fAlumno) return false;
        if (fRespondio && (!p.respuesta || p.respuesta.mentorId !== fRespondio)) return false;
        if (fDesde && p.createdAt < fDesde) return false;
        if (fHasta && p.createdAt > fHasta) return false;
        return true;
      })
      .sort((a, b) => b[1].createdAt - a[1].createdAt);

    listadoEl.innerHTML = '';
    if (!filtradas.length) {
      listadoEl.innerHTML = '<p class="text-soft">No hay preguntas con ese filtro.</p>';
      return;
    }

    filtradas.forEach(([preguntaId, p]) => {
      const fecha = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(p.createdAt));
      const bloque = document.createElement('div');
      bloque.style.cssText = 'padding:14px 0; border-bottom:0.5px solid var(--border); cursor:pointer;';
      bloque.innerHTML = `
        <div class="flex-between" style="align-items:flex-start; gap:10px;">
          <div style="flex:1; min-width:0;">
            <strong>${p.alumnoNombre || 'Alumno'}</strong> <span class="text-soft" style="font-size:12px;">— ${fecha}</span>
            <span class="badge badge--activo" style="font-size:10px; margin-left:6px;">${p.tematica || 'Sin temática'}</span>
            <p style="margin:6px 0 0;">${p.pregunta || ''}</p>
            ${p.respuesta ? `<p class="text-soft" style="margin:4px 0 0; font-size:11px;">Respondida por ${p.respuesta.mentorNombre || 'un mentor'}</p>` : ''}
          </div>
          <span class="badge ${p.respuesta ? 'badge--activo' : 'badge--impaga'}" style="font-size:10px; white-space:nowrap;">${p.respuesta ? '✓ Respondida — solo lectura' : 'No respondida — puedes responder'}</span>
        </div>
        <div class="hidden" style="margin-top:10px;" data-detalle-box-begin></div>`;
      listadoEl.appendChild(bloque);

      bloque.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-detalle-box-begin]')) return;
        const detalle = bloque.querySelector('[data-detalle-box-begin]');
        const quedaOculto = detalle.classList.toggle('hidden');
        if (quedaOculto || detalle.dataset.cargado) return;
        detalle.dataset.cargado = '1';
        detalle.innerHTML = `
          ${(p.imagenes || []).map(url => `<img src="${url}" alt="" style="max-width:120px; border-radius:6px; margin:0 4px 6px 0;">`).join('')}
          ${p.respuesta
            ? `<div style="padding:10px; background:#F7F8FA; border-radius:8px;"><strong style="font-size:12px;">Respuesta de ${p.respuesta.mentorNombre || 'un mentor'}</strong><p style="margin:4px 0 0; white-space:pre-wrap;">${p.respuesta.texto || ''}</p></div>`
            : `<textarea class="box-begin-textarea-respuesta" placeholder="Escribe la respuesta..." style="min-height:120px; width:100%;"></textarea>
               <button type="button" class="btn btn--primary btn-responder-box-begin" style="font-size:12px; margin-top:8px;">Enviar Respuesta</button>`}
        `;
        const btnResponder = detalle.querySelector('.btn-responder-box-begin');
        if (btnResponder) {
          btnResponder.addEventListener('click', async (ev2) => {
            ev2.stopPropagation();
            const texto = detalle.querySelector('.box-begin-textarea-respuesta').value.trim();
            if (!texto) { alert('Escribe una respuesta antes de enviar.'); return; }
            btnResponder.disabled = true;
            try {
              const mentorSnap = await get(ref(db, `usuarios/${uid}`));
              const mentorDatos = mentorSnap.exists() ? mentorSnap.val() : {};
              await update(ref(db, `boxBegin/${preguntaId}`), {
                respuesta: { texto, mentorId: uid, mentorNombre: mentorDatos.nombre || mentorDatos.email || 'Mentor', createdAt: Date.now() }
              });
              await cargarBoxBeginMentor();
            } catch (err) {
              alert('No se pudo enviar — alguien más ya la había respondido justo antes que tú.');
              btnResponder.disabled = false;
              await cargarBoxBeginMentor();
            }
          });
        }
      });
    });
  }

  render();
  [filtroEstadoEl, filtroTematicaEl, filtroAlumnoEl, filtroRespondioEl, filtroDesdeEl, filtroHastaEl].forEach(el => {
    if (el) el.onchange = render;
  });
}

document.querySelectorAll('.nav-item[data-nav="box-consultas"]').forEach(item => {
  item.addEventListener('click', cargarBoxBeginMentor);
});

/* ============================================================
   Mentor IA — foto exclusiva, instrucciones de estilo, y
   conocimiento adicional (texto libre o archivos). Todo esto
   alimenta al Mentor IA del BOX Inteligente junto con lo
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
    const texto = document.getElementById('mentor-instrucciones-estilo').value.trim();
    if (!uid || !texto) { alert('Escribe algo antes de guardar.'); return; }
    btnGuardarInstruccionesMentor.disabled = true;
    try {
      await update(ref(db, `usuarios/${uid}`), { instruccionesEstilo: texto });
      await cargarPerfilMentor();
    } finally {
      btnGuardarInstruccionesMentor.disabled = false;
    }
  });
}

const btnEditarInstruccionesMentor = document.getElementById('btn-editar-instrucciones-mentor');
if (btnEditarInstruccionesMentor) {
  btnEditarInstruccionesMentor.addEventListener('click', () => {
    document.getElementById('mentor-instrucciones-texto').classList.add('hidden');
    document.getElementById('campo-instrucciones-estilo').classList.remove('hidden');
    document.getElementById('btn-guardar-instrucciones-mentor').classList.remove('hidden');
    btnEditarInstruccionesMentor.classList.add('hidden');
  });
}

/* --- Conocimiento Adicional: texto libre o archivo, con título --- */
let archivoConocimientoSeleccionado = null;
const btnAdjuntarArchivoConocimiento = document.getElementById('btn-adjuntar-archivo-conocimiento');
const inputArchivoConocimiento = document.getElementById('input-archivo-conocimiento');
if (btnAdjuntarArchivoConocimiento && inputArchivoConocimiento) {
  btnAdjuntarArchivoConocimiento.addEventListener('click', () => inputArchivoConocimiento.click());
  inputArchivoConocimiento.addEventListener('change', () => {
    const archivo = inputArchivoConocimiento.files[0] || null;
    if (archivo && archivo.size > 10 * 1024 * 1024) {
      alert('El archivo pesa más de 10MB. Elige uno más liviano.');
      inputArchivoConocimiento.value = '';
      archivoConocimientoSeleccionado = null;
      document.getElementById('conocimiento-archivo-nombre').textContent = '';
      return;
    }
    archivoConocimientoSeleccionado = archivo;
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

const btnGuardarHorarioRecurrente = document.getElementById('btn-guardar-horario-recurrente');
if (btnGuardarHorarioRecurrente) {
  btnGuardarHorarioRecurrente.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid) return;
    const dia = document.getElementById('mentor-horario-recurrente-dia').value;
    const hora = document.getElementById('mentor-horario-recurrente-hora').value;

    // Antes se guardaba "null" en silencio si faltaba uno de los dos
    // campos, pero igual avisaba "guardado" — quedaba sin efecto sin
    // que el mentor se diera cuenta.
    if (!dia || !hora) {
      alert('Elige el día y la hora antes de guardar.');
      return;
    }

    btnGuardarHorarioRecurrente.disabled = true;
    try {
      await update(ref(db, `usuarios/${uid}`), { horarioRecurrente: { dia, hora, zonaCreador: zonaHorariaLocal() } });
      await cargarPerfilMentor();
    } catch (err) {
      alert('No se pudo guardar. Intenta de nuevo.');
      btnGuardarHorarioRecurrente.disabled = false;
    }
  });
}

const btnEditarHorarioRecurrente = document.getElementById('btn-editar-horario-recurrente');
if (btnEditarHorarioRecurrente) {
  btnEditarHorarioRecurrente.addEventListener('click', () => {
    document.getElementById('mentor-horario-recurrente-texto').classList.add('hidden');
    document.getElementById('mentor-horario-recurrente-campos').classList.remove('hidden');
    document.getElementById('btn-guardar-horario-recurrente').classList.remove('hidden');
    btnEditarHorarioRecurrente.classList.add('hidden');
  });
}
