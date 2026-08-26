/* ============================================================
   alumno-portal.js
   Fase 2 — primera entrega: crear el acceso del alumno (desde
   la ficha, director/coach) y su Dashboard de solo lectura
   (ficha, acuerdo/PDF, Test Brújula histórico, bitácora). Nada
   es editable por el alumno — todo lo sigue manejando el coach.

   El BOX de Consultas (preguntas + respuestas con audio/imagen)
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

  // --- Foto grande sobre el menú lateral ---
  const fotoSidebar = document.getElementById('sidebar-foto-alumno');
  if (fotoSidebar) fotoSidebar.src = alumno.fotoUrl || PLACEHOLDER_FOTO_ALUMNO;

  // --- Bienvenida (Bienvenido/a según género; por defecto Bienvenido) ---
  const bienvenidaEl = document.getElementById('alumno-bienvenida');
  if (bienvenidaEl) {
    const saludo = alumno.genero === 'Femenino' ? 'Bienvenida' : 'Bienvenido';
    bienvenidaEl.textContent = `${saludo} a UNEQ Mentoring ${alumno.nombre || ''},`.trim();
  }

  // --- Stepper del programa (Begin → Next → eXIT), como línea de tiempo ---
  const stepperEl = document.getElementById('alumno-stepper-programa');
  if (stepperEl) {
    const programaActual = ciclo ? ciclo.programa : null;
    const PROGRAMAS_ORDEN = [['begin', 'BEGIN'], ['next', 'NEXT'], ['exit', 'EXIT']];
    stepperEl.innerHTML = `
      <div style="display:flex; align-items:center;">
        ${PROGRAMAS_ORDEN.map(([clave, label], idx) => {
          const activo = clave === programaActual;
          return `
          <div style="display:flex; flex-direction:column; align-items:center; opacity:${activo ? '1' : '0.35'};">
            <span style="font-weight:700; font-size:14px; letter-spacing:0.5px; margin-bottom:6px;">${label}</span>
            <span style="width:14px; height:14px; border-radius:50%; background:${activo ? 'var(--color-accent, #2563EB)' : 'transparent'}; border:2px solid ${activo ? 'var(--color-accent, #2563EB)' : 'var(--border)'};"></span>
          </div>
          ${idx < PROGRAMAS_ORDEN.length - 1 ? `<span style="flex:1; height:2px; background:var(--border); min-width:24px; margin:0 4px 22px;"></span>` : ''}`;
        }).join('')}
      </div>`;
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
    if (ciclo && ciclo.coachId) {
      const coachSnap = await get(ref(db, `usuarios/${ciclo.coachId}`));
      coach = coachSnap.exists() ? coachSnap.val() : null;
    }
    const numeroFase = (ciclo && ciclo.faseMetodologia && /\d/.test(ciclo.faseMetodologia)) ? ciclo.faseMetodologia.match(/\d/)[0] : null;
    const fraseFase = numeroFase
      ? `Actualmente te encuentras en la Fase ${numeroFase} de la Metodología 2E`
      : 'Tu fase actual aún no está definida — pronto tu coach la va a actualizar.';
    const mensajeCoach = coach ? encodeURIComponent(`Hola ${coach.nombre || ''}, necesito tu ayuda por favor`) : '';
    const whatsappCoachUrl = coach && coach.telefono ? `https://wa.me/${coach.telefono.replace(/[^0-9]/g, '')}?text=${mensajeCoach}` : '';

    let fraseDiasRestantes = '';
    if (ciclo && ciclo.fechaEgreso) {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const egreso = new Date(ciclo.fechaEgreso + 'T00:00:00');
      const diasRestantes = Math.ceil((egreso.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
      if (diasRestantes > 0) {
        fraseDiasRestantes = `<p style="margin:6px 0 0;">¡Te quedan ${diasRestantes} día${diasRestantes === 1 ? '' : 's'} de acceso al acompañamiento, estamos aquí para acompañarte, no te detengas!</p>`;
      } else {
        fraseDiasRestantes = `<p style="margin:6px 0 0; color:#B8860B; font-weight:600;">Tu acceso está en período de gracia</p>`;
      }
    }

    accesosEl.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:18px;">
        <button type="button" class="btn btn--primary" id="btn-acceso-preguntar-mentores">Pregunta a los Mentores</button>
        ${config.comunidadHotmartUrl ? `<a href="${config.comunidadHotmartUrl}" target="_blank" rel="noopener" class="btn btn--accent">Comunidad Hotmart</a>` : ''}
        ${contenidoUrl ? `<a href="${contenidoUrl}" target="_blank" rel="noopener" class="btn btn--accent">Contenidos en Hotmart</a>` : ''}
        ${whatsappUrl ? `<a href="${whatsappUrl}" target="_blank" rel="noopener" class="btn" style="background:#25D366; color:#fff;">Grupo WhatsApp Exclusivo</a>` : ''}
      </div>
      <div style="line-height:1.6;">
        <p style="margin:0 0 8px;">
          ${coach ? `Tu Coach es <strong>${coach.nombre || '—'}</strong>` : 'Aún no tienes coach asignado'}
          ${whatsappCoachUrl ? ` <a href="${whatsappCoachUrl}" target="_blank" rel="noopener" class="btn" style="background:#25D366; color:#fff; padding:4px 12px; font-size:12px;">💬 WhatsApp</a>` : ''}
        </p>
        <p style="margin:0 0 8px;">${fraseFase}</p>
        ${fraseDiasRestantes.replace('margin:6px 0 0;', 'margin:0 0 8px;')}
      </div>`;

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
    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px 20px; font-size:13px;">
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

function renderKpiTest(test) {
  const p = test.promedios || {};
  const fecha = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(test.completadoAt));
  return `
    <p class="text-soft mb-16">${fecha}</p>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-card__label">Fase 1: Claridad y Fundamentos</div><div class="kpi-card__value accent">${p.fase1 ?? '—'}</div></div>
      <div class="kpi-card"><div class="kpi-card__label">Fase 2: Cliente Soñado</div><div class="kpi-card__value accent">${p.fase2 ?? '—'}</div></div>
      <div class="kpi-card"><div class="kpi-card__label">Fase 3: Oferta y Método</div><div class="kpi-card__value accent">${p.fase3 ?? '—'}</div></div>
      <div class="kpi-card"><div class="kpi-card__label">Fase 4: Acción y Sistemas</div><div class="kpi-card__value accent">${p.fase4 ?? '—'}</div></div>
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
   BOX de Consultas (alumno): tarjetas de mentor (foto + "Hacer
   Pregunta" + "Detalles Mentor"), límite de 3 preguntas por
   semana (máx. 1 por mentor), reseteo los lunes 00:00.
   ============================================================ */
