/* ============================================================
   closer.js — panel real, conectado a Firebase. Mismo HTML/CSS ya
   validado en la vista previa. "Mi Agenda" lee agendamiento/citas
   del propio closer; al marcar el resultado de una llamada, se crea
   un registro directo en agendamiento/leadsPorCloser/{miUid} (el
   closer escribe ahí mismo, sin pasar por ninguna función) — una
   cita se considera "ya marcada" si ya tiene un lead con su mismo
   citaId, así no hace falta tocar agendamiento/citas (que solo
   pueden escribir las Cloud Functions).
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, set, update, push, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getStorage, ref as sref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getAuth, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { iniciarSesionStaff } from './staff-auth.js';

const storageInstance = getStorage();
const authInstance = getAuth();

/* Lista de países (código + nombre en español), vía Intl del navegador. */
function listaPaises() {
  try {
    const codigos = Intl.supportedValuesOf('region').filter(c => /^[A-Z]{2}$/.test(c));
    const nombres = new Intl.DisplayNames(['es'], { type: 'region' });
    return codigos.map(c => ({ codigo: c, nombre: nombres.of(c) })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  } catch (err) {
    return [
      { codigo: 'CL', nombre: 'Chile' }, { codigo: 'AR', nombre: 'Argentina' }, { codigo: 'PE', nombre: 'Perú' },
      { codigo: 'CO', nombre: 'Colombia' }, { codigo: 'MX', nombre: 'México' }, { codigo: 'ES', nombre: 'España' },
      { codigo: 'US', nombre: 'Estados Unidos' }
    ];
  }
}

const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DIAS_SEMANA_LABEL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const HORAS_GRID = Array.from({ length: 21 }, (_, i) => { const h = 9 + Math.floor(i / 2); const m = i % 2 === 0 ? '00' : '30'; return `${String(h).padStart(2, '0')}:${m}`; });
const ETIQUETAS_ESTADO = {
  se_presento: { texto: 'Se presenta a llamada', clase: 'se-presento' }, en_seguimiento: { texto: 'En Seguimiento', clase: 'en-seguimiento' },
  cerrado: { texto: 'Cerrado', clase: 'cerrado' }, no_show: { texto: 'No-Show', clase: 'no-show' }, baja: { texto: 'Dado de baja', clase: 'baja' }
};
const PROGRAMAS = [{ v: 'begin', t: 'Begin' }, { v: 'next', t: 'Next' }, { v: 'exit', t: 'eXIT' }];

let miUid = null;
let citasAgenda = [], leads = [], disponibilidad = {}, bloqueos = [], miPerfil = {};
let subtabLeadsActual = 'activos';
let filtroEstadoLeadActual = '';
let arrastrandoDisponibilidad = false, valorArrastreDisponibilidad = null;

document.querySelectorAll('.adm-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.adm-nav-item').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    document.querySelectorAll('.adm-seccion').forEach(s => s.classList.remove('is-activa'));
    document.getElementById('sec-' + btn.dataset.seccion).classList.add('is-activa');
  });
});
document.querySelectorAll('.adm-subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.adm-subtab').forEach(b => b.classList.remove('is-activa'));
    btn.classList.add('is-activa');
    subtabLeadsActual = btn.dataset.subtab;
    renderLeads();
  });
});
document.getElementById('filtro-estado-lead').addEventListener('change', (e) => {
  filtroEstadoLeadActual = e.target.value;
  renderLeads();
});
function mostrarToast(texto) {
  const toast = document.getElementById('toast');
  toast.textContent = texto; toast.classList.add('is-visible');
  setTimeout(() => toast.classList.remove('is-visible'), 2200);
}
function formatearFechaHora(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/* --- MI AGENDA --- */
async function cargarAgenda() {
  const [citasSnap, leadsSnap] = await Promise.all([get(ref(db, 'agendamiento/citas')), get(ref(db, `agendamiento/leadsPorCloser/${miUid}`))]);
  const citaIdsYaMarcadas = new Set(leadsSnap.exists() ? Object.values(leadsSnap.val()).map(l => l.citaId) : []);
  citasAgenda = citasSnap.exists()
    ? Object.entries(citasSnap.val())
      .filter(([id, c]) => c.closerUid === miUid && c.estado === 'agendada' && !citaIdsYaMarcadas.has(id))
      .map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => a.inicioMs - b.inicioMs)
    : [];
}
function renderAgenda() {
  const cont = document.getElementById('agenda-lista');
  if (!citasAgenda.length) { cont.innerHTML = '<p style="color:var(--color-ink-soft);">No tienes llamadas próximas por marcar.</p>'; return; }
  cont.innerHTML = citasAgenda.map(c => `
    <div class="adm-cita-card" data-id="${c.id}">
      <div class="adm-cita-card__top"><span class="adm-cita-card__fecha">${formatearFechaHora(c.inicioMs)}</span><span class="adm-cita-card__nombre">${c.leadNombre}</span></div>
      <p class="adm-cita-card__meta">${c.leadCorreo} · ${c.leadTelefono}</p>
      <dl class="adm-cita-card__respuestas">${Object.entries(c.respuestas || {}).map(([p, r]) => `<dt>${p}</dt><dd>${r}</dd>`).join('') || '<dd>Sin respuestas previas.</dd>'}</dl>
      <div class="adm-cita-card__acciones">
        <button type="button" class="adm-btn-chico adm-btn-chico--accent" data-accion="se-presento">✅ Se presentó</button>
        <button type="button" class="adm-btn-chico adm-btn-chico--danger" data-accion="no-show">❌ No-Show</button>
      </div>
    </div>`).join('');
  cont.querySelectorAll('.adm-cita-card').forEach(card => {
    const cita = citasAgenda.find(c => c.id === card.dataset.id);
    card.querySelector('[data-accion="se-presento"]').addEventListener('click', () => marcarResultado(cita, 'se_presento'));
    card.querySelector('[data-accion="no-show"]').addEventListener('click', () => marcarResultado(cita, 'no_show'));
  });
}
async function marcarResultado(cita, resultado) {
  const esNoShow = resultado === 'no_show';
  const leadRef = push(ref(db, `agendamiento/leadsPorCloser/${miUid}`));
  const bitacoraId = push(ref(db, `agendamiento/leadsPorCloser/${miUid}/${leadRef.key}/bitacora`)).key;
  await set(leadRef, {
    nombre: cita.leadNombre, correo: cita.leadCorreo, telefono: cita.leadTelefono, estado: resultado, programa: null, archivada: esNoShow, citaId: cita.id,
    bitacora: { [bitacoraId]: { texto: esNoShow ? 'No se presentó a la llamada agendada.' : 'Llamada realizada — se presentó.', fecha: Date.now() } },
    createdAt: Date.now()
  });
  citasAgenda = citasAgenda.filter(c => c.id !== cita.id);
  renderAgenda();
  await cargarLeads(); renderLeads();
  mostrarToast(esNoShow ? 'Marcado como No-Show' : '✅ Lead pasó a "Se presenta a llamada"');
}

