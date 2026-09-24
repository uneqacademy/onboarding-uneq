/* ============================================================
   director-comercial.js — panel real, conectado a Firebase. Mismo
   HTML/CSS ya validado en la vista previa; acá solo cambia de
   dónde vienen y a dónde van los datos (antes: localStorage / ahora:
   agendamiento/config, agendamiento/staff, agendamiento/citas).
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, set, update, push, onValue } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getAuth, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { getStorage, ref as sref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { iniciarSesionStaff } from './staff-auth.js';

const authInstance = getAuth();
const storageInstance = getStorage();

/* Lista de países (código + nombre en español), generada con Intl para no
   mantener una lista a mano. Si el navegador no soporta esta API (muy
   poco común hoy), cae a una lista corta de respaldo. */
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

const TIPOS_PREGUNTA = [
  { valor: 'texto_corto', etiqueta: 'Texto corto' }, { valor: 'texto_largo', etiqueta: 'Texto largo' },
  { valor: 'seleccion_unica', etiqueta: 'Selección única' }, { valor: 'seleccion_multiple', etiqueta: 'Selección múltiple' },
  { valor: 'numero', etiqueta: 'Número' }, { valor: 'si_no', etiqueta: 'Sí / No' },
  { valor: 'telefono', etiqueta: 'Teléfono' }, { valor: 'correo', etiqueta: 'Correo' }
];

let general = {}, preguntas = [], recordatorios = {}, closers = [], citasTodas = [];

/* --- Navegación (igual que antes) --- */
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
  toast.textContent = texto; toast.classList.add('is-visible');
  setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

/* --- GENERAL --- */
function renderGeneral() {
  document.getElementById('gen-anticipacion').value = general.anticipacionMinimaHoras ?? 2;
  document.getElementById('gen-dias-futuro').value = general.diasMaximoFuturo ?? 14;
  document.getElementById('gen-duracion').value = general.duracionMinutos ?? 45;
  document.getElementById('gen-colchon').value = general.colchonMinutos ?? 10;
  document.getElementById('gen-whatsapp-dudas').value = general.whatsappDudasNumero || '';
}
document.querySelector('[data-guardar="general"]').addEventListener('click', async () => {
  general = {
    ...general,
    anticipacionMinimaHoras: Number(document.getElementById('gen-anticipacion').value) || 0,
    diasMaximoFuturo: Number(document.getElementById('gen-dias-futuro').value) || 1,
    duracionMinutos: Number(document.getElementById('gen-duracion').value) || 30,
    colchonMinutos: Number(document.getElementById('gen-colchon').value) || 0,
    whatsappDudasNumero: document.getElementById('gen-whatsapp-dudas').value.trim()
  };
  await set(ref(db, 'agendamiento/config/general'), general);
  mostrarToast('✅ Configuración general guardada');
});

