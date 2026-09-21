/* ============================================================
   director-comercial-mock.js — VISTA PREVIA del panel del Director
   Comercial. Guarda los cambios en localStorage (solo para poder
   revisar el panel entre recargas); en la versión conectada a
   Firebase (fase 4 del diseño) esto se reemplaza por lecturas y
   escrituras en agendamiento/config, sin cambiar el resto del
   archivo. La gestión de Closers y la Agenda General también usan
   datos de prueba por ahora.
   ============================================================ */

const CLAVE_STORAGE = 'uneq_agendamiento_config_demo';

const TIPOS_PREGUNTA = [
  { valor: 'texto_corto', etiqueta: 'Texto corto' },
  { valor: 'texto_largo', etiqueta: 'Texto largo' },
  { valor: 'seleccion_unica', etiqueta: 'Selección única' },
  { valor: 'seleccion_multiple', etiqueta: 'Selección múltiple' },
  { valor: 'numero', etiqueta: 'Número' },
  { valor: 'si_no', etiqueta: 'Sí / No' },
  { valor: 'telefono', etiqueta: 'Teléfono' },
  { valor: 'correo', etiqueta: 'Correo' }
];

function configPorDefecto() {
  return {
    general: { anticipacionMinimaHoras: 2, diasMaximoFuturo: 14, duracionMinutos: 45, colchonMinutos: 10, whatsappDudasNumero: '56900000000' },
    preguntas: [
      { id: 'q1', tipo: 'texto_corto', texto: '¿En qué rubro o industria trabaja tu negocio?', obligatoria: true, opciones: [] },
      { id: 'q2', tipo: 'seleccion_unica', texto: '¿Cuál es tu principal desafío hoy?', obligatoria: true, opciones: ['Conseguir clientes', 'Cerrar ventas', 'Organizar el equipo', 'Otro'] },
      { id: 'q3', tipo: 'numero', texto: '¿Cuántas ventas hiciste el mes pasado, aprox.?', obligatoria: false, opciones: [] },
      { id: 'q4', tipo: 'texto_largo', texto: 'Cuéntanos brevemente qué te gustaría lograr', obligatoria: true, opciones: [] }
    ],
    rotacion: { periodo: 'semanal' },
    recordatorios: [
      { id: 'r1', etiqueta: 'Recordatorio 1 — el mismo día', modo: 'mismo_dia', horaFija: '09:00', minutosAntes: 60, canalCorreo: true, canalWhatsapp: false,
        plantilla: 'Hola {{nombre}}, te recordamos tu llamada de hoy a las {{hora}} con el equipo de UNEQ. ¡Te esperamos!' },
      { id: 'r2', etiqueta: 'Recordatorio 2 — minutos antes', modo: 'minutos_antes', horaFija: '09:00', minutosAntes: 15, canalCorreo: false, canalWhatsapp: true,
        plantilla: 'Hola {{nombre}}, tu llamada con UNEQ empieza en {{minutos}} minutos. Link: {{linkMeet}}' }
    ],
    closers: [
      { id: 'c1', nombre: 'Carlos Muñoz', correo: 'carlos@agenciauneq.com', activo: true },
      { id: 'c2', nombre: 'Ana Torres', correo: 'ana@agenciauneq.com', activo: true },
      { id: 'c3', nombre: 'Diego Fuentes', correo: 'diego@agenciauneq.com', activo: false }
    ]
  };
}

function cargarConfig() {
  try {
    const guardado = localStorage.getItem(CLAVE_STORAGE);
    if (guardado) return JSON.parse(guardado);
  } catch (e) { /* si falla, usa default */ }
  return configPorDefecto();
}
function persistirConfig() {
  localStorage.setItem(CLAVE_STORAGE, JSON.stringify(estado));
}

let estado = cargarConfig();
let idPreguntaContador = estado.preguntas.length + 1;

/* --- Navegación --- */
document.querySelectorAll('.adm-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.adm-nav-item').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    document.querySelectorAll('.adm-seccion').forEach(s => s.classList.remove('is-activa'));
    document.getElementById('sec-' + btn.dataset.seccion).classList.add('is-activa');
  });
});

