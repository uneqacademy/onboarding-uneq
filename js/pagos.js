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
import { ref, get, set, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getCurrentRole } from './main.js';

let cicloIdActual = null;
let monedaActual = 'CLP';

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
    if (select.value === 'pagada') {
      select.disabled = true;
      agregarBotonDesbloquear(celda, select);
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

function agregarFilaCuota(cuota) {
  const tbody = document.getElementById('tabla-cuotas-ficha-body');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="date" class="cuota-fecha" value="${cuota && cuota.fecha ? cuota.fecha : ''}"></td>
    <td><input class="cuota-monto" placeholder="0" value="${cuota && cuota.monto ? cuota.monto : ''}"></td>
    <td class="cuota-estado-cell"></td>
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

/* --- Llamada desde alumnos.js cada vez que se abre una ficha (solo director) --- */
export async function cargarAcuerdoParaCiclo(cicloId) {
  cicloIdActual = cicloId;
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

  const snap = await get(ref(db, `acuerdosPago/${cicloId}`));
  const acuerdo = snap.exists() ? snap.val() : { montoTotal: '', moneda: 'CLP', descuento: '', abono: '', cuotas: {} };
  monedaActual = acuerdo.moneda || 'CLP';

  document.getElementById('pago-moneda').textContent = monedaActual;
  document.getElementById('pago-monto-total').value = acuerdo.montoTotal || '';
  document.getElementById('pago-descuento').value = acuerdo.descuento || '';
  document.getElementById('pago-abono').value = acuerdo.abono || '';
  const cicloSnap = await get(ref(db, `ciclos/${cicloId}/createdAt`));
  const fechaAbono = cicloSnap.exists() ? new Date(cicloSnap.val()).toISOString().slice(0, 10) : '';
  document.getElementById('pago-fecha-abono').value = fechaAbono;
  recalcularSaldo();

  // Estado del PDF: se genera desde "Generar Acuerdo y Enviar a Revisión"
  // del coach (ver alumnos.js / pdf-acuerdo.js) — el director aquí solo lo ve.
  const estadoPdfEl = document.getElementById('pago-estado-pdf');
  if (estadoPdfEl) {
    estadoPdfEl.innerHTML = acuerdo.pdfUrl
      ? `<a href="${acuerdo.pdfUrl}" target="_blank" rel="noopener">Ver PDF ↗</a>`
      : 'Aún no generado';
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

  const btnAtraso = document.getElementById('pago-toggle-atraso');
  if (btnAtraso) {
    const enAtraso = !!acuerdo.atrasoPago;
    btnAtraso.textContent = enAtraso ? '⚠️ Atraso registrado — clic para quitarlo' : 'Sin atraso registrado';
    btnAtraso.style.cssText = enAtraso ? 'background:#FDEDED; color:#C0392B; border-color:#F5C6C6;' : '';
  }

  tbody.innerHTML = '';
  const cuotas = acuerdo.cuotas ? Object.values(acuerdo.cuotas).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')) : [];
  cuotas.forEach(agregarFilaCuota);
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
      const cuotas = {};
      document.querySelectorAll('#tabla-cuotas-ficha-body tr').forEach((row, idx) => {
        const fecha = row.querySelector('.cuota-fecha').value;
        const monto = row.querySelector('.cuota-monto').value.trim();
        const estado = row.querySelector('.cuota-estado-select').value;
        if (fecha || monto) {
          cuotas[`c${idx}_${Date.now()}`] = { fecha, monto, estado };
        }
      });

      await update(ref(db, `acuerdosPago/${cicloIdActual}`), {
        montoTotal: inputMonto.value.trim(),
        moneda: monedaActual,
        descuento: inputDescuento.value.trim(),
        abono: inputAbono.value.trim(),
        cuotas
      });

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
      const archivoRef = storageRef(storage, `acuerdos-firmados/${cicloIdActual}`);
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

const btnToggleAtraso = document.getElementById('pago-toggle-atraso');
if (btnToggleAtraso) {
  btnToggleAtraso.addEventListener('click', async () => {
    if (!cicloIdActual) return;
    const enAtrasoActual = btnToggleAtraso.textContent.includes('Atraso registrado');
    btnToggleAtraso.disabled = true;
    try {
      await update(ref(db, `acuerdosPago/${cicloIdActual}`), { atrasoPago: !enAtrasoActual });
      await cargarAcuerdoParaCiclo(cicloIdActual);
    } finally {
      btnToggleAtraso.disabled = false;
    }
  });
}