const TEMAS_BOX = ['Mentalidad', 'Estrategia', 'META ADS', 'Contenido Orgánico', 'CopyWriting', 'Ventas', 'Energía', 'Planificación', 'Identidad Visual', 'Diseño', 'Redes Sociales', 'Google ADS', 'Herramientas y Software'];

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
  if (respuesta.texto) html += `<p style="margin:4px 0;">${linkify(respuesta.texto)}</p>`;
  if (respuesta.archivoUrl && respuesta.archivoTipo === 'audio') {
    html += `<audio controls src="${respuesta.archivoUrl}" style="width:100%; margin-top:4px;"></audio>`;
  } else if (respuesta.archivoUrl && respuesta.archivoTipo === 'imagen') {
    html += `<img src="${respuesta.archivoUrl}" alt="" style="max-width:220px; border-radius:8px; margin-top:4px; display:block;">`;
  }
  html += '</div>';
  return html;
}

function renderImagenesPregunta(imagenes) {
  if (!imagenes || !imagenes.length) return '';
  return `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">
    ${imagenes.map(url => `<img src="${url}" alt="" style="max-width:120px; border-radius:8px;">`).join('')}
  </div>`;
}

async function subirImagenesPregunta(rutaBase, files) {
  const urls = [];
  for (let i = 0; i < files.length; i++) {
    const archivoRef = storageRef(storage, `${rutaBase}/${i}_${Date.now()}`);
    await uploadBytes(archivoRef, files[i]);
    urls.push(await getDownloadURL(archivoRef));
  }
  return urls;
}

