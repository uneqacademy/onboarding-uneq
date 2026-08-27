/* ============================================================
   coaches.js
   Vista "Coaches" (Director): lista real, NPS con desglose por
   área y momento (medio/final), comentarios, links para copiar
   y mandar al alumno, y eliminar (bloqueado si tiene alumnos
   vigentes). También carga el cuadro "Mi Evaluación" en el
   dashboard del coach (solo con 3+ respuestas, protege anonimato).

   El promedio de NPS NO se guarda aparte — se calcula al vuelo
   leyendo /nps/{coachId} cada vez, para no duplicar datos.
   ============================================================ */

import { db, auth, firebaseConfig } from './firebase-config.js';
import { ref, get, set, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecundaria, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getCurrentRole, setNav } from './main.js';

const ESTADOS_VIGENTES = ['activo', 'en_proceso_matricula', 'pausado'];

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
const AREA_LABELS = {
  dominio: 'Dominio y soporte',
  acceso: 'Acceso a contenidos',
  seguimiento: 'Seguimiento',
  cercania: 'Cercanía y empatía',
  motivacion: 'Motivación',
  mentorias: 'Mentorías en vivo'
};

const SESENTA_DIAS_MS = 60 * 24 * 60 * 60 * 1000;

/* --- Calcula promedios por área/momento + promedio general.
       Prioriza los últimos 60 días; si no hay al menos 3 respuestas
       en ese rango, va sumando las más antiguas hasta llegar a 3
       (o a todas, si hay menos de 3 en total) — así el promedio
       nunca desaparece una vez que el coach alcanzó 3 respuestas,
       pero refleja mejoras recientes cuando hay suficiente volumen.
       Los comentarios NO se filtran por fecha, se muestran todos. --- */
function calcularStatsCoach(entradasObj) {
  const todas = entradasObj ? Object.values(entradasObj) : [];
  const ahora = Date.now();

  const comentarios = todas
    .filter(e => e.comentario)
    .map(e => ({ momento: e.momento === 'final' ? 'final' : 'medio', comentario: e.comentario, createdAt: e.createdAt || 0 }))
    .sort((a, b) => b.createdAt - a.createdAt);

  const ordenadas = [...todas].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const dentroDe60 = ordenadas.filter(e => (ahora - (e.createdAt || 0)) <= SESENTA_DIAS_MS);
  const seleccionadas = dentroDe60.length >= 3 ? dentroDe60 : ordenadas.slice(0, Math.max(3, dentroDe60.length));

  const porArea = {};
  Object.keys(AREA_LABELS).forEach(a => { porArea[a] = { medio: [], final: [] }; });
  const todasLasNotas = [];

  seleccionadas.forEach(e => {
    const momento = e.momento === 'final' ? 'final' : 'medio';
    Object.keys(AREA_LABELS).forEach(a => {
      const val = e.areas ? e.areas[a] : undefined;
      if (typeof val === 'number') {
        porArea[a][momento].push(val);
        todasLasNotas.push(val);
      }
    });
  });

  const promedio = arr => arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null;

  const promedios = {};
  Object.keys(AREA_LABELS).forEach(a => {
    promedios[a] = { medio: promedio(porArea[a].medio), final: promedio(porArea[a].final) };
  });

  return {
    promedios,
    promedioGeneral: promedio(todasLasNotas),
    totalRespuestas: seleccionadas.length,
    comentarios
  };
}

function construirLinkNps(uid, nombre, momento) {
  const url = new URL('nps.html', window.location.href);
  url.searchParams.set('coach', uid);
  url.searchParams.set('nombre', nombre);
  url.searchParams.set('momento', momento);
  return url.href;
}

function copiarLink(uid, nombre, momento) {
  const url = construirLinkNps(uid, nombre, momento);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => alert(`Link copiado (evaluación "${momento}"). Pégalo donde quieras mandarlo.`))
      .catch(() => prompt('Copia este link manualmente:', url));
  } else {
    prompt('Copia este link manualmente:', url);
  }
}