/* --- MIS LEADS --- */
async function cargarLeads() {
  const snap = await get(ref(db, `agendamiento/leadsPorCloser/${miUid}`));
  leads = snap.exists() ? Object.entries(snap.val()).map(([id, l]) => ({ id, ...l, bitacora: Object.entries(l.bitacora || {}).map(([bid, b]) => ({ id: bid, ...b })) })) : [];
}
function renderLeads() {
  const cont = document.getElementById('leads-lista');
  const filtrados = leads
    .filter(l => (subtabLeadsActual === 'activos') === !l.archivada)
    .filter(l => !filtroEstadoLeadActual || l.estado === filtroEstadoLeadActual)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!filtrados.length) { cont.innerHTML = `<p style="color:var(--color-ink-soft);">No hay leads que calcen con este filtro.</p>`; return; }

  cont.innerHTML = filtrados.map(l => {
    const et = ETIQUETAS_ESTADO[l.estado];
    const etiquetaTxt = l.estado === 'cerrado' && l.programa ? `Cerrado (${PROGRAMAS.find(p => p.v === l.programa).t})` : et.texto;
    const bitacoraOrdenada = [...l.bitacora].sort((a, b) => b.fecha - a.fecha);
    return `
    <div class="adm-cita-card" data-id="${l.id}">
      <div class="adm-cita-card__top"><span class="adm-badge-lead ${et.clase}">${etiquetaTxt}</span><span class="adm-cita-card__nombre">${l.nombre}</span></div>
      <p class="adm-cita-card__meta">${l.correo} · ${l.telefono}</p>
      <div class="adm-bitacora-lista">${bitacoraOrdenada.map(b => `<div class="adm-bitacora-entrada"><time>${new Date(b.fecha).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>${b.texto}</div>`).join('')}</div>
      ${!l.archivada ? `
        <div class="adm-bitacora-nueva"><input type="text" placeholder="Agregar una nota de seguimiento…" data-nota><button type="button" class="adm-btn-chico" data-accion="agregar-nota">Agregar</button></div>
        <div class="adm-cita-card__acciones" style="margin-top:12px;">
          ${l.estado === 'se_presento' ? `<button type="button" class="adm-btn-chico adm-btn-chico--accent" data-accion="cierra">🏆 Cierra en llamada</button><button type="button" class="adm-btn-chico" data-accion="seguimiento">↪ Pasar a Seguimiento</button>` : ''}
          ${l.estado === 'en_seguimiento' ? `<button type="button" class="adm-btn-chico adm-btn-chico--accent" data-accion="cierra">🏆 Cierra en Seguimiento</button><button type="button" class="adm-btn-chico adm-btn-chico--danger" data-accion="baja">Dado de baja</button>` : ''}
        </div>
        <div class="adm-cita-card__acciones hidden" data-selector-programa style="margin-top:10px;">
          <span style="font-size:12.5px; color:var(--color-ink-soft); align-self:center;">¿Qué programa cerró?</span>
          ${PROGRAMAS.map(p => `<button type="button" class="adm-btn-chico" data-programa="${p.v}">${p.t}</button>`).join('')}
        </div>` : `<button type="button" class="adm-btn-chico" data-accion="reabrir" style="margin-top:8px;">↩ Reabrir</button>`}
    </div>`;
  }).join('');

  cont.querySelectorAll('.adm-cita-card').forEach(card => {
    const lead = leads.find(l => l.id === card.dataset.id);
    const refLead = ref(db, `agendamiento/leadsPorCloser/${miUid}/${lead.id}`);

    card.querySelector('[data-accion="agregar-nota"]')?.addEventListener('click', async () => {
      const input = card.querySelector('[data-nota]');
      if (!input.value.trim()) return;
      await set(push(ref(db, `agendamiento/leadsPorCloser/${miUid}/${lead.id}/bitacora`)), { texto: input.value.trim(), fecha: Date.now() });
      await cargarLeads(); renderLeads(); mostrarToast('Nota agregada a la bitácora');
    });
    card.querySelector('[data-accion="seguimiento"]')?.addEventListener('click', async () => {
      await update(refLead, { estado: 'en_seguimiento' });
      await set(push(ref(db, `agendamiento/leadsPorCloser/${miUid}/${lead.id}/bitacora`)), { texto: 'Pasa a En Seguimiento.', fecha: Date.now() });
      await cargarLeads(); renderLeads(); mostrarToast('Lead pasó a "En Seguimiento"');
    });
    card.querySelector('[data-accion="baja"]')?.addEventListener('click', async () => {
      if (!confirm('¿Dar de baja a este lead?')) return;
      await update(refLead, { estado: 'baja', archivada: true });
      await set(push(ref(db, `agendamiento/leadsPorCloser/${miUid}/${lead.id}/bitacora`)), { texto: 'Lead dado de baja.', fecha: Date.now() });
      await cargarLeads(); renderLeads(); mostrarToast('Lead dado de baja');
    });
    card.querySelector('[data-accion="cierra"]')?.addEventListener('click', () => card.querySelector('[data-selector-programa]').classList.toggle('hidden'));
    card.querySelectorAll('[data-programa]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const programa = btn.dataset.programa;
        await update(refLead, { estado: 'cerrado', archivada: true, programa });
        await set(push(ref(db, `agendamiento/leadsPorCloser/${miUid}/${lead.id}/bitacora`)), { texto: `¡Cerró ${PROGRAMAS.find(p => p.v === programa).t}! Pasa a Recién Cerrados.`, fecha: Date.now() });
        await set(push(ref(db, 'agendamiento/recienCerrados')), { nombre: lead.nombre, correo: lead.correo, telefono: lead.telefono, programa, closerId: miUid, createdAt: Date.now() });
        await cargarLeads(); renderLeads(); mostrarToast('✅ Cierre registrado — pasa a Recién Cerrados');
      });
    });
    card.querySelector('[data-accion="reabrir"]')?.addEventListener('click', async () => {
      await update(refLead, { archivada: false, estado: 'en_seguimiento' });
      await set(push(ref(db, `agendamiento/leadsPorCloser/${miUid}/${lead.id}/bitacora`)), { texto: 'Lead reabierto.', fecha: Date.now() });
      await cargarLeads(); renderLeads(); mostrarToast('↩ Lead reabierto — ahora está "En Seguimiento"');
    });
  });
}

