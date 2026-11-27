/* ============================================================
   pagos.js
   Edición del Acuerdo de Pago dentro de la ficha de alumno
   (/acuerdosPago/{cicloId}) — solo Director. Monto Total,
   Descuento y Abono son editables; Saldo se calcula solo
   (Monto − Descuento − Abono). Las cuotas se agregan/quitan
   libremente y se guardan todas juntas al presionar
   "Guardar Acuerdo" (mismo patrón que Datos/Ciclo).

   Candado B: una cuota marcada "Pagada" se bloquea sola; el
   director puede desbloquearla con el ícono 🔓 si se equivocó.
   ============================================================ */

import { db, storage } from './firebase-config.js';
import { ref, get, set, update, push, onValue } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getCurrentRole, esSubdirectora } from './main.js';
import { hoyISO } from './util-pagos.js';
import { generarPdfAcuerdo } from './pdf-acuerdo.js';
import { pintarPanelUpgrade, upgradePendiente } from './upgrade-vitalicio.js';

let cicloIdActual = null;
let monedaActual = 'CLP';
let cuotaIdsOriginales = new Set(); // ids de cuota guardados al abrir la ficha (para saber cuáles se quitaron)
let dejarDeEscuchar = null;         // cierra la escucha en vivo del acuerdo abierto

/* Atrasado = alguna cuota con fecha ya pasada y estado distinto de "pagada" */
function calcularEstadoPago(cuotas) {
  if (!cuotas) return false;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Object.values(cuotas).some(c => {
    if (!c.fecha || c.estado === 'pagada') return false;
    return new Date(c.fecha + 'T00:00:00') <= hoy;
  });
}

function aplicarBloqueoAcuerdo(bloqueado) {
  ['pago-monto-total', 'pago-descuento', 'pago-abono', 'pago-fecha-abono', 'btn-agregar-cuota-ficha', 'btn-subir-acuerdo-firmado', 'btn-eliminar-acuerdo-firmado']
    .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = bloqueado; });
  document.querySelectorAll('#tabla-cuotas-ficha-body input, #tabla-cuotas-ficha-body select, #tabla-cuotas-ficha-body button')
    .forEach(el => { el.disabled = bloqueado; });
}

const btnEditarAcuerdoGlobal = document.getElementById('btn-editar-acuerdo');
if (btnEditarAcuerdoGlobal) {
  btnEditarAcuerdoGlobal.addEventListener('click', () => {
    aplicarBloqueoAcuerdo(false);
    btnEditarAcuerdoGlobal.classList.add('hidden');
  });
}

function crearSelectEstado(celda, estadoInicial) {
  const select = document.createElement('select');
  select.className = 'cuota-estado-select';
  select.innerHTML = `<option value="pendiente">Pendiente</option><option value="pagada">Pagada</option><option value="impaga">Impaga</option>`;
  select.value = estadoInicial;
  select.disabled = estadoInicial === 'pagada';
  celda.innerHTML = '';
  celda.appendChild(select);

  if (estadoInicial === 'pagada') agregarBotonDesbloquear(celda, select);

  select.addEventListener('change', () => {
    const fechaPagoInput = celda.closest('tr')?.querySelector('.cuota-fecha-pago');
    if (select.value === 'pagada') {
      if (fechaPagoInput && !fechaPagoInput.value) fechaPagoInput.value = hoyISO(); // se puede corregir a mano
      select.disabled = true;
      agregarBotonDesbloquear(celda, select);
    } else if (fechaPagoInput) {
      fechaPagoInput.value = ''; // solo una cuota pagada tiene fecha de pago
    }
  });
}