function renderDetalleNps(stats) {
  const filasAreas = Object.entries(AREA_LABELS).map(([key, label]) => {
    const p = stats.promedios[key];
    const medioTxt = p.medio !== null ? p.medio.toFixed(1) : '—';
    const finalTxt = p.final !== null ? p.final.toFixed(1) : '—';
    return `<tr><td>${label}</td><td>${medioTxt}</td><td>${finalTxt}</td></tr>`;
  }).join('');

  const comentariosHtml = stats.comentarios.length
    ? stats.comentarios.map(c => `
        <div style="padding:8px 0; border-bottom:0.5px solid var(--border);">
          <span class="text-soft" style="font-size:11px;">${c.momento === 'final' ? 'Final' : 'Medio'}</span>
          <p style="margin:2px 0 0;">${c.comentario}</p>
        </div>`).join('')
    : '<p class="text-soft">Sin comentarios.</p>';

  return `
    <td colspan="6" style="background:#F7F8FA; padding:16px;">
      <div style="display:flex; gap:24px; flex-wrap:wrap;">
        <div style="flex:1; min-width:240px;">
          <strong style="font-size:13px;">Promedio por área (Medio / Final)</strong>
          <p class="text-soft" style="font-size:11px; margin:2px 0 6px;">Últimos 60 días (si no hay 3 respuestas recientes, incluye las más antiguas)</p>
          <table class="data-table" style="margin-top:0;">
            <thead><tr><th>Área</th><th>Medio</th><th>Final</th></tr></thead>
            <tbody>${filasAreas}</tbody>
          </table>
        </div>
        <div style="flex:1; min-width:240px;">
          <strong style="font-size:13px;">Comentarios (${stats.comentarios.length})</strong>
          <div style="margin-top:8px; max-height:220px; overflow-y:auto;">${comentariosHtml}</div>
        </div>
      </div>
    </td>`;
}