/* --- DISPONIBILIDAD --- */
async function cargarDisponibilidad() {
  const [dispSnap, genSnap] = await Promise.all([get(ref(db, `agendamiento/disponibilidad/${miUid}`)), get(ref(db, 'agendamiento/config/general'))]);
  const config = genSnap.exists() ? genSnap.val() : { duracionMinutos: 45, colchonMinutos: 10 };
  if (dispSnap.exists()) { disponibilidad = dispSnap.val(); }
  else { disponibilidad = {}; DIAS_SEMANA.forEach((dia, idx) => { disponibilidad[dia] = HORAS_GRID.map(h => idx < 5 && h >= '10:00' && h < '18:00'); }); }
  document.getElementById('disp-sub').textContent = `Marca los horarios en los que puedes recibir llamadas. Cada llamada dura ${config.duracionMinutos} min, con ${config.colchonMinutos} min de colchón después (lo define tu Director Comercial). Se repite cada semana.`;
}
function renderDisponibilidad() {
  const grid = document.getElementById('disp-grid');
  let html = '<div></div>' + DIAS_SEMANA_LABEL.map(d => `<div class="cabecera">${d}</div>`).join('');
  HORAS_GRID.forEach((hora, hIdx) => {
    html += `<div class="hora-label">${hora}</div>`;
    DIAS_SEMANA.forEach(dia => { const activa = disponibilidad[dia] && disponibilidad[dia][hIdx]; html += `<div class="adm-disp-celda ${activa ? 'is-activa' : ''}" data-dia="${dia}" data-h="${hIdx}"></div>`; });
  });
  grid.innerHTML = html;

  /* --- Selección por arrastre: mantiene presionado y pasa por varias
     celdas para prenderlas o apagarlas de una vez. Un clic simple (sin
     arrastrar) sigue funcionando igual que antes, para ajustes de a uno. --- */
  function aplicarCelda(celda, valor) {
    const dia = celda.dataset.dia, h = Number(celda.dataset.h);
    if (!disponibilidad[dia]) disponibilidad[dia] = HORAS_GRID.map(() => false);
    disponibilidad[dia][h] = valor;
    celda.classList.toggle('is-activa', valor);
  }
  grid.querySelectorAll('.adm-disp-celda').forEach(celda => {
    celda.addEventListener('mousedown', (e) => {
      e.preventDefault();
      arrastrandoDisponibilidad = true;
      const dia = celda.dataset.dia, h = Number(celda.dataset.h);
      const actual = !!(disponibilidad[dia] && disponibilidad[dia][h]);
      valorArrastreDisponibilidad = !actual;
      aplicarCelda(celda, valorArrastreDisponibilidad);
    });
    celda.addEventListener('mouseenter', () => {
      if (arrastrandoDisponibilidad) aplicarCelda(celda, valorArrastreDisponibilidad);
    });
    celda.addEventListener('touchstart', (e) => {
      e.preventDefault();
      arrastrandoDisponibilidad = true;
      const dia = celda.dataset.dia, h = Number(celda.dataset.h);
      const actual = !!(disponibilidad[dia] && disponibilidad[dia][h]);
      valorArrastreDisponibilidad = !actual;
      aplicarCelda(celda, valorArrastreDisponibilidad);
    }, { passive: false });
  });
  grid.addEventListener('touchmove', (e) => {
    if (!arrastrandoDisponibilidad) return;
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el && el.classList.contains('adm-disp-celda')) aplicarCelda(el, valorArrastreDisponibilidad);
  }, { passive: false });
}
document.addEventListener('mouseup', () => { arrastrandoDisponibilidad = false; });
document.addEventListener('touchend', () => { arrastrandoDisponibilidad = false; });
document.getElementById('btn-guardar-disponibilidad').addEventListener('click', async () => {
  await set(ref(db, `agendamiento/disponibilidad/${miUid}`), disponibilidad);
  mostrarToast('✅ Disponibilidad guardada');
});