function agregarBotonDesbloquear(celda, select) {
  if (celda.querySelector('.btn-unlock-cuota')) return;
  const btn = document.createElement('button');
  btn.className = 'btn btn--ghost btn-unlock-cuota';
  btn.style.cssText = 'margin-left:8px; padding:2px 8px; font-size:11px;';
  btn.textContent = '🔓';
  btn.title = 'Desbloquear (solo director)';
  btn.classList.toggle('hidden', getCurrentRole() !== 'director');
  btn.addEventListener('click', () => {
    select.disabled = false;
    btn.remove();
  });
  celda.appendChild(btn);
}

// "id" es el id guardado de la cuota; una cuota nueva recibe uno desde ya. Se conserva al guardar para que la
// sección Pagos y esta ficha hablen de la misma cuota.
function agregarFilaCuota(cuota, id) {
  const tbody = document.getElementById('tabla-cuotas-ficha-body');
  const tr = document.createElement('tr');
  tr.dataset.cuotaId = typeof id === 'string' ? id : push(ref(db)).key;
  tr.innerHTML = `
    <td><input type="date" class="cuota-fecha" value="${cuota && cuota.fecha ? cuota.fecha : ''}"></td>
    <td><input class="cuota-monto" placeholder="0" value="${cuota && cuota.monto ? cuota.monto : ''}"></td>
    <td class="cuota-estado-cell"></td>
    <td><input type="date" class="cuota-fecha-pago" title="Fecha en que se pagó" value="${cuota && cuota.fechaPago ? cuota.fechaPago : ''}"></td>
    <td><button class="btn btn--danger btn-quitar-cuota">Quitar</button></td>`;
  tbody.appendChild(tr);

  crearSelectEstado(tr.querySelector('.cuota-estado-cell'), (cuota && cuota.estado) || 'pendiente');
  tr.querySelector('.btn-quitar-cuota').addEventListener('click', () => tr.remove());
}

function recalcularSaldo() {
  const monto = parseFloat((document.getElementById('pago-monto-total').value || '').toString().replace(/\./g, '').replace(',', '.')) || 0;
  const descuento = parseFloat((document.getElementById('pago-descuento').value || '').toString().replace(/\./g, '').replace(',', '.')) || 0;
  const abono = parseFloat((document.getElementById('pago-abono').value || '').toString().replace(/\./g, '').replace(',', '.')) || 0;
  const saldo = monto - descuento - abono;
  document.getElementById('pago-saldo').value = saldo.toLocaleString('es-CL');
}

/* --- Llamada desde alumnos.js cada vez que se abre una ficha (solo director) ---
   Además queda escuchando el acuerdo: si se cambia un pago desde la sección "Pagos", esta ficha se
   actualiza sola (salvo que se esté editando, para no pisar lo que se está escribiendo). --- */
export async function cargarAcuerdoParaCiclo(cicloId) {
  if (dejarDeEscuchar) { dejarDeEscuchar(); dejarDeEscuchar = null; }
  cicloIdActual = cicloId;
  if (getCurrentRole() === 'director' && !esSubdirectora() && cicloId) {
    let primera = true;
    dejarDeEscuchar = onValue(ref(db, `acuerdosPago/${cicloId}`), (snap) => {
      if (cicloIdActual !== cicloId) return;
      const editando = document.getElementById('btn-editar-acuerdo')?.classList.contains('hidden');
      if (!primera && editando) return;
      primera = false;
      pintarAcuerdo(cicloId, snap.exists() ? snap.val() : null);
    });
    return;
  }
  pintarAcuerdo(cicloId, null);
}