async function cargarCoachesView() {
  if (getCurrentRole() !== 'director') return;
  const tbody = document.getElementById('tabla-coaches-body');
  if (!tbody) return;

  const [usuariosSnap, alumnosSnap, ciclosSnap, npsSnap] = await Promise.all([
    get(ref(db, 'usuarios')),
    get(ref(db, 'alumnos')),
    get(ref(db, 'ciclos')),
    get(ref(db, 'nps'))
  ]);
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
  const alumnos = alumnosSnap.exists() ? alumnosSnap.val() : {};
  const ciclos = ciclosSnap.exists() ? ciclosSnap.val() : {};
  const npsTodos = npsSnap.exists() ? npsSnap.val() : {};

  tbody.innerHTML = '';

  Object.entries(usuarios)
    .filter(([, u]) => tieneRol(u, 'coach'))
    .forEach(([uid, coach]) => {
      const nombreCoach = coach.nombre || coach.email;
      const alumnosDeCoach = Object.entries(alumnos).filter(([, al]) => {
        const ciclo = al.cicloActualId ? ciclos[al.cicloActualId] : null;
        return ciclo && ciclo.coachId === uid;
      });
      const vigentes = alumnosDeCoach.filter(([, al]) => {
        const ciclo = ciclos[al.cicloActualId];
        return ciclo && ESTADOS_VIGENTES.includes(ciclo.estadoAlumno);
      });

      const stats = calcularStatsCoach(npsTodos[uid]);
      const npsTexto = stats.promedioGeneral !== null
        ? `${stats.promedioGeneral.toFixed(1)} ★ <span class="text-soft" style="font-size:11px;">(${stats.totalRespuestas})</span>`
        : '<span class="text-soft">—</span>';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${nombreCoach}</td>
        <td>${coach.email || ''}</td>
        <td>${alumnosDeCoach.length}</td>
        <td><span class="badge ${coach.activo === false ? 'badge--impaga' : 'badge--activo'}">${coach.activo === false ? 'Inactivo' : 'Activo'}</span></td>
        <td>${npsTexto}</td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn--ghost btn-ver-nps" style="font-size:11px; padding:4px 8px;">Ver NPS</button>
          <button class="btn btn--ghost btn-copiar-medio" style="font-size:11px; padding:4px 8px;">Link Medio</button>
          <button class="btn btn--ghost btn-copiar-final" style="font-size:11px; padding:4px 8px;">Link Final</button>
          <button class="btn btn--ghost btn-gestionar-roles" style="font-size:11px; padding:4px 8px;">Roles</button>
          <button class="btn btn--ghost btn-editar-datos-coach" style="font-size:11px; padding:4px 8px;">Editar Datos</button>
          <button class="btn btn--ghost btn-restablecer-password" style="font-size:11px; padding:4px 8px;">Restablecer Contraseña</button>
          <button class="btn btn--ghost btn-eliminar-coach" style="font-size:11px; padding:4px 8px;">Eliminar</button>
        </td>`;
      tbody.appendChild(tr);

      tr.querySelector('.btn-copiar-medio').addEventListener('click', () => copiarLink(uid, nombreCoach, 'medio'));
      tr.querySelector('.btn-copiar-final').addEventListener('click', () => copiarLink(uid, nombreCoach, 'final'));
      tr.querySelector('.btn-eliminar-coach').addEventListener('click', () => eliminarCoach(uid, nombreCoach, vigentes));
      tr.querySelector('.btn-restablecer-password').addEventListener('click', (ev) => enviarResetPassword(coach.email, ev.target));

      let filaEditarDatos = null;
      tr.querySelector('.btn-editar-datos-coach').addEventListener('click', () => {
        if (filaEditarDatos) { filaEditarDatos.remove(); filaEditarDatos = null; return; }
        filaEditarDatos = document.createElement('tr');
        filaEditarDatos.innerHTML = `
          <td colspan="6" style="background:#F7F8FA; padding:14px 16px;">
            <div class="field-grid mb-16">
              <div class="field"><label>Nombre</label><input class="edit-nombre-coach" value="${coach.nombre || ''}"></div>
              <div class="field"><label>Correo</label><input class="edit-email-coach" type="email" value="${coach.email || ''}"></div>
              <div class="field"><label>Teléfono</label><input class="edit-telefono-coach" value="${coach.telefono || ''}"></div>
            </div>
            <button class="btn btn--primary btn-guardar-datos-coach" style="font-size:11px; padding:4px 10px;">Guardar</button>
          </td>`;
        tr.insertAdjacentElement('afterend', filaEditarDatos);

        filaEditarDatos.querySelector('.btn-guardar-datos-coach').addEventListener('click', async () => {
          await update(ref(db, `usuarios/${uid}`), {
            nombre: filaEditarDatos.querySelector('.edit-nombre-coach').value.trim(),
            email: filaEditarDatos.querySelector('.edit-email-coach').value.trim(),
            telefono: filaEditarDatos.querySelector('.edit-telefono-coach').value.trim()
          });
          await cargarCoachesView();
        });
      });

      let filaRoles = null;
      tr.querySelector('.btn-gestionar-roles').addEventListener('click', () => {
        if (filaRoles) { filaRoles.remove(); filaRoles = null; return; }
        const rolesActuales = normalizarRoles(coach);
        filaRoles = document.createElement('tr');
        filaRoles.innerHTML = `
          <td colspan="6" style="background:#F7F8FA; padding:14px 16px;">
            <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
              <label style="font-weight:400;"><input type="checkbox" class="chk-rol-coach" ${rolesActuales.coach ? 'checked' : ''}> Coach</label>
              <label style="font-weight:400;"><input type="checkbox" class="chk-rol-mentor" ${rolesActuales.mentor ? 'checked' : ''}> Mentor</label>
              <label style="font-weight:400;" title="Puede crear sesiones grupales semanales exclusivas para alumnos BEGIN">
                <input type="checkbox" class="chk-coach-cabecera-begin" ${coach.coachCabeceraBegin ? 'checked' : ''}> Coach de Cabecera (BEGIN)
              </label>
              <span class="text-soft" style="font-size:12px;">El rol Director se asigna aparte, en Firebase Console.</span>
              <button class="btn btn--primary btn-guardar-roles" style="font-size:11px; padding:4px 10px;">Guardar</button>
            </div>
          </td>`;
        tr.insertAdjacentElement('afterend', filaRoles);

        filaRoles.querySelector('.btn-guardar-roles').addEventListener('click', async () => {
          const nuevosRoles = {
            ...rolesActuales,
            coach: filaRoles.querySelector('.chk-rol-coach').checked,
            mentor: filaRoles.querySelector('.chk-rol-mentor').checked
          };
          if (!Object.values(nuevosRoles).some(Boolean)) {
            alert('Debe quedar con al menos un rol activo. Para sacarle todos los accesos, usa "Eliminar".');
            return;
          }
          const coachCabeceraBegin = filaRoles.querySelector('.chk-coach-cabecera-begin').checked;
          if (coachCabeceraBegin && !nuevosRoles.coach) {
            alert('Para ser Coach de Cabecera (BEGIN) primero debe tener el rol Coach activo.');
            return;
          }
          await update(ref(db, `usuarios/${uid}`), { roles: nuevosRoles, rol: null, coachCabeceraBegin });
          await cargarCoachesView();
        });
      });

      let filaDetalle = null;
      tr.querySelector('.btn-ver-nps').addEventListener('click', (ev) => {
        if (filaDetalle) {
          filaDetalle.remove();
          filaDetalle = null;
          return;
        }
        filaDetalle = document.createElement('tr');
        filaDetalle.innerHTML = renderDetalleNps(stats);
        tr.insertAdjacentElement('afterend', filaDetalle);
      });
    });
}

async function enviarResetPassword(email, boton) {
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

async function eliminarCoach(uid, nombreCoach, vigentes) {
  if (vigentes.length > 0) {
    const nombresAlumnos = vigentes.map(([, al]) => `${al.nombre} ${al.apellido}`).join(', ');
    alert(
      `No puedes eliminar a ${nombreCoach} todavía — tiene ${vigentes.length} alumno(s) vigente(s): ${nombresAlumnos}.\n\n` +
      `Ve a la ficha de cada uno (pestaña "Ciclo Actual" → Coach Asignado) y reasígnalo a otro coach antes de eliminar. ` +
      `El historial completo (datos, tests, bitácora) se mantiene intacto y el nuevo coach lo ve todo.`
    );
    return;
  }

  const confirmado = confirm(
    `¿Eliminar a ${nombreCoach}? Ya no va a poder entrar a la app. Los alumnos que tuvo (con ciclo ya finalizado) mantienen su historial intacto, ` +
    `solo que el nombre del coach en esos registros antiguos quedará sin cuenta activa.`
  );
  if (!confirmado) return;

  await set(ref(db, `usuarios/${uid}`), null);
  await cargarCoachesView();
}

/* --- Cuadro "Mi Evaluación" en el dashboard del coach — solo con 3+ respuestas --- */
export async function cargarMiEvaluacionCoach() {
  if (getCurrentRole() !== 'coach') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const card = document.getElementById('kpi-card-mi-evaluacion');
  const valorEl = document.getElementById('kpi-mi-evaluacion-valor');
  if (!uid || !card || !valorEl) return;

  const snap = await get(ref(db, `nps/${uid}`));
  const stats = calcularStatsCoach(snap.exists() ? snap.val() : null);

  if (stats.totalRespuestas >= 3 && stats.promedioGeneral !== null) {
    valorEl.textContent = `${stats.promedioGeneral.toFixed(1)} ★`;
    card.classList.remove('hidden');
  } else {
    card.classList.add('hidden');
  }
}

const btnCopiarPasswordCoach = document.getElementById('btn-copiar-password-coach');
if (btnCopiarPasswordCoach) {
  btnCopiarPasswordCoach.addEventListener('click', () => {
    const valor = document.getElementById('coach-creado-password').value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(valor)
        .then(() => { btnCopiarPasswordCoach.textContent = '¡Copiada! ✓'; setTimeout(() => { btnCopiarPasswordCoach.textContent = 'Copiar contraseña'; }, 1500); })
        .catch(() => alert('No se pudo copiar automático — selecciónala manualmente del campo.'));
    } else {
      document.getElementById('coach-creado-password').select();
      alert('Selecciónala y usa Ctrl+C / Cmd+C para copiarla.');
    }
  });
}

document.querySelectorAll('.nav-item[data-nav="coaches"]').forEach(item => {
  item.addEventListener('click', cargarCoachesView);
});
document.querySelectorAll('.nav-item[data-nav="dashboard"]').forEach(item => {
  item.addEventListener('click', cargarMiEvaluacionCoach);
});

/* --- Crear cuenta real de coach — usa una instancia SECUNDARIA de Firebase
       para no cerrar la sesión del director al crear el usuario nuevo. --- */
function generarPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 10; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  return pass;
}

const btnCrearCoach = document.getElementById('btn-crear-coach');
if (btnCrearCoach) {
  btnCrearCoach.addEventListener('click', async () => {
    const errorEl = document.getElementById('nuevo-coach-error');
    errorEl.classList.add('hidden');
    document.getElementById('panel-coach-creado').classList.add('hidden');
    const nombre = document.getElementById('nuevo-coach-nombre').value.trim();
    const email = document.getElementById('nuevo-coach-email').value.trim();
    const telefono = document.getElementById('nuevo-coach-telefono').value.trim();
    const tambienMentor = document.getElementById('nuevo-coach-tambien-mentor').checked;

    if (!nombre || !email) {
      errorEl.textContent = 'Completa nombre y correo.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnCrearCoach.disabled = true;
    btnCrearCoach.textContent = 'Creando...';

    try {
      // ¿Ya existe una cuenta con este correo? Si es así, solo le agregamos
      // el rol — no se crea una cuenta nueva ni se genera contraseña.
      const usuariosSnap = await get(ref(db, 'usuarios'));
      const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
      const existente = Object.entries(usuarios).find(([, u]) => (u.email || '').toLowerCase() === email.toLowerCase());

      if (existente) {
        const [uidExistente, datosExistente] = existente;
        const rolesNuevos = { ...normalizarRoles(datosExistente), coach: true };
        if (tambienMentor) rolesNuevos.mentor = true;
        await update(ref(db, `usuarios/${uidExistente}`), { roles: rolesNuevos, rol: null, telefono: telefono || datosExistente.telefono || '' });

        document.getElementById('nuevo-coach-nombre').value = '';
        document.getElementById('nuevo-coach-email').value = '';
        document.getElementById('nuevo-coach-telefono').value = '';
        document.getElementById('nuevo-coach-tambien-mentor').checked = false;
        alert(`${datosExistente.nombre || email} ya tenía una cuenta — se le agregó el rol de Coach${tambienMentor ? ' y Mentor' : ''} a la misma cuenta, sin generar contraseña nueva.`);
        await cargarCoachesView();
        return;
      }

      const password = generarPassword();
      let secundaria = null;
      try {
        secundaria = initializeApp(firebaseConfig, 'crear-coach-' + Date.now());
        const authSecundaria = getAuth(secundaria);
        const credencial = await createUserWithEmailAndPassword(authSecundaria, email, password);
        const nuevoUid = credencial.user.uid;
        await signOutSecundaria(authSecundaria);

        const roles = { coach: true };
        if (tambienMentor) roles.mentor = true;
        await set(ref(db, `usuarios/${nuevoUid}`), { nombre, email, telefono, roles, activo: true });

        document.getElementById('nuevo-coach-nombre').value = '';
        document.getElementById('nuevo-coach-email').value = '';
        document.getElementById('nuevo-coach-telefono').value = '';
        document.getElementById('nuevo-coach-tambien-mentor').checked = false;

        document.getElementById('coach-creado-email').value = email;
        document.getElementById('coach-creado-password').value = password;
        document.getElementById('panel-coach-creado').classList.remove('hidden');

        await cargarCoachesView();
        // Ojo: NO navegamos a "Coaches" acá a propósito — así el panel con la
        // contraseña se queda visible hasta que el director lo copie y decida
        // volver él mismo con "← Volver".
      } finally {
        if (secundaria) await deleteApp(secundaria);
      }
    } catch (err) {
      errorEl.textContent = err.code === 'auth/email-already-in-use'
        ? 'Ese correo ya tiene una cuenta creada.'
        : 'No se pudo crear la cuenta. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
    } finally {
      btnCrearCoach.disabled = false;
      btnCrearCoach.textContent = 'Crear Cuenta de Coach';
    }
  });
}

export { cargarCoachesView };