/* --- BLOQUEOS --- */
async function cargarBloqueos() {
  const snap = await get(ref(db, `agendamiento/bloqueos/${miUid}`));
  bloqueos = snap.exists() ? Object.entries(snap.val()).map(([id, b]) => ({ id, ...b })) : [];
}
function renderBloqueos() {
  const cont = document.getElementById('bloqueos-lista');
  const ordenados = [...bloqueos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!ordenados.length) { cont.innerHTML = '<p style="color:var(--color-ink-soft);">No tienes bloqueos agendados.</p>'; return; }
  cont.innerHTML = ordenados.map(b => `
    <div class="adm-bloqueo-item" data-id="${b.id}">
      <span>📅 ${new Date(b.fecha + 'T00:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })} · ${b.desde} – ${b.hasta}</span>
      <button type="button" class="adm-icon-btn adm-icon-btn--danger" data-accion="eliminar">🗑</button>
    </div>`).join('');
  cont.querySelectorAll('[data-accion="eliminar"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.adm-bloqueo-item').dataset.id;
      await remove(ref(db, `agendamiento/bloqueos/${miUid}/${id}`));
      bloqueos = bloqueos.filter(b => b.id !== id); renderBloqueos(); mostrarToast('Bloqueo eliminado');
    });
  });
}
document.getElementById('btn-agregar-bloqueo').addEventListener('click', async () => {
  const fecha = document.getElementById('bloqueo-fecha').value, desde = document.getElementById('bloqueo-desde').value, hasta = document.getElementById('bloqueo-hasta').value;
  if (!fecha || !desde || !hasta) { mostrarToast('⚠️ Completa fecha, desde y hasta'); return; }
  if (hasta <= desde) { mostrarToast('⚠️ La hora "hasta" debe ser mayor que "desde"'); return; }
  await set(push(ref(db, `agendamiento/bloqueos/${miUid}`)), { fecha, desde, hasta });
  await cargarBloqueos(); renderBloqueos();
  document.getElementById('bloqueo-fecha').value = ''; document.getElementById('bloqueo-desde').value = ''; document.getElementById('bloqueo-hasta').value = '';
  mostrarToast('✅ Bloqueo agregado');
});