// Vuelve a generar el PDF del acuerdo con los datos y cláusulas actuales (no cambia el estado del proceso).
// Solo mientras no esté firmado: enviado para firma o en revisión.
async function regenerarPdfAcuerdo(cicloId) {
  const btn = document.getElementById('btn-regenerar-pdf-acuerdo');
  try {
    const cicloSnap = await get(ref(db, `ciclos/${cicloId}`));
    const ciclo = cicloSnap.exists() ? cicloSnap.val() : null;
    if (!ciclo) { alert('No se encontró el ciclo.'); return; }
    const upgradePendienteDeFirma = !!(ciclo.upgradeVitalicio && ciclo.upgradeVitalicio.estado === 'pendiente_firma');
    if (!upgradePendienteDeFirma && !['enviado_firma', 'en_revision'].includes(ciclo.estadoProceso)) {
      alert('Este acuerdo ya no está pendiente de firma, así que no se puede regenerar.');
      return;
    }
    if (!confirm('¿Regenerar el PDF del acuerdo con los datos y cláusulas actuales? Reemplaza al PDF anterior.')) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Generando…'; }
    await generarPdfAcuerdo(ciclo.alumnoId, cicloId);
    alert('Listo: el PDF del acuerdo se regeneró.');
  } catch (err) {
    console.error('No se pudo regenerar el PDF del acuerdo:', err);
    alert('No se pudo regenerar el PDF. Detalle: ' + (err && err.message ? err.message : err));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Regenerar PDF'; }
  }
}

async function pintarAcuerdo(cicloId, acuerdoGuardado) {
  const tbody = document.getElementById('tabla-cuotas-ficha-body');
  if (getCurrentRole() !== 'director' || !cicloId) {
    if (tbody) tbody.innerHTML = '';
    document.getElementById('pago-moneda').textContent = '—';
    document.getElementById('pago-monto-total').value = '';
    document.getElementById('pago-descuento').value = '';
    document.getElementById('pago-abono').value = '';
    document.getElementById('pago-fecha-abono').value = '';
    document.getElementById('pago-saldo').value = '';
    const estadoPdfElVacio = document.getElementById('pago-estado-pdf');
    if (estadoPdfElVacio) estadoPdfElVacio.textContent = '—';
    return;
  }

  const acuerdo = acuerdoGuardado || { montoTotal: '', moneda: 'CLP', descuento: '', abono: '', cuotas: {} };
  monedaActual = acuerdo.moneda || 'CLP';

  document.getElementById('pago-moneda').textContent = monedaActual;
  document.getElementById('pago-monto-total').value = acuerdo.montoTotal || '';
  document.getElementById('pago-descuento').value = acuerdo.descuento || '';
  document.getElementById('pago-abono').value = acuerdo.abono || '';
  // Fecha del abono: la que se guardó; si aún no hay, la de asignación del ciclo como punto de partida.
  let fechaAbono = acuerdo.fechaAbono || '';
  if (!fechaAbono) {
    const cicloSnap = await get(ref(db, `ciclos/${cicloId}/createdAt`));
    fechaAbono = cicloSnap.exists() ? new Date(cicloSnap.val()).toISOString().slice(0, 10) : '';
  }
  document.getElementById('pago-fecha-abono').value = fechaAbono;
  recalcularSaldo();

  // Estado del PDF: se genera desde "Generar Acuerdo y Enviar a Revisión"
  // del coach (ver alumnos.js / pdf-acuerdo.js) — el director aquí solo lo ve.
  const estadoPdfEl = document.getElementById('pago-estado-pdf');
  if (estadoPdfEl) {
    estadoPdfEl.innerHTML = acuerdo.pdfUrl
      ? `<a href="${acuerdo.pdfUrl}" target="_blank" rel="noopener">Ver PDF ↗</a>`
      : 'Aún no generado';
    // Si el acuerdo cambió (monto, fechas, cláusulas) antes de firmarse, se puede volver a generar el PDF.
    if (acuerdo.pdfUrl) {
      estadoPdfEl.insertAdjacentHTML('beforeend', ' <button type="button" class="btn btn--ghost" id="btn-regenerar-pdf-acuerdo" style="font-size:12px; padding:4px 10px; margin-left:8px;">🔄 Regenerar PDF</button>');
      document.getElementById('btn-regenerar-pdf-acuerdo').addEventListener('click', () => regenerarPdfAcuerdo(cicloId));
    }
  }

  const estadoPdfFirmadoEl = document.getElementById('pago-estado-pdf-firmado');
  if (estadoPdfFirmadoEl) {
    estadoPdfFirmadoEl.innerHTML = acuerdo.pdfFirmadoUrl
      ? `<a href="${acuerdo.pdfFirmadoUrl}" target="_blank" rel="noopener">Ver PDF firmado ↗</a>`
      : 'Aún no subido';
  }
  const btnSubirEl = document.getElementById('btn-subir-acuerdo-firmado');
  const btnEliminarEl = document.getElementById('btn-eliminar-acuerdo-firmado');
  if (btnSubirEl && btnEliminarEl) {
    btnSubirEl.classList.toggle('hidden', !!acuerdo.pdfFirmadoUrl);
    btnEliminarEl.classList.toggle('hidden', !acuerdo.pdfFirmadoUrl);
  }

  const badgeEstadoEl = document.getElementById('pago-badge-estado');
  if (badgeEstadoEl) {
    const atrasado = calcularEstadoPago(acuerdo.cuotas);
    badgeEstadoEl.textContent = atrasado ? 'Pago Atrasado' : 'Al día';
    badgeEstadoEl.className = 'badge ' + (atrasado ? 'badge--impaga' : 'badge--activo');
  }

  const yaGuardado = !!(acuerdo.montoTotal || (acuerdo.cuotas && Object.keys(acuerdo.cuotas).length));
  const btnEditarAcuerdo = document.getElementById('btn-editar-acuerdo');
  if (btnEditarAcuerdo) {
    aplicarBloqueoAcuerdo(yaGuardado);
    btnEditarAcuerdo.classList.toggle('hidden', !yaGuardado);
  }

  tbody.innerHTML = '';
  const cuotas = acuerdo.cuotas ? Object.entries(acuerdo.cuotas).sort((a, b) => (a[1].fecha || '').localeCompare(b[1].fecha || '')) : [];
  cuotaIdsOriginales = new Set(cuotas.map(([id]) => id));
  cuotas.forEach(([id, c]) => agregarFilaCuota(c, id));

  // Upgrade a OPEN Vitalicio (solo alumnos OPEN; ver upgrade-vitalicio.js)
  await pintarPanelUpgrade(cicloId, acuerdo, () => cargarAcuerdoParaCiclo(cicloId));
}

