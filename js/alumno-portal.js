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

  // --- Stepper del programa (Begin → Next → eXIT), el actual destacado ---
  const stepperEl = document.getElementById('alumno-stepper-programa');
  if (stepperEl) {
    const programaActual = ciclo ? ciclo.programa : null;
    const PROGRAMAS_ORDEN = [['begin', 'BEGIN'], ['next', 'NEXT'], ['exit', 'EXIT']];
    stepperEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        ${PROGRAMAS_ORDEN.map(([clave, label], idx) => `
          <span style="font-weight:700; font-size:15px; letter-spacing:0.5px; opacity:${clave === programaActual ? '1' : '0.35'};">${label}</span>
          ${idx < PROGRAMAS_ORDEN.length - 1 ? '<span style="flex:1; height:2px; background:var(--border); min-width:24px;"></span>' : ''}
        `).join('')}
      </div>`;
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
    const fase = FASE_LABELS[ciclo ? ciclo.faseMetodologia : ''] || 'Sin definir';
    const whatsappCoachUrl = coach && coach.telefono ? `https://wa.me/${coach.telefono.replace(/[^0-9]/g, '')}` : '';

    accesosEl.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:18px;">
        <button type="button" class="btn btn--primary" id="btn-acceso-preguntar-mentores">Pregunta a los Mentores</button>
        ${config.comunidadHotmartUrl ? `<a href="${config.comunidadHotmartUrl}" target="_blank" rel="noopener" class="btn btn--accent">Comunidad Hotmart</a>` : ''}
        ${contenidoUrl ? `<a href="${contenidoUrl}" target="_blank" rel="noopener" class="btn btn--accent">Contenidos en Hotmart</a>` : ''}
        ${whatsappUrl ? `<a href="${whatsappUrl}" target="_blank" rel="noopener" class="btn" style="background:#25D366; color:#fff;">Grupo WhatsApp Exclusivo</a>` : ''}
        ${whatsappCoachUrl ? `<a href="${whatsappCoachUrl}" target="_blank" rel="noopener" class="btn" style="background:#25D366; color:#fff;">💬 Escribir a mi Coach</a>` : ''}
      </div>
      <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px 20px; font-size:13px;">
        <div><strong>Coach:</strong> ${coach ? (coach.nombre || '—') : '—'}</div>
        <div><strong>Contacto Coach:</strong> ${coach ? [coach.email, coach.telefono].filter(Boolean).join(' · ') || '—' : '—'}</div>
        <div><strong>Fase Actual:</strong> ${fase}</div>
        <div><strong>Correo de Soporte:</strong> ${config.correoSoporte || '—'}</div>
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
        ultimoTestEl.innerHTML = renderKpiTest(ultimo);
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
      <div><strong>Ocupación:</strong> ${alumno.ocupacion || '—'}</div>
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
  item.addEventListener('click', cargarFichaAlumnoPropia);
});
document.querySelectorAll('.nav-item[data-nav="acuerdo-alumno"]').forEach(item => {
  item.addEventListener('click', cargarAcuerdoAlumno);
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

/* --- Mi Test Brújula, historial completo (página propia) --- */
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
  const tests = testsSnap.exists() ? Object.values(testsSnap.val()) : [];
  el.innerHTML = tests.length
    ? tests.sort((a, b) => b.completadoAt - a.completadoAt)
        .map(t => `<div style="padding-bottom:20px; margin-bottom:20px; border-bottom:0.5px solid var(--border);">${renderKpiTest(t)}</div>`)
        .join('')
    : '<p class="text-soft">Aún no has completado el Test Brújula — tu coach te va a guiar en eso.</p>';
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
  let html = '<div style="margin-top:8px; padding:10px; background:#EFF6FF; border-radius:8px;"><strong style="font-size:12px;">Respuesta:</strong>';
  if (respuesta.texto) html += `<p style="margin:4px 0;">${linkify(respuesta.texto)}</p>`;
  if (respuesta.archivoUrl && respuesta.archivoTipo === 'audio') {
    html += `<audio controls src="${respuesta.archivoUrl}" style="width:100%; margin-top:4px;"></audio>`;
  } else if (respuesta.archivoUrl && respuesta.archivoTipo === 'imagen') {
    html += `<img src="${respuesta.archivoUrl}" alt="" style="max-width:220px; border-radius:8px; margin-top:4px; display:block;">`;
  }
  html += '</div>';
  return html;
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
      return snap.exists() ? snap.val() : null;
    })
  )).filter(Boolean);

  const inicioSemana = inicioSemanaActual();
  const deEstaSemana = entradas.filter(e => e.createdAt >= inicioSemana);
  const mentoresPreguntadosEstaSemana = new Set(deEstaSemana.map(e => e.mentorId));
  const preguntasRestantes = Math.max(0, 3 - deEstaSemana.length);

  const contadorEl = document.getElementById('box-alumno-contador');
  if (contadorEl) contadorEl.textContent = `Te quedan ${preguntasRestantes} preguntas esta semana`;

  // --- Tarjetas de mentor ---
  gridEl.innerHTML = mentores.length ? '' : '<p class="text-soft">No hay mentores disponibles por ahora.</p>';
  gridEl.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:14px;';
  mentores.forEach(([uid, m]) => {
    const yaPreguntado = mentoresPreguntadosEstaSemana.has(uid);
    const bloqueado = yaPreguntado || preguntasRestantes <= 0;
    const tarjeta = document.createElement('div');
    tarjeta.className = 'panel';
    tarjeta.style.cssText = 'padding:16px; text-align:center;';
    tarjeta.innerHTML = `
      <img src="${m.fotoUrl || PLACEHOLDER_FOTO_ALUMNO}" alt="" style="width:64px; height:64px; border-radius:50%; object-fit:cover; margin-bottom:10px;">
      <p style="font-weight:600; margin-bottom:2px;">${m.nombre || m.email}</p>
      ${yaPreguntado ? '<p class="text-soft" style="font-size:11px; margin-bottom:8px;">Ya le preguntaste esta semana</p>' : '<div style="margin-bottom:8px;"></div>'}
      <div style="display:flex; flex-direction:column; gap:6px;">
        <button type="button" class="btn btn--primary btn-hacer-pregunta" style="font-size:12px;" ${bloqueado ? 'disabled' : ''}>Hacer Pregunta</button>
        <button type="button" class="btn btn--ghost btn-detalles-mentor" style="font-size:12px;">Detalles Mentor</button>
      </div>`;
    gridEl.appendChild(tarjeta);

    tarjeta.querySelector('.btn-hacer-pregunta').addEventListener('click', () => {
      document.getElementById('box-alumno-detalle-panel').classList.add('hidden');
      document.getElementById('box-alumno-form-panel').classList.remove('hidden');
      document.getElementById('box-alumno-mentor-nombre-form').textContent = m.nombre || m.email;
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
  listadoEl.innerHTML = validas.length
    ? validas.map(e => {
        const mentorNombre = usuarios[e.mentorId] ? (usuarios[e.mentorId].nombre || usuarios[e.mentorId].email) : 'Mentor';
        return `
          <div class="panel mb-16" style="padding:14px;">
            <strong>Para ${mentorNombre}</strong> <span class="text-soft" style="font-size:12px;">— ${formatFecha(new Date(e.createdAt).toISOString().slice(0, 10))}</span>
            <p style="margin:6px 0;">${linkify(e.pregunta)}</p>
            ${renderRespuestaBox(e.respuesta)}
          </div>`;
      }).join('')
    : '<p class="text-soft">Aún no has enviado ninguna consulta.</p>';
}

const btnCerrarFormPregunta = document.getElementById('btn-cerrar-form-pregunta');
if (btnCerrarFormPregunta) btnCerrarFormPregunta.addEventListener('click', () => document.getElementById('box-alumno-form-panel').classList.add('hidden'));

const btnCerrarDetalleMentor = document.getElementById('btn-cerrar-detalle-mentor');
if (btnCerrarDetalleMentor) btnCerrarDetalleMentor.addEventListener('click', () => document.getElementById('box-alumno-detalle-panel').classList.add('hidden'));

const btnEnviarPreguntaAlumno = document.getElementById('btn-enviar-pregunta-alumno');
if (btnEnviarPreguntaAlumno) {
  btnEnviarPreguntaAlumno.addEventListener('click', async () => {
    const errorEl = document.getElementById('box-alumno-error');
    errorEl.classList.add('hidden');
    const mentorId = btnEnviarPreguntaAlumno.dataset.mentorId;
    const pregunta = document.getElementById('box-alumno-pregunta').value.trim();

    if (!mentorId || !pregunta || !alumnoIdActual) {
      errorEl.textContent = 'Escribe tu pregunta antes de enviar.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnEnviarPreguntaAlumno.disabled = true;
    try {
      const preguntaId = push(ref(db, `box/${mentorId}`)).key;
      const alumnoSnap = await get(ref(db, `alumnos/${alumnoIdActual}`));
      const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
      const nombreAlumno = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim();

      await update(ref(db), {
        [`box/${mentorId}/${preguntaId}`]: { alumnoId: alumnoIdActual, alumnoNombre: nombreAlumno, mentorId, pregunta, createdAt: Date.now(), respuesta: null },
        [`boxIndice/${alumnoIdActual}/${preguntaId}`]: mentorId
      });

      document.getElementById('box-alumno-pregunta').value = '';
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
  todas.sort((a, b) => b.createdAt - a.createdAt);

  function render() {
    const filtroMentor = filtroMentorEl ? filtroMentorEl.value : '';
    const filtroTema = filtroTemaEl ? filtroTemaEl.value : '';
    const filtradas = todas.filter(p =>
      (!filtroMentor || p.mentorId === filtroMentor) &&
      (!filtroTema || (p.respuesta && p.respuesta.tema === filtroTema))
    );
    listadoEl.innerHTML = filtradas.length
      ? filtradas.map(p => {
          const mentorNombre = usuarios[p.mentorId] ? (usuarios[p.mentorId].nombre || usuarios[p.mentorId].email) : 'Mentor';
          return `
            <div class="panel mb-16" style="padding:14px;">
              <span class="badge badge--activo" style="font-size:10px;">${p.respuesta.tema || 'Sin tema'}</span>
              <p class="text-soft" style="font-size:12px; margin:6px 0 2px;">Pregunta para ${mentorNombre} — ${formatFecha(new Date(p.createdAt).toISOString().slice(0, 10))}</p>
              <p style="margin:4px 0;">${linkify(p.pregunta)}</p>
              ${renderRespuestaBox(p.respuesta)}
            </div>`;
        }).join('')
      : '<p class="text-soft">No hay preguntas respondidas con ese filtro todavía.</p>';
  }

  render();
  if (filtroMentorEl) filtroMentorEl.onchange = render;
  if (filtroTemaEl) filtroTemaEl.onchange = render;
}

document.querySelectorAll('.nav-item[data-nav="preguntas-comunidad"]').forEach(item => {
  item.addEventListener('click', cargarPreguntasComunidad);
});