/* --- PREGUNTAS --- */
function renderPreguntas() {
  const cont = document.getElementById('preguntas-lista');
  cont.innerHTML = preguntas.map((p, idx) => `
    <div class="adm-pregunta-card" data-id="${p.id}">
      <div class="adm-pregunta-card__header">
        <span class="badge-tipo">${TIPOS_PREGUNTA.find(t => t.valor === p.tipo).etiqueta}</span>
        <div class="adm-pregunta-card__acciones">
          <button type="button" class="adm-icon-btn" data-accion="subir" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="adm-icon-btn" data-accion="bajar" ${idx === preguntas.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="adm-icon-btn adm-icon-btn--danger" data-accion="eliminar">🗑</button>
        </div>
      </div>
      <div class="ag-field" style="margin-bottom:8px;"><select data-campo="tipo">${TIPOS_PREGUNTA.map(t => `<option value="${t.valor}" ${t.valor === p.tipo ? 'selected' : ''}>${t.etiqueta}</option>`).join('')}</select></div>
      <div class="ag-field" style="margin-bottom:0;"><input type="text" data-campo="texto" value="${(p.texto || '').replace(/"/g, '&quot;')}" placeholder="Texto de la pregunta"></div>
      ${p.tipo === 'seleccion_unica' || p.tipo === 'seleccion_multiple' ? `
        <div class="adm-opciones-lista">
          ${(p.opciones || []).map((o, oi) => `<span class="op">${o} <button type="button" data-quitar-opcion="${oi}">✕</button></span>`).join('')}
          <button type="button" class="adm-btn-agregar-opcion" data-accion="agregar-opcion">+ opción</button>
        </div>` : ''}
      <label class="adm-toggle-obligatoria"><input type="checkbox" data-campo="obligatoria" ${p.obligatoria ? 'checked' : ''}> Obligatoria</label>
    </div>`).join('');

  cont.querySelectorAll('.adm-pregunta-card').forEach(card => {
    const id = card.dataset.id; const p = preguntas.find(x => x.id === id);
    card.querySelector('[data-campo="tipo"]').addEventListener('change', async (e) => { p.tipo = e.target.value; await guardarPregunta(p); renderPreguntas(); });
    card.querySelector('[data-campo="texto"]').addEventListener('input', (e) => { p.texto = e.target.value; });
    card.querySelector('[data-campo="texto"]').addEventListener('blur', () => guardarPregunta(p));
    card.querySelector('[data-campo="obligatoria"]').addEventListener('change', async (e) => { p.obligatoria = e.target.checked; await guardarPregunta(p); });
    card.querySelectorAll('[data-quitar-opcion]').forEach(b => b.addEventListener('click', async () => { p.opciones.splice(Number(b.dataset.quitarOpcion), 1); await guardarPregunta(p); renderPreguntas(); }));
    const btnOp = card.querySelector('[data-accion="agregar-opcion"]');
    if (btnOp) btnOp.addEventListener('click', async () => { const t = prompt('Texto de la nueva opción:'); if (t && t.trim()) { p.opciones = p.opciones || []; p.opciones.push(t.trim()); await guardarPregunta(p); renderPreguntas(); } });
    card.querySelector('[data-accion="eliminar"]').addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta pregunta?')) return;
      await set(ref(db, `agendamiento/config/preguntas/${id}`), null);
      preguntas = preguntas.filter(x => x.id !== id);
      renderPreguntas(); mostrarToast('Pregunta eliminada');
    });
    card.querySelector('[data-accion="subir"]').addEventListener('click', () => moverPregunta(id, -1));
    card.querySelector('[data-accion="bajar"]').addEventListener('click', () => moverPregunta(id, 1));
  });
}
async function guardarPregunta(p) { await set(ref(db, `agendamiento/config/preguntas/${p.id}`), { tipo: p.tipo, texto: p.texto, obligatoria: p.obligatoria, opciones: p.opciones || [], orden: p.orden }); }
async function moverPregunta(id, delta) {
  const idx = preguntas.findIndex(x => x.id === id);
  const nuevoIdx = idx + delta;
  if (nuevoIdx < 0 || nuevoIdx >= preguntas.length) return;
  const [item] = preguntas.splice(idx, 1);
  preguntas.splice(nuevoIdx, 0, item);
  await Promise.all(preguntas.map((p, i) => { p.orden = i; return guardarPregunta(p); }));
  renderPreguntas();
}
document.getElementById('btn-agregar-pregunta').addEventListener('click', async () => {
  const id = push(ref(db, 'agendamiento/config/preguntas')).key;
  const p = { id, tipo: 'texto_corto', texto: '', obligatoria: true, opciones: [], orden: preguntas.length };
  preguntas.push(p);
  await guardarPregunta(p);
  renderPreguntas();
  mostrarToast('Pregunta agregada — edítala y se guarda sola');
});

/* --- ROTACIÓN (vive dentro de config/general) --- */
function renderRotacion() { document.getElementById('rot-periodo').value = general.rotacionPeriodo || 'semanal'; }
document.querySelector('[data-guardar="rotacion"]').addEventListener('click', async () => {
  general = { ...general, rotacionPeriodo: document.getElementById('rot-periodo').value };
  await update(ref(db, 'agendamiento/config/general'), { rotacionPeriodo: general.rotacionPeriodo });
  mostrarToast('✅ Reparto rotativo guardado');
});