export async function cargarBoxAlumno() {
  const gridEl = document.getElementById('box-alumno-mentores-grid');
  const listadoEl = document.getElementById('box-alumno-listado');
  if (!gridEl || !listadoEl || !alumnoIdActual) return;

  const usuariosSnap = await get(ref(db, 'usuarios'));
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
  const mentores = Object.entries(usuarios).filter(([, u]) => {
    const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
    return !!roles.mentor;
  });

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

  const contadorEl = document.getElementById('box-alumno-contador');
  if (contadorEl) contadorEl.textContent = '1 pregunta por Mentor IA por semana';

  // --- Tarjetas de mentor ---
  gridEl.innerHTML = mentores.length ? '' : '<p class="text-soft">No hay mentores disponibles por ahora.</p>';
  gridEl.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:14px;';
  mentores.forEach(([uid, m]) => {
    const yaPreguntado = mentoresPreguntadosEstaSemana.has(uid);
    const bloqueado = yaPreguntado;
    const tarjeta = document.createElement('div');
    tarjeta.className = 'panel' + (bloqueado ? ' mentor-card-bloqueado' : '');
    tarjeta.style.cssText = 'padding:16px; text-align:center;';
    if (yaPreguntado) tarjeta.title = 'Ya le preguntaste a este Mentor IA esta semana';
    tarjeta.innerHTML = `
      <img src="${m.fotoIA || m.fotoUrl || PLACEHOLDER_FOTO_ALUMNO}" alt="" style="width:64px; height:64px; border-radius:50%; object-fit:cover; margin-bottom:10px;">
      <p style="font-weight:600; margin-bottom:2px;">${m.nombre || m.email}</p>
      <p class="text-soft" style="font-size:10px; margin-bottom:8px;">Mentor IA</p>
      <div style="display:flex; flex-direction:column; gap:6px;">
        <button type="button" class="btn btn--primary btn-hacer-pregunta" style="font-size:12px;" ${bloqueado ? 'disabled' : ''}>Hacer Pregunta</button>
        <button type="button" class="btn btn--ghost btn-detalles-mentor" style="font-size:12px;">Detalles Mentor</button>
      </div>`;
    gridEl.appendChild(tarjeta);

    tarjeta.querySelector('.btn-hacer-pregunta').addEventListener('click', () => {
      document.getElementById('box-alumno-detalle-panel').classList.add('hidden');
      document.getElementById('box-alumno-form-panel').classList.remove('hidden');
      document.getElementById('box-alumno-mentor-nombre-form').textContent = `${m.nombre || m.email} (Mentor IA)`;
      document.getElementById('btn-enviar-pregunta-alumno').dataset.mentorId = uid;
      document.getElementById('box-alumno-form-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    tarjeta.querySelector('.btn-detalles-mentor').addEventListener('click', () => {
      document.getElementById('box-alumno-form-panel').classList.add('hidden');
      document.getElementById('box-alumno-detalle-panel').classList.remove('hidden');
      document.getElementById('box-alumno-detalle-contenido').innerHTML = `
        <div style="display:flex; align-items:center; gap:14px; margin-bottom:12px;">
          <img src="${m.fotoUrl || PLACEHOLDER_FOTO_ALUMNO}" alt="" style="width:56px; height:56px; border-radius:50%; object-fit:cover;">
          <strong>${m.nombre || m.email}</strong>
        </div>
        <p style="white-space:pre-wrap;">${m.bio ? linkify(m.bio) : 'Este mentor aún no ha escrito su presentación.'}</p>`;
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
            <div class="panel mb-16" style="padding:14px;">
              <div class="flex-between">
                <strong>Para ${mentorNombre}</strong>
                ${!e.respuesta ? `<button type="button" class="btn btn--ghost btn-eliminar-pregunta" data-pregunta-id="${e.preguntaId}" data-mentor-id="${e.mentorId}" style="font-size:11px; padding:2px 8px;">Eliminar</button>` : ''}
              </div>
              <span class="text-soft" style="font-size:12px;">${formatFecha(new Date(e.createdAt).toISOString().slice(0, 10))}</span>
              <p style="margin:6px 0;">${linkify(e.pregunta)}</p>
              ${renderImagenesPregunta(e.imagenes)}
              ${renderRespuestaBox(e.respuesta)}
            </div>`;
        }).join('')
      : '<p class="text-soft">Aún no has enviado ninguna consulta con ese filtro.</p>');

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

const btnCerrarDetalleMentor = document.getElementById('btn-cerrar-detalle-mentor');
if (btnCerrarDetalleMentor) btnCerrarDetalleMentor.addEventListener('click', () => document.getElementById('box-alumno-detalle-panel').classList.add('hidden'));

let imagenesSeleccionadasPregunta = [];
const btnAdjuntarImagenesPregunta = document.getElementById('btn-adjuntar-imagenes-pregunta');
const inputImagenesPregunta = document.getElementById('input-imagenes-pregunta');
if (btnAdjuntarImagenesPregunta && inputImagenesPregunta) {
  btnAdjuntarImagenesPregunta.addEventListener('click', () => inputImagenesPregunta.click());
  inputImagenesPregunta.addEventListener('change', () => {
    imagenesSeleccionadasPregunta = Array.from(inputImagenesPregunta.files);
    const previewEl = document.getElementById('box-alumno-imagenes-preview');
    previewEl.innerHTML = imagenesSeleccionadasPregunta
      .map(f => `<span class="text-soft" style="font-size:11px; background:#F0F1F3; padding:3px 8px; border-radius:6px;">🖼️ ${f.name}</span>`)
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

    if (!mentorId || (!pregunta && !imagenesSeleccionadasPregunta.length) || !alumnoIdActual) {
      errorEl.textContent = 'Escribe tu pregunta o adjunta al menos una imagen.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnEnviarPreguntaAlumno.disabled = true;
    try {
      const preguntaId = push(ref(db, `box/${mentorId}`)).key;
      const alumnoSnap = await get(ref(db, `alumnos/${alumnoIdActual}`));
      const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
      const nombreAlumno = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim();

      const imagenes = imagenesSeleccionadasPregunta.length
        ? await subirImagenesPregunta(`box-preguntas/${mentorId}/${preguntaId}`, imagenesSeleccionadasPregunta)
        : [];

      await update(ref(db), {
        [`box/${mentorId}/${preguntaId}`]: { alumnoId: alumnoIdActual, alumnoNombre: nombreAlumno, mentorId, pregunta, imagenes, createdAt: Date.now(), respuesta: null },
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
  const mentores = Object.entries(usuarios).filter(([, u]) => {
    const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
    return !!roles.mentor;
  });

  if (filtroMentorEl && !filtroMentorEl.dataset.cargado) {
    filtroMentorEl.innerHTML = '<option value="">Todos</option>' + mentores.map(([uid, m]) => `<option value="${uid}">${m.nombre || m.email}</option>`).join('');
    filtroMentorEl.dataset.cargado = '1';
  }
  if (filtroTemaEl && !filtroTemaEl.dataset.cargado) {
    filtroTemaEl.innerHTML = '<option value="">Todas</option>' + TEMAS_BOX.map(t => `<option value="${t}">${t}</option>`).join('');
    filtroTemaEl.dataset.cargado = '1';
  }

  const todasSnaps = await Promise.all(mentores.map(([uid]) => get(ref(db, `box/${uid}`))));
  let todas = [];
  todasSnaps.forEach((snap, idx) => {
    if (!snap.exists()) return;
    const [mentorUid] = mentores[idx];
    Object.values(snap.val()).forEach(p => { if (p.respuesta) todas.push(p); });
  });
  todas.sort((a, b) => b.createdAt - a.createdAt); // más reciente primero

  const PAGE_SIZE = 10;
  let cantidadVisible = PAGE_SIZE;

  function render() {
    const filtroMentor = filtroMentorEl ? filtroMentorEl.value : '';
    const filtroTema = filtroTemaEl ? filtroTemaEl.value : '';
    const fDesde = filtroDesdeEl && filtroDesdeEl.value ? new Date(filtroDesdeEl.value + 'T00:00:00').getTime() : null;
    const fHasta = filtroHastaEl && filtroHastaEl.value ? new Date(filtroHastaEl.value + 'T23:59:59').getTime() : null;

    const filtradas = todas.filter(p =>
      (!filtroMentor || p.mentorId === filtroMentor) &&
      (!filtroTema || (p.respuesta && p.respuesta.tema === filtroTema)) &&
      (!fDesde || p.createdAt >= fDesde) &&
      (!fHasta || p.createdAt <= fHasta)
    );

    const visibles = filtradas.slice(0, cantidadVisible);

    listadoEl.innerHTML = (visibles.length
      ? visibles.map(p => {
          const mentorNombre = usuarios[p.mentorId] ? (usuarios[p.mentorId].nombre || usuarios[p.mentorId].email) : 'Mentor';
          return `
            <div class="panel mb-16" style="padding:14px;">
              <span class="badge badge--activo" style="font-size:10px;">${p.respuesta.tema || 'Sin tema'}</span>
              <p class="text-soft" style="font-size:12px; margin:6px 0 2px;">Pregunta para ${mentorNombre} — ${formatFecha(new Date(p.createdAt).toISOString().slice(0, 10))}</p>
              <p style="margin:4px 0;">${linkify(p.pregunta)}</p>
              ${renderImagenesPregunta(p.imagenes)}
              ${renderRespuestaBox(p.respuesta)}
            </div>`;
        }).join('')
      : '<p class="text-soft">No hay preguntas respondidas con ese filtro todavía.</p>');

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

async function cargarMisPreguntasVivo(card, s) {
  const cont = card.querySelector('.pv-mis-preguntas');
  if (!cont) return;
  const snap = await get(ref(db, `preguntasVivo/${s.mentorUid}/${s.mentoriaId}`));
  if (!snap.exists()) { cont.innerHTML = ''; return; }
  const propias = Object.entries(snap.val()).filter(([, p]) => p.alumnoId === alumnoIdActual);

  if (!propias.length) { cont.innerHTML = ''; return; }

  cont.innerHTML = '<strong style="font-size:12px; display:block; margin-bottom:6px;">Tus preguntas para esta sesión:</strong>' +
    propias.map(([preguntaId, p]) => `
      <div class="pv-pregunta-propia" data-pregunta-id="${preguntaId}" style="margin-top:8px; font-size:13px; padding:8px; background:#fff; border-radius:8px;">
        <p class="pv-pregunta-propia-texto" style="margin:0;">${linkify(p.texto || '')}</p>
        ${renderImagenesPregunta(p.imagenes)}
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
        contNuevas.innerHTML = imagenesNuevas.map(f => `<span class="text-soft" style="font-size:11px; background:#F0F1F3; padding:3px 8px; border-radius:6px;">🖼️ ${f.name}</span>`).join('');

        const btnAdjuntar = bloque.querySelector('.btn-adjuntar-editar-vivo');
        const inputAdjuntar = bloque.querySelector('.pv-input-editar-imagenes');
        btnAdjuntar.addEventListener('click', () => inputAdjuntar.click());
        inputAdjuntar.addEventListener('change', () => {
          imagenesNuevas = imagenesNuevas.concat(Array.from(inputAdjuntar.files));
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
            const urlsNuevas = imagenesNuevas.length
              ? await subirImagenesPregunta(`preguntas-vivo/${s.mentorUid}/${s.mentoriaId}/${preguntaId}`, imagenesNuevas)
              : [];
            await update(ref(db, `preguntasVivo/${s.mentorUid}/${s.mentoriaId}/${preguntaId}`), {
              texto: nuevoTexto,
              imagenes: [...imagenesActuales, ...urlsNuevas]
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
    imagenesSel = Array.from(inputImagenes.files);
    card.querySelector('.pv-imagenes-preview').innerHTML = imagenesSel
      .map(f => `<span class="text-soft" style="font-size:11px; background:#F0F1F3; padding:3px 8px; border-radius:6px;">🖼️ ${f.name}</span>`).join('');
  });

  card.querySelector('.pv-btn-enviar').addEventListener('click', async (ev) => {
    const btn = ev.target;
    const texto = card.querySelector('.pv-pregunta-texto').value.trim();
    if (!texto && !imagenesSel.length) { alert('Escribe tu pregunta o adjunta una imagen.'); return; }
    btn.disabled = true;
    try {
      const preguntaId = push(ref(db, `preguntasVivo/${s.mentorUid}/${s.mentoriaId}`)).key;
      const alumnoSnap = await get(ref(db, `alumnos/${alumnoIdActual}`));
      const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
      const nombreAlumno = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim();
      const imagenes = imagenesSel.length
        ? await subirImagenesPregunta(`preguntas-vivo/${s.mentorUid}/${s.mentoriaId}/${preguntaId}`, imagenesSel)
        : [];
      await set(ref(db, `preguntasVivo/${s.mentorUid}/${s.mentoriaId}/${preguntaId}`), {
        alumnoId: alumnoIdActual, alumnoNombre: nombreAlumno, texto, imagenes, createdAt: Date.now()
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

export async function cargarPreguntasVivo() {
  const listadoEl = document.getElementById('preguntas-vivo-listado');
  if (!listadoEl || !alumnoIdActual) return;
  if (intervaloPreguntasVivo) clearInterval(intervaloPreguntasVivo);

  const usuariosSnap = await get(ref(db, 'usuarios'));
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
  const mentores = Object.entries(usuarios).filter(([, u]) => {
    const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
    return !!roles.mentor;
  });

  const mentoriasSnaps = await Promise.all(mentores.map(([uid]) => get(ref(db, `mentorias/${uid}`))));
  let sesiones = [];
  mentoriasSnaps.forEach((snap, idx) => {
    if (!snap.exists()) return;
    const [mentorUid, mentorDatos] = mentores[idx];
    Object.entries(snap.val()).forEach(([mentoriaId, m]) => {
      if (!m.fecha || !m.hora) return;
      const inicio = new Date(`${m.fecha}T${m.hora}`);
      if (isNaN(inicio.getTime())) return;
      sesiones.push({ mentorUid, mentorDatos, mentoriaId, ...m, inicio });
    });
  });

  const ahora = Date.now();
  sesiones = sesiones.filter(s => (s.inicio.getTime() + 60 * 60 * 1000) > ahora && s.estado !== 'no_dictada');
  sesiones.sort((a, b) => a.inicio - b.inicio);

  if (!sesiones.length) {
    listadoEl.innerHTML = '<p class="text-soft">No hay sesiones en vivo próximas por ahora.</p>';
    return;
  }

  // --- Límite: 1 pregunta en vivo por mentor, por semana ---
  const mentorUidsEnSesiones = [...new Set(sesiones.map(s => s.mentorUid))];
  const preguntasVivoPorMentorSnaps = await Promise.all(mentorUidsEnSesiones.map(uid => get(ref(db, `preguntasVivo/${uid}`))));
  const inicioSemanaVivo = inicioSemanaActual();
  const mentoresConPreguntaEstaSemana = new Set();
  preguntasVivoPorMentorSnaps.forEach((snap, idx) => {
    if (!snap.exists()) return;
    const mentorUid = mentorUidsEnSesiones[idx];
    Object.values(snap.val()).forEach(preguntasDeMentoria => {
      Object.values(preguntasDeMentoria).forEach(p => {
        if (p.alumnoId === alumnoIdActual && p.createdAt >= inicioSemanaVivo) mentoresConPreguntaEstaSemana.add(mentorUid);
      });
    });
  });

  listadoEl.innerHTML = sesiones.map((s, idx) => {
    const temasMentor = Object.keys(s.mentorDatos.temas || {}).join(', ') || 'Temáticas no definidas aún';
    const fechaLarga = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }).format(s.inicio);
    return `
    <div class="panel mb-16" data-sesion-idx="${idx}">
      <div class="panel__body" style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
        <img src="${s.mentorDatos.fotoUrl || PLACEHOLDER_FOTO_ALUMNO}" alt="" style="width:56px; height:56px; border-radius:50%; object-fit:cover; flex-shrink:0;">
        <div style="flex:1; min-width:220px;">
          <strong>${s.mentorDatos.nombre || s.mentorDatos.email}</strong>
          <span class="pv-badge-en-vivo hidden" style="background:#C0392B; color:#fff; font-size:10px; font-weight:700; letter-spacing:0.5px; padding:2px 8px; border-radius:4px; margin-left:6px; vertical-align:middle;">● EN VIVO</span>
          <p class="text-soft" style="margin:2px 0; font-size:12px;">${temasMentor}</p>
          <p style="margin:6px 0 2px;"><strong>${s.tema || ''}</strong></p>
          <p class="text-soft" style="margin:0; font-size:12px;">${fechaLarga} · ${s.hora}</p>
          ${s.link ? `<a href="${s.link}" target="_blank" rel="noopener" style="font-size:13px;">Ir al link de acceso</a>` : ''}
          <p class="pv-countdown text-soft" style="margin-top:8px; font-size:12px; font-weight:600;"></p>
        </div>
        <button type="button" class="btn btn--primary pv-btn-preguntar" style="font-size:12px;" ${mentoresConPreguntaEstaSemana.has(s.mentorUid) ? 'disabled' : ''}>Enviar Pregunta</button>
      </div>
      <div class="panel__body hidden pv-form-panel" style="border-top:0.5px solid var(--border);">
        <div class="field mb-16">
          <textarea class="pv-pregunta-texto" placeholder="Escribe tu pregunta para esta sesión... (puedes incluir links)"></textarea>
        </div>
        <button type="button" class="btn btn--ghost pv-btn-adjuntar" style="font-size:11px;">🖼️ Adjuntar Imágenes</button>
        <input type="file" class="pv-input-imagenes hidden" accept="image/*" multiple>
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

      if (mentoresConPreguntaEstaSemana.has(s.mentorUid)) {
        countdownEl.textContent = 'Ya le enviaste una pregunta en vivo a este mentor esta semana.';
        btnPreguntar.disabled = true;
        btnPreguntar.title = 'Ya le enviaste una pregunta en vivo a este mentor esta semana.';
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
    const preguntasVivoSnaps = await Promise.all(mentores.map(([uid]) => get(ref(db, `preguntasVivo/${uid}`))));
    let historial = [];
    preguntasVivoSnaps.forEach((snap, idx) => {
      if (!snap.exists()) return;
      const [mentorUid, mentorDatos] = mentores[idx];
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
              ${renderImagenesPregunta(p.imagenes)}
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
