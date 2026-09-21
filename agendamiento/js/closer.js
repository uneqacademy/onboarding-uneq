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
import { iniciarSesionStaff } from './staff-auth.js';

const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DIAS_SEMANA_LABEL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const HORAS_GRID = Array.from({ length: 21 }, (_, i) => { const h = 9 + Math.floor(i / 2); const m = i % 2 === 0 ? '00' : '30'; return `${String(h).padStart(2, '0')}:${m}`; });
const ETIQUETAS_ESTADO = {
  se_presento: { texto: 'Se presenta a llamada', clase: 'se-presento' }, en_seguimiento: { texto: 'En Seguimiento', clase: 'en-seguimiento' },
  cerrado: { texto: 'Cerrado', clase: 'cerrado' }, no_show: { texto: 'No-Show', clase: 'no-show' }, baja: { texto: 'Dado de baja', clase: 'baja' }
};
const PROGRAMAS = [{ v: 'begin', t: 'Begin' }, { v: 'next', t: 'Next' }, { v: 'exit', t: 'eXIT' }];

let miUid = null;
let citasAgenda = [], leads = [], disponibilidad = {}, bloqueos = [];
let subtabLeadsActual = 'activos';

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
  const filtrados = leads.filter(l => (subtabLeadsActual === 'activos') === !l.archivada).sort((a, b) => b.createdAt - a.createdAt);
  if (!filtrados.length) { cont.innerHTML = `<p style="color:var(--color-ink-soft);">${subtabLeadsActual === 'activos' ? 'No tienes leads activos por ahora.' : 'Aún no tienes leads archivados.'}</p>`; return; }

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
        await set(push(ref(db, 'agendamiento/recienCerrados')), { nombre: lead.nombre, telefono: lead.telefono, programa, closerId: miUid, createdAt: Date.now() });
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
  grid.querySelectorAll('.adm-disp-celda').forEach(celda => {
    celda.addEventListener('click', () => {
      const dia = celda.dataset.dia, h = Number(celda.dataset.h);
      if (!disponibilidad[dia]) disponibilidad[dia] = HORAS_GRID.map(() => false);
      disponibilidad[dia][h] = !disponibilidad[dia][h];
      celda.classList.toggle('is-activa');
    });
  });
}
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

/* --- Arranque --- */
iniciarSesionStaff('closer', async (uid) => {
  miUid = uid;
  await cargarAgenda(); renderAgenda();
  await cargarLeads(); renderLeads();
  await cargarDisponibilidad(); renderDisponibilidad();
  await cargarBloqueos(); renderBloqueos();
});