const inputMonto = document.getElementById('pago-monto-total');
const inputDescuento = document.getElementById('pago-descuento');
const inputAbono = document.getElementById('pago-abono');
[inputMonto, inputDescuento, inputAbono].forEach(el => {
  if (el) el.addEventListener('input', recalcularSaldo);
});

const btnAgregarCuota = document.getElementById('btn-agregar-cuota-ficha');
if (btnAgregarCuota) btnAgregarCuota.addEventListener('click', () => agregarFilaCuota());

const btnGuardarAcuerdo = document.getElementById('btn-guardar-acuerdo');
if (btnGuardarAcuerdo) {
  btnGuardarAcuerdo.addEventListener('click', async () => {
    if (!cicloIdActual) return;
    btnGuardarAcuerdo.disabled = true;
    btnGuardarAcuerdo.textContent = 'Guardando...';
    try {
      // Se guarda cuota por cuota (con su id de siempre): así lo que se cambió en la sección "Pagos" en otras
      // cuotas no se pierde, y solo se borran las que se quitaron aquí.
      const cambios = {
        montoTotal: inputMonto.value.trim(),
        moneda: monedaActual,
        descuento: inputDescuento.value.trim(),
        abono: inputAbono.value.trim(),
        fechaAbono: document.getElementById('pago-fecha-abono').value || null
      };
      const idsEnPantalla = new Set();
      document.querySelectorAll('#tabla-cuotas-ficha-body tr').forEach((row) => {
        const fecha = row.querySelector('.cuota-fecha').value;
        const monto = row.querySelector('.cuota-monto').value.trim();
        const estado = row.querySelector('.cuota-estado-select').value;
        const fechaPago = row.querySelector('.cuota-fecha-pago').value;
        if (fecha || monto) {
          idsEnPantalla.add(row.dataset.cuotaId);
          cambios[`cuotas/${row.dataset.cuotaId}`] = { fecha, monto, estado, fechaPago: estado === 'pagada' && fechaPago ? fechaPago : null };
        }
      });
      cuotaIdsOriginales.forEach((id) => { if (!idsEnPantalla.has(id)) cambios[`cuotas/${id}`] = null; });

      await update(ref(db, `acuerdosPago/${cicloIdActual}`), cambios);
      // Recién en este momento el coach empieza a ver a este alumno
      // en su dashboard — antes de "Guardar Acuerdo", queda solo
      // visible para el Director.
      await update(ref(db, `ciclos/${cicloIdActual}`), { acuerdoCerrado: true });

      await cargarAcuerdoParaCiclo(cicloIdActual);
    } finally {
      btnGuardarAcuerdo.disabled = false;
      btnGuardarAcuerdo.textContent = 'Guardar Acuerdo';
    }
  });
}

