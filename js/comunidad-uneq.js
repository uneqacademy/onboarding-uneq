/* ============================================================
   comunidad-uneq.js — orquesta la sección "Comunidad UNEQ": el clic
   en el nav-item y el cambio entre sus 4 subtabs. La carga de
   "Hitos" y "Preguntas" vive en hitos.js / alumno-portal.js;
   "Presentación" e "Historias Reales" se manejan acá mismo.
   ============================================================ */

import { db, auth } from './firebase-config.js';
import { ref, get, set, update, push } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole } from './main.js';
import { aplicarClampTexto } from './texto-clamp.js';
import { cargarHitosComunidad } from './hitos.js';
import { cargarPreguntasComunidad } from './alumno-portal.js';

const VENTANA_EDICION_MS = 24 * 60 * 60 * 1000;
function dentroDeVentana(createdAt) { return (Date.now() - createdAt) < VENTANA_EDICION_MS; }

let subtabActual = 'hitos';
let presentacionAprobada = false; // controla el candado de las otras 3 pestañas

const CARGADORES = {
  hitos: cargarHitosComunidad,
  preguntas: cargarPreguntasComunidad,
  presentacion: cargarPresentacion,
  historias: cargarHistoriasReales
};

function activarSubtab(nombre) {
  // Alumno sin presentación aprobada: solo puede ver "Presentación".
  const role = getCurrentRole();
  if (role === 'alumno' && !presentacionAprobada && nombre !== 'presentacion') {
    nombre = 'presentacion';
  }
  subtabActual = nombre;
  document.querySelectorAll('[data-comunidad-tab]').forEach(btn => {
    btn.classList.toggle('is-activa', btn.dataset.comunidadTab === nombre);
  });
  document.querySelectorAll('.comunidad-vista').forEach(vista => {
    vista.classList.toggle('is-activa', vista.id === `comunidad-vista-${nombre}`);
  });
  CARGADORES[nombre]?.();
}

document.querySelectorAll('[data-comunidad-tab]').forEach(btn => {
  btn.addEventListener('click', () => activarSubtab(btn.dataset.comunidadTab));
});

document.querySelectorAll('.nav-item[data-nav="comunidad-uneq"]').forEach(item => {
  item.addEventListener('click', async () => {
    const role = getCurrentRole();
    if (role === 'alumno') {
      const uid = auth.currentUser?.uid;
      const mapaSnap = uid ? await get(ref(db, `alumnoPorAuthUid/${uid}`)) : null;
      const alumnoId = mapaSnap && mapaSnap.exists() ? mapaSnap.val() : null;
      const presSnap = alumnoId ? await get(ref(db, `comunidad/presentaciones/${alumnoId}`)) : null;
      presentacionAprobada = !!(presSnap && presSnap.exists() && presSnap.val().estado === 'aprobada');
    } else {
      presentacionAprobada = true; // el candado es solo para alumno
    }
    activarSubtab(subtabActual);
  });
});

/* ============================================================
   PRESENTACIÓN
   ============================================================ */
async function obtenerContextoAlumno(uid) {
  const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
  const alumnoId = mapaSnap.exists() ? mapaSnap.val() : null;
  if (!alumnoId) return { alumnoId: null };
  const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
  const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
  const nombre = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim();
  let programa = '', coachId = '';
  if (alumno.cicloActualId) {
    const cicloSnap = await get(ref(db, `ciclos/${alumno.cicloActualId}`));
    if (cicloSnap.exists()) { programa = cicloSnap.val().programa || ''; coachId = cicloSnap.val().coachId || ''; }
  }
  return { alumnoId, nombre, programa, coachId };
}

