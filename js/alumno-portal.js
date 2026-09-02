/* ============================================================
   alumno-portal.js
   Fase 2 — primera entrega: crear el acceso del alumno (desde
   la ficha, director/coach) y su Dashboard de solo lectura
   (ficha, acuerdo/PDF, Test Brújula histórico, bitácora). Nada
   es editable por el alumno — todo lo sigue manejando el coach.

   El BOX Inteligente (preguntas + respuestas con audio/imagen)
   queda para la próxima entrega, es su propio bloque de trabajo.
   ============================================================ */

import { db, auth, storage, firebaseConfig } from './firebase-config.js';
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { ref, get, set, update, push } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecundaria, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { programaLabel } from './ciclos.js';

function generarPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 10; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  return pass;
}

function formatFecha(fechaStr) {
  if (!fechaStr) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(fechaStr + 'T00:00:00'));
}

/* Detecta URLs sueltas en texto plano y las vuelve links clickeables */
export function linkify(texto) {
  if (!texto) return '';
  const regexUrl = /(https?:\/\/[^\s<]+)/g;
  return texto.replace(regexUrl, url => `<a href="${url}" target="_blank" rel="noopener" style="color:#2563EB;">${url}</a>`);
}

const FASE_LABELS = { fase1: 'Fase 1', fase2: 'Fase 2', fase3: 'Fase 3', fase4: 'Fase 4' };
const PLACEHOLDER_FOTO_ALUMNO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#E4E7EC"/><circle cx="40" cy="32" r="14" fill="#9AA4B2"/><ellipse cx="40" cy="70" rx="24" ry="18" fill="#9AA4B2"/></svg>'
);
let alumnoIdActual = null;

/* ============================================================
   Crear acceso del alumno (desde la ficha, director o coach)
   ============================================================ */
const btnCrearAccesoAlumno = document.getElementById('btn-crear-acceso-alumno');
if (btnCrearAccesoAlumno) {
  btnCrearAccesoAlumno.addEventListener('click', async () => {
    const alumnoId = btnCrearAccesoAlumno.dataset.alumnoId;
    const email = document.getElementById('datos-email').value.trim();
    if (!alumnoId || !email) {
      alert('El alumno necesita tener un correo guardado (pestaña Datos Generales) antes de crear su acceso.');
      return;
    }

    btnCrearAccesoAlumno.disabled = true;
    btnCrearAccesoAlumno.textContent = 'Creando...';
    const password = generarPassword();
    let secundaria = null;
    try {
      secundaria = initializeApp(firebaseConfig, 'crear-alumno-acceso-' + Date.now());
      const authSecundaria = getAuth(secundaria);
      const credencial = await createUserWithEmailAndPassword(authSecundaria, email, password);
      const nuevoUid = credencial.user.uid;
      await signOutSecundaria(authSecundaria);

      await update(ref(db, `alumnos/${alumnoId}`), { authUid: nuevoUid });
      await set(ref(db, `alumnoPorAuthUid/${nuevoUid}`), alumnoId);

      document.getElementById('acceso-alumno-email').value = email;
      document.getElementById('acceso-alumno-password').value = password;
      document.getElementById('panel-acceso-alumno-creado').classList.remove('hidden');
      btnCrearAccesoAlumno.classList.add('hidden');
      const bloqueExistente = document.getElementById('bloque-acceso-alumno-existente');
      if (bloqueExistente) bloqueExistente.classList.remove('hidden');
    } catch (err) {
      alert(err.code === 'auth/email-already-in-use'
        ? 'Ese correo ya tiene una cuenta creada en el sistema (puede que ya sea coach o mentor).'
        : 'No se pudo crear el acceso. Intenta de nuevo.');
    } finally {
      if (secundaria) await deleteApp(secundaria);
      btnCrearAccesoAlumno.disabled = false;
      btnCrearAccesoAlumno.textContent = '🔑 Crear Acceso para el Alumno';
    }
  });
}

const btnCopiarPasswordAlumno = document.getElementById('btn-copiar-password-alumno');
if (btnCopiarPasswordAlumno) {
  btnCopiarPasswordAlumno.addEventListener('click', () => {
    const valor = document.getElementById('acceso-alumno-password').value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(valor)
        .then(() => { btnCopiarPasswordAlumno.textContent = '¡Copiada! ✓'; setTimeout(() => { btnCopiarPasswordAlumno.textContent = 'Copiar contraseña'; }, 1500); })
        .catch(() => alert('No se pudo copiar automático — selecciónala manualmente.'));
    }
  });
}

/* --- Actualiza el estado del botón "Crear Acceso" cada vez que se abre
       una ficha (llamado desde alumnos.js) --- */
export function actualizarBotonAccesoAlumno(alumnoId, yaTieneAcceso) {
  if (!btnCrearAccesoAlumno) return;
  document.getElementById('panel-acceso-alumno-creado').classList.add('hidden');
  btnCrearAccesoAlumno.dataset.alumnoId = alumnoId;
  btnCrearAccesoAlumno.classList.toggle('hidden', yaTieneAcceso);
  btnCrearAccesoAlumno.textContent = '🔑 Crear Acceso para el Alumno';

  const bloqueExistente = document.getElementById('bloque-acceso-alumno-existente');
  if (bloqueExistente) bloqueExistente.classList.toggle('hidden', !yaTieneAcceso);
  const btnResetPasswordAlumno = document.getElementById('btn-restablecer-password-alumno');
  if (btnResetPasswordAlumno) btnResetPasswordAlumno.dataset.alumnoId = alumnoId;
}

const btnRestablecerPasswordAlumno = document.getElementById('btn-restablecer-password-alumno');
if (btnRestablecerPasswordAlumno) {
  btnRestablecerPasswordAlumno.addEventListener('click', async () => {
    const email = document.getElementById('datos-email').value.trim();
    if (!email) return;
    btnRestablecerPasswordAlumno.disabled = true;
    const textoOriginal = btnRestablecerPasswordAlumno.textContent;
    btnRestablecerPasswordAlumno.textContent = 'Enviando...';
    try {
      await sendPasswordResetEmail(auth, email);
      alert(`Listo — le mandamos un correo a ${email} con un link para elegir una nueva contraseña.`);
    } catch (err) {
      alert('No se pudo enviar el correo. Revisa que el email esté bien escrito.');
    } finally {
      btnRestablecerPasswordAlumno.disabled = false;
      btnRestablecerPasswordAlumno.textContent = textoOriginal;
    }
  });
}

/* ============================================================
   Dashboard del alumno (solo lectura)
   ============================================================ */