/* --- MI PERFIL --- */
async function cargarPerfil() {
  const snap = await get(ref(db, `agendamiento/staff/${miUid}`));
  miPerfil = snap.exists() ? snap.val() : {};
}
function poblarSelectPaisesPerfil() {
  const sel = document.getElementById('perfil-pais');
  sel.innerHTML = listaPaises().map(p => `<option value="${p.nombre}" ${p.nombre === miPerfil.pais ? 'selected' : ''}>${p.nombre}</option>`).join('');
}
function renderPerfil() {
  document.getElementById('perfil-nombre').value = miPerfil.nombre || '';
  document.getElementById('perfil-apellido').value = miPerfil.apellido || '';
  document.getElementById('perfil-correo').value = miPerfil.correo || '';
  document.getElementById('perfil-whatsapp').value = miPerfil.whatsapp || '';
  document.getElementById('perfil-fecha-nacimiento').value = miPerfil.fechaNacimiento || '';
  poblarSelectPaisesPerfil();
  const preview = document.getElementById('perfil-foto-preview');
  if (miPerfil.fotoUrl) { preview.src = miPerfil.fotoUrl; preview.classList.remove('hidden'); } else { preview.classList.add('hidden'); }
}
document.getElementById('btn-guardar-perfil').addEventListener('click', async () => {
  const nombre = document.getElementById('perfil-nombre').value.trim();
  const apellido = document.getElementById('perfil-apellido').value.trim();
  const whatsapp = document.getElementById('perfil-whatsapp').value.trim();
  const fechaNacimiento = document.getElementById('perfil-fecha-nacimiento').value;
  const pais = document.getElementById('perfil-pais').value;
  const archivoFoto = document.getElementById('perfil-foto').files[0] || null;

  if (!nombre || !apellido || !whatsapp || !fechaNacimiento || !pais) {
    mostrarToast('⚠️ Completa todos los campos obligatorios'); return;
  }

  const btn = document.getElementById('btn-guardar-perfil');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    const datos = { nombre, apellido, whatsapp, fechaNacimiento, pais };
    if (archivoFoto) {
      const storageRef = sref(storageInstance, `fotos-perfil/${miUid}`);
      await uploadBytes(storageRef, archivoFoto);
      datos.fotoUrl = await getDownloadURL(storageRef);
    }
    await update(ref(db, `agendamiento/staff/${miUid}`), datos);
    miPerfil = { ...miPerfil, ...datos };
    document.getElementById('closer-nombre-sesion').textContent = `${miPerfil.nombre} ${miPerfil.apellido || ''}`.trim();
    document.getElementById('perfil-foto').value = '';
    renderPerfil();
    mostrarToast('✅ Perfil actualizado');
  } catch (err) {
    mostrarToast('⚠️ No se pudo guardar: ' + err.message);
  } finally { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
});