async function cargarPresentacion() {
  const role = getCurrentRole();
  const esAlumno = role === 'alumno';
  const esStaff = !esAlumno;
  const esDirector = role === 'director';
  const esCoach = role === 'coach';
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;

  document.getElementById('pres-filtros-staff-panel')?.classList.toggle('hidden', !esStaff);
  document.getElementById('pres-filtros-alumno-panel')?.classList.toggle('hidden', !esAlumno);

  let ctxAlumno = { alumnoId: null };
  if (esAlumno) {
    ctxAlumno = await obtenerContextoAlumno(uid);
    await renderPropiaPresentacion(ctxAlumno);
  }

  let presSnap, alumnosSnap, ciclosSnap, usuariosSnap;
  try {
    [presSnap, alumnosSnap, ciclosSnap, usuariosSnap] = await Promise.all([
      get(ref(db, 'comunidad/presentaciones')),
      get(ref(db, 'alumnos')),
      get(ref(db, 'ciclos')),
      esStaff ? get(ref(db, 'usuarios')) : Promise.resolve(null)
    ]);
  } catch (err) {
    console.error('No se pudieron cargar las presentaciones:', err);
    const feedEl = document.getElementById('pres-feed');
    if (feedEl) feedEl.innerHTML = '<p class="text-soft">No se pudo cargar la lista. Recarga la página e intenta de nuevo.</p>';
    return;
  }
  const alumnos = alumnosSnap.exists() ? alumnosSnap.val() : {};
  const ciclos = ciclosSnap.exists() ? ciclosSnap.val() : {};
  const usuarios = usuariosSnap && usuariosSnap.exists() ? usuariosSnap.val() : {};
  const todas = presSnap.exists() ? Object.entries(presSnap.val()) : [];

  const conDatos = todas.map(([alumnoId, p]) => {
    const alumno = alumnos[alumnoId] || {};
    const ciclo = alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
    return { alumnoId, ...p, nombre: `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim() || p.alumnoNombre || 'Alumno', programa: ciclo ? ciclo.programa : '', coachId: ciclo ? ciclo.coachId : '' };
  }).filter(p => esDirector || esCoach || p.estado === 'aprobada' || p.alumnoId === ctxAlumno.alumnoId)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (esStaff) {
    const coachEl = document.getElementById('pres-f-coach');
    if (coachEl && !coachEl.dataset.cargado) {
      const coaches = Object.entries(usuarios).filter(([, u]) => {
        const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
        return !!roles.coach;
      }).sort((a, b) => (a[1].nombre || '').localeCompare(b[1].nombre || '', 'es'));
      coachEl.innerHTML = '<option value="">Todos</option>' + coaches.map(([id, c]) => `<option value="${id}">${c.nombre || c.email}</option>`).join('');
      coachEl.dataset.cargado = '1';
    }
    const estEl = document.getElementById('pres-f-estudiante');
    if (estEl) {
      const nombres = [...new Set(conDatos.map(p => p.nombre))].sort((a, b) => a.localeCompare(b, 'es'));
      const previo = estEl.value;
      estEl.innerHTML = '<option value="">Todos</option>' + nombres.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');
      if (nombres.includes(previo)) estEl.value = previo;
    }
  }

  function render() {
    let lista = conDatos;
    if (esStaff) {
      const fPrograma = document.getElementById('pres-f-programa')?.value || '';
      const fCoach = document.getElementById('pres-f-coach')?.value || '';
      const fEstudiante = document.getElementById('pres-f-estudiante')?.value || '';
      const fPendientes = document.getElementById('pres-f-pendientes')?.checked || false;
      const fDesde = document.getElementById('pres-f-desde-staff')?.value ? new Date(document.getElementById('pres-f-desde-staff').value + 'T00:00:00').getTime() : null;
      const fHasta = document.getElementById('pres-f-hasta-staff')?.value ? new Date(document.getElementById('pres-f-hasta-staff').value + 'T23:59:59').getTime() : null;
      lista = lista.filter(p =>
        (!fPrograma || p.programa === fPrograma) && (!fCoach || p.coachId === fCoach) &&
        (!fEstudiante || p.nombre === fEstudiante) && (!fPendientes || p.estado === 'pendiente') &&
        (!fDesde || p.createdAt >= fDesde) && (!fHasta || p.createdAt <= fHasta)
      );
      const contadorEl = document.getElementById('pres-contador');
      if (contadorEl) { contadorEl.textContent = `${lista.length} resultado${lista.length === 1 ? '' : 's'}`; contadorEl.classList.remove('hidden'); }
    } else {
      lista = lista.filter(p => p.estado === 'aprobada'); // el alumno solo ve las aprobadas de otros
      const fDesde = document.getElementById('pres-f-desde')?.value ? new Date(document.getElementById('pres-f-desde').value + 'T00:00:00').getTime() : null;
      const fHasta = document.getElementById('pres-f-hasta')?.value ? new Date(document.getElementById('pres-f-hasta').value + 'T23:59:59').getTime() : null;
      lista = lista.filter(p => (!fDesde || p.createdAt >= fDesde) && (!fHasta || p.createdAt <= fHasta));
    }

    const feedEl = document.getElementById('pres-feed');
    feedEl.innerHTML = lista.length ? lista.map(p => `
      <div class="panel mb-16" style="padding:14px;">
        <div class="flex-between">
          <strong>${p.nombre}</strong>
          ${p.estado === 'pendiente' ? '<span class="badge badge--impaga" style="font-size:10px;">Pendiente</span>' : ''}
        </div>
        <p class="texto-clamp" data-clamp style="margin:8px 0 0; white-space:pre-wrap;">${(p.texto || '').replace(/</g, '&lt;')}</p>
        <button type="button" class="btn-ver-mas-texto hidden" data-clamp-btn></button>
        ${esCoach || esDirector ? `
          <div style="display:flex; gap:8px; margin-top:10px;">
            ${p.estado !== 'aprobada' ? `<button type="button" class="btn btn--primary btn-aprobar-presentacion" data-alumno-id="${p.alumnoId}" style="font-size:12px; padding:5px 12px;">✓ Aprobar</button>` : ''}
            ${esDirector ? `<button type="button" class="btn btn--ghost btn-eliminar-presentacion" data-alumno-id="${p.alumnoId}" style="font-size:12px; padding:5px 12px; color:#C0392B;">Eliminar</button>` : ''}
          </div>` : ''}
      </div>`).join('') : '<p class="text-soft">No hay presentaciones con ese filtro todavía.</p>';
    aplicarClampTexto(feedEl);

    feedEl.querySelectorAll('.btn-aprobar-presentacion').forEach(btn => btn.addEventListener('click', async () => {
      try {
        await update(ref(db, `comunidad/presentaciones/${btn.dataset.alumnoId}`), { estado: 'aprobada' });
        cargarPresentacion();
      } catch (err) {
        console.error('No se pudo aprobar la presentación:', err);
        alert('No se pudo aprobar. Intenta de nuevo.');
      }
    }));
    feedEl.querySelectorAll('.btn-eliminar-presentacion').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta presentación?')) return;
      try {
        await set(ref(db, `comunidad/presentaciones/${btn.dataset.alumnoId}`), null);
        cargarPresentacion();
      } catch (err) {
        console.error('No se pudo eliminar la presentación:', err);
        alert('No se pudo eliminar. Intenta de nuevo.');
      }
    }));
  }
  render();
  ['pres-f-programa', 'pres-f-coach', 'pres-f-estudiante', 'pres-f-pendientes', 'pres-f-desde-staff', 'pres-f-hasta-staff', 'pres-f-desde', 'pres-f-hasta'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', render);
  });
}

async function renderPropiaPresentacion(ctxAlumno) {
  const candadoPanel = document.getElementById('pres-candado-panel');
  const pendienteBanner = document.getElementById('pres-pendiente-banner');
  const propioPanel = document.getElementById('pres-propia-panel');
  if (!ctxAlumno.alumnoId) return;

  const snap = await get(ref(db, `comunidad/presentaciones/${ctxAlumno.alumnoId}`));
  const propia = snap.exists() ? snap.val() : null;

  candadoPanel?.classList.toggle('hidden', !!propia);
  if (propia) {
    const enVentana = dentroDeVentana(propia.createdAt);
    pendienteBanner?.classList.toggle('hidden', propia.estado !== 'pendiente' || !enVentana);
    propioPanel?.classList.remove('hidden');
    document.getElementById('pres-propia-texto').textContent = propia.texto;
    const badgeEl = document.getElementById('pres-propia-estado');
    if (badgeEl) {
      badgeEl.textContent = propia.estado === 'aprobada' ? 'Aprobada' : 'Pendiente de tu Coach';
      badgeEl.className = 'badge ' + (propia.estado === 'aprobada' ? 'badge--activo' : 'badge--impaga');
    }
    document.getElementById('pres-btn-editar')?.classList.toggle('hidden', !enVentana);
    aplicarClampTexto(propioPanel);
  } else {
    pendienteBanner?.classList.add('hidden');
    propioPanel?.classList.add('hidden');
  }

  document.getElementById('pres-btn-enviar')?.addEventListener('click', async (ev) => {
    const texto = document.getElementById('pres-texto-form').value.trim();
    const errorEl = document.getElementById('pres-form-error');
    if (texto.length < 20) { errorEl.textContent = 'Cuéntanos un poco más — al menos unas líneas.'; errorEl.classList.remove('hidden'); return; }
    if (!ctxAlumno.alumnoId) { errorEl.textContent = 'No pudimos identificar tu ficha de alumno. Recarga la página e intenta de nuevo.'; errorEl.classList.remove('hidden'); return; }
    errorEl.classList.add('hidden');
    const btn = ev.currentTarget;
    btn.disabled = true; btn.textContent = 'Enviando...';
    try {
      await set(ref(db, `comunidad/presentaciones/${ctxAlumno.alumnoId}`), {
        texto, estado: 'pendiente', createdAt: Date.now(), alumnoNombre: ctxAlumno.nombre
      });
      activarSubtab('presentacion');
    } catch (err) {
      console.error('No se pudo enviar la presentación:', err);
      errorEl.textContent = 'No se pudo enviar. Intenta de nuevo en un momento.';
      errorEl.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Enviar presentación';
    }
  }, { once: true });

  document.getElementById('pres-btn-editar')?.addEventListener('click', async () => {
    const nuevoTexto = prompt('Edita tu presentación:', propia.texto);
    if (nuevoTexto === null || !nuevoTexto.trim()) return;
    try {
      await update(ref(db, `comunidad/presentaciones/${ctxAlumno.alumnoId}`), { texto: nuevoTexto.trim() });
      cargarPresentacion();
    } catch (err) {
      console.error('No se pudo editar la presentación:', err);
      alert('No se pudo guardar el cambio. Intenta de nuevo.');
    }
  }, { once: true });
}

/* ============================================================
   HISTORIAS REALES
   ============================================================ */
async function cargarHistoriasReales() {
  const role = getCurrentRole();
  const esAlumno = role === 'alumno';
  const esStaff = !esAlumno;
  const esDirector = role === 'director';
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;

  document.getElementById('hist-publicar-panel')?.classList.toggle('hidden', !esAlumno);
  document.getElementById('hist-filtros-staff-panel')?.classList.toggle('hidden', !esStaff);
  document.getElementById('hist-filtros-alumno-panel')?.classList.toggle('hidden', !esAlumno);

  let ctxAlumno = { alumnoId: null };
  if (esAlumno) ctxAlumno = await obtenerContextoAlumno(uid);

  let historiasSnap, alumnosSnap, ciclosSnap, usuariosSnap;
  try {
    [historiasSnap, alumnosSnap, ciclosSnap, usuariosSnap] = await Promise.all([
      get(ref(db, 'comunidad/historiasReales')),
      esStaff ? get(ref(db, 'alumnos')) : Promise.resolve(null),
      esStaff ? get(ref(db, 'ciclos')) : Promise.resolve(null),
      esStaff ? get(ref(db, 'usuarios')) : Promise.resolve(null)
    ]);
  } catch (err) {
    console.error('No se pudieron cargar las historias:', err);
    const feedEl = document.getElementById('hist-feed');
    if (feedEl) feedEl.innerHTML = '<p class="text-soft">No se pudo cargar la lista. Recarga la página e intenta de nuevo.</p>';
    return;
  }
  const alumnos = alumnosSnap && alumnosSnap.exists() ? alumnosSnap.val() : {};
  const ciclos = ciclosSnap && ciclosSnap.exists() ? ciclosSnap.val() : {};
  const usuarios = usuariosSnap && usuariosSnap.exists() ? usuariosSnap.val() : {};
  let todas = historiasSnap.exists() ? Object.entries(historiasSnap.val()) : [];
  todas = todas.filter(([, h]) => esDirector || h.estado !== 'oculta')
    .map(([id, h]) => {
      let programa = '', coachId = '';
      if (esStaff) {
        const alumnoEntry = Object.entries(alumnos).find(([, a]) => a.authUid === h.autorId);
        const alumno = alumnoEntry ? alumnoEntry[1] : null;
        const ciclo = alumno && alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
        programa = ciclo ? ciclo.programa : ''; coachId = ciclo ? ciclo.coachId : '';
      }
      return { id, ...h, programa, coachId };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  if (esStaff) {
    const coachEl = document.getElementById('hist-f-coach');
    if (coachEl && !coachEl.dataset.cargado) {
      const coaches = Object.entries(usuarios).filter(([, u]) => {
        const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
        return !!roles.coach;
      }).sort((a, b) => (a[1].nombre || '').localeCompare(b[1].nombre || '', 'es'));
      coachEl.innerHTML = '<option value="">Todos</option>' + coaches.map(([id, c]) => `<option value="${id}">${c.nombre || c.email}</option>`).join('');
      coachEl.dataset.cargado = '1';
    }
    const estEl = document.getElementById('hist-f-estudiante');
    if (estEl) {
      const nombres = [...new Set(todas.map(h => h.alumnoNombre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      const previo = estEl.value;
      estEl.innerHTML = '<option value="">Todos</option>' + nombres.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');
      if (nombres.includes(previo)) estEl.value = previo;
    }
  }

  function render() {
    let lista = todas;
    if (esStaff) {
      const fPrograma = document.getElementById('hist-f-programa')?.value || '';
      const fCoach = document.getElementById('hist-f-coach')?.value || '';
      const fEstudiante = document.getElementById('hist-f-estudiante')?.value || '';
      const fDesde = document.getElementById('hist-f-desde-staff')?.value ? new Date(document.getElementById('hist-f-desde-staff').value + 'T00:00:00').getTime() : null;
      const fHasta = document.getElementById('hist-f-hasta-staff')?.value ? new Date(document.getElementById('hist-f-hasta-staff').value + 'T23:59:59').getTime() : null;
      lista = lista.filter(h =>
        (!fPrograma || h.programa === fPrograma) && (!fCoach || h.coachId === fCoach) &&
        (!fEstudiante || h.alumnoNombre === fEstudiante) &&
        (!fDesde || h.createdAt >= fDesde) && (!fHasta || h.createdAt <= fHasta)
      );
      const contadorEl = document.getElementById('hist-contador');
      if (contadorEl) { contadorEl.textContent = `${lista.length} resultado${lista.length === 1 ? '' : 's'}`; contadorEl.classList.remove('hidden'); }
    } else {
      const fDesde = document.getElementById('hist-f-desde')?.value ? new Date(document.getElementById('hist-f-desde').value + 'T00:00:00').getTime() : null;
      const fHasta = document.getElementById('hist-f-hasta')?.value ? new Date(document.getElementById('hist-f-hasta').value + 'T23:59:59').getTime() : null;
      lista = lista.filter(h => (!fDesde || h.createdAt >= fDesde) && (!fHasta || h.createdAt <= fHasta));
    }

    const feedEl = document.getElementById('hist-feed');
    feedEl.innerHTML = lista.length ? lista.map(h => {
      const esAutora = h.autorId === uid;
      const puedeEditar = esAutora && dentroDeVentana(h.createdAt);
      const puedeEliminar = puedeEditar || esDirector;
      return `
      <div class="panel mb-16" style="padding:14px;" data-historia-id="${h.id}">
        <strong>${h.alumnoNombre || 'Alumno'}</strong>
        <span class="text-soft" style="font-size:11px; margin-left:6px;">${new Date(h.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        <p class="texto-clamp" data-clamp data-texto-original="${(h.texto || '').replace(/"/g, '&quot;')}" style="margin:8px 0 0; white-space:pre-wrap;">${(h.texto || '').replace(/</g, '&lt;')}</p>
        <button type="button" class="btn-ver-mas-texto hidden" data-clamp-btn></button>
        <div style="display:flex; gap:8px; margin-top:10px;">
          ${puedeEditar ? `<button type="button" class="btn btn--ghost btn-editar-historia" style="font-size:12px; padding:5px 12px;">✏️ Editar</button>` : ''}
          ${puedeEliminar ? `<button type="button" class="btn btn--ghost btn-eliminar-historia" style="font-size:12px; padding:5px 12px; color:#C0392B;">Eliminar</button>` : ''}
        </div>
      </div>`;
    }).join('') : '<p class="text-soft">Todavía no hay historias que mostrar.</p>';
    aplicarClampTexto(feedEl);

    feedEl.querySelectorAll('[data-historia-id]').forEach(card => {
      const id = card.dataset.historiaId;
      card.querySelector('.btn-eliminar-historia')?.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta historia?')) return;
        try {
          await set(ref(db, `comunidad/historiasReales/${id}`), null);
          cargarHistoriasReales();
        } catch (err) {
          console.error('No se pudo eliminar la historia:', err);
          alert('No se pudo eliminar. Intenta de nuevo.');
        }
      });
      card.querySelector('.btn-editar-historia')?.addEventListener('click', async () => {
        const parrafo = card.querySelector('[data-clamp]');
        const nuevo = prompt('Edita tu historia:', parrafo.dataset.textoOriginal);
        if (nuevo === null || !nuevo.trim()) return;
        try {
          await update(ref(db, `comunidad/historiasReales/${id}`), { texto: nuevo.trim() });
          cargarHistoriasReales();
        } catch (err) {
          console.error('No se pudo editar la historia:', err);
          alert('No se pudo guardar el cambio. Intenta de nuevo.');
        }
      });
    });
  }
  render();
  ['hist-f-programa', 'hist-f-coach', 'hist-f-estudiante', 'hist-f-desde-staff', 'hist-f-hasta-staff', 'hist-f-desde', 'hist-f-hasta'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', render);
  });

  document.getElementById('hist-btn-publicar')?.addEventListener('click', async (ev) => {
    const texto = document.getElementById('hist-texto-form').value.trim();
    const errorEl = document.getElementById('hist-form-error');
    if (texto.length < 10) { errorEl.textContent = 'Escribe un poco más sobre tu historia.'; errorEl.classList.remove('hidden'); return; }
    errorEl.classList.add('hidden');
    const btn = ev.currentTarget;
    btn.disabled = true; btn.textContent = 'Publicando...';
    try {
      await set(push(ref(db, 'comunidad/historiasReales')), {
        autorId: uid, alumnoNombre: ctxAlumno.nombre, texto, createdAt: Date.now()
      });
      document.getElementById('hist-texto-form').value = '';
      cargarHistoriasReales();
    } catch (err) {
      console.error('No se pudo publicar la historia:', err);
      errorEl.textContent = 'No se pudo publicar. Intenta de nuevo en un momento.';
      errorEl.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Publicar';
    }
  }, { once: true });
}
