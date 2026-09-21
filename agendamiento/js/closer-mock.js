/* ============================================================
   closer-mock.js — VISTA PREVIA del panel del Closer. Guarda en
   localStorage solo para poder revisar el panel entre recargas.
   En la versión conectada a Firebase (fase 4), esto lee y escribe
   en agendamiento/citas, agendamiento/leadsPorCloser,
   agendamiento/disponibilidad y agendamiento/bloqueos.

   Lee la duración y el colchón desde la MISMA clave de localStorage
   que usa director-comercial-mock.js, para mostrar el dato real que
   configuró el Director Comercial (en la versión real sería la
   misma lectura, desde agendamiento/config/general).
   ============================================================ */

const CLAVE_STORAGE_CONFIG = 'uneq_agendamiento_config_demo';
const CLAVE_STORAGE_CLOSER = 'uneq_agendamiento_closer_demo';

const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DIAS_SEMANA_LABEL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const HORAS_GRID = Array.from({ length: 21 }, (_, i) => { const h = 9 + Math.floor(i / 2); const m = i % 2 === 0 ? '00' : '30'; return `${String(h).padStart(2, '0')}:${m}`; });

const ETIQUETAS_ESTADO = {
  se_presento: { texto: 'Se presenta a llamada', clase: 'se-presento' },
  en_seguimiento: { texto: 'En Seguimiento', clase: 'en-seguimiento' },
  cerrado: { texto: 'Cerrado', clase: 'cerrado' },
  no_show: { texto: 'No-Show', clase: 'no-show' },
  baja: { texto: 'Dado de baja', clase: 'baja' }
};
const PROGRAMAS = [{ v: 'begin', t: 'Begin' }, { v: 'next', t: 'Next' }, { v: 'exit', t: 'eXIT' }];

function datosPorDefecto() {
  const ahora = Date.now();
  const enHoras = (h) => ahora + h * 3600000;
  return {
    citasAgenda: [
      { id: 'ct1', horaInicio: enHoras(20), nombre: 'María Paz González', correo: 'mpaz@correo.com', telefono: '+56911112222',
        respuestas: { '¿En qué rubro o industria trabaja tu negocio?': 'Venta de ropa online', '¿Cuál es tu principal desafío hoy?': 'Cerrar ventas' } },
      { id: 'ct2', horaInicio: enHoras(44), nombre: 'Jorge Lagos', correo: 'jlagos@correo.com', telefono: '+56922223333',
        respuestas: { '¿En qué rubro o industria trabaja tu negocio?': 'Coaching deportivo', '¿Cuál es tu principal desafío hoy?': 'Conseguir clientes' } }
    ],
    leads: [
      { id: 'ld1', nombre: 'Camila Soto', correo: 'camila@correo.com', telefono: '+56933334444', estado: 'en_seguimiento', programa: null, archivada: false,
        bitacora: [{ texto: 'Tuvimos la llamada, muy interesada. Le envié la propuesta por correo.', fecha: Date.now() - 86400000 * 2 }, { texto: 'Me escribió por WhatsApp, está evaluando con su socio.', fecha: Date.now() - 86400000 }] },
      { id: 'ld2', nombre: 'Roberto Álvarez', correo: 'roberto@correo.com', telefono: '+56944445555', estado: 'se_presento', programa: null, archivada: false,
        bitacora: [{ texto: 'Llamada realizada — se presentó.', fecha: Date.now() - 3600000 * 5 }] },
      { id: 'ld3', nombre: 'Valentina Rojas', correo: 'valentina@correo.com', telefono: '+56955556666', estado: 'cerrado', programa: 'next', archivada: true,
        bitacora: [{ texto: 'Llamada realizada — se presentó.', fecha: Date.now() - 86400000 * 4 }, { texto: '¡Cerró Next! Pasa a Recién Cerrados.', fecha: Date.now() - 86400000 * 3 }] },
      { id: 'ld4', nombre: 'Andrés Pizarro', correo: 'andres@correo.com', telefono: '+56966667777', estado: 'no_show', programa: null, archivada: true,
        bitacora: [{ texto: 'No se presentó a la llamada agendada.', fecha: Date.now() - 86400000 * 6 }] }
    ],
    disponibilidad: null, // se genera con generarDisponibilidadDefecto()
    bloqueos: [
      { id: 'bl1', fecha: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10), desde: '15:00', hasta: '17:00' }
    ]
  };
}
function generarDisponibilidadDefecto() {
  const d = {};
  DIAS_SEMANA.forEach((dia, idx) => {
    d[dia] = HORAS_GRID.map(h => idx < 5 && h >= '10:00' && h < '18:00'); // lun-vie, 10 a 18, activo por defecto
  });
  return d;
}