document.getElementById('btn-cambiar-password').addEventListener('click', async () => {
  const actual = document.getElementById('perfil-password-actual').value;
  const nueva = document.getElementById('perfil-password-nueva').value;
  const repetir = document.getElementById('perfil-password-repetir').value;

  if (!actual || !nueva || !repetir) { mostrarToast('⚠️ Completa las 3 contraseñas'); return; }
  if (nueva.length < 6) { mostrarToast('⚠️ La contraseña nueva debe tener al menos 6 caracteres'); return; }
  if (nueva !== repetir) { mostrarToast('⚠️ La contraseña nueva no coincide en ambos campos'); return; }

  const btn = document.getElementById('btn-cambiar-password');
  btn.disabled = true; btn.textContent = 'Cambiando...';
  try {
    const usuario = authInstance.currentUser;
    const credencial = EmailAuthProvider.credential(usuario.email, actual);
    await reauthenticateWithCredential(usuario, credencial);
    await updatePassword(usuario, nueva);
    document.getElementById('perfil-password-actual').value = '';
    document.getElementById('perfil-password-nueva').value = '';
    document.getElementById('perfil-password-repetir').value = '';
    mostrarToast('✅ Contraseña actualizada');
  } catch (err) {
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      mostrarToast('⚠️ Tu contraseña actual no es correcta');
    } else {
      mostrarToast('⚠️ No se pudo cambiar: ' + (err.code || err.message));
    }
  } finally { btn.disabled = false; btn.textContent = 'Cambiar contraseña'; }
});

/* --- Arranque --- */
iniciarSesionStaff('closer', async (uid) => {
  miUid = uid;
  await cargarAgenda(); renderAgenda();
  await cargarLeads(); renderLeads();
  await cargarDisponibilidad(); renderDisponibilidad();
  await cargarBloqueos(); renderBloqueos();
  await cargarPerfil(); renderPerfil();
  if (miPerfil.nombre) document.getElementById('closer-nombre-sesion').textContent = `${miPerfil.nombre} ${miPerfil.apellido || ''}`.trim();
});
