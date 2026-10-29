/* ============================================================
   pagos-consolidado.js — sección "Pagos" del Director Académico.
   Una fila por acuerdo (los socios de un mismo ciclo van juntos),
   con el abono y todas las cuotas en columnas, lo pagado y lo que
   falta por cubrir. Los totales van separados por moneda (CLP / USD).
   Lee y escribe el MISMO dato que la ficha de cada alumno
   (acuerdosPago/{cicloId}): lo que se cambie aquí se ve allá y al revés
   (esta vista se actualiza sola cuando algo cambia).
   Solo alumnos activos por defecto; el filtro permite ver los demás.
   ============================================================ */

import { db } from './firebase-config.js';
import { escaparHtml } from './util-html.js';
import { ref, get, update, onValue } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole } from './main.js';
import { programaLabel } from './ciclos.js';
import { resumenAcuerdo, formatMonto, fechaCorta, hoyISO, cuotaVencida, parsearMonto } from './util-pagos.js';

const ESTADOS_ALUMNO = {
  activo: 'Activo', en_proceso_matricula: 'En proceso de matrícula', pausado: 'Pausado', egresado: 'Egresado', abandono: 'Abandono'
};

let alumnos = {};
let ciclos = {};
let acuerdos = {};
let escuchando = false;
let filasActuales = [];   // lo que se ve ahora (también es lo que baja a Excel)
let columnasCuotas = 1;

const vistaEl = () => document.getElementById('view-pagos');
const vistaVisible = () => !!vistaEl() && !vistaEl().classList.contains('hidden');

function nombreDeCiclo(cicloId, ciclo) {
  const ids = Array.isArray(ciclo.alumnoIds) && ciclo.alumnoIds.length ? ciclo.alumnoIds : [ciclo.alumnoId];
  const nombres = ids.map(id => alumnos[id]).filter(a => a && !a.esDemo)
    .map(a => `${a.nombre || ''} ${a.apellido || ''}`.trim()).filter(Boolean);
  return nombres.join(' y ');
}