export async function cargarDashboardAlumno(alumnoId) {
  alumnoIdActual = alumnoId;
  const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
  if (!alumnoSnap.exists()) return;
  const alumno = alumnoSnap.val();

  let ciclo = null;
  if (alumno.cicloActualId) {
    const cicloSnap = await get(ref(db, `ciclos/${alumno.cicloActualId}`));
    ciclo = cicloSnap.exists() ? cicloSnap.val() : null;
  }

  // --- El BOX ahora sí es visible para BEGIN — ve un canal
  //     distinto (ver cargarBoxAlumno), no el de Mentor IA por especialidad.

  // --- Foto grande sobre el menú lateral ---
  const fotoSidebar = document.getElementById('sidebar-foto-alumno');
  if (fotoSidebar) fotoSidebar.src = alumno.fotoUrl || PLACEHOLDER_FOTO_ALUMNO;

  // --- Bienvenida (Bienvenido/a según género; por defecto Bienvenido) ---
  const bienvenidaEl = document.getElementById('alumno-bienvenida');
  if (bienvenidaEl) {
    const saludo = alumno.genero === 'Femenino' ? 'Bienvenida' : 'Bienvenido';
    bienvenidaEl.textContent = `${saludo} a UNEQ Mentoring ${alumno.nombre || ''},`.trim();
  }

  // --- Stepper del programa (Begin → Next → eXIT), con logos reales ---
  const stepperEl = document.getElementById('alumno-stepper-programa');
  if (stepperEl) {
    const programaActual = ciclo ? ciclo.programa : null;
    const PROGRAMAS_ORDEN = [
      ['begin', 'assets/logos/logo-begin.png', 'BEGIN'],
      ['next', 'assets/logos/logo-next.png', 'NEXT'],
      ['exit', 'assets/logos/logo-exit.png', 'eXIT']
    ];
    stepperEl.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:center; gap:16px;">
        ${PROGRAMAS_ORDEN.map(([clave, logo, label]) => {
          const activo = clave === programaActual;
          return `
          <div style="display:flex; align-items:center; justify-content:center; padding:${activo ? '12px 22px' : '10px 16px'}; border-radius:var(--radius-md, 10px); border:${activo ? '1.5px solid var(--color-accent, #2563EB)' : '1.5px solid transparent'}; opacity:${activo ? '1' : '0.4'};">
            <img src="${logo}" alt="${label}" style="height:${activo ? '42px' : '30px'}; width:auto; object-fit:contain;">
          </div>`;
        }).join('')}
      </div>`;
  }

  // --- Stepper de astronautas: Inicio → Fase 1-4 → Final, según el
  //     avance real del alumno (faseMetodologia / estadoAlumno). ---
  const astronautaEl = document.getElementById('alumno-astronauta-fase');
  if (astronautaEl) {
    // TODO: cuando lleguen los sets de BEGIN y eXIT, cambiar 'next' por
    // (ciclo ? ciclo.programa : 'next') acá abajo, para que cada quien
    // vea el set de su propio programa. Por ahora, todos ven el de NEXT.
    const carpetaStepper = 'next';
    let estadoAstro = 'inicio';
    if (ciclo && ciclo.estadoAlumno === 'egresado') {
      estadoAstro = 'final';
    } else if (ciclo && ciclo.faseMetodologia && /\d/.test(ciclo.faseMetodologia)) {
      estadoAstro = `fase${ciclo.faseMetodologia.match(/\d/)[0]}`;
    }
    astronautaEl.innerHTML = `<img src="assets/stepper/${carpetaStepper}/${estadoAstro}.jpg" alt="Tu avance en la Metodología 2E" style="width:100%; height:auto; display:block; border-radius:var(--radius-md, 10px);">`;
  }

  // --- Aviso de atraso de pago (automático: alguna cuota vencida y no pagada) ---
  const avisoAtrasoEl = document.getElementById('alumno-aviso-atraso');
  if (avisoAtrasoEl) {
    if (alumno.cicloActualId) {
      const acuerdoSnap = await get(ref(db, `acuerdosPago/${alumno.cicloActualId}`));
      const acuerdo = acuerdoSnap.exists() ? acuerdoSnap.val() : null;
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const atrasado = acuerdo && acuerdo.cuotas && Object.values(acuerdo.cuotas).some(c => {
        if (!c.fecha || c.estado === 'pagada') return false;
        return new Date(c.fecha + 'T00:00:00') <= hoy;
      });
      if (atrasado) {
        avisoAtrasoEl.classList.remove('hidden');
        avisoAtrasoEl.innerHTML = `
          <div class="panel" style="background:#FDEDED; border-color:#F5C6C6;">
            <div class="panel__body" style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:20px;">⚠️</span>
              <p style="margin:0; color:#8A2E2E;">Tienes un pago atrasado según tu acuerdo. Por favor contacta a <strong>Soporte Alumnos</strong> para resolverlo y obtener más información.</p>
            </div>
          </div>`;
      } else {
        avisoAtrasoEl.classList.add('hidden');
        avisoAtrasoEl.innerHTML = '';
      }
    } else {
      avisoAtrasoEl.classList.add('hidden');
    }
  }

  // --- Accesos Directos ---
  const accesosEl = document.getElementById('alumno-accesos-directos');
  if (accesosEl) {
    const configSnap = await get(ref(db, 'configuracion/general'));
    const config = configSnap.exists() ? configSnap.val() : {};
    const programa = ciclo ? ciclo.programa : null;
    const contenidoUrl = programa === 'begin' ? config.contenidoHotmartBegin
      : programa === 'next' ? config.contenidoHotmartNext
      : programa === 'exit' ? config.contenidoHotmartExit : '';
    const whatsappUrl = programa === 'begin' ? config.whatsappBegin
      : (programa === 'next' || programa === 'exit') ? config.whatsappNextExit : '';

    let coach = null;
    let esCoachCabeceraMsg = false;
    if (ciclo && ciclo.coachId) {
      const coachSnap = await get(ref(db, `usuarios/${ciclo.coachId}`));
      coach = coachSnap.exists() ? coachSnap.val() : null;
    } else if (ciclo && ciclo.programa === 'begin') {
      const usuariosSnapCabecera = await get(ref(db, 'usuarios'));
      if (usuariosSnapCabecera.exists()) {
        coach = Object.values(usuariosSnapCabecera.val()).find(u => u.coachCabeceraBegin === true) || null;
        esCoachCabeceraMsg = !!coach;
      }
    }
    const numeroFase = (ciclo && ciclo.faseMetodologia && /\d/.test(ciclo.faseMetodologia)) ? ciclo.faseMetodologia.match(/\d/)[0] : null;
    const fraseFase = numeroFase
      ? `Actualmente te encuentras en: <span style="background:#E2E4E8; color:#1B2333; padding:2px 10px; border-radius:6px; font-weight:700;">Fase ${numeroFase}</span> de la Metodología 2E`
      : 'Tu fase actual aún no está definida — pronto tu coach la va a actualizar.';
    const mensajeCoach = coach ? encodeURIComponent(`Hola ${coach.nombre || ''}, necesito tu ayuda por favor`) : '';
    const whatsappCoachUrl = coach && coach.telefono ? `https://wa.me/${coach.telefono.replace(/[^0-9]/g, '')}?text=${mensajeCoach}` : '';

    let fraseDiasRestantes = '';
    if (ciclo && ciclo.fechaEgreso) {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const egreso = new Date(ciclo.fechaEgreso + 'T00:00:00');
      const diasRestantes = Math.ceil((egreso.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
      if (diasRestantes > 0) {
        fraseDiasRestantes = `¡Te quedan <strong>${diasRestantes} día${diasRestantes === 1 ? '' : 's'}</strong> de acceso al acompañamiento, estamos aquí para guiarte, <strong><em>no te detengas!</em></strong>`;
      } else {
        fraseDiasRestantes = `<span style="color:#B8860B; font-weight:600;">Tu acceso está en período de gracia</span>`;
      }
    }

    // Íconos genéricos (sin marca de nadie) para Comunidad/Contenidos —
    // el de Hotmart sí es su logo real (assets/logos/hotmart.png).
    const iconoComunidad = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="16" cy="8" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M2 20c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 15.5c.7-.3 1.5-.5 2-.5 3.5 0 6 2 6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    const iconoContenidos = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="5" width="18" height="12" rx="1.5" stroke="currentColor" stroke-width="1.8"/><path d="M1 20h22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    const iconoWhatsapp = `<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.05-1.33C8.51 21.5 10.2 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm5.2 14.15c-.22.62-1.28 1.18-1.76 1.24-.45.06-1.02.09-1.65-.1-.38-.12-.87-.28-1.5-.55-2.64-1.14-4.36-3.8-4.5-3.98-.13-.18-1.08-1.43-1.08-2.73 0-1.3.68-1.94.92-2.2.24-.26.53-.33.7-.33.18 0 .35 0 .5.01.16.01.38-.06.6.46.22.53.75 1.83.82 1.96.07.13.11.29.02.47-.09.18-.13.29-.26.44-.13.15-.27.34-.39.46-.13.13-.26.27-.11.53.15.26.68 1.12 1.46 1.81 1 .89 1.85 1.17 2.11 1.3.26.13.41.11.56-.07.15-.18.64-.75.81-1 .17-.26.34-.22.57-.13.24.09 1.5.71 1.76.84.26.13.43.2.5.31.06.11.06.62-.16 1.24z"/></svg>`;
    const logoHotmart = `<img src="assets/logos/hotmart.png" alt="Hotmart" style="height:14px; width:auto; vertical-align:middle;">`;

    accesosEl.innerHTML = `
      <div class="accesos-directos-botones" style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:18px;">
        <button type="button" class="btn btn--primary" id="btn-acceso-preguntar-mentores">Pregunta a los Mentores</button>
        ${config.comunidadHotmartUrl ? `<a href="${config.comunidadHotmartUrl}" target="_blank" rel="noopener" class="btn" style="background:#000; color:#fff; display:inline-flex; align-items:center; justify-content:center; gap:7px;">Comunidad ${logoHotmart}hotmart ${iconoComunidad}</a>` : ''}
        ${contenidoUrl ? `<a href="${contenidoUrl}" target="_blank" rel="noopener" class="btn" style="background:#000; color:#fff; display:inline-flex; align-items:center; justify-content:center; gap:7px;">Contenidos en ${logoHotmart}hotmart ${iconoContenidos}</a>` : ''}
        ${whatsappUrl ? `<a href="${whatsappUrl}" target="_blank" rel="noopener" class="btn" style="background:#25D366; color:#fff;">Grupo WhatsApp Exclusivo</a>` : ''}
      </div>
      <div style="line-height:1.6;">
        <p style="margin:0 0 10px; line-height:1.6; display:flex; align-items:center; gap:10px;">
          <img src="${coach && coach.fotoUrl ? coach.fotoUrl : PLACEHOLDER_FOTO_ALUMNO}" alt="" style="width:38px; height:38px; border-radius:50%; object-fit:cover; flex-shrink:0; ${coach ? '' : 'display:none;'}">
          <span>
            ${coach ? `<strong>Tu Coach es:</strong> <em>${coach.nombre || '—'}</em>${esCoachCabeceraMsg ? ' <span style="font-size:11px;">🚩 Coach de Cabecera</span>' : ''}` : 'Aún no tienes coach asignado'}
            ${whatsappCoachUrl ? ` <a href="${whatsappCoachUrl}" target="_blank" rel="noopener" aria-label="WhatsApp" style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:50%; background:#25D366; vertical-align:middle;">${iconoWhatsapp}</a>` : ''}
          </span>
        </p>
        <p style="margin:0 0 8px; line-height:1.6; text-align:center;">${fraseFase}</p>
      </div>`;

    const diasRestantesPanelEl = document.getElementById('alumno-dias-restantes-panel');
    if (diasRestantesPanelEl) {
      if (fraseDiasRestantes) {
        diasRestantesPanelEl.classList.remove('hidden');
        diasRestantesPanelEl.innerHTML = `
          <div class="panel__body" style="display:flex; align-items:center; gap:14px;">
            <span style="font-size:28px;">⏳</span>
            <p style="margin:0; line-height:1.5;">${fraseDiasRestantes}</p>
          </div>`;
      } else {
        diasRestantesPanelEl.classList.add('hidden');
        diasRestantesPanelEl.innerHTML = '';
      }
    }

    const btnPreguntarMentores = document.getElementById('btn-acceso-preguntar-mentores');
    if (btnPreguntarMentores) {
      btnPreguntarMentores.addEventListener('click', () => document.querySelector('.nav-item[data-nav="box-consultas"]')?.click());
    }
  }

  // --- Mi Último Test Brújula (visual) — el historial completo vive en su propia página ---
  const ultimoTestEl = document.getElementById('alumno-ultimo-test');
  if (ultimoTestEl) {
    if (alumno.cicloActualId) {
      const testsSnap = await get(ref(db, `ciclos/${alumno.cicloActualId}/tests`));
      const tests = testsSnap.exists() ? Object.values(testsSnap.val()) : [];
      if (tests.length) {
        const ultimo = tests.sort((a, b) => b.completadoAt - a.completadoAt)[0];
        ultimoTestEl.innerHTML = renderDetalleCompletoTest(ultimo);
      } else {
        ultimoTestEl.innerHTML = '<p class="text-soft">Aún no has completado el Test Brújula — tu coach te va a guiar en eso.</p>';
      }
    } else {
      ultimoTestEl.innerHTML = '<p class="text-soft">Aún no hay un ciclo asociado.</p>';
    }
  }

  const btnVerHistorialTest = document.getElementById('btn-ver-historial-test-alumno');
  if (btnVerHistorialTest) {
    btnVerHistorialTest.onclick = () => document.querySelector('.nav-item[data-nav="test-alumno"]')?.click();
  }
}

/* --- Mi Ficha Alumno (página propia) --- */
export async function cargarFichaAlumnoPropia() {
  const fichaEl = document.getElementById('alumno-mi-ficha');
  if (!fichaEl || !alumnoIdActual) return;
  const alumnoId = alumnoIdActual;

  const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
  if (!alumnoSnap.exists()) return;
  const alumno = alumnoSnap.val();

  let ciclo = null;
  if (alumno.cicloActualId) {
    const cicloSnap = await get(ref(db, `ciclos/${alumno.cicloActualId}`));
    ciclo = cicloSnap.exists() ? cicloSnap.val() : null;
  }

  const dir = alumno.direccion || {};
  const direccionTexto = [[dir.calle, dir.numero].filter(Boolean).join(' '), dir.departamento, dir.comuna, dir.region, dir.pais]
    .filter(Boolean).join(', ') || '—';

  fichaEl.innerHTML = `
    <div style="display:flex; align-items:center; gap:14px; margin-bottom:16px;">
      <img id="alumno-foto-preview" src="${alumno.fotoUrl || PLACEHOLDER_FOTO_ALUMNO}" alt="" style="width:56px; height:56px; border-radius:50%; object-fit:cover; background:#E4E7EC;">
      <div>
        <strong style="font-size:16px;">${alumno.nombre || ''} ${alumno.apellido || ''}</strong>
        <p class="text-soft" style="margin:2px 0 0;">${ciclo ? programaLabel(ciclo.programa) : '—'}</p>
        <button type="button" class="btn btn--ghost" id="btn-cambiar-foto-alumno" style="font-size:11px; padding:4px 10px; margin-top:6px;">Cambiar Foto</button>
        <input type="file" id="alumno-foto-input" accept="image/*" class="hidden">
      </div>
    </div>
    <div class="ficha-alumno-datos" style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px 20px; font-size:13px;">
      <div><strong>Correo:</strong> ${alumno.email || '—'}</div>
      <div><strong>Teléfono:</strong> ${alumno.telefono || '—'}</div>
      <div><strong>Ocupación:</strong> ${alumno.ocupacion || '—'}${alumno.ocupacionEspecialidad ? `, ${alumno.ocupacionEspecialidad}` : ''}</div>
      <div><strong>Dirección:</strong> ${direccionTexto}</div>
      <div><strong>Fecha de Ingreso:</strong> ${formatFecha(ciclo ? ciclo.fechaIngreso : null)}</div>
      <div><strong>Fecha de Egreso:</strong> ${formatFecha(ciclo ? ciclo.fechaEgreso : null)}</div>
    </div>`;

  const btnCambiarFotoAlumno = document.getElementById('btn-cambiar-foto-alumno');
  const inputFotoAlumno = document.getElementById('alumno-foto-input');
  if (btnCambiarFotoAlumno && inputFotoAlumno) {
    btnCambiarFotoAlumno.addEventListener('click', () => inputFotoAlumno.click());
    inputFotoAlumno.addEventListener('change', async () => {
      const file = inputFotoAlumno.files[0];
      if (!file) return;
      btnCambiarFotoAlumno.disabled = true;
      const textoOriginal = btnCambiarFotoAlumno.textContent;
      btnCambiarFotoAlumno.textContent = 'Subiendo...';
      try {
        const archivoRef = storageRef(storage, `fotos-alumnos/${alumnoId}`);
        await uploadBytes(archivoRef, file);
        const url = await getDownloadURL(archivoRef);
        await set(ref(db, `alumnos/${alumnoId}/fotoUrl`), url);
        document.getElementById('alumno-foto-preview').src = url;
        const fotoSidebar = document.getElementById('sidebar-foto-alumno');
        if (fotoSidebar) fotoSidebar.src = url;
      } catch (err) {
        alert('No se pudo subir la foto. Intenta de nuevo.');
      } finally {
        btnCambiarFotoAlumno.disabled = false;
        btnCambiarFotoAlumno.textContent = textoOriginal;
        inputFotoAlumno.value = '';
      }
    });
  }
}

/* --- Acuerdo Alumno (página propia, descarga directa) --- */
export async function cargarAcuerdoAlumno() {
  const acuerdoEl = document.getElementById('alumno-mi-acuerdo');
  if (!acuerdoEl || !alumnoIdActual) return;
  const alumnoSnap = await get(ref(db, `alumnos/${alumnoIdActual}`));
  const alumno = alumnoSnap.exists() ? alumnoSnap.val() : null;

  if (alumno && alumno.cicloActualId) {
    const acuerdoSnap = await get(ref(db, `acuerdosPago/${alumno.cicloActualId}`));
    const acuerdo = acuerdoSnap.exists() ? acuerdoSnap.val() : null;
    acuerdoEl.innerHTML = acuerdo && acuerdo.pdfFirmadoUrl
      ? `<a href="${acuerdo.pdfFirmadoUrl}" target="_blank" rel="noopener" class="btn btn--primary">Descargar mi Acuerdo Firmado (PDF)</a>`
      : '<p class="text-soft">Tu acuerdo firmado todavía no está disponible — tu director lo va a subir apenas esté listo.</p>';
  } else {
    acuerdoEl.innerHTML = '<p class="text-soft">Aún no hay un ciclo asociado.</p>';
  }
}

document.querySelectorAll('.nav-item[data-nav="ficha-alumno-propia"]').forEach(item => {
  item.addEventListener('click', () => { cargarFichaAlumnoPropia(); cargarAcuerdoAlumno(); });
});

// --- Gauge semicircular (SVG puro, sin librerías) para las 4 Fases ---
function gaugeSVG(valor, colorHex) {
  const v = Math.max(0, Math.min(10, Number(valor) || 0));
  const cx = 100, cy = 95, r = 78;
  const anguloGrados = 180 - (v / 10) * 180;
  const rad = deg => (deg * Math.PI) / 180;
  const endX = (cx + r * Math.cos(rad(anguloGrados))).toFixed(2);
  const endY = (cy - r * Math.sin(rad(anguloGrados))).toFixed(2);
  const pathValor = v > 0 ? `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${endX} ${endY}` : '';
  return `
    <svg viewBox="0 0 200 120" style="width:100%; max-width:220px; display:block; margin:0 auto;">
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="#E2E4E8" stroke-width="16" stroke-linecap="round"/>
      ${pathValor ? `<path d="${pathValor}" fill="none" stroke="${colorHex}" stroke-width="16" stroke-linecap="round"/>` : ''}
      <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="30" font-weight="700" fill="${colorHex}" font-family="Sora, sans-serif">${v.toFixed(1)}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="#5B6472" font-family="Inter, sans-serif">de 10</text>
      <text x="${cx - r}" y="${cy + 20}" text-anchor="start" font-size="10" fill="#9CA3AF">0</text>
      <text x="${cx + r}" y="${cy + 20}" text-anchor="end" font-size="10" fill="#9CA3AF">10</text>
    </svg>`;
}

function renderKpiTest(test) {
  const p = test.promedios || {};
  const fecha = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(test.completadoAt));
  const FASES_GAUGE = [
    ['fase1', 'Fase 1:', 'Claridad y Fundamentos', '#8B5CF6'],
    ['fase2', 'Fase 2:', 'Cliente Soñado', '#0EA5E9'],
    ['fase3', 'Fase 3:', 'Oferta y Método', '#EC4899'],
    ['fase4', 'Fase 4:', 'Acción y Sistemas', '#10B981']
  ];
  return `
    <p class="text-soft mb-16">${fecha}</p>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:20px;">
      ${FASES_GAUGE.map(([clave, linea1, linea2, color]) => `
        <div style="text-align:center;">
          <p style="font-weight:700; font-size:12.5px; margin:0 0 4px; line-height:1.35;">${linea1}<br>${linea2}</p>
          ${gaugeSVG(p[clave], color)}
        </div>`).join('')}
    </div>`;
}

const LABELS_SABOTEADORES = [
  { id: 'sab_perfeccionista', label: 'Perfeccionista' },
  { id: 'sab_procrastinador', label: 'Procrastinador' },
  { id: 'sab_comparador', label: 'Comparador' },
  { id: 'sab_disperso', label: 'Disperso' },
  { id: 'sab_controlador', label: 'Controlador' },
  { id: 'sab_victima', label: 'Víctima' }
];
const LABELS_BLOQUEOS_VENTA = [
  { id: 'bv_rogar', label: 'Miedo a "rogar"' },
  { id: 'bv_dinero', label: 'Culpa por el dinero' },
  { id: 'bv_expectativas', label: 'Miedo a no cumplir' },
  { id: 'bv_perseguir', label: 'Rechazo a "perseguir"' },
  { id: 'bv_aburrir', label: 'Miedo a aburrir' }
];

function renderBarrasAlumno(respuestas, lista) {
  return lista.map(item => {
    const valor = respuestas ? respuestas[item.id] : undefined;
    if (valor === undefined) return '';
    const nivel = valor <= 3 ? 'level-low' : valor <= 6 ? 'level-mid' : 'level-high';
    return `
      <div class="bar-chart-row">
        <div class="bar-label">${item.label}</div>
        <div class="bar-track"><div class="bar-fill ${nivel}" style="width:${valor * 10}%"></div></div>
        <div class="bar-value">${valor}</div>
      </div>`;
  }).join('');
}

function renderDetalleCompletoTest(test) {
  return `
    ${renderKpiTest(test)}
    <div class="panel mb-16" style="margin-top:16px;">
      <div class="panel__body">
        <div class="result-panel-title">Saboteadores Internos</div>
        <div class="result-panel-sub">0 = no me afecta · 10 = me bloquea constantemente</div>
        ${renderBarrasAlumno(test.respuestas, LABELS_SABOTEADORES)}
      </div>
    </div>
    <div class="panel">
      <div class="panel__body">
        <div class="result-panel-title">Bloqueos de Venta</div>
        <div class="result-panel-sub">0 = no me afecta · 10 = me bloquea constantemente</div>
        ${renderBarrasAlumno(test.respuestas, LABELS_BLOQUEOS_VENTA)}
      </div>
    </div>`;
}

/* --- Mi Bitácora (página propia) --- */
export async function cargarBitacoraAlumnoCompleta() {
  const el = document.getElementById('alumno-bitacora-completa');
  if (!el || !alumnoIdActual) return;
  const alumnoSnap = await get(ref(db, `alumnos/${alumnoIdActual}`));
  const alumno = alumnoSnap.exists() ? alumnoSnap.val() : null;
  if (!alumno || !alumno.cicloActualId) {
    el.innerHTML = '<p class="text-soft">Aún no hay un ciclo asociado.</p>';
    return;
  }
  const bitacoraSnap = await get(ref(db, `bitacora/${alumno.cicloActualId}`));
  const entradas = bitacoraSnap.exists() ? Object.values(bitacoraSnap.val()) : [];
  el.innerHTML = entradas.length
    ? entradas.sort((a, b) => b.createdAt - a.createdAt).map(e => `
        <div class="panel mb-16" style="padding:14px; font-size:13px;">
          <strong>${e.titulo || ''}</strong> <span class="text-soft">— ${formatFecha(e.fecha)} · ${e.canal || ''}</span>
          <p style="margin:6px 0 0;">${linkify(e.notas || '')}</p>
        </div>`).join('')
    : '<p class="text-soft">Aún no hay entradas en tu bitácora.</p>';
}

/* --- Mi Test Brújula, historial completo (página propia): el último
       queda abierto con todo el detalle (fases + saboteadores + bloqueos
       de venta); los anteriores quedan colapsados, clic para expandir. --- */
export async function cargarTestAlumnoCompleto() {
  const el = document.getElementById('alumno-test-completo');
  if (!el || !alumnoIdActual) return;
  const alumnoSnap = await get(ref(db, `alumnos/${alumnoIdActual}`));
  const alumno = alumnoSnap.exists() ? alumnoSnap.val() : null;
  if (!alumno || !alumno.cicloActualId) {
    el.innerHTML = '<p class="text-soft">Aún no hay un ciclo asociado.</p>';
    return;
  }
  const testsSnap = await get(ref(db, `ciclos/${alumno.cicloActualId}/tests`));
  const testsObj = testsSnap.exists() ? testsSnap.val() : {};
  const tests = Object.values(testsObj).sort((a, b) => b.completadoAt - a.completadoAt);

  if (!tests.length) {
    el.innerHTML = '<p class="text-soft">Aún no has completado el Test Brújula — tu coach te va a guiar en eso.</p>';
    return;
  }

  const [ultimo, ...anteriores] = tests;
  el.innerHTML = `
    <div style="margin-bottom:24px;">
      <p class="text-soft mb-16"><strong>Tu test más reciente</strong></p>
      ${renderDetalleCompletoTest(ultimo)}
    </div>
    ${anteriores.length ? `
      <div style="border-top:0.5px solid var(--border); padding-top:16px;">
        <p class="text-soft mb-16">Tests anteriores — haz clic para ver el detalle</p>
        <div id="alumno-tests-anteriores"></div>
      </div>` : ''}`;

  if (anteriores.length) {
    const contenedorAnteriores = document.getElementById('alumno-tests-anteriores');
    anteriores.forEach(t => {
      const fecha = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(t.completadoAt));
      const fila = document.createElement('div');
      fila.className = 'panel mb-16';
      fila.style.cssText = 'padding:14px; cursor:pointer;';
      fila.innerHTML = `<strong>${fecha}</strong> <span class="text-soft" style="font-size:12px;">— clic para ver el detalle</span><div class="hidden" style="margin-top:12px;"></div>`;
      contenedorAnteriores.appendChild(fila);

      const detalleDiv = fila.querySelector('div');
      let expandido = false;
      fila.addEventListener('click', () => {
        expandido = !expandido;
        if (expandido && !detalleDiv.innerHTML) detalleDiv.innerHTML = renderDetalleCompletoTest(t);
        detalleDiv.classList.toggle('hidden', !expandido);
      });
    });
  }
}

document.querySelectorAll('.nav-item[data-nav="bitacora-alumno"]').forEach(item => {
  item.addEventListener('click', cargarBitacoraAlumnoCompleta);
});
document.querySelectorAll('.nav-item[data-nav="test-alumno"]').forEach(item => {
  item.addEventListener('click', cargarTestAlumnoCompleto);
});

/* ============================================================
   BOX Inteligente (alumno): tarjetas de mentor (foto + "Hacer
   Pregunta" + "Detalles Mentor"), límite de 3 preguntas por
   semana (máx. 1 por mentor), reseteo los lunes 00:00.
   ============================================================ */
function inicioSemanaActual() {
  const ahora = new Date();
  const dia = ahora.getDay();
  const diff = (dia === 0 ? -6 : 1) - dia;
  const lunes = new Date(ahora);
  lunes.setDate(ahora.getDate() + diff);
  lunes.setHours(0, 0, 0, 0);
  return lunes.getTime();
}

function renderRespuestaBox(respuesta) {
  if (!respuesta) return '<p class="text-soft" style="margin:6px 0 0;">Aún sin responder.</p>';
  let html = '<div style="margin-top:8px; padding:10px; background:#EFF6FF; border-radius:8px;">';
  if (respuesta.estadoRevision === 'intervenida') {
    html += '<p class="text-soft" style="margin:0 0 6px; font-size:11px; font-style:italic;">Respuesta complementaria de Mentor</p>';
  }
  if (respuesta.texto) html += `<p style="margin:4px 0; white-space:pre-wrap;">${linkify(respuesta.texto)}</p>`;
  if (respuesta.archivoUrl && respuesta.archivoTipo === 'audio') {
    html += `<audio controls src="${respuesta.archivoUrl}" style="width:100%; margin-top:4px;"></audio>`;
  } else if (respuesta.archivoUrl && respuesta.archivoTipo === 'imagen') {
    html += `<img src="${respuesta.archivoUrl}" alt="" style="max-width:220px; border-radius:8px; margin-top:4px; display:block;">`;
  }
  html += '</div>';
  return html;
}

function renderImagenesPregunta(imagenes, archivos) {
  const html = renderArchivosAdjuntos(archivos, imagenes);
  return html ? `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">${html}</div>` : '';
}

const TAMANO_MAXIMO_ARCHIVO = 10 * 1024 * 1024; // 10 MB

// Orden de mentores definido por el director (usuarios/{uid}/orden) —
// el que no tenga orden asignado todavía queda al final, por nombre.
function ordenarMentores(entries) {
  return entries.sort(([, a], [, b]) => {
    const oa = typeof a.orden === 'number' ? a.orden : 999;
    const ob = typeof b.orden === 'number' ? b.orden : 999;
    if (oa !== ob) return oa - ob;
    return (a.nombre || '').localeCompare(b.nombre || '', 'es');
  });
}

function tipoDeArchivo(file) {
  if (file.type.startsWith('image/')) return 'imagen';
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type.includes('word') || /\.docx?$/i.test(file.name)) return 'word';
  return 'otro';
}

// Sube imágenes, PDF o Word — devuelve [{url, nombre, tipo}], no solo la
// URL, para poder mostrar cada adjunto con su ícono/vista correcta
// después, y para que la Cloud Function sepa cómo leer cada uno.
async function subirArchivosPregunta(rutaBase, files) {
  const resultado = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const archivoRef = storageRef(storage, `${rutaBase}/${i}_${Date.now()}_${file.name}`);
    await uploadBytes(archivoRef, file);
    const url = await getDownloadURL(archivoRef);
    resultado.push({ url, nombre: file.name, tipo: tipoDeArchivo(file), mimeType: file.type });
  }
  return resultado;
}

// Compatible con datos viejos (imagenes: ["url", ...]) y nuevos
// (archivos: [{url, nombre, tipo}, ...]) — arma el HTML de vista previa
// para cualquiera de los dos formatos.
function renderArchivosAdjuntos(archivos, imagenesLegado) {
  const items = [];
  (archivos || []).forEach(a => items.push(a));
  (imagenesLegado || []).forEach(url => items.push({ url, nombre: 'Imagen', tipo: 'imagen' }));
  if (!items.length) return '';
  return items.map(a => {
    if (a.tipo === 'imagen') {
      return `<img src="${a.url}" alt="" style="max-width:140px; max-height:140px; border-radius:6px; margin:0 6px 6px 0; object-fit:cover;">`;
    }
    const icono = a.tipo === 'pdf' ? '📄' : a.tipo === 'word' ? '📝' : '📎';
    return `<a href="${a.url}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:6px; background:var(--color-surface-alt); padding:6px 12px; border-radius:8px; margin:0 6px 6px 0; font-size:12px; text-decoration:none; color:var(--color-ink);">${icono} ${a.nombre || 'Archivo'}</a>`;
  }).join('');
}

export async function cargarBoxAlumno() {
  if (!alumnoIdActual) return;

  // --- BEGIN usa un canal distinto: sin elegir mentor, sin IA,
  //     respuesta manual de "un mentor disponible". Ver más abajo
  //     cargarBoxBeginAlumno(). ---
  const alumnoSnapBox = await get(ref(db, `alumnos/${alumnoIdActual}`));
  const alumnoDatosBox = alumnoSnapBox.exists() ? alumnoSnapBox.val() : {};
  let programaBox = null;
  if (alumnoDatosBox.cicloActualId) {
    const cicloSnapBox = await get(ref(db, `ciclos/${alumnoDatosBox.cicloActualId}`));
    programaBox = cicloSnapBox.exists() ? (cicloSnapBox.val().programa || null) : null;
  }
  const contMentorIA = document.getElementById('box-alumno-mentor-ia-contenedor');
  const contBegin = document.getElementById('box-alumno-begin-contenedor');
  const contadorEl = document.getElementById('box-alumno-contador');
  const tituloEl = document.getElementById('box-alumno-titulo');
  const topbarTituloEl = document.getElementById('topbar-title');
  const navBoxEl = document.querySelector('.nav-item[data-nav="box-consultas"]');
  // Esta función se llama sola al iniciar sesión (para precargar datos),
  // no solo cuando el alumno de verdad está mirando esta sección — por
  // eso el título de arriba (topbar) solo se toca si esta vista es la
  // que realmente está visible en pantalla en este momento; si no, se
  // pisaría el título de la sección que sí se está viendo.
  const vistaBoxVisible = !document.getElementById('view-box-alumno').classList.contains('hidden');

  if (programaBox === 'begin') {
    if (contMentorIA) contMentorIA.classList.add('hidden');
    if (contBegin) contBegin.classList.remove('hidden');
    if (contadorEl) contadorEl.textContent = 'Tienes hasta 2 preguntas por semana';
    if (tituloEl) tituloEl.textContent = 'BOX de Consultas';
    if (topbarTituloEl && vistaBoxVisible) topbarTituloEl.textContent = 'BOX de Consultas';
    if (navBoxEl) navBoxEl.textContent = 'BOX de Consultas';
    await cargarBoxBeginAlumno();
    return;
  }
  if (contMentorIA) contMentorIA.classList.remove('hidden');
  if (contBegin) contBegin.classList.add('hidden');
  if (tituloEl) tituloEl.textContent = 'BOX Inteligente';
  if (topbarTituloEl && vistaBoxVisible) topbarTituloEl.textContent = 'BOX Inteligente';
  if (navBoxEl) navBoxEl.textContent = 'BOX Inteligente';

  const gridEl = document.getElementById('box-alumno-mentores-grid');
  const listadoEl = document.getElementById('box-alumno-listado');
  if (!gridEl || !listadoEl) return;

  const usuariosSnap = await get(ref(db, 'usuarios'));
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
  const mentores = ordenarMentores(Object.entries(usuarios).filter(([, u]) => {
    const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
    return !!roles.mentor;
  }));

  // --- Mis consultas + cálculo del límite semanal ---
  const indiceSnap = await get(ref(db, `boxIndice/${alumnoIdActual}`));
  const indice = indiceSnap.exists() ? indiceSnap.val() : {};
  const entradas = (await Promise.all(
    Object.entries(indice).map(async ([preguntaId, mentorId]) => {
      const snap = await get(ref(db, `box/${mentorId}/${preguntaId}`));
      return snap.exists() ? { ...snap.val(), preguntaId } : null;
    })
  )).filter(Boolean);

  const inicioSemana = inicioSemanaActual();
  const deEstaSemana = entradas.filter(e => e.createdAt >= inicioSemana);
  const mentoresPreguntadosEstaSemana = new Set(deEstaSemana.map(e => e.mentorId));

  if (contadorEl) contadorEl.textContent = 'Tienes 1 pregunta por cada Mentor IA por semana';

  // --- Tarjetas de mentor ---
  gridEl.innerHTML = mentores.length ? '' : '<p class="text-soft">No hay mentores disponibles por ahora.</p>';
  gridEl.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
  mentores.forEach(([uid, m]) => {
    const yaPreguntado = mentoresPreguntadosEstaSemana.has(uid);
    const bloqueado = yaPreguntado;
    const claseBotonPreguntar = bloqueado ? 'btn btn-hacer-pregunta' : 'btn btn--primary btn-hacer-pregunta';
    const estiloBotonPreguntar = bloqueado ? 'background:#9CA3AF; color:#fff; opacity:1;' : '';
    const atributosBotonPreguntar = bloqueado ? `disabled title="¡Ya le has preguntado a este Mentor!"` : '';
    const tarjeta = document.createElement('div');
    tarjeta.className = 'mentor-card-ia';
    tarjeta.style.cssText = 'display:flex; align-items:center; gap:14px; padding:14px 16px; background:var(--color-surface-alt); border-radius:var(--radius-md);';
    tarjeta.innerHTML = `
      <img src="${m.fotoIA || m.fotoUrl || PLACEHOLDER_FOTO_ALUMNO}" alt="" style="width:64px; height:64px; border-radius:50%; object-fit:cover; flex-shrink:0;">
      <div style="flex:1; min-width:0;">
        <p style="font-weight:700; margin:0 0 1px; font-size:16px;">${m.nombre || m.email}</p>
        <p class="text-soft" style="font-size:12.5px; font-style:italic; margin:0;">Mentor IA</p>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0;">
        <button type="button" class="${claseBotonPreguntar}" style="font-size:12px; padding:8px 14px; white-space:nowrap; ${estiloBotonPreguntar}" ${atributosBotonPreguntar}>Hacer Pregunta</button>
        <button type="button" class="btn btn-detalles-mentor" style="font-size:12px; padding:8px 14px; white-space:nowrap; background:#6B7280; color:#fff;">Detalles Mentor</button>
      </div>`;
    gridEl.appendChild(tarjeta);

    tarjeta.querySelector('.btn-hacer-pregunta').addEventListener('click', () => {
      document.getElementById('modal-detalle-mentor').classList.remove('is-visible');
      document.getElementById('box-alumno-form-panel').classList.remove('hidden');
      document.getElementById('box-alumno-mentor-nombre-form').textContent = `${m.nombre || m.email} (Mentor IA)`;
      document.getElementById('btn-enviar-pregunta-alumno').dataset.mentorId = uid;
      const temasMentor = Array.isArray(m.temasBox) ? m.temasBox : [];
      const selectTematicaPregunta = document.getElementById('box-alumno-pregunta-tematica');
      selectTematicaPregunta.innerHTML = temasMentor.length
        ? temasMentor.map(t => `<option value="${t}">${t}</option>`).join('')
        : '<option value="">Este mentor aún no agregó temáticas</option>';
      document.getElementById('box-alumno-form-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    tarjeta.querySelector('.btn-detalles-mentor').addEventListener('click', () => {
      document.getElementById('box-alumno-detalle-contenido').innerHTML = `
        <div style="display:flex; align-items:center; gap:14px; margin-bottom:12px;">
          <img src="${m.fotoIA || m.fotoUrl || PLACEHOLDER_FOTO_ALUMNO}" alt="" style="width:56px; height:56px; border-radius:50%; object-fit:cover;">
          <strong>${m.nombre || m.email}</strong>
        </div>
        <p style="white-space:pre-wrap;">${m.bio ? linkify(m.bio) : 'Este mentor aún no ha escrito su presentación.'}</p>`;
      document.getElementById('modal-detalle-mentor').classList.add('is-visible');
    });
  });

  // --- Mis consultas (historial, separadas y con respuesta destacada) ---
  const validas = entradas.slice().sort((a, b) => b.createdAt - a.createdAt);

  const filtroMentorBoxEl = document.getElementById('box-alumno-filtro-mentor');
  const filtroDesdeBoxEl = document.getElementById('box-alumno-filtro-desde');
  const filtroHastaBoxEl = document.getElementById('box-alumno-filtro-hasta');
  if (filtroMentorBoxEl && !filtroMentorBoxEl.dataset.cargado) {
    const mentoresConConsultas = [...new Map(validas.map(e => [e.mentorId, usuarios[e.mentorId] ? (usuarios[e.mentorId].nombre || usuarios[e.mentorId].email) : 'Mentor'])).entries()];
    filtroMentorBoxEl.innerHTML = '<option value="">Todos</option>' + mentoresConConsultas.map(([uid, nombre]) => `<option value="${uid}">${nombre}</option>`).join('');
    filtroMentorBoxEl.dataset.cargado = '1';
  }

  const LIMITE_INICIAL = 3;
  let mostrarTodas = false;

  function renderMisConsultas() {
    const fMentor = filtroMentorBoxEl ? filtroMentorBoxEl.value : '';
    const fDesde = filtroDesdeBoxEl && filtroDesdeBoxEl.value ? new Date(filtroDesdeBoxEl.value + 'T00:00:00').getTime() : null;
    const fHasta = filtroHastaBoxEl && filtroHastaBoxEl.value ? new Date(filtroHastaBoxEl.value + 'T23:59:59').getTime() : null;

    const filtradas = validas.filter(e =>
      (!fMentor || e.mentorId === fMentor) &&
      (!fDesde || e.createdAt >= fDesde) &&
      (!fHasta || e.createdAt <= fHasta)
    );
    const visibles = mostrarTodas ? filtradas : filtradas.slice(0, LIMITE_INICIAL);

    listadoEl.innerHTML = (visibles.length
      ? visibles.map(e => {
          const mentorNombre = usuarios[e.mentorId] ? (usuarios[e.mentorId].nombre || usuarios[e.mentorId].email) : 'Mentor';
          return `
            <div class="panel mb-16" style="padding:14px; cursor:pointer;" data-fila-consulta>
              <div class="flex-between">
                <strong>Para ${mentorNombre}</strong>
                <div style="display:flex; align-items:center; gap:8px;">
                  ${!e.respuesta ? `<button type="button" class="btn btn--ghost btn-eliminar-pregunta" data-pregunta-id="${e.preguntaId}" data-mentor-id="${e.mentorId}" style="font-size:11px; padding:2px 8px;">Eliminar</button>` : ''}
                  <span class="text-soft" style="font-size:16px;" data-flecha-consulta>▾</span>
                </div>
              </div>
              <span class="text-soft" style="font-size:12px;">${formatFecha(new Date(e.createdAt).toISOString().slice(0, 10))}</span>
              <p style="margin:6px 0;">${linkify(e.pregunta)}</p>
              <div class="hidden" data-detalle-consulta>
                ${renderImagenesPregunta(e.imagenes, e.archivos)}
                ${renderRespuestaBox(e.respuesta)}
              </div>
            </div>`;
        }).join('')
      : '<p class="text-soft">Aún no has enviado ninguna consulta con ese filtro.</p>');

    listadoEl.querySelectorAll('[data-fila-consulta]').forEach(fila => {
      fila.addEventListener('click', (ev) => {
        if (ev.target.closest('.btn-eliminar-pregunta') || ev.target.closest('a')) return;
        const detalle = fila.querySelector('[data-detalle-consulta]');
        const flecha = fila.querySelector('[data-flecha-consulta]');
        const ahoraOculto = detalle.classList.toggle('hidden');
        flecha.textContent = ahoraOculto ? '▾' : '▴';
      });
    });

    if (!mostrarTodas && filtradas.length > LIMITE_INICIAL) {
      listadoEl.innerHTML += `<button type="button" class="btn btn--ghost" id="btn-ver-todas-consultas">Ver todas (${filtradas.length})</button>`;
      document.getElementById('btn-ver-todas-consultas').addEventListener('click', () => { mostrarTodas = true; renderMisConsultas(); });
    }

    listadoEl.querySelectorAll('.btn-eliminar-pregunta').forEach(btn => {
      btn.addEventListener('click', async () => {
        const confirmado = confirm('¿Eliminar esta pregunta? Recuperas el cupo de esta semana.');
        if (!confirmado) return;
        btn.disabled = true;
        try {
          await update(ref(db), {
            [`box/${btn.dataset.mentorId}/${btn.dataset.preguntaId}`]: null,
            [`boxIndice/${alumnoIdActual}/${btn.dataset.preguntaId}`]: null
          });
          await cargarBoxAlumno();
        } catch (err) {
          alert('No se pudo eliminar. Intenta de nuevo.');
          btn.disabled = false;
        }
      });
    });
  }

  renderMisConsultas();
  if (filtroMentorBoxEl) filtroMentorBoxEl.onchange = renderMisConsultas;
  if (filtroDesdeBoxEl) filtroDesdeBoxEl.onchange = renderMisConsultas;
  if (filtroHastaBoxEl) filtroHastaBoxEl.onchange = renderMisConsultas;
}

const btnCerrarFormPregunta = document.getElementById('btn-cerrar-form-pregunta');
if (btnCerrarFormPregunta) btnCerrarFormPregunta.addEventListener('click', () => document.getElementById('box-alumno-form-panel').classList.add('hidden'));

const modalDetalleMentor = document.getElementById('modal-detalle-mentor');
const btnCerrarDetalleMentor = document.getElementById('btn-cerrar-detalle-mentor');
if (btnCerrarDetalleMentor) btnCerrarDetalleMentor.addEventListener('click', () => modalDetalleMentor.classList.remove('is-visible'));
if (modalDetalleMentor) {
  modalDetalleMentor.addEventListener('click', (ev) => {
    if (ev.target === modalDetalleMentor) modalDetalleMentor.classList.remove('is-visible'); // clic afuera de la tarjeta
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') modalDetalleMentor.classList.remove('is-visible');
  });
}

let imagenesSeleccionadasPregunta = [];
const btnAdjuntarImagenesPregunta = document.getElementById('btn-adjuntar-imagenes-pregunta');
const inputImagenesPregunta = document.getElementById('input-imagenes-pregunta');
if (btnAdjuntarImagenesPregunta && inputImagenesPregunta) {
  btnAdjuntarImagenesPregunta.addEventListener('click', () => inputImagenesPregunta.click());
  inputImagenesPregunta.addEventListener('change', () => {
    const seleccionados = Array.from(inputImagenesPregunta.files);
    const muyPesados = seleccionados.filter(f => f.size > TAMANO_MAXIMO_ARCHIVO);
    if (muyPesados.length) {
      alert(`Estos archivos pesan más de 10MB y no se pueden adjuntar: ${muyPesados.map(f => f.name).join(', ')}`);
      inputImagenesPregunta.value = '';
      return;
    }
    imagenesSeleccionadasPregunta = seleccionados;
    const previewEl = document.getElementById('box-alumno-imagenes-preview');
    previewEl.innerHTML = imagenesSeleccionadasPregunta
      .map(f => `<span class="text-soft" style="font-size:11px; background:#F0F1F3; padding:3px 8px; border-radius:6px;">${tipoDeArchivo(f) === 'imagen' ? '🖼️' : tipoDeArchivo(f) === 'pdf' ? '📄' : '📝'} ${f.name}</span>`)
      .join('');
  });
}

const btnEnviarPreguntaAlumno = document.getElementById('btn-enviar-pregunta-alumno');
if (btnEnviarPreguntaAlumno) {
  btnEnviarPreguntaAlumno.addEventListener('click', async () => {
    const errorEl = document.getElementById('box-alumno-error');
    errorEl.classList.add('hidden');
    const mentorId = btnEnviarPreguntaAlumno.dataset.mentorId;
    const pregunta = document.getElementById('box-alumno-pregunta').value.trim();
    const tematica = document.getElementById('box-alumno-pregunta-tematica').value;

    if (!tematica) {
      errorEl.textContent = 'Elige una temática para tu pregunta.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!mentorId || (!pregunta && !imagenesSeleccionadasPregunta.length) || !alumnoIdActual) {
      errorEl.textContent = 'Escribe tu pregunta o adjunta al menos un archivo.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnEnviarPreguntaAlumno.disabled = true;
    try {
      const preguntaId = push(ref(db, `box/${mentorId}`)).key;
      const alumnoSnap = await get(ref(db, `alumnos/${alumnoIdActual}`));
      const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
      const nombreAlumno = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim();

      const archivos = imagenesSeleccionadasPregunta.length
        ? await subirArchivosPregunta(`box-preguntas/${mentorId}/${preguntaId}`, imagenesSeleccionadasPregunta)
        : [];

      await update(ref(db), {
        [`box/${mentorId}/${preguntaId}`]: { alumnoId: alumnoIdActual, alumnoNombre: nombreAlumno, mentorId, pregunta, tematica, archivos, createdAt: Date.now(), respuesta: null },
        [`boxIndice/${alumnoIdActual}/${preguntaId}`]: mentorId
      });

      document.getElementById('box-alumno-pregunta').value = '';
      document.getElementById('box-alumno-imagenes-preview').innerHTML = '';
      inputImagenesPregunta.value = '';
      imagenesSeleccionadasPregunta = [];
      document.getElementById('box-alumno-form-panel').classList.add('hidden');
      await cargarBoxAlumno();
    } catch (err) {
      errorEl.textContent = 'No se pudo enviar. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
    } finally {
      btnEnviarPreguntaAlumno.disabled = false;
    }
  });
}

document.querySelectorAll('.nav-item[data-nav="box-consultas"]').forEach(item => {
  item.addEventListener('click', cargarBoxAlumno);
});

const btnActualizarMisConsultas = document.getElementById('btn-actualizar-mis-consultas');
if (btnActualizarMisConsultas) {
  btnActualizarMisConsultas.addEventListener('click', async () => {
    btnActualizarMisConsultas.disabled = true;
    const textoOriginal = btnActualizarMisConsultas.textContent;
    btnActualizarMisConsultas.textContent = 'Actualizando...';
    try {
      await cargarBoxAlumno();
    } finally {
      const btnDeNuevo = document.getElementById('btn-actualizar-mis-consultas');
      if (btnDeNuevo) {
        btnDeNuevo.disabled = false;
        btnDeNuevo.textContent = textoOriginal;
      }
    }
  });
}

/* ============================================================
   BOX — ALUMNO BEGIN: canal único de preguntas por temática,
   sin elegir mentor, respondidas a mano por "un Mentor disponible".
   Límite: 2 preguntas por semana (total, no por mentor).
   ============================================================ */
async function cargarBoxBeginAlumno() {
  const listadoEl = document.getElementById('box-begin-listado');
  const selectTematica = document.getElementById('box-begin-tematica');
  if (!listadoEl || !selectTematica || !alumnoIdActual) return;

  // BEGIN no tiene un mentor específico asignado a la pregunta — la
  // lista de temáticas es la suma de las de TODOS los mentores (con
  // "Otra" siempre al final para lo que no calce en ninguna).
  const usuariosSnapTemas = await get(ref(db, 'usuarios'));
  const usuariosTemas = usuariosSnapTemas.exists() ? usuariosSnapTemas.val() : {};
  const todasLasTematicas = new Set();
  Object.values(usuariosTemas).forEach(u => {
    const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
    if (roles.mentor && Array.isArray(u.temasBox)) {
      u.temasBox.forEach(t => todasLasTematicas.add(t));
    }
  });
  const tematicas = [...todasLasTematicas].sort((a, b) => a.localeCompare(b, 'es'));
  tematicas.push('Otra');
  const valorPrevio = selectTematica.value;
  selectTematica.innerHTML = tematicas.map(t => `<option value="${t}">${t}</option>`).join('');
  if (valorPrevio && tematicas.includes(valorPrevio)) selectTematica.value = valorPrevio;

  const campoOtra = document.getElementById('box-begin-tematica-otra-campo');
  const actualizarCampoOtra = () => { if (campoOtra) campoOtra.classList.toggle('hidden', selectTematica.value !== 'Otra'); };
  selectTematica.onchange = actualizarCampoOtra;
  actualizarCampoOtra();

  const boxBeginSnap = await get(ref(db, 'boxBegin'));
  const todas = boxBeginSnap.exists() ? Object.entries(boxBeginSnap.val()) : [];
  const propias = todas.filter(([, p]) => p.alumnoId === alumnoIdActual).sort((a, b) => b[1].createdAt - a[1].createdAt);

  const inicioSemana = inicioSemanaActual();
  const estaSemana = propias.filter(([, p]) => p.createdAt >= inicioSemana);
  const puedePreguntar = estaSemana.length < 2;

  const btnEnviar = document.getElementById('btn-enviar-pregunta-box-begin');
  if (btnEnviar) {
    btnEnviar.disabled = !puedePreguntar;
    btnEnviar.title = puedePreguntar ? '' : 'Ya usaste tus 2 preguntas de esta semana — vuelve la próxima semana.';
  }

  listadoEl.innerHTML = propias.length
    ? propias.map(([, p]) => `
        <div class="panel mb-16" style="padding:14px;">
          <span class="badge badge--activo" style="font-size:10px;">${p.tematica || 'Sin temática'}</span>
          <p style="margin:8px 0 0;">${linkify(p.pregunta || '')}</p>
          ${renderImagenesPregunta(p.imagenes, p.archivos)}
          ${p.respuesta
            ? `<div style="margin-top:10px; padding:10px; background:#F7F8FA; border-radius:8px;">
                 <strong style="font-size:12px;">Respuesta${p.respuesta.mentorNombre ? ` de ${p.respuesta.mentorNombre}` : ''}</strong>
                 <p style="margin:4px 0 0; white-space:pre-wrap;">${linkify(p.respuesta.texto || '')}</p>
               </div>`
            : '<p class="text-soft" style="margin-top:8px; font-size:12px;">Aún sin responder — puede tardar hasta 3 días hábiles.</p>'}
        </div>`).join('')
    : '<p class="text-soft">Todavía no has enviado ninguna pregunta.</p>';
}

let imagenesSelBoxBegin = [];
const btnAdjuntarBoxBegin = document.getElementById('btn-adjuntar-imagenes-box-begin');
const inputImagenesBoxBegin = document.getElementById('input-imagenes-box-begin');
if (btnAdjuntarBoxBegin && inputImagenesBoxBegin) {
  btnAdjuntarBoxBegin.addEventListener('click', () => inputImagenesBoxBegin.click());
  inputImagenesBoxBegin.addEventListener('change', () => {
    const seleccionados = Array.from(inputImagenesBoxBegin.files);
    const muyPesados = seleccionados.filter(f => f.size > TAMANO_MAXIMO_ARCHIVO);
    if (muyPesados.length) {
      alert(`Estos archivos pesan más de 10MB: ${muyPesados.map(f => f.name).join(', ')}`);
      inputImagenesBoxBegin.value = '';
      return;
    }
    imagenesSelBoxBegin = seleccionados;
    document.getElementById('box-begin-imagenes-preview').innerHTML = imagenesSelBoxBegin
      .map(f => `<span class="text-soft" style="font-size:11px; background:#F0F1F3; padding:3px 8px; border-radius:6px;">${tipoDeArchivo(f) === 'imagen' ? '🖼️' : tipoDeArchivo(f) === 'pdf' ? '📄' : '📝'} ${f.name}</span>`).join('');
  });
}

const btnEnviarBoxBegin = document.getElementById('btn-enviar-pregunta-box-begin');
if (btnEnviarBoxBegin) {
  btnEnviarBoxBegin.addEventListener('click', async () => {
    const errorEl = document.getElementById('box-begin-error');
    errorEl.classList.add('hidden');

    const selectTematica = document.getElementById('box-begin-tematica');
    let tematica = selectTematica.value;
    if (tematica === 'Otra') {
      const libre = document.getElementById('box-begin-tematica-otra-texto').value.trim();
      if (!libre) {
        errorEl.textContent = 'Escribe de qué se trata tu temática.';
        errorEl.classList.remove('hidden');
        return;
      }
      tematica = `Otra: ${libre}`;
    }

    const pregunta = document.getElementById('box-begin-pregunta').value.trim();
    if (!pregunta && !imagenesSelBoxBegin.length) {
      errorEl.textContent = 'Escribe tu pregunta o adjunta una imagen.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnEnviarBoxBegin.disabled = true;
    try {
      const preguntaId = push(ref(db, 'boxBegin')).key;
      const alumnoSnap = await get(ref(db, `alumnos/${alumnoIdActual}`));
      const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
      const nombreAlumno = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim();
      const archivos = imagenesSelBoxBegin.length
        ? await subirArchivosPregunta(`box-begin/${preguntaId}`, imagenesSelBoxBegin)
        : [];
      await set(ref(db, `boxBegin/${preguntaId}`), {
        alumnoId: alumnoIdActual, alumnoNombre: nombreAlumno, tematica, pregunta, archivos, createdAt: Date.now()
      });

      document.getElementById('box-begin-pregunta').value = '';
      document.getElementById('box-begin-imagenes-preview').innerHTML = '';
      inputImagenesBoxBegin.value = '';
      imagenesSelBoxBegin = [];
      const campoOtraReset = document.getElementById('box-begin-tematica-otra-campo');
      const inputOtraReset = document.getElementById('box-begin-tematica-otra-texto');
      if (campoOtraReset) campoOtraReset.classList.add('hidden');
      if (inputOtraReset) inputOtraReset.value = '';

      await cargarBoxBeginAlumno();
    } catch (err) {
      errorEl.textContent = 'No se pudo enviar. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
    } finally {
      btnEnviarBoxBegin.disabled = false;
    }
  });
}

const btnActualizarBoxBegin = document.getElementById('btn-actualizar-box-begin');
if (btnActualizarBoxBegin) {
  btnActualizarBoxBegin.addEventListener('click', async () => {
    btnActualizarBoxBegin.disabled = true;
    try {
      await cargarBoxBeginAlumno();
    } finally {
      btnActualizarBoxBegin.disabled = false;
    }
  });
}

/* ============================================================
   Preguntas de la Comunidad: todo lo respondido, de todos los
   mentores, filtrable por mentor y por temática.
   ============================================================ */
export async function cargarPreguntasComunidad() {
  const listadoEl = document.getElementById('comunidad-listado');
  const filtroMentorEl = document.getElementById('comunidad-filtro-mentor');
  const filtroTemaEl = document.getElementById('comunidad-filtro-tema');
  const filtroDesdeEl = document.getElementById('comunidad-filtro-desde');
  const filtroHastaEl = document.getElementById('comunidad-filtro-hasta');
  if (!listadoEl) return;

  const usuariosSnap = await get(ref(db, 'usuarios'));
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
  const mentores = ordenarMentores(Object.entries(usuarios).filter(([, u]) => {
    const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
    return !!roles.mentor;
  }));

  if (filtroMentorEl && !filtroMentorEl.dataset.cargado) {
    filtroMentorEl.innerHTML = '<option value="">Todos</option>' + mentores.map(([uid, m]) => `<option value="${uid}">${m.nombre || m.email}</option>`).join('');
    filtroMentorEl.dataset.cargado = '1';
  }

  const todasSnaps = await Promise.all(mentores.map(([uid]) => get(ref(db, `box/${uid}`))));
  let todas = [];
  todasSnaps.forEach((snap, idx) => {
    if (!snap.exists()) return;
    const [mentorUid] = mentores[idx];
    Object.values(snap.val()).forEach(p => { if (p.respuesta) todas.push(p); });
  });
  todas.sort((a, b) => b.createdAt - a.createdAt); // más reciente primero

  // Las temáticas ya no son una lista fija — se arma con las que
  // realmente aparecen en las preguntas ya hechas.
  if (filtroTemaEl) {
    const valorPrevioTema = filtroTemaEl.value;
    const tematicasPresentes = [...new Set(todas.map(p => p.tematica).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    filtroTemaEl.innerHTML = '<option value="">Todas</option>' + tematicasPresentes.map(t => `<option value="${t}">${t}</option>`).join('');
    if (valorPrevioTema && tematicasPresentes.includes(valorPrevioTema)) filtroTemaEl.value = valorPrevioTema;
  }

  const PAGE_SIZE = 10;
  let cantidadVisible = PAGE_SIZE;

  function render() {
    const filtroMentor = filtroMentorEl ? filtroMentorEl.value : '';
    const filtroTema = filtroTemaEl ? filtroTemaEl.value : '';
    const fDesde = filtroDesdeEl && filtroDesdeEl.value ? new Date(filtroDesdeEl.value + 'T00:00:00').getTime() : null;
    const fHasta = filtroHastaEl && filtroHastaEl.value ? new Date(filtroHastaEl.value + 'T23:59:59').getTime() : null;

    const filtradas = todas.filter(p =>
      (!filtroMentor || p.mentorId === filtroMentor) &&
      (!filtroTema || p.tematica === filtroTema) &&
      (!fDesde || p.createdAt >= fDesde) &&
      (!fHasta || p.createdAt <= fHasta)
    );

    const visibles = filtradas.slice(0, cantidadVisible);

    listadoEl.innerHTML = (visibles.length
      ? visibles.map(p => {
          const mentorNombre = usuarios[p.mentorId] ? (usuarios[p.mentorId].nombre || usuarios[p.mentorId].email) : 'Mentor';
          return `
            <div class="panel mb-16" style="padding:14px; cursor:pointer;" data-fila-comunidad>
              <div class="flex-between">
                <span class="badge badge--activo" style="font-size:10px;">${p.tematica || 'Sin tema'}</span>
                <span class="text-soft" style="font-size:16px;" data-flecha-comunidad>▾</span>
              </div>
              <p class="text-soft" style="font-size:12px; margin:6px 0 2px;">Pregunta para ${mentorNombre} — ${formatFecha(new Date(p.createdAt).toISOString().slice(0, 10))}</p>
              <p style="margin:4px 0;">${linkify(p.pregunta)}</p>
              <div class="hidden" data-detalle-comunidad>
                ${renderImagenesPregunta(p.imagenes, p.archivos)}
                ${renderRespuestaBox(p.respuesta)}
              </div>
            </div>`;
        }).join('')
      : '<p class="text-soft">No hay preguntas respondidas con ese filtro todavía.</p>');

    listadoEl.querySelectorAll('[data-fila-comunidad]').forEach(fila => {
      fila.addEventListener('click', (ev) => {
        if (ev.target.closest('a')) return;
        const detalle = fila.querySelector('[data-detalle-comunidad]');
        const flecha = fila.querySelector('[data-flecha-comunidad]');
        const ahoraOculto = detalle.classList.toggle('hidden');
        flecha.textContent = ahoraOculto ? '▾' : '▴';
      });
    });

    if (filtradas.length > cantidadVisible) {
      listadoEl.innerHTML += `<button type="button" class="btn btn--ghost" id="btn-ver-mas-comunidad">Ver 10 más (${filtradas.length - cantidadVisible} restantes)</button>`;
      document.getElementById('btn-ver-mas-comunidad').addEventListener('click', () => {
        cantidadVisible += PAGE_SIZE;
        render();
      });
    }
  }

  function resetYRender() {
    cantidadVisible = PAGE_SIZE;
    render();
  }

  resetYRender();
  if (filtroMentorEl) filtroMentorEl.onchange = resetYRender;
  if (filtroTemaEl) filtroTemaEl.onchange = resetYRender;
  if (filtroDesdeEl) filtroDesdeEl.onchange = resetYRender;
  if (filtroHastaEl) filtroHastaEl.onchange = resetYRender;
}

document.querySelectorAll('.nav-item[data-nav="preguntas-comunidad"]').forEach(item => {
  item.addEventListener('click', cargarPreguntasComunidad);
});

/* ============================================================
   Soporte Alumnos: correo, WhatsApp de soporte, y el formulario
   embebido que el director pega en Configuración.
   ============================================================ */
export async function cargarSoporteAlumnos() {
  const contactoEl = document.getElementById('soporte-alumnos-contacto');
  const embedEl = document.getElementById('soporte-alumnos-form-embed');
  if (!contactoEl) return;

  const configSnap = await get(ref(db, 'configuracion/general'));
  const config = configSnap.exists() ? configSnap.val() : {};
  const whatsappSoporteUrl = config.whatsappSoporte ? `https://wa.me/${config.whatsappSoporte.replace(/[^0-9]/g, '')}` : '';

  contactoEl.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:center;">
      ${config.correoSoporte ? `<span>Correo: <strong>${config.correoSoporte}</strong></span>` : '<span class="text-soft">El correo de soporte aún no está configurado.</span>'}
      ${whatsappSoporteUrl ? `<a href="${whatsappSoporteUrl}" target="_blank" rel="noopener" class="btn" style="background:#25D366; color:#fff;">💬 WhatsApp Soporte</a>` : ''}
    </div>`;

  if (embedEl) {
    embedEl.innerHTML = config.formSoporteEmbed || '<p class="text-soft">El formulario de contacto aún no está configurado.</p>';
  }
}

document.querySelectorAll('.nav-item[data-nav="soporte-alumnos"]').forEach(item => {
  item.addEventListener('click', cargarSoporteAlumnos);
});

/* ============================================================
   Preguntas en Vivo: lista las próximas sesiones en vivo de
   todos los mentores. El botón "Enviar Pregunta" se bloquea
   automáticamente 12h antes del inicio; la sesión desaparece
   1h después de haber comenzado. Cuenta regresiva en vivo.
   ============================================================ */
function formatearDuracion(ms) {
  const totalSegundos = Math.max(0, Math.floor(ms / 1000));
  const dias = Math.floor(totalSegundos / 86400);
  const horas = Math.floor((totalSegundos % 86400) / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);
  const segundos = totalSegundos % 60;
  if (dias > 0) return `${dias}d ${horas}h ${minutos}m`;
  return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
}

let intervaloPreguntasVivo = null;

// Sesiones de mentor van en /preguntasVivo, sesiones grupales de un
// coach de cabecera (BEGIN) van en /preguntasVivoBegin — mismo shape,
// distinta raíz según s.tipo.
function rutaPreguntas(s) {
  return s.tipo === 'coach' ? 'preguntasVivoBegin' : 'preguntasVivo';
}

/* --- Horarios multi-zona (mismo patrón que mentores.js/dashboard-coach.js):
       la hora Chile siempre visible, además de la del propio alumno cuando
       está en otra zona. Solo aplica a sesiones nuevas (con inicioTimestamp);
       las viejas se siguen mostrando tal cual, como siempre. --- */
function zonaHorariaLocal() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
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
function formatearHorarioSesion(timestampMs) {
  const fechaObj = new Date(timestampMs);
  const soloHora = (zona) => new Intl.DateTimeFormat('es-CL', { timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: false }).format(fechaObj);
  const zonaViewer = zonaHorariaLocal();
  if (zonaViewer === 'America/Santiago') return `${soloHora(zonaViewer)} 🇨🇱`;
  return `${soloHora(zonaViewer)} ${banderaDeZona(zonaViewer)} tu hora · ${soloHora('America/Santiago')} 🇨🇱 hora Chile`;
}

async function cargarMisPreguntasVivo(card, s) {
  const cont = card.querySelector('.pv-mis-preguntas');
  if (!cont) return;
  const snap = await get(ref(db, `${rutaPreguntas(s)}/${s.mentorUid}/${s.mentoriaId}`));
  if (!snap.exists()) { cont.innerHTML = ''; return; }
  const propias = Object.entries(snap.val()).filter(([, p]) => p.alumnoId === alumnoIdActual);

  if (!propias.length) { cont.innerHTML = ''; return; }

  cont.innerHTML = '<strong style="font-size:12px; display:block; margin-bottom:6px;">Tus preguntas para esta sesión:</strong>' +
    propias.map(([preguntaId, p]) => `
      <div class="pv-pregunta-propia" data-pregunta-id="${preguntaId}" style="margin-top:8px; font-size:13px; padding:8px; background:#fff; border-radius:8px;">
        <p class="pv-pregunta-propia-texto" style="margin:0;">${linkify(p.texto || '')}</p>
        ${renderImagenesPregunta(p.imagenes, p.archivos)}
        ${p.revisada
          ? '<p class="text-soft" style="margin:6px 0 0; font-size:11px;">✓ El Mentor ya ha revisado tu pregunta.</p>'
          : `<button type="button" class="btn btn--ghost btn-editar-pregunta-vivo" style="font-size:11px; padding:3px 8px; margin-top:6px;">Editar</button>`}
      </div>`).join('');

  cont.querySelectorAll('.btn-editar-pregunta-vivo').forEach(btn => {
    btn.addEventListener('click', () => {
      const bloque = btn.closest('.pv-pregunta-propia');
      const preguntaId = bloque.dataset.preguntaId;
      const [, datosPregunta] = propias.find(([id]) => id === preguntaId);
      const textoActual = datosPregunta.texto || '';
      let imagenesActuales = [...(datosPregunta.imagenes || [])];
      let imagenesNuevas = [];

      function renderEdicion() {
        bloque.innerHTML = `
          <textarea class="pv-editar-texto">${textoActual}</textarea>
          <div class="pv-editar-imagenes-actuales" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;"></div>
          <button type="button" class="btn btn--ghost btn-adjuntar-editar-vivo" style="font-size:11px; padding:3px 8px; margin-top:8px;">🖼️ Adjuntar más Imágenes</button>
          <input type="file" class="pv-input-editar-imagenes hidden" accept="image/*" multiple>
          <div class="pv-editar-imagenes-nuevas" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;"></div>
          <div style="margin-top:10px; display:flex; gap:8px;">
            <button type="button" class="btn btn--primary btn-guardar-edicion-vivo" style="font-size:11px; padding:3px 10px;">Guardar</button>
            <button type="button" class="btn btn--ghost btn-cancelar-edicion-vivo" style="font-size:11px; padding:3px 10px;">Cancelar</button>
          </div>`;
        bloque.querySelector('.pv-editar-texto').value = textoActual;

        const contActuales = bloque.querySelector('.pv-editar-imagenes-actuales');
        contActuales.innerHTML = imagenesActuales.map((url, idx) => `
          <div style="position:relative;">
            <img src="${url}" alt="" style="width:60px; height:60px; object-fit:cover; border-radius:6px;">
            <button type="button" class="btn-quitar-imagen-actual" data-idx="${idx}" style="position:absolute; top:-6px; right:-6px; background:#C0392B; color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:11px; cursor:pointer; line-height:1;">✕</button>
          </div>`).join('');
        contActuales.querySelectorAll('.btn-quitar-imagen-actual').forEach(x => {
          x.addEventListener('click', () => {
            imagenesActuales.splice(Number(x.dataset.idx), 1);
            renderEdicion();
          });
        });

        const contNuevas = bloque.querySelector('.pv-editar-imagenes-nuevas');
        contNuevas.innerHTML = imagenesNuevas.map(f => `<span class="text-soft" style="font-size:11px; background:#F0F1F3; padding:3px 8px; border-radius:6px;">${tipoDeArchivo(f) === 'imagen' ? '🖼️' : tipoDeArchivo(f) === 'pdf' ? '📄' : '📝'} ${f.name}</span>`).join('');

        const btnAdjuntar = bloque.querySelector('.btn-adjuntar-editar-vivo');
        const inputAdjuntar = bloque.querySelector('.pv-input-editar-imagenes');
        btnAdjuntar.addEventListener('click', () => inputAdjuntar.click());
        inputAdjuntar.addEventListener('change', () => {
          const nuevos = Array.from(inputAdjuntar.files);
          const muyPesados = nuevos.filter(f => f.size > TAMANO_MAXIMO_ARCHIVO);
          if (muyPesados.length) {
            alert(`Estos archivos pesan más de 10MB: ${muyPesados.map(f => f.name).join(', ')}`);
            return;
          }
          imagenesNuevas = imagenesNuevas.concat(nuevos);
          renderEdicion();
        });

        bloque.querySelector('.btn-cancelar-edicion-vivo').addEventListener('click', () => cargarMisPreguntasVivo(card, s));
        bloque.querySelector('.btn-guardar-edicion-vivo').addEventListener('click', async (ev) => {
          const nuevoTexto = bloque.querySelector('.pv-editar-texto').value.trim();
          if (!nuevoTexto && !imagenesActuales.length && !imagenesNuevas.length) {
            alert('La pregunta no puede quedar vacía.');
            return;
          }
          ev.target.disabled = true;
          try {
            const archivosNuevos = imagenesNuevas.length
              ? await subirArchivosPregunta(`preguntas-vivo/${s.mentorUid}/${s.mentoriaId}/${preguntaId}`, imagenesNuevas)
              : [];
            await update(ref(db, `${rutaPreguntas(s)}/${s.mentorUid}/${s.mentoriaId}/${preguntaId}`), {
              texto: nuevoTexto,
              imagenes: imagenesActuales,
              archivos: [...(datosPregunta.archivos || []), ...archivosNuevos]
            });
            await cargarMisPreguntasVivo(card, s);
          } catch (err) {
            alert('No se pudo guardar — puede que el mentor ya haya revisado tu pregunta.');
            await cargarMisPreguntasVivo(card, s);
          }
        });
      }

      renderEdicion();
    });
  });
}

function bindSesionVivo(card, s) {
  let imagenesSel = [];
  const btnPreguntar = card.querySelector('.pv-btn-preguntar');
  const formPanel = card.querySelector('.pv-form-panel');
  btnPreguntar.addEventListener('click', () => { if (!btnPreguntar.disabled) formPanel.classList.toggle('hidden'); });

  const btnAdjuntar = card.querySelector('.pv-btn-adjuntar');
  const inputImagenes = card.querySelector('.pv-input-imagenes');
  btnAdjuntar.addEventListener('click', () => inputImagenes.click());
  inputImagenes.addEventListener('change', () => {
    const seleccionados = Array.from(inputImagenes.files);
    const muyPesados = seleccionados.filter(f => f.size > TAMANO_MAXIMO_ARCHIVO);
    if (muyPesados.length) {
      alert(`Estos archivos pesan más de 10MB y no se pueden adjuntar: ${muyPesados.map(f => f.name).join(', ')}`);
      inputImagenes.value = '';
      return;
    }
    imagenesSel = seleccionados;
    card.querySelector('.pv-imagenes-preview').innerHTML = imagenesSel
      .map(f => `<span class="text-soft" style="font-size:11px; background:#F0F1F3; padding:3px 8px; border-radius:6px;">${tipoDeArchivo(f) === 'imagen' ? '🖼️' : tipoDeArchivo(f) === 'pdf' ? '📄' : '📝'} ${f.name}</span>`).join('');
  });

  card.querySelector('.pv-btn-enviar').addEventListener('click', async (ev) => {
    const btn = ev.target;
    const texto = card.querySelector('.pv-pregunta-texto').value.trim();
    if (!texto && !imagenesSel.length) { alert('Escribe tu pregunta o adjunta un archivo.'); return; }
    btn.disabled = true;
    try {
      const preguntaId = push(ref(db, `${rutaPreguntas(s)}/${s.mentorUid}/${s.mentoriaId}`)).key;
      const alumnoSnap = await get(ref(db, `alumnos/${alumnoIdActual}`));
      const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
      const nombreAlumno = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim();
      const archivos = imagenesSel.length
        ? await subirArchivosPregunta(`preguntas-vivo/${s.mentorUid}/${s.mentoriaId}/${preguntaId}`, imagenesSel)
        : [];
      await set(ref(db, `${rutaPreguntas(s)}/${s.mentorUid}/${s.mentoriaId}/${preguntaId}`), {
        alumnoId: alumnoIdActual, alumnoNombre: nombreAlumno, texto, archivos, createdAt: Date.now()
      });
      card.querySelector('.pv-pregunta-texto').value = '';
      card.querySelector('.pv-imagenes-preview').innerHTML = '';
      inputImagenes.value = '';
      imagenesSel = [];
      formPanel.classList.add('hidden');
      await cargarMisPreguntasVivo(card, s);
    } catch (err) {
      alert('No se pudo enviar. Intenta de nuevo.');
    } finally {
      btn.disabled = false;
    }
  });

  cargarMisPreguntasVivo(card, s);
}

// Franja informativa arriba de "Preguntas en Vivo": día/hora recurrente
// de cada mentor que lo tenga configurado (independiente de las
// sesiones puntuales agendadas). El que no lo tenga, no aparece.
const DIAS_ORDEN_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
function capitalizar(texto) {
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}

// Convierte año/mes/día/hora/minuto, interpretados EN UNA ZONA
// ESPECÍFICA, al instante UTC exacto que representan — es lo
// contrario de "formatear un instante en una zona", que es lo que
// ya hacíamos en fechaHoraChileDesdeInstante. JS no trae esto de
// fábrica, así que se calcula: se asume el valor como si fuera UTC,
// se mide qué hora local muestra esa zona para ese instante, y se
// corrige por la diferencia.
function instanteDesdeFechaHoraEnZona(anio, mes, dia, hora, minuto, zona) {
  const comoUTC = Date.UTC(anio, mes - 1, dia, hora, minuto);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date(comoUTC));
  const obtener = (tipo) => parseInt(partes.find(p => p.type === tipo)?.value || '0', 10);
  const horaObtenida = obtener('hour') === 24 ? 0 : obtener('hour');
  const comoSiFueraZona = Date.UTC(obtener('year'), obtener('month') - 1, obtener('day'), horaObtenida, obtener('minute'));
  return comoUTC + (comoUTC - comoSiFueraZona);
}

// La próxima fecha (año/mes/día) en que cae ese día de la semana,
// contando desde hoy — solo sirve como "ancla" para poder convertir
// zonas horarias, el día exacto no importa mientras caiga en el día
// de semana correcto.
function proximaFechaParaDia(diaNombre) {
  const idx = DIAS_ORDEN_SEMANA.indexOf(diaNombre);
  const hoy = new Date();
  const diaHoyISO = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1; // 0=Lunes...6=Domingo
  let diff = idx - diaHoyISO;
  if (diff < 0) diff += 7;
  const fecha = new Date(hoy);
  fecha.setDate(hoy.getDate() + diff);
  return fecha;
}

function renderHorariosRecurrentes(usuarios) {
  const contenedor = document.getElementById('pv-horarios-recurrentes-contenedor');
  const lista = document.getElementById('pv-horarios-recurrentes-lista');
  if (!contenedor || !lista) return;

  const mentoresConHorario = Object.values(usuarios).filter(u => {
    const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
    return roles.mentor && u.horarioRecurrente && u.horarioRecurrente.dia && u.horarioRecurrente.hora;
  });

  if (!mentoresConHorario.length) {
    contenedor.classList.add('hidden');
    return;
  }

  const zonaViewer = zonaHorariaLocal();
  const mismaZonaQueChile = zonaViewer === 'America/Santiago';

  // Cada horario se guardó en la zona del mentor que lo creó (o se
  // asume Chile, para los pocos que se hayan guardado antes de este
  // cambio) — acá se convierte al instante real, y desde ahí a lo
  // que corresponda ver a quien esté mirando en este momento.
  const conInstante = mentoresConHorario.map(m => {
    const hr = m.horarioRecurrente;
    const zonaCreador = hr.zonaCreador || 'America/Santiago';
    const [hora, minuto] = hr.hora.split(':').map(Number);
    const fechaAnclaje = proximaFechaParaDia(hr.dia);
    const instante = instanteDesdeFechaHoraEnZona(fechaAnclaje.getFullYear(), fechaAnclaje.getMonth() + 1, fechaAnclaje.getDate(), hora, minuto, zonaCreador);
    return { m, instante };
  });
  conInstante.sort((a, b) => a.instante - b.instante);

  contenedor.classList.remove('hidden');
  lista.style.cssText = 'display:flex; gap:8px; justify-content:space-between; flex-wrap:nowrap;';
  lista.innerHTML = conInstante.map(({ m, instante }) => {
    const fechaObj = new Date(instante);
    const diaViewer = new Intl.DateTimeFormat('es-CL', { weekday: 'short', timeZone: zonaViewer }).format(fechaObj);
    const diaViewerAbrev = capitalizar(diaViewer.replace('.', '').slice(0, 3));
    const horaViewer = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zonaViewer }).format(fechaObj);
    const diaChileAbrev = capitalizar(new Intl.DateTimeFormat('es-CL', { weekday: 'short', timeZone: 'America/Santiago' }).format(fechaObj).replace('.', '').slice(0, 3));
    const horaChile = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago' }).format(fechaObj);
    return `
      <div style="text-align:center; min-width:0; flex:1;">
        <p style="font-weight:700; font-size:9.5px; letter-spacing:0.3px; margin:0 0 4px; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.nombre || m.email}</p>
        <img src="${m.fotoUrl || PLACEHOLDER_FOTO_ALUMNO}" alt="" style="width:44px; height:44px; border-radius:50%; object-fit:cover; margin-bottom:4px;">
        <p style="font-size:10.5px; margin:0;">📅 ${diaViewerAbrev}</p>
        <p style="font-size:10.5px; margin:0;">${horaViewer} ${banderaDeZona(zonaViewer)}</p>
        ${!mismaZonaQueChile ? `<p style="font-size:9px; margin:2px 0 0; color:#9CA0A8;">${diaChileAbrev} ${horaChile} 🇨🇱</p>` : ''}
      </div>`;
  }).join('');
}

export async function cargarPreguntasVivo() {
  const listadoEl = document.getElementById('preguntas-vivo-listado');
  if (!listadoEl || !alumnoIdActual) return;
  if (intervaloPreguntasVivo) clearInterval(intervaloPreguntasVivo);

  // --- Programa del alumno: determina qué sesiones puede ver ---
  const alumnoSnapPv = await get(ref(db, `alumnos/${alumnoIdActual}`));
  const alumnoDatosPv = alumnoSnapPv.exists() ? alumnoSnapPv.val() : {};
  let programaAlumnoPv = null;
  if (alumnoDatosPv.cicloActualId) {
    const cicloSnapPv = await get(ref(db, `ciclos/${alumnoDatosPv.cicloActualId}`));
    programaAlumnoPv = cicloSnapPv.exists() ? (cicloSnapPv.val().programa || null) : null;
  }
  const usuariosSnap = await get(ref(db, 'usuarios'));
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};

  renderHorariosRecurrentes(usuarios);
  const esBegin = programaAlumnoPv === 'begin';
  const mentores = ordenarMentores(Object.entries(usuarios).filter(([, u]) => {
    const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
    return !!roles.mentor;
  }));

  let sesiones = [];

  // --- Mentorías: para BEGIN solo las marcadas "exclusiva BEGIN";
  //     para NEXT/eXIT, todas las demás (nunca las exclusivas BEGIN) ---
  const mentoriasSnaps = await Promise.all(mentores.map(([uid]) => get(ref(db, `mentorias/${uid}`))));
  mentoriasSnaps.forEach((snap, idx) => {
    if (!snap.exists()) return;
    const [mentorUid, mentorDatos] = mentores[idx];
    Object.entries(snap.val()).forEach(([mentoriaId, m]) => {
      if (!m.fecha || !m.hora) return;
      if (esBegin !== !!m.exclusivaBegin) return; // filtra según programa
      const inicio = m.inicioTimestamp ? new Date(m.inicioTimestamp) : new Date(`${m.fecha}T${m.hora}`);
      if (isNaN(inicio.getTime())) return;
      sesiones.push({ tipo: 'mentor', mentorUid, mentorDatos, mentoriaId, ...m, inicio });
    });
  });

  // --- BEGIN además ve las sesiones grupales de los coaches de cabecera ---
  if (esBegin) {
    const coachesCabecera = Object.entries(usuarios).filter(([, u]) => {
      const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
      return !!roles.coach && u.coachCabeceraBegin === true;
    });
    const sesionesBeginSnaps = await Promise.all(coachesCabecera.map(([uid]) => get(ref(db, `sesionesBegin/${uid}`))));
    sesionesBeginSnaps.forEach((snap, idx) => {
      if (!snap.exists()) return;
      const [coachUid, coachDatos] = coachesCabecera[idx];
      Object.entries(snap.val()).forEach(([sesionId, s]) => {
        if (!s.fecha || !s.hora) return;
        const inicio = s.inicioTimestamp ? new Date(s.inicioTimestamp) : new Date(`${s.fecha}T${s.hora}`);
        if (isNaN(inicio.getTime())) return;
        sesiones.push({ tipo: 'coach', mentorUid: coachUid, mentorDatos: coachDatos, mentoriaId: sesionId, ...s, inicio });
      });
    });
  }

  const ahora = Date.now();
  sesiones = sesiones.filter(s => (s.inicio.getTime() + 60 * 60 * 1000) > ahora && s.estado !== 'no_dictada');
  sesiones.sort((a, b) => a.inicio - b.inicio);

  if (!sesiones.length) {
    listadoEl.innerHTML = '<p class="text-soft">No hay sesiones en vivo próximas por ahora.</p>';
    return;
  }

  // --- Límite: 1 pregunta en vivo por responsable (mentor o coach), por semana ---
  const responsablesEnSesiones = [...new Set(sesiones.map(s => `${s.tipo}:${s.mentorUid}`))];
  const preguntasPorResponsableSnaps = await Promise.all(responsablesEnSesiones.map(clave => {
    const [tipo, uid] = clave.split(':');
    return get(ref(db, `${tipo === 'coach' ? 'preguntasVivoBegin' : 'preguntasVivo'}/${uid}`));
  }));
  const inicioSemanaVivo = inicioSemanaActual();
  const mentoresConPreguntaEstaSemana = new Set();
  preguntasPorResponsableSnaps.forEach((snap, idx) => {
    if (!snap.exists()) return;
    const clave = responsablesEnSesiones[idx];
    Object.values(snap.val()).forEach(preguntasDeSesion => {
      Object.values(preguntasDeSesion).forEach(p => {
        if (p.alumnoId === alumnoIdActual && p.createdAt >= inicioSemanaVivo) mentoresConPreguntaEstaSemana.add(clave);
      });
    });
  });

  listadoEl.innerHTML = sesiones.map((s, idx) => {
    const temasMentor = s.tipo === 'coach'
      ? 'Sesión grupal semanal — resolución de dudas (BEGIN)'
      : ((Array.isArray(s.mentorDatos.temasBox) && s.mentorDatos.temasBox.length) ? s.mentorDatos.temasBox.slice(0, 3).join(', ') : 'Temáticas no definidas aún');
    const fechaLarga = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'long', year: 'numeric', timeZone: zonaHorariaLocal() }).format(s.inicio);
    const horaTexto = s.inicioTimestamp ? formatearHorarioSesion(s.inicioTimestamp) : s.hora;
    return `
    <div class="panel mb-16" data-sesion-idx="${idx}">
      <div class="panel__body" style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
        <img src="${s.mentorDatos.fotoUrl || PLACEHOLDER_FOTO_ALUMNO}" alt="" style="width:56px; height:56px; border-radius:50%; object-fit:cover; flex-shrink:0;">
        <div style="flex:1; min-width:220px;">
          <strong>${s.mentorDatos.nombre || s.mentorDatos.email}</strong>
          <span class="pv-badge-en-vivo hidden" style="background:#C0392B; color:#fff; font-size:10px; font-weight:700; letter-spacing:0.5px; padding:2px 8px; border-radius:4px; margin-left:6px; vertical-align:middle;">● EN VIVO</span>
          <p class="text-soft" style="margin:2px 0; font-size:12px;">${temasMentor}</p>
          <p class="text-soft" style="margin:6px 0 2px; font-size:12px;">${fechaLarga} · ${horaTexto}</p>
          ${s.link ? `<a href="${s.link}" target="_blank" rel="noopener" style="font-size:13px;">Ir al link de acceso</a>` : ''}
          <p class="pv-countdown text-soft" style="margin-top:8px; font-size:12px; font-weight:600;"></p>
        </div>
        <button type="button" class="btn btn--primary pv-btn-preguntar" style="font-size:12px;" ${mentoresConPreguntaEstaSemana.has(`${s.tipo}:${s.mentorUid}`) ? 'disabled' : ''}>Enviar Pregunta</button>
      </div>
      <div class="panel__body hidden pv-form-panel" style="border-top:0.5px solid var(--border);">
        <div class="field mb-16">
          <textarea class="pv-pregunta-texto" placeholder="Escribe tu pregunta para esta sesión... (puedes incluir links)"></textarea>
        </div>
        <button type="button" class="btn btn--ghost pv-btn-adjuntar" style="font-size:11px;">📎 Adjuntar Imagen, PDF o Word</button>
        <input type="file" class="pv-input-imagenes hidden" accept="image/*,.pdf,.doc,.docx" multiple>
        <div class="pv-imagenes-preview" style="display:flex; gap:6px; flex-wrap:wrap; margin:8px 0;"></div>
        <button type="button" class="btn btn--primary pv-btn-enviar" style="font-size:12px;">Enviar</button>
      </div>
      <div class="panel__body pv-mis-preguntas" style="border-top:2px solid var(--border); background:#F7F8FA; margin-top:4px;"></div>
    </div>`;
  }).join('');

  const cards = Array.from(listadoEl.querySelectorAll('[data-sesion-idx]'));
  cards.forEach((card, idx) => bindSesionVivo(card, sesiones[idx]));

  function actualizarCountdowns() {
    cards.forEach((card, idx) => {
      const s = sesiones[idx];
      const inicioMs = s.inicio.getTime();
      const limite = inicioMs - 12 * 60 * 60 * 1000;
      const restante = limite - Date.now();
      const countdownEl = card.querySelector('.pv-countdown');
      const btnPreguntar = card.querySelector('.pv-btn-preguntar');
      const enVivoAhora = Date.now() >= inicioMs && Date.now() < (inicioMs + 60 * 60 * 1000);

      const badgeEl = card.querySelector('.pv-badge-en-vivo');
      if (badgeEl) badgeEl.classList.toggle('hidden', !enVivoAhora);

      const yaPreguntoEstaSemana = mentoresConPreguntaEstaSemana.has(`${s.tipo}:${s.mentorUid}`);
      if (yaPreguntoEstaSemana) {
        countdownEl.textContent = 'Ya enviaste una pregunta en vivo para esta sesión esta semana.';
        btnPreguntar.disabled = true;
        btnPreguntar.title = 'Ya enviaste una pregunta en vivo para esta sesión esta semana.';
      } else if (restante <= 0) {
        countdownEl.textContent = 'El plazo para dejar tu pregunta se cerró (12 horas antes de la sesión). De todas maneras te esperamos en vivo, para que participes junto a tus compañeros y si queda tiempo, puedas preguntar en vivo.';
        btnPreguntar.disabled = true;
        btnPreguntar.title = 'El plazo para preguntar ya cerró.';
      } else {
        countdownEl.textContent = `Deja tu pregunta antes de: ${formatearDuracion(restante)}`;
        btnPreguntar.disabled = false;
        btnPreguntar.title = '';
      }
    });
  }
  actualizarCountdowns();
  intervaloPreguntasVivo = setInterval(actualizarCountdowns, 1000);

  // --- Historial permanente: todas mis preguntas en vivo, aunque la sesión ya haya desaparecido del listado ---
  const historialEl = document.getElementById('preguntas-vivo-historial');
  if (historialEl) {
    const responsablesHistorial = mentores.map(([uid, datos]) => ({ tipo: 'mentor', uid, datos }));
    if (esBegin) {
      Object.entries(usuarios)
        .filter(([, u]) => {
          const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
          return !!roles.coach && u.coachCabeceraBegin === true;
        })
        .forEach(([uid, datos]) => responsablesHistorial.push({ tipo: 'coach', uid, datos }));
    }

    const preguntasVivoSnaps = await Promise.all(
      responsablesHistorial.map(r => get(ref(db, `${r.tipo === 'coach' ? 'preguntasVivoBegin' : 'preguntasVivo'}/${r.uid}`)))
    );
    let historial = [];
    preguntasVivoSnaps.forEach((snap, idx) => {
      if (!snap.exists()) return;
      const { uid: mentorUid, datos: mentorDatos } = responsablesHistorial[idx];
      Object.entries(snap.val()).forEach(([mentoriaId, preguntas]) => {
        Object.values(preguntas).forEach(p => {
          if (p.alumnoId === alumnoIdActual) historial.push({ ...p, mentorUid, mentorNombre: mentorDatos.nombre || mentorDatos.email });
        });
      });
    });
    historial.sort((a, b) => b.createdAt - a.createdAt);

    const filtroMentorEl = document.getElementById('historial-vivo-filtro-mentor');
    const filtroDesdeEl = document.getElementById('historial-vivo-filtro-desde');
    const filtroHastaEl = document.getElementById('historial-vivo-filtro-hasta');
    if (filtroMentorEl) {
      const mentoresConPreguntas = [...new Map(historial.map(p => [p.mentorUid, p.mentorNombre])).entries()];
      filtroMentorEl.innerHTML = '<option value="">Todos</option>' + mentoresConPreguntas.map(([uid, nombre]) => `<option value="${uid}">${nombre}</option>`).join('');
    }

    function renderHistorial() {
      const fMentor = filtroMentorEl ? filtroMentorEl.value : '';
      const fDesde = filtroDesdeEl && filtroDesdeEl.value ? new Date(filtroDesdeEl.value + 'T00:00:00').getTime() : null;
      const fHasta = filtroHastaEl && filtroHastaEl.value ? new Date(filtroHastaEl.value + 'T23:59:59').getTime() : null;

      const filtradas = historial.filter(p =>
        (!fMentor || p.mentorUid === fMentor) &&
        (!fDesde || p.createdAt >= fDesde) &&
        (!fHasta || p.createdAt <= fHasta)
      );

      historialEl.innerHTML = filtradas.length
        ? filtradas.map(p => `
            <div class="panel mb-16" style="padding:12px; font-size:13px;">
              <strong>Para ${p.mentorNombre}</strong> <span class="text-soft" style="font-size:11px;">— ${formatFecha(new Date(p.createdAt).toISOString().slice(0, 10))}</span>
              <p style="margin:6px 0 0;">${linkify(p.texto || '')}</p>
              ${renderImagenesPregunta(p.imagenes, p.archivos)}
            </div>`).join('')
        : '<p class="text-soft">No hay preguntas con ese filtro.</p>';
    }

    renderHistorial();
    if (filtroMentorEl) filtroMentorEl.onchange = renderHistorial;
    if (filtroDesdeEl) filtroDesdeEl.onchange = renderHistorial;
    if (filtroHastaEl) filtroHastaEl.onchange = renderHistorial;
  }

  const btnMinimizarHistorialVivo = document.getElementById('btn-minimizar-historial-vivo');
  if (btnMinimizarHistorialVivo) {
    btnMinimizarHistorialVivo.onclick = () => {
      const cont = document.getElementById('preguntas-vivo-historial-contenedor');
      const minimizado = cont.classList.toggle('hidden');
      btnMinimizarHistorialVivo.textContent = minimizado ? 'Mostrar ▼' : 'Minimizar ▲';
    };
  }
}

document.querySelectorAll('.nav-item[data-nav="preguntas-vivo"]').forEach(item => {
  item.addEventListener('click', cargarPreguntasVivo);
});