function mostrarToast(texto) {
  const toast = document.getElementById('toast');
  toast.textContent = texto;
  toast.classList.add('is-visible');
  setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

/* --- GENERAL --- */
function renderGeneral() {
  document.getElementById('gen-anticipacion').value = estado.general.anticipacionMinimaHoras;
  document.getElementById('gen-dias-futuro').value = estado.general.diasMaximoFuturo;
  document.getElementById('gen-duracion').value = estado.general.duracionMinutos;
  document.getElementById('gen-colchon').value = estado.general.colchonMinutos;
  document.getElementById('gen-whatsapp-dudas').value = estado.general.whatsappDudasNumero;
}
document.querySelector('[data-guardar="general"]').addEventListener('click', () => {
  estado.general = {
    anticipacionMinimaHoras: Number(document.getElementById('gen-anticipacion').value) || 0,
    diasMaximoFuturo: Number(document.getElementById('gen-dias-futuro').value) || 1,
    duracionMinutos: Number(document.getElementById('gen-duracion').value) || 30,
    colchonMinutos: Number(document.getElementById('gen-colchon').value) || 0,
    whatsappDudasNumero: document.getElementById('gen-whatsapp-dudas').value.trim()
  };
  persistirConfig();
  mostrarToast('✅ Configuración general guardada');
});

/* --- PREGUNTAS --- */
function renderPreguntas() {
  const cont = document.getElementById('preguntas-lista');
  cont.innerHTML = estado.preguntas.map((p, idx) => `
    <div class="adm-pregunta-card" data-id="${p.id}">
      <div class="adm-pregunta-card__header">
        <span class="badge-tipo">${TIPOS_PREGUNTA.find(t => t.valor === p.tipo).etiqueta}</span>
        <div class="adm-pregunta-card__acciones">
          <button type="button" class="adm-icon-btn" data-accion="subir" ${idx === 0 ? 'disabled' : ''} title="Subir">↑</button>
          <button type="button" class="adm-icon-btn" data-accion="bajar" ${idx === estado.preguntas.length - 1 ? 'disabled' : ''} title="Bajar">↓</button>
          <button type="button" class="adm-icon-btn adm-icon-btn--danger" data-accion="eliminar" title="Eliminar">🗑</button>
        </div>
      </div>
      <div class="ag-field" style="margin-bottom:8px;">
        <select data-campo="tipo">${TIPOS_PREGUNTA.map(t => `<option value="${t.valor}" ${t.valor === p.tipo ? 'selected' : ''}>${t.etiqueta}</option>`).join('')}</select>
      </div>
      <div class="ag-field" style="margin-bottom:0;">
        <input type="text" data-campo="texto" value="${p.texto.replace(/"/g, '&quot;')}" placeholder="Texto de la pregunta">
      </div>
      ${p.tipo === 'seleccion_unica' || p.tipo === 'seleccion_multiple' ? `
        <div class="adm-opciones-lista" data-opciones>
          ${p.opciones.map((o, oi) => `<span class="op">${o} <button type="button" data-quitar-opcion="${oi}">✕</button></span>`).join('')}
          <button type="button" class="adm-btn-agregar-opcion" data-accion="agregar-opcion">+ opción</button>
        </div>` : ''}
      <label class="adm-toggle-obligatoria">
        <input type="checkbox" data-campo="obligatoria" ${p.obligatoria ? 'checked' : ''}> Obligatoria
      </label>
    </div>
  `).join('');

  cont.querySelectorAll('.adm-pregunta-card').forEach(card => {
    const id = card.dataset.id;
    const p = estado.preguntas.find(x => x.id === id);

    card.querySelector('[data-campo="tipo"]').addEventListener('change', (e) => { p.tipo = e.target.value; renderPreguntas(); });
    card.querySelector('[data-campo="texto"]').addEventListener('input', (e) => { p.texto = e.target.value; });
    card.querySelector('[data-campo="obligatoria"]').addEventListener('change', (e) => { p.obligatoria = e.target.checked; });

    card.querySelectorAll('[data-quitar-opcion]').forEach(b => {
      b.addEventListener('click', () => { p.opciones.splice(Number(b.dataset.quitarOpcion), 1); renderPreguntas(); });
    });
    const btnAgregarOpcion = card.querySelector('[data-accion="agregar-opcion"]');
    if (btnAgregarOpcion) btnAgregarOpcion.addEventListener('click', () => {
      const texto = prompt('Texto de la nueva opción:');
      if (texto && texto.trim()) { p.opciones.push(texto.trim()); renderPreguntas(); }
    });

    card.querySelector('[data-accion="eliminar"]').addEventListener('click', () => {
      if (!confirm('¿Eliminar esta pregunta?')) return;
      estado.preguntas = estado.preguntas.filter(x => x.id !== id);
      persistirConfig(); renderPreguntas(); mostrarToast('Pregunta eliminada');
    });
    card.querySelector('[data-accion="subir"]').addEventListener('click', () => moverPregunta(id, -1));
    card.querySelector('[data-accion="bajar"]').addEventListener('click', () => moverPregunta(id, 1));
  });
}
function moverPregunta(id, delta) {
  const idx = estado.preguntas.findIndex(x => x.id === id);
  const nuevoIdx = idx + delta;
  if (nuevoIdx < 0 || nuevoIdx >= estado.preguntas.length) return;
  const [item] = estado.preguntas.splice(idx, 1);
  estado.preguntas.splice(nuevoIdx, 0, item);
  persistirConfig(); renderPreguntas();
}
document.getElementById('btn-agregar-pregunta').addEventListener('click', () => {
  estado.preguntas.push({ id: 'q' + (idPreguntaContador++), tipo: 'texto_corto', texto: '', obligatoria: true, opciones: [] });
  persistirConfig(); renderPreguntas();
  mostrarToast('Pregunta agregada — edítala y se guarda sola');
});

/* --- ROTACIÓN --- */
function renderRotacion() { document.getElementById('rot-periodo').value = estado.rotacion.periodo; }
document.querySelector('[data-guardar="rotacion"]').addEventListener('click', () => {
  estado.rotacion.periodo = document.getElementById('rot-periodo').value;
  persistirConfig();
  mostrarToast('✅ Reparto rotativo guardado');
});

/* --- RECORDATORIOS --- */
function renderRecordatorios() {
  const cont = document.getElementById('recordatorios-lista');
  cont.innerHTML = estado.recordatorios.map(r => `
    <div class="adm-recordatorio-card" data-id="${r.id}">
      <h3>${r.etiqueta}</h3>
      <div class="ag-field">
        <label>¿Cuándo se envía?</label>
        <select data-campo="modo">
          <option value="mismo_dia" ${r.modo === 'mismo_dia' ? 'selected' : ''}>El mismo día, a una hora fija</option>
          <option value="minutos_antes" ${r.modo === 'minutos_antes' ? 'selected' : ''}>X minutos antes de la llamada</option>
        </select>
      </div>
      <div class="ag-field" data-campo-hora style="${r.modo !== 'mismo_dia' ? 'display:none;' : ''}">
        <label>Hora del envío (hora local del lead)</label>
        <input type="time" data-campo="horaFija" value="${r.horaFija}">
      </div>
      <div class="ag-field" data-campo-minutos style="${r.modo !== 'minutos_antes' ? 'display:none;' : ''}">
        <label>Minutos antes de la llamada</label>
        <input type="number" data-campo="minutosAntes" min="1" value="${r.minutosAntes}">
      </div>
      <div class="adm-canal-opciones">
        <label><input type="checkbox" data-campo="canalCorreo" ${r.canalCorreo ? 'checked' : ''}> Correo</label>
        <label><input type="checkbox" data-campo="canalWhatsapp" ${r.canalWhatsapp ? 'checked' : ''}> WhatsApp</label>
      </div>
      <div class="ag-field" style="margin-bottom:0;">
        <label>Plantilla del mensaje</label>
        <textarea data-campo="plantilla">${r.plantilla}</textarea>
        <small class="ag-hint">Variables disponibles: {{nombre}}, {{fecha}}, {{hora}}, {{minutos}}, {{linkMeet}}</small>
      </div>
    </div>
  `).join('');

  cont.querySelectorAll('.adm-recordatorio-card').forEach(card => {
    const id = card.dataset.id;
    const r = estado.recordatorios.find(x => x.id === id);
    const selectModo = card.querySelector('[data-campo="modo"]');
    selectModo.addEventListener('change', () => {
      r.modo = selectModo.value;
      card.querySelector('[data-campo-hora]').style.display = r.modo === 'mismo_dia' ? '' : 'none';
      card.querySelector('[data-campo-minutos]').style.display = r.modo === 'minutos_antes' ? '' : 'none';
    });
    card.querySelector('[data-campo="horaFija"]').addEventListener('input', (e) => { r.horaFija = e.target.value; });
    card.querySelector('[data-campo="minutosAntes"]').addEventListener('input', (e) => { r.minutosAntes = Number(e.target.value); });
    card.querySelector('[data-campo="canalCorreo"]').addEventListener('change', (e) => { r.canalCorreo = e.target.checked; });
    card.querySelector('[data-campo="canalWhatsapp"]').addEventListener('change', (e) => { r.canalWhatsapp = e.target.checked; });
    card.querySelector('[data-campo="plantilla"]').addEventListener('input', (e) => { r.plantilla = e.target.value; });
  });
}
document.querySelector('[data-guardar="recordatorios"]').addEventListener('click', () => {
  const sinCanal = estado.recordatorios.find(r => !r.canalCorreo && !r.canalWhatsapp);
  if (sinCanal) { mostrarToast('⚠️ Elige al menos un canal para cada recordatorio'); return; }
  persistirConfig();
  mostrarToast('✅ Recordatorios guardados');
});

/* --- CLOSERS --- */
function renderClosers() {
  const tbody = document.querySelector('#tabla-closers tbody');
  tbody.innerHTML = estado.closers.map(c => `
    <tr data-id="${c.id}">
      <td>${c.nombre}</td>
      <td>${c.correo}</td>
      <td><span class="adm-badge-estado ${c.activo ? 'activo' : 'inactivo'}">${c.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td><button type="button" class="ag-btn ag-btn--ghost" style="width:auto; padding:6px 12px; font-size:12.5px;" data-accion="toggle">${c.activo ? 'Desactivar' : 'Activar'}</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-accion="toggle"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      const c = estado.closers.find(x => x.id === id);
      c.activo = !c.activo;
      persistirConfig(); renderClosers();
      mostrarToast(c.activo ? `${c.nombre} activado` : `${c.nombre} desactivado`);
    });
  });
}
document.getElementById('btn-agregar-closer').addEventListener('click', () => {
  const nombre = document.getElementById('closer-nombre').value.trim();
  const correo = document.getElementById('closer-correo').value.trim();
  if (!nombre || !correo) { mostrarToast('⚠️ Completa nombre y correo'); return; }
  estado.closers.push({ id: 'c' + Date.now(), nombre, correo, activo: true });
  persistirConfig(); renderClosers();
  document.getElementById('closer-nombre').value = '';
  document.getElementById('closer-correo').value = '';
  mostrarToast('✅ Closer agregado (solo en esta vista de prueba)');
});

/* --- AGENDA GENERAL (datos de prueba) --- */
function renderAgendaMock() {
  const nombres = estado.closers.filter(c => c.activo).map(c => c.nombre);
  const leads = ['María P.', 'Jorge L.', 'Camila S.', 'Roberto A.', 'Valentina R.'];
  const estados = ['Agendada', 'Agendada', 'Realizada', 'No-Show', 'Agendada'];
  const filas = leads.map((lead, i) => {
    const fecha = new Date(); fecha.setDate(fecha.getDate() + i);
    return `<tr>
      <td>${fecha.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}</td>
      <td>${10 + i}:00</td>
      <td>${nombres[i % nombres.length] || '—'}</td>
      <td>${lead}</td>
      <td><span class="adm-badge-estado ${estados[i] === 'No-Show' ? 'inactivo' : 'activo'}">${estados[i]}</span></td>
    </tr>`;
  }).join('');
  document.querySelector('#tabla-agenda tbody').innerHTML = filas;
}

/* --- Arranque --- */
renderGeneral();
renderPreguntas();
renderRotacion();
renderRecordatorios();
renderClosers();
renderAgendaMock();
