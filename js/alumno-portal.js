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
import { ref, get, set, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
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

const FASE_LABELS = { fase1: 'Fase 1', fase2: 'Fase 2', fase3: 'Fase 3', fase4: 'Fase 4' };
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

  // --- Mi Ficha ---
  const dir = alumno.direccion || {};
  const direccionTexto = [[dir.calle, dir.numero].filter(Boolean).join(' '), dir.departamento, dir.comuna, dir.region, dir.pais]
    .filter(Boolean).join(', ') || '—';
  const fichaEl = document.getElementById('alumno-mi-ficha');
  if (fichaEl) {
    fichaEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:14px; margin-bottom:16px;">
        <img id="alumno-foto-preview" src="${alumno.fotoUrl || ''}" alt="" style="width:56px; height:56px; border-radius:50%; object-fit:cover; background:#E4E7EC;">
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

  // --- Mi Acuerdo Firmado (PDF) — lo sube el director una vez firmado ---
  const acuerdoEl = document.getElementById('alumno-mi-acuerdo');
  if (acuerdoEl) {
    if (alumno.cicloActualId) {
      const acuerdoSnap = await get(ref(db, `acuerdosPago/${alumno.cicloActualId}`));
      const acuerdo = acuerdoSnap.exists() ? acuerdoSnap.val() : null;
      acuerdoEl.innerHTML = acuerdo && acuerdo.pdfFirmadoUrl
        ? `<a href="${acuerdo.pdfFirmadoUrl}" target="_blank" rel="noopener" class="btn btn--primary">Descargar mi Acuerdo Firmado (PDF)</a>`
        : '<p class="text-soft">Tu acuerdo firmado todavía no está disponible — tu director lo va a subir apenas esté listo.</p>';
    } else {
      acuerdoEl.innerHTML = '<p class="text-soft">Aún no hay un ciclo asociado.</p>';
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
    const fase = FASE_LABELS[ciclo ? ciclo.faseMetodologia : ''] || 'Sin definir';

    accesosEl.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:18px;">
        ${config.comunidadHotmartUrl ? `<a href="${config.comunidadHotmartUrl}" target="_blank" rel="noopener" class="btn btn--primary">Comunidad Hotmart</a>` : ''}
        ${contenidoUrl ? `<a href="${contenidoUrl}" target="_blank" rel="noopener" class="btn btn--primary">Contenido del Programa</a>` : ''}
        ${whatsappUrl ? `<a href="${whatsappUrl}" target="_blank" rel="noopener" class="btn btn--accent">Grupo de WhatsApp</a>` : ''}
      </div>
      <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px 20px; font-size:13px;">
        <div><strong>Coach:</strong> ${coach ? (coach.nombre || '—') : '—'}</div>
        <div><strong>Contacto Coach:</strong> ${coach ? [coach.email, coach.telefono].filter(Boolean).join(' · ') || '—' : '—'}</div>
        <div><strong>Fase Actual:</strong> ${fase}</div>
        <div><strong>Correo de Soporte:</strong> ${config.correoSoporte || '—'}</div>
      </div>`;
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
        <div style="padding:10px 0; border-bottom:0.5px solid var(--border); font-size:13px;">
          <strong>${e.titulo || ''}</strong> <span class="text-soft">— ${formatFecha(e.fecha)} · ${e.canal || ''}</span>
          <p style="margin:4px 0 0;">${e.notas || ''}</p>
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