function cargarConfigCompartida() {
  try {
    const guardado = localStorage.getItem(CLAVE_STORAGE_CONFIG);
    if (guardado) return JSON.parse(guardado).general;
  } catch (e) { /* usa default */ }
  return { duracionMinutos: 45, colchonMinutos: 10 };
}
function cargarDatosCloser() {
  try {
    const guardado = localStorage.getItem(CLAVE_STORAGE_CLOSER);
    if (guardado) {
      const datos = JSON.parse(guardado);
      if (!datos.disponibilidad) datos.disponibilidad = generarDisponibilidadDefecto();
      return datos;
    }
  } catch (e) { /* usa default */ }
  const d = datosPorDefecto();
  d.disponibilidad = generarDisponibilidadDefecto();
  return d;
}
function persistir() { localStorage.setItem(CLAVE_STORAGE_CLOSER, JSON.stringify(estado)); }

let estado = cargarDatosCloser();
const configCompartida = cargarConfigCompartida();
let subtabLeadsActual = 'activos';

/* --- Navegación --- */
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
  toast.textContent = texto;
  toast.classList.add('is-visible');
  setTimeout(() => toast.classList.remove('is-visible'), 2200);
}
function formatearFechaHora(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/* --- MI AGENDA --- */
function renderAgenda() {
  const cont = document.getElementById('agenda-lista');
  const citas = [...estado.citasAgenda].sort((a, b) => a.horaInicio - b.horaInicio);
  if (!citas.length) { cont.innerHTML = '<p class="text-soft" style="color:var(--color-ink-soft);">No tienes llamadas próximas por marcar.</p>'; return; }

  cont.innerHTML = citas.map(c => `
    <div class="adm-cita-card" data-id="${c.id}">
      <div class="adm-cita-card__top">
        <span class="adm-cita-card__fecha">${formatearFechaHora(c.horaInicio)}</span>
        <span class="adm-cita-card__nombre">${c.nombre}</span>
      </div>
      <p class="adm-cita-card__meta">${c.correo} · ${c.telefono}</p>
      <dl class="adm-cita-card__respuestas">
        ${Object.entries(c.respuestas).map(([p, r]) => `<dt>${p}</dt><dd>${r}</dd>`).join('')}
      </dl>
      <div class="adm-cita-card__acciones">
        <button type="button" class="adm-btn-chico adm-btn-chico--accent" data-accion="se-presento">✅ Se presentó</button>
        <button type="button" class="adm-btn-chico adm-btn-chico--danger" data-accion="no-show">❌ No-Show</button>
      </div>
    </div>
  `).join('');

  cont.querySelectorAll('.adm-cita-card').forEach(card => {
    const id = card.dataset.id;
    const cita = estado.citasAgenda.find(c => c.id === id);
    card.querySelector('[data-accion="se-presento"]').addEventListener('click', () => marcarResultado(cita, 'se_presento'));
    card.querySelector('[data-accion="no-show"]').addEventListener('click', () => marcarResultado(cita, 'no_show'));
  });
}
function marcarResultado(cita, resultado) {
  estado.citasAgenda = estado.citasAgenda.filter(c => c.id !== cita.id);
  const esNoShow = resultado === 'no_show';
  estado.leads.unshift({
    id: 'ld' + Date.now(), nombre: cita.nombre, correo: cita.correo, telefono: cita.telefono,
    estado: resultado, programa: null, archivada: esNoShow,
    bitacora: [{ texto: esNoShow ? 'No se presentó a la llamada agendada.' : 'Llamada realizada — se presentó.', fecha: Date.now() }]
  });
  persistir(); renderAgenda(); renderLeads();
  mostrarToast(esNoShow ? 'Marcado como No-Show' : '✅ Lead pasó a "Se presenta a llamada"');
}

/* --- MIS LEADS --- */
function renderLeads() {
  const cont = document.getElementById('leads-lista');
  const leads = estado.leads.filter(l => (subtabLeadsActual === 'activos') === !l.archivada);
  if (!leads.length) { cont.innerHTML = `<p style="color:var(--color-ink-soft);">${subtabLeadsActual === 'activos' ? 'No tienes leads activos por ahora.' : 'Aún no tienes leads archivados.'}</p>`; return; }

  cont.innerHTML = leads.map(l => {
    const et = ETIQUETAS_ESTADO[l.estado];
    const etiquetaTxt = l.estado === 'cerrado' && l.programa ? `Cerrado (${PROGRAMAS.find(p => p.v === l.programa).t})` : et.texto;
    return `
    <div class="adm-cita-card" data-id="${l.id}">
      <div class="adm-cita-card__top">
        <span class="adm-badge-lead ${et.clase}">${etiquetaTxt}</span>
        <span class="adm-cita-card__nombre">${l.nombre}</span>
      </div>
      <p class="adm-cita-card__meta">${l.correo} · ${l.telefono}</p>
      <div class="adm-bitacora-lista">
        ${l.bitacora.slice().reverse().map(b => `<div class="adm-bitacora-entrada"><time>${new Date(b.fecha).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>${b.texto}</div>`).join('')}
      </div>
      ${!l.archivada ? `
        <div class="adm-bitacora-nueva">
          <input type="text" placeholder="Agregar una nota de seguimiento…" data-nota>
          <button type="button" class="adm-btn-chico" data-accion="agregar-nota">Agregar</button>
        </div>
        <div class="adm-cita-card__acciones" style="margin-top:12px;">
          ${l.estado === 'se_presento' ? `
            <button type="button" class="adm-btn-chico adm-btn-chico--accent" data-accion="cierra">🏆 Cierra en llamada</button>
            <button type="button" class="adm-btn-chico" data-accion="seguimiento">↪ Pasar a Seguimiento</button>
          ` : ''}
          ${l.estado === 'en_seguimiento' ? `
            <button type="button" class="adm-btn-chico adm-btn-chico--accent" data-accion="cierra">🏆 Cierra en Seguimiento</button>
            <button type="button" class="adm-btn-chico adm-btn-chico--danger" data-accion="baja">Dado de baja</button>
          ` : ''}
        </div>
        <div class="adm-cita-card__acciones hidden" data-selector-programa style="margin-top:10px;">
          <span style="font-size:12.5px; color:var(--color-ink-soft); align-self:center;">¿Qué programa cerró?</span>
          ${PROGRAMAS.map(p => `<button type="button" class="adm-btn-chico" data-programa="${p.v}">${p.t}</button>`).join('')}
        </div>
      ` : `
        <button type="button" class="adm-btn-chico" data-accion="reabrir" style="margin-top:8px;">↩ Reabrir</button>
      `}
    </div>`;
  }).join('');

  cont.querySelectorAll('.adm-cita-card').forEach(card => {
    const id = card.dataset.id;
    const lead = estado.leads.find(l => l.id === id);

    card.querySelector('[data-accion="agregar-nota"]')?.addEventListener('click', () => {
      const input = card.querySelector('[data-nota]');
      if (!input.value.trim()) return;
      lead.bitacora.push({ texto: input.value.trim(), fecha: Date.now() });
      persistir(); renderLeads();
      mostrarToast('Nota agregada a la bitácora');
    });
    card.querySelector('[data-accion="seguimiento"]')?.addEventListener('click', () => {
      lead.estado = 'en_seguimiento';
      lead.bitacora.push({ texto: 'Pasa a En Seguimiento.', fecha: Date.now() });
      persistir(); renderLeads();
      mostrarToast('Lead pasó a "En Seguimiento"');
    });
    card.querySelector('[data-accion="baja"]')?.addEventListener('click', () => {
      if (!confirm('¿Dar de baja a este lead?')) return;
      lead.estado = 'baja'; lead.archivada = true;
      lead.bitacora.push({ texto: 'Lead dado de baja.', fecha: Date.now() });
      persistir(); renderLeads();
      mostrarToast('Lead dado de baja');
    });
    card.querySelector('[data-accion="cierra"]')?.addEventListener('click', () => {
      card.querySelector('[data-selector-programa]').classList.toggle('hidden');
    });
    card.querySelectorAll('[data-programa]').forEach(btn => {
      btn.addEventListener('click', () => {
        lead.estado = 'cerrado'; lead.archivada = true; lead.programa = btn.dataset.programa;
        lead.bitacora.push({ texto: `¡Cerró ${PROGRAMAS.find(p => p.v === btn.dataset.programa).t}! Pasa a Recién Cerrados.`, fecha: Date.now() });
        persistir(); renderLeads();
        mostrarToast(`✅ Cierre registrado — pasa a Recién Cerrados`);
      });
    });
    card.querySelector('[data-accion="reabrir"]')?.addEventListener('click', () => {
      lead.archivada = false; lead.estado = 'en_seguimiento';
      lead.bitacora.push({ texto: 'Lead reabierto.', fecha: Date.now() });
      persistir(); renderLeads();
      mostrarToast('↩ Lead reabierto — ahora está "En Seguimiento"');
    });
  });
}

/* --- DISPONIBILIDAD --- */
function renderDisponibilidad() {
  document.getElementById('disp-sub').textContent =
    `Marca los horarios en los que puedes recibir llamadas. Cada llamada dura ${configCompartida.duracionMinutos} min, con ${configCompartida.colchonMinutos} min de colchón después (lo define tu Director Comercial). Se repite cada semana.`;

  const grid = document.getElementById('disp-grid');
  let html = '<div></div>' + DIAS_SEMANA_LABEL.map(d => `<div class="cabecera">${d}</div>`).join('');
  HORAS_GRID.forEach((hora, hIdx) => {
    html += `<div class="hora-label">${hora}</div>`;
    DIAS_SEMANA.forEach(dia => {
      const activa = estado.disponibilidad[dia][hIdx];
      html += `<div class="adm-disp-celda ${activa ? 'is-activa' : ''}" data-dia="${dia}" data-h="${hIdx}"></div>`;
    });
  });
  grid.innerHTML = html;

  grid.querySelectorAll('.adm-disp-celda').forEach(celda => {
    celda.addEventListener('click', () => {
      const dia = celda.dataset.dia, h = Number(celda.dataset.h);
      estado.disponibilidad[dia][h] = !estado.disponibilidad[dia][h];
      celda.classList.toggle('is-activa');
    });
  });
}
document.getElementById('btn-guardar-disponibilidad').addEventListener('click', () => {
  persistir();
  mostrarToast('✅ Disponibilidad guardada');
});

/* --- BLOQUEOS --- */
function renderBloqueos() {
  const cont = document.getElementById('bloqueos-lista');
  const bloqueos = [...estado.bloqueos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!bloqueos.length) { cont.innerHTML = '<p style="color:var(--color-ink-soft);">No tienes bloqueos agendados.</p>'; return; }
  cont.innerHTML = bloqueos.map(b => `
    <div class="adm-bloqueo-item" data-id="${b.id}">
      <span>📅 ${new Date(b.fecha + 'T00:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })} · ${b.desde} – ${b.hasta}</span>
      <button type="button" class="adm-icon-btn adm-icon-btn--danger" data-accion="eliminar">🗑</button>
    </div>
  `).join('');
  cont.querySelectorAll('[data-accion="eliminar"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.adm-bloqueo-item').dataset.id;
      estado.bloqueos = estado.bloqueos.filter(b => b.id !== id);
      persistir(); renderBloqueos();
      mostrarToast('Bloqueo eliminado');
    });
  });
}
document.getElementById('btn-agregar-bloqueo').addEventListener('click', () => {
  const fecha = document.getElementById('bloqueo-fecha').value;
  const desde = document.getElementById('bloqueo-desde').value;
  const hasta = document.getElementById('bloqueo-hasta').value;
  if (!fecha || !desde || !hasta) { mostrarToast('⚠️ Completa fecha, desde y hasta'); return; }
  if (hasta <= desde) { mostrarToast('⚠️ La hora "hasta" debe ser mayor que "desde"'); return; }
  estado.bloqueos.push({ id: 'bl' + Date.now(), fecha, desde, hasta });
  persistir(); renderBloqueos();
  document.getElementById('bloqueo-fecha').value = '';
  document.getElementById('bloqueo-desde').value = '';
  document.getElementById('bloqueo-hasta').value = '';
  mostrarToast('✅ Bloqueo agregado');
});

/* --- Arranque --- */
renderAgenda();
renderLeads();
renderDisponibilidad();
renderBloqueos();