/* --- Arma las filas según los filtros --- */
function construirFilas() {
  const fEstadoAlumno = document.getElementById('pagos-f-estado-alumno')?.value ?? 'activo';
  const fPrograma = document.getElementById('pagos-f-programa')?.value || '';
  const fPago = document.getElementById('pagos-f-pago')?.value || '';
  const fNombre = (document.getElementById('pagos-f-nombre')?.value || '').toLowerCase().trim();

  const filas = [];
  Object.entries(acuerdos).forEach(([cicloId, acuerdo]) => {
    const ciclo = ciclos[cicloId];
    if (!ciclo || !acuerdo) return;
    const resumen = resumenAcuerdo(acuerdo);
    if (!resumen.monto && !resumen.cuotas.length) return; // acuerdo aún sin definir
    const nombre = nombreDeCiclo(cicloId, ciclo);
    if (!nombre) return; // ciclo de un alumno demo o sin ficha

    if (fEstadoAlumno && ciclo.estadoAlumno !== fEstadoAlumno) return;
    if (fPrograma && ciclo.programa !== fPrograma) return;
    if (fNombre && !nombre.toLowerCase().includes(fNombre)) return;

    const completo = resumen.total > 0 && resumen.porCubrir === 0;
    const estadoPago = resumen.atrasado ? 'atrasado' : (completo ? 'completo' : 'aldia');
    if (fPago && fPago !== estadoPago) return;

    filas.push({ cicloId, nombre, ciclo, resumen, estadoPago });
  });
  return filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/* --- Totales por moneda --- */
function renderKpis(filas) {
  const el = document.getElementById('pagos-kpis');
  const porMoneda = {};
  filas.forEach(({ resumen: r, estadoPago }) => {
    const m = porMoneda[r.moneda] || (porMoneda[r.moneda] = { total: 0, pagado: 0, porCubrir: 0, atrasadoMonto: 0, atrasados: 0, alumnos: 0 });
    m.total += r.total; m.pagado += r.pagado; m.porCubrir += r.porCubrir; m.atrasadoMonto += r.atrasadoMonto;
    if (estadoPago === 'atrasado') m.atrasados++;
    m.alumnos++;
  });
  const monedas = Object.keys(porMoneda).sort();
  if (!monedas.length) { el.innerHTML = ''; return; }
  el.innerHTML = monedas.map(mon => {
    const m = porMoneda[mon];
    return `<div class="panel pagos-kpi"><div class="panel__body">
      <p class="pagos-kpi__moneda">${escaparHtml(mon)} <span class="text-soft">· ${m.alumnos} acuerdo${m.alumnos === 1 ? '' : 's'}</span></p>
      <div class="pagos-kpi__fila">
        <div><span class="text-soft">Total acordado</span><strong>${formatMonto(m.total, mon)}</strong></div>
        <div><span class="text-soft">Pagado</span><strong class="pagos-ok">${formatMonto(m.pagado, mon)}</strong></div>
        <div><span class="text-soft">Por cubrir</span><strong>${formatMonto(m.porCubrir, mon)}</strong></div>
        <div><span class="text-soft">Atrasado (${m.atrasados})</span><strong class="pagos-mal">${formatMonto(m.atrasadoMonto, mon)}</strong></div>
      </div>
    </div></div>`;
  }).join('');
}

/* --- Matriz --- */
function celdaCuota(cicloId, id, c, moneda) {
  const vencida = cuotaVencida(c);
  const clase = c.estado === 'pagada' ? 'pagada' : (c.estado === 'impaga' || vencida ? 'atrasada' : 'pendiente');
  const etiqueta = c.estado === 'pagada' ? `Pagada${c.fechaPago ? ` · ${fechaCorta(c.fechaPago)}` : ''}`
    : (c.estado === 'impaga' ? 'Impaga' : (vencida ? 'Vencida' : 'Pendiente'));
  return `<td class="pagos-celda pagos-celda--${clase} pagos-clic" data-ciclo-id="${escaparHtml(cicloId)}" data-cuota-id="${escaparHtml(id)}" title="Clic para editar">
    <strong>${formatMonto(parsearMonto(c.monto), moneda)}</strong>
    <small>Vence ${fechaCorta(c.fecha) || '—'}</small>
    <small>${escaparHtml(etiqueta)}</small></td>`;
}

function renderTabla() {
  const filas = construirFilas();
  filasActuales = filas;
  renderKpis(filas);

  columnasCuotas = Math.max(1, ...filas.map(f => f.resumen.cuotas.length));
  const cabeceraCuotas = Array.from({ length: columnasCuotas }, (_, i) => `<th>Cuota ${i + 1}</th>`).join('');
  const cuerpo = filas.map(({ cicloId, nombre, ciclo, resumen: r, estadoPago }) => {
    const celdas = Array.from({ length: columnasCuotas }, (_, i) =>
      r.cuotas[i] ? celdaCuota(cicloId, r.cuotas[i][0], r.cuotas[i][1], r.moneda) : '<td class="pagos-celda pagos-celda--vacia">—</td>').join('');
    const badge = estadoPago === 'atrasado' ? '<span class="badge badge--impaga">Atrasado</span>'
      : (estadoPago === 'completo' ? '<span class="badge badge--pagada">Pagado completo</span>' : '<span class="badge badge--activo">Al día</span>');
    return `<tr>
      <td class="pagos-alumno"><strong>${escaparHtml(nombre)}</strong>${ciclo.estadoAlumno !== 'activo' ? `<small>${escaparHtml(ESTADOS_ALUMNO[ciclo.estadoAlumno] || ciclo.estadoAlumno || '')}</small>` : ''}</td>
      <td>${escaparHtml(programaLabel(ciclo.programa) || '—')}</td>
      <td>${escaparHtml(r.moneda)}</td>
      <td class="pagos-num">${formatMonto(r.total, r.moneda)}${r.descuento ? `<small>Desc. ${formatMonto(r.descuento, r.moneda)}</small>` : ''}</td>
      <td class="pagos-celda pagos-celda--${r.abono ? 'pagada' : 'pendiente'} pagos-clic" data-ciclo-id="${escaparHtml(cicloId)}" data-abono="1" title="Clic para editar el abono">
        <strong>${formatMonto(r.abono, r.moneda)}</strong><small>${r.abono && r.fechaAbono ? `Pagó ${fechaCorta(r.fechaAbono)}` : (r.abono ? 'Sin fecha' : 'Sin abono')}</small></td>
      ${celdas}
      <td class="pagos-num pagos-ok"><strong>${formatMonto(r.pagado, r.moneda)}</strong></td>
      <td class="pagos-num"><strong>${formatMonto(r.porCubrir, r.moneda)}</strong></td>
      <td>${badge}</td>
    </tr>`;
  }).join('');

  document.getElementById('pagos-tabla').innerHTML = `
    <thead><tr><th>Alumno</th><th>Programa</th><th>Moneda</th><th>Total</th><th>Abono</th>${cabeceraCuotas}<th>Pagado</th><th>Por cubrir</th><th>Estado</th></tr></thead>
    <tbody>${cuerpo || `<tr><td colspan="${8 + columnasCuotas}" class="text-soft" style="padding:18px;">No hay acuerdos con estos filtros.</td></tr>`}</tbody>`;
}

export async function cargarPagos() {
  if (getCurrentRole() !== 'director') return;
  const [alumnosSnap, ciclosSnap] = await Promise.all([get(ref(db, 'alumnos')), get(ref(db, 'ciclos'))]);
  alumnos = alumnosSnap.exists() ? alumnosSnap.val() : {};
  ciclos = ciclosSnap.exists() ? ciclosSnap.val() : {};
  if (!escuchando) {
    escuchando = true;
    // En vivo: un cambio hecho en la ficha de un alumno (u otra sesión) se refleja aquí al instante.
    onValue(ref(db, 'acuerdosPago'), (snap) => {
      acuerdos = snap.exists() ? snap.val() : {};
      if (vistaVisible() && !modalAbierto()) renderTabla();
    });
  } else {
    renderTabla();
  }
}

/* --- Edición de una cuota o del abono (ventanita) --- */
const modalEl = document.getElementById('modal-pago');
const modalAbierto = () => !!modalEl && modalEl.classList.contains('is-visible');
let edicion = null; // { cicloId, cuotaId | null (abono) }

function abrirModalCuota(cicloId, cuotaId) {
  const c = ((acuerdos[cicloId] || {}).cuotas || {})[cuotaId];
  if (!c) return;
  edicion = { cicloId, cuotaId };
  const nombre = nombreDeCiclo(cicloId, ciclos[cicloId] || {});
  document.getElementById('modal-pago-titulo').textContent = `Cuota de ${nombre}`;
  document.getElementById('modal-pago-campos').innerHTML = `
    <div class="field-grid">
      <div class="field"><label>Vencimiento</label><input type="date" id="mp-fecha" value="${escaparHtml(c.fecha || '')}"></div>
      <div class="field"><label>Monto</label><input id="mp-monto" value="${escaparHtml(c.monto || '')}"></div>
      <div class="field"><label>Estado</label>
        <select id="mp-estado">
          <option value="pendiente">Pendiente</option><option value="pagada">Pagada</option><option value="impaga">Impaga</option>
        </select></div>
      <div class="field"><label>Fecha de pago</label><input type="date" id="mp-fecha-pago" value="${escaparHtml(c.fechaPago || '')}"></div>
    </div>`;
  const estadoSel = document.getElementById('mp-estado');
  estadoSel.value = c.estado || 'pendiente';
  estadoSel.addEventListener('change', () => {
    const fp = document.getElementById('mp-fecha-pago');
    if (estadoSel.value === 'pagada' && !fp.value) fp.value = hoyISO();
    if (estadoSel.value !== 'pagada') fp.value = '';
  });
  document.getElementById('btn-modal-pago-hoy').classList.toggle('hidden', c.estado === 'pagada');
  document.getElementById('modal-pago-error').classList.add('hidden');
  modalEl.classList.add('is-visible');
}

function abrirModalAbono(cicloId) {
  const a = acuerdos[cicloId] || {};
  edicion = { cicloId, cuotaId: null };
  document.getElementById('modal-pago-titulo').textContent = `Abono de ${nombreDeCiclo(cicloId, ciclos[cicloId] || {})}`;
  document.getElementById('modal-pago-campos').innerHTML = `
    <div class="field-grid">
      <div class="field"><label>Monto del abono</label><input id="mp-abono" value="${escaparHtml(a.abono || '')}"></div>
      <div class="field"><label>Fecha del abono</label><input type="date" id="mp-fecha-abono" value="${escaparHtml(a.fechaAbono || '')}"></div>
    </div>`;
  document.getElementById('btn-modal-pago-hoy').classList.add('hidden');
  document.getElementById('modal-pago-error').classList.add('hidden');
  modalEl.classList.add('is-visible');
}

function cerrarModal() { modalEl?.classList.remove('is-visible'); edicion = null; if (vistaVisible()) renderTabla(); }

async function guardarModal(marcarPagadaHoy) {
  if (!edicion) return;
  const errorEl = document.getElementById('modal-pago-error');
  errorEl.classList.add('hidden');
  const botones = modalEl.querySelectorAll('button');
  botones.forEach(b => { b.disabled = true; });
  try {
    if (edicion.cuotaId) {
      let estado = document.getElementById('mp-estado').value;
      let fechaPago = document.getElementById('mp-fecha-pago').value;
      if (marcarPagadaHoy) { estado = 'pagada'; fechaPago = hoyISO(); }
      if (estado === 'pagada' && !fechaPago) fechaPago = hoyISO();
      await update(ref(db, `acuerdosPago/${edicion.cicloId}/cuotas/${edicion.cuotaId}`), {
        fecha: document.getElementById('mp-fecha').value,
        monto: document.getElementById('mp-monto').value.trim(),
        estado,
        fechaPago: estado === 'pagada' ? fechaPago : null
      });
    } else {
      await update(ref(db, `acuerdosPago/${edicion.cicloId}`), {
        abono: document.getElementById('mp-abono').value.trim(),
        fechaAbono: document.getElementById('mp-fecha-abono').value || null
      });
    }
    cerrarModal();
  } catch (err) {
    console.error('No se pudo guardar el pago:', err);
    errorEl.textContent = 'No se pudo guardar. Intenta de nuevo.';
    errorEl.classList.remove('hidden');
  } finally {
    botones.forEach(b => { b.disabled = false; });
  }
}

document.getElementById('pagos-tabla')?.addEventListener('click', (ev) => {
  const celda = ev.target.closest('.pagos-clic');
  if (!celda) return;
  if (celda.dataset.abono) abrirModalAbono(celda.dataset.cicloId);
  else abrirModalCuota(celda.dataset.cicloId, celda.dataset.cuotaId);
});
document.getElementById('btn-modal-pago-guardar')?.addEventListener('click', () => guardarModal(false));
document.getElementById('btn-modal-pago-hoy')?.addEventListener('click', () => guardarModal(true));
document.getElementById('btn-modal-pago-cerrar')?.addEventListener('click', cerrarModal);
modalEl?.addEventListener('click', (ev) => { if (ev.target === modalEl) cerrarModal(); });

['pagos-f-estado-alumno', 'pagos-f-programa', 'pagos-f-pago'].forEach(id => document.getElementById(id)?.addEventListener('change', renderTabla));
document.getElementById('pagos-f-nombre')?.addEventListener('input', renderTabla);
document.querySelectorAll('.nav-item[data-nav="pagos"]').forEach(item => item.addEventListener('click', cargarPagos));

/* --- Excel (CSV con ; y BOM, igual que "Descargar Excel" de Alumnos): lo que se ve con los filtros puestos --- */
function csv(valor) {
  const t = String(valor ?? '');
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
const num = (n) => String(Math.round((n || 0) * 100) / 100).replace('.', ',');

document.getElementById('btn-pagos-excel')?.addEventListener('click', () => {
  const encabezado = ['Alumno', 'Programa', 'Estado alumno', 'Moneda', 'Monto total', 'Descuento', 'Total a pagar', 'Abono', 'Fecha abono'];
  for (let i = 1; i <= columnasCuotas; i++) encabezado.push(`Cuota ${i} vence`, `Cuota ${i} monto`, `Cuota ${i} estado`, `Cuota ${i} fecha de pago`);
  encabezado.push('Pagado', 'Por cubrir', 'Estado de pago');

  const lineas = [encabezado.map(csv).join(';')];
  filasActuales.forEach(({ nombre, ciclo, resumen: r, estadoPago }) => {
    const fila = [nombre, programaLabel(ciclo.programa) || '', ESTADOS_ALUMNO[ciclo.estadoAlumno] || '', r.moneda,
      num(r.monto), num(r.descuento), num(r.total), num(r.abono), fechaCorta(r.fechaAbono)];
    for (let i = 0; i < columnasCuotas; i++) {
      const c = r.cuotas[i] && r.cuotas[i][1];
      const estado = !c ? '' : (c.estado === 'pagada' ? 'Pagada' : (c.estado === 'impaga' ? 'Impaga' : (cuotaVencida(c) ? 'Vencida' : 'Pendiente')));
      fila.push(c ? fechaCorta(c.fecha) : '', c ? num(parsearMonto(c.monto)) : '', estado, c ? fechaCorta(c.fechaPago) : '');
    }
    fila.push(num(r.pagado), num(r.porCubrir), estadoPago === 'atrasado' ? 'Atrasado' : (estadoPago === 'completo' ? 'Pagado completo' : 'Al día'));
    lineas.push(fila.map(csv).join(';'));
  });
  const blob = new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pagos-${hoyISO()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
});