/* --- RECORDATORIOS --- */
function renderRecordatorios() {
  const cont = document.getElementById('recordatorios-lista');
  const lista = [
    { id: 'r1', etiqueta: 'Recordatorio 1', ...( recordatorios.r1 || { modo: 'mismo_dia', horaFija: '09:00', minutosAntes: 60, canalCorreo: true, canalWhatsapp: false, plantilla: '' }) },
    { id: 'r2', etiqueta: 'Recordatorio 2', ...( recordatorios.r2 || { modo: 'minutos_antes', horaFija: '09:00', minutosAntes: 15, canalCorreo: false, canalWhatsapp: true, plantilla: '' }) }
  ];
  cont.innerHTML = lista.map(r => `
    <div class="adm-recordatorio-card" data-id="${r.id}">
      <h3>${r.etiqueta}</h3>
      <div class="ag-field"><label>¿Cuándo se envía?</label>
        <select data-campo="modo">
          <option value="mismo_dia" ${r.modo === 'mismo_dia' ? 'selected' : ''}>El mismo día, a una hora fija</option>
          <option value="minutos_antes" ${r.modo === 'minutos_antes' ? 'selected' : ''}>X minutos antes de la llamada</option>
        </select></div>
      <div class="ag-field" data-campo-hora style="${r.modo !== 'mismo_dia' ? 'display:none;' : ''}"><label>Hora del envío (hora local del lead)</label><input type="time" data-campo="horaFija" value="${r.horaFija}"></div>
      <div class="ag-field" data-campo-minutos style="${r.modo !== 'minutos_antes' ? 'display:none;' : ''}"><label>Minutos antes de la llamada</label><input type="number" data-campo="minutosAntes" min="1" value="${r.minutosAntes}"></div>
      <div class="adm-canal-opciones">
        <label><input type="checkbox" data-campo="canalCorreo" ${r.canalCorreo ? 'checked' : ''}> Correo</label>
        <label><input type="checkbox" data-campo="canalWhatsapp" ${r.canalWhatsapp ? 'checked' : ''}> WhatsApp</label>
      </div>
      <div class="ag-field" style="margin-bottom:0;"><label>Plantilla del mensaje</label><textarea data-campo="plantilla">${r.plantilla || ''}</textarea>
        <small class="ag-hint">Variables disponibles: {{nombre}}, {{fecha}}, {{hora}}, {{minutos}}, {{linkMeet}}</small></div>
    </div>`).join('');

  cont.querySelectorAll('.adm-recordatorio-card').forEach(card => {
    const id = card.dataset.id; const r = lista.find(x => x.id === id);
    card.querySelector('[data-campo="modo"]').addEventListener('change', (e) => {
      r.modo = e.target.value;
      card.querySelector('[data-campo-hora]').style.display = r.modo === 'mismo_dia' ? '' : 'none';
      card.querySelector('[data-campo-minutos]').style.display = r.modo === 'minutos_antes' ? '' : 'none';
    });
    card.querySelector('[data-campo="horaFija"]').addEventListener('input', (e) => { r.horaFija = e.target.value; });
    card.querySelector('[data-campo="minutosAntes"]').addEventListener('input', (e) => { r.minutosAntes = Number(e.target.value); });
    card.querySelector('[data-campo="canalCorreo"]').addEventListener('change', (e) => { r.canalCorreo = e.target.checked; });
    card.querySelector('[data-campo="canalWhatsapp"]').addEventListener('change', (e) => { r.canalWhatsapp = e.target.checked; });
    card.querySelector('[data-campo="plantilla"]').addEventListener('input', (e) => { r.plantilla = e.target.value; });
  });
  recordatorios = { r1: lista[0], r2: lista[1] };
}
document.querySelector('[data-guardar="recordatorios"]').addEventListener('click', async () => {
  if ((!recordatorios.r1.canalCorreo && !recordatorios.r1.canalWhatsapp) || (!recordatorios.r2.canalCorreo && !recordatorios.r2.canalWhatsapp)) {
    mostrarToast('⚠️ Elige al menos un canal para cada recordatorio'); return;
  }
  await set(ref(db, 'agendamiento/config/recordatorios'), recordatorios);
  mostrarToast('✅ Recordatorios guardados');
});