/* --- Subir acuerdo firmado (director) — el alumno lo descarga desde su portal --- */
const btnSubirAcuerdoFirmado = document.getElementById('btn-subir-acuerdo-firmado');
const inputAcuerdoFirmado = document.getElementById('input-acuerdo-firmado');
if (btnSubirAcuerdoFirmado && inputAcuerdoFirmado) {
  btnSubirAcuerdoFirmado.addEventListener('click', () => inputAcuerdoFirmado.click());
  inputAcuerdoFirmado.addEventListener('change', async () => {
    const file = inputAcuerdoFirmado.files[0];
    if (!file || !cicloIdActual) return;
    btnSubirAcuerdoFirmado.disabled = true;
    const textoOriginal = btnSubirAcuerdoFirmado.textContent;
    btnSubirAcuerdoFirmado.textContent = 'Subiendo...';
    try {
      const archivoRef = storageRef(storage, `acuerdos-firmados/${cicloIdActual}${upgradePendiente() ? '-vitalicio' : ''}`);
      await uploadBytes(archivoRef, file);
      const url = await getDownloadURL(archivoRef);
      await update(ref(db, `acuerdosPago/${cicloIdActual}`), { pdfFirmadoUrl: url });
      await cargarAcuerdoParaCiclo(cicloIdActual);
    } catch (err) {
      alert('No se pudo subir el acuerdo firmado. Intenta de nuevo.');
    } finally {
      btnSubirAcuerdoFirmado.disabled = false;
      btnSubirAcuerdoFirmado.textContent = textoOriginal;
      inputAcuerdoFirmado.value = '';
    }
  });
}

const btnEliminarAcuerdoFirmado = document.getElementById('btn-eliminar-acuerdo-firmado');
if (btnEliminarAcuerdoFirmado) {
  btnEliminarAcuerdoFirmado.addEventListener('click', async () => {
    if (!cicloIdActual) return;
    const confirmado = confirm('¿Eliminar el acuerdo firmado? El alumno ya no va a poder descargarlo desde su portal hasta que subas uno nuevo.');
    if (!confirmado) return;

    btnEliminarAcuerdoFirmado.disabled = true;
    try {
      const archivoRef = storageRef(storage, `acuerdos-firmados/${cicloIdActual}`);
      try { await deleteObject(archivoRef); } catch (err) { /* si ya no existe el archivo, seguimos igual */ }
      await update(ref(db, `acuerdosPago/${cicloIdActual}`), { pdfFirmadoUrl: null });
      await cargarAcuerdoParaCiclo(cicloIdActual);
    } finally {
      btnEliminarAcuerdoFirmado.disabled = false;
    }
  });
}