/* --- CLOSERS --- */
function contarParaCloser(closerId) {
  const deEsteCloser = citasTodas.filter(c => c.closerUid === closerId);
  return {
    recibidas: deEsteCloser.length,
    realizadas: deEsteCloser.filter(c => c.estado === 'realizada' || c.estado === 'cerrada').length,
    cerradas: deEsteCloser.filter(c => c.estado === 'cerrada').length
  };
}
function renderClosers() {
  const tbody = document.querySelector('#tabla-closers tbody');
  tbody.innerHTML = closers.map(c => {
    const cont = contarParaCloser(c.id);
    const foto = c.fotoUrl
      ? `<img src="${c.fotoUrl}" alt="" style="width:36px; height:36px; border-radius:50%; object-fit:cover;">`
      : `<span style="display:inline-flex; width:36px; height:36px; border-radius:50%; background:var(--color-borde); align-items:center; justify-content:center; font-size:13px; color:var(--color-ink-soft);">${(c.nombre || '?').charAt(0).toUpperCase()}</span>`;
    return `
    <tr data-id="${c.id}">
      <td>${foto}</td>
      <td>${c.nombre} ${c.apellido || ''}</td>
      <td>${c.correo}</td>
      <td>${c.whatsapp || '—'}</td>
      <td>${c.pais || '—'}</td>
      <td>${cont.recibidas}</td>
      <td>${cont.realizadas}</td>
      <td>${cont.cerradas}</td>
      <td><span class="adm-badge-estado ${c.activo ? 'activo' : 'inactivo'}">${c.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td class="adm-acciones-cell">
        <button type="button" class="ag-btn ag-btn--ghost" style="width:auto; padding:6px 10px; font-size:12px;" data-accion="editar">Editar</button>
        <button type="button" class="ag-btn ag-btn--ghost" style="width:auto; padding:6px 10px; font-size:12px;" data-accion="reset-password">Restablecer contraseña</button>
        <button type="button" class="ag-btn ag-btn--ghost" style="width:auto; padding:6px 10px; font-size:12px;" data-accion="toggle">${c.activo ? 'Desactivar' : 'Activar'}</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-accion="toggle"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id; const c = closers.find(x => x.id === id);
      c.activo = !c.activo;
      await update(ref(db, `agendamiento/staff/${id}`), { activo: c.activo });
      renderClosers(); mostrarToast(c.activo ? `${c.nombre} activado` : `${c.nombre} desactivado`);
    });
  });
  tbody.querySelectorAll('[data-accion="reset-password"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id; const c = closers.find(x => x.id === id);
      if (!confirm(`¿Enviar correo de restablecer contraseña a ${c.nombre} (${c.correo})?`)) return;
      btn.disabled = true;
      try {
        await sendPasswordResetEmail(authInstance, c.correo);
        mostrarToast(`✅ Le llegó un correo a ${c.correo} para restablecer su contraseña`);
      } catch (err) {
        mostrarToast('⚠️ No se pudo enviar el correo: ' + (err.code || err.message));
      } finally { btn.disabled = false; }
    });
  });
  tbody.querySelectorAll('[data-accion="editar"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id; const c = closers.find(x => x.id === id);
      cargarCloserEnFormulario(c);
    });
  });
}

function poblarSelectPaises(selectEl, valorActual) {
  selectEl.innerHTML = listaPaises().map(p => `<option value="${p.nombre}" ${p.nombre === valorActual ? 'selected' : ''}>${p.nombre}</option>`).join('');
}
poblarSelectPaises(document.getElementById('closer-pais'), '');

function limpiarFormularioCloser() {
  document.getElementById('closer-id-edicion').value = '';
  document.getElementById('closer-nombre').value = '';
  document.getElementById('closer-apellido').value = '';
  document.getElementById('closer-correo').value = '';
  document.getElementById('closer-whatsapp').value = '';
  document.getElementById('closer-fecha-nacimiento').value = '';
  poblarSelectPaises(document.getElementById('closer-pais'), '');
  document.getElementById('closer-foto').value = '';
  const preview = document.getElementById('closer-foto-preview');
  preview.src = ''; preview.classList.add('hidden');
  document.getElementById('closer-panel-titulo').textContent = 'Agregar closer';
  document.getElementById('btn-agregar-closer').textContent = '+ Agregar';
  document.getElementById('closer-correo').disabled = false;
  document.getElementById('btn-cancelar-edicion-closer').style.display = 'none';
}
function cargarCloserEnFormulario(c) {
  document.getElementById('closer-id-edicion').value = c.id;
  document.getElementById('closer-nombre').value = c.nombre || '';
  document.getElementById('closer-apellido').value = c.apellido || '';
  document.getElementById('closer-correo').value = c.correo || '';
  document.getElementById('closer-correo').disabled = true; // el correo no se cambia al editar (es el login)
  document.getElementById('closer-whatsapp').value = c.whatsapp || '';
  document.getElementById('closer-fecha-nacimiento').value = c.fechaNacimiento || '';
  poblarSelectPaises(document.getElementById('closer-pais'), c.pais || '');
  const preview = document.getElementById('closer-foto-preview');
  if (c.fotoUrl) { preview.src = c.fotoUrl; preview.classList.remove('hidden'); } else { preview.classList.add('hidden'); }
  document.getElementById('closer-panel-titulo').textContent = `Editando a ${c.nombre}`;
  document.getElementById('btn-agregar-closer').textContent = 'Guardar cambios';
  document.getElementById('btn-cancelar-edicion-closer').style.display = '';
  document.getElementById('sec-closers').scrollIntoView({ behavior: 'smooth', block: 'end' });
}
document.getElementById('btn-cancelar-edicion-closer').addEventListener('click', limpiarFormularioCloser);

async function subirFotoCloser(uid, archivo) {
  const storageRef = sref(storageInstance, `fotos-perfil/${uid}`);
  await uploadBytes(storageRef, archivo);
  return await getDownloadURL(storageRef);
}

document.getElementById('btn-agregar-closer').addEventListener('click', async () => {
  const idEdicion = document.getElementById('closer-id-edicion').value;
  const nombre = document.getElementById('closer-nombre').value.trim();
  const apellido = document.getElementById('closer-apellido').value.trim();
  const correo = document.getElementById('closer-correo').value.trim();
  const whatsapp = document.getElementById('closer-whatsapp').value.trim();
  const fechaNacimiento = document.getElementById('closer-fecha-nacimiento').value;
  const pais = document.getElementById('closer-pais').value;
  const archivoFoto = document.getElementById('closer-foto').files[0] || null;

  if (!nombre || !apellido || !correo || !whatsapp || !fechaNacimiento || !pais) {
    mostrarToast('⚠️ Completa todos los campos obligatorios'); return;
  }

  const btn = document.getElementById('btn-agregar-closer');
  btn.disabled = true;

  if (idEdicion) {
    // --- Editar closer existente ---
    btn.textContent = 'Guardando...';
    try {
      const datos = { nombre, apellido, whatsapp, fechaNacimiento, pais };
      if (archivoFoto) datos.fotoUrl = await subirFotoCloser(idEdicion, archivoFoto);
      await update(ref(db, `agendamiento/staff/${idEdicion}`), datos);
      const c = closers.find(x => x.id === idEdicion);
      Object.assign(c, datos);
      renderClosers();
      limpiarFormularioCloser();
      mostrarToast(`✅ ${nombre} actualizado`);
    } catch (err) {
      mostrarToast('⚠️ No se pudo guardar: ' + err.message);
    } finally { btn.disabled = false; }
    return;
  }

  // --- Agregar closer nuevo ---
  btn.textContent = 'Creando...';
  try {
    const solicitudRef = push(ref(db, 'agendamiento/solicitudesCloser'));
    await set(solicitudRef, { nombre, apellido, correo, whatsapp, fechaNacimiento, pais, rol: 'closer', createdAt: Date.now() });
    const resultado = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('timeout')), 15000);
      onValue(solicitudRef, (snap) => {
        const val = snap.val();
        if (!val || !val.resultado) return;
        clearTimeout(timeoutId);
        if (val.resultado.estado === 'ok') resolve(val.resultado);
        else reject(new Error(val.resultado.mensaje));
      });
    });
    if (archivoFoto) {
      const fotoUrl = await subirFotoCloser(resultado.uid, archivoFoto);
      await update(ref(db, `agendamiento/staff/${resultado.uid}`), { fotoUrl });
    }
    mostrarToast(`✅ ${nombre} ya puede iniciar sesión — le llegó un correo con su acceso`);
    limpiarFormularioCloser();
    const staffSnap = await get(ref(db, 'agendamiento/staff'));
    closers = staffSnap.exists() ? Object.entries(staffSnap.val()).filter(([, s]) => s.rol === 'closer').map(([id, s]) => ({ id, ...s })) : [];
    renderClosers();
    actualizarSelectFiltroCloser();
  } catch (err) {
    mostrarToast('⚠️ ' + err.message);
  } finally { btn.disabled = false; btn.textContent = idEdicion ? 'Guardar cambios' : '+ Agregar'; }
});

/* --- AGENDA GENERAL --- */
function actualizarSelectFiltroCloser() {
  const sel = document.getElementById('filtro-closer');
  const actual = sel.value;
  sel.innerHTML = '<option value="">Todos</option>' + closers.map(c => `<option value="${c.id}">${c.nombre} ${c.apellido || ''}</option>`).join('');
  sel.value = actual;
}

document.getElementById('filtro-rango').addEventListener('change', (e) => {
  const esPersonalizado = e.target.value === 'personalizado';
  document.getElementById('filtro-fecha-desde-cont').style.display = esPersonalizado ? '' : 'none';
  document.getElementById('filtro-fecha-hasta-cont').style.display = esPersonalizado ? '' : 'none';
  renderAgendaGeneral();
});
document.getElementById('filtro-fecha-desde').addEventListener('change', renderAgendaGeneral);
document.getElementById('filtro-fecha-hasta').addEventListener('change', renderAgendaGeneral);
document.getElementById('filtro-closer').addEventListener('change', renderAgendaGeneral);
document.getElementById('filtro-estado').addEventListener('change', renderAgendaGeneral);

function rangoFechasElegido() {
  const rango = document.getElementById('filtro-rango').value;
  const ahora = Date.now();
  if (rango === 'todo') return { desde: -Infinity, hasta: Infinity };
  if (rango === 'personalizado') {
    const desdeStr = document.getElementById('filtro-fecha-desde').value;
    const hastaStr = document.getElementById('filtro-fecha-hasta').value;
    return {
      desde: desdeStr ? new Date(desdeStr + 'T00:00:00').getTime() : -Infinity,
      hasta: hastaStr ? new Date(hastaStr + 'T23:59:59').getTime() : Infinity
    };
  }
  const dias = Number(rango);
  return { desde: ahora - dias * 24 * 60 * 60 * 1000, hasta: Infinity };
}
const ETIQUETAS_ESTADO = { agendada: 'Agendada', cancelada: 'Cancelada', reagendada: 'Reagendada', realizada: 'Realizada', cerrada: 'Cerrada' };
function renderAgendaGeneral() {
  const staffPorId = Object.fromEntries(closers.map(c => [c.id, c]));
  const { desde, hasta } = rangoFechasElegido();
  const closerElegido = document.getElementById('filtro-closer').value;
  const estadoElegido = document.getElementById('filtro-estado').value;

  const filtradas = citasTodas
    .filter(c => c.inicioMs >= desde && c.inicioMs <= hasta)
    .filter(c => !closerElegido || c.closerUid === closerElegido)
    .filter(c => !estadoElegido || c.estado === estadoElegido)
    .sort((a, b) => b.inicioMs - a.inicioMs);

  document.querySelector('#tabla-agenda tbody').innerHTML = filtradas.map(c => `
    <tr>
      <td>${new Date(c.inicioMs).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
      <td>${new Date(c.inicioMs).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })}</td>
      <td>${(staffPorId[c.closerUid] && staffPorId[c.closerUid].nombre) || '—'}</td>
      <td>${c.leadNombre}</td>
      <td><span class="adm-badge-estado ${c.estado === 'agendada' ? 'activo' : 'inactivo'}">${ETIQUETAS_ESTADO[c.estado] || c.estado}</span></td>
    </tr>`).join('') || '<tr><td colspan="5" style="color:var(--color-ink-soft);">No hay llamadas en este rango.</td></tr>';
}

/* --- Arranque --- */
iniciarSesionStaff('directorComercial', async () => {
  const [genSnap, preguntasSnap, recordSnap, staffSnap, citasSnap] = await Promise.all([
    get(ref(db, 'agendamiento/config/general')), get(ref(db, 'agendamiento/config/preguntas')),
    get(ref(db, 'agendamiento/config/recordatorios')), get(ref(db, 'agendamiento/staff')), get(ref(db, 'agendamiento/citas'))
  ]);
  general = genSnap.exists() ? genSnap.val() : {};
  preguntas = preguntasSnap.exists() ? Object.entries(preguntasSnap.val()).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.orden || 0) - (b.orden || 0)) : [];
  recordatorios = recordSnap.exists() ? recordSnap.val() : {};
  closers = staffSnap.exists() ? Object.entries(staffSnap.val()).filter(([, s]) => s.rol === 'closer').map(([id, s]) => ({ id, ...s })) : [];
  citasTodas = citasSnap.exists() ? Object.values(citasSnap.val()) : [];

  renderGeneral(); renderPreguntas(); renderRotacion(); renderRecordatorios(); renderClosers();
  actualizarSelectFiltroCloser();
  renderAgendaGeneral();
});
