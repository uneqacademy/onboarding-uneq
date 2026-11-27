/* ============================================================
   upgrade-vitalicio.js
   Un alumno OPEN que ya pagó la versión anual puede pasar a OPEN Vitalicio (solo el Director,
   desde la pestaña "Acuerdo de Pago" de su ficha).

   Flujo:
   1. "Pasar a OPEN Vitalicio": se archiva el acuerdo vigente en acuerdosPago/{ciclo}/acuerdoAnterior
      (montos, cuotas, PDF y PDF firmado), el acuerdo pasa a mostrar el valor de OPEN Vitalicio y una
      cuota con la DIFERENCIA, y se genera el PDF nuevo (acuerdos/{ciclo}-vitalicio.pdf).
      ciclo.upgradeVitalicio = { estado: 'pendiente_firma', ... }. El alumno sigue ACTIVO con todo su
      acceso; no se toca nada de lo que hizo en la app.
   2. El Director sube el acuerdo firmado (acuerdos-firmados/{ciclo}-vitalicio) y pulsa
      "Confirmar firma y activar Vitalicio": ciclo.vitalicio = true (desde ahí lleva el ∞ y,
      pasado su primer año, el modo Vitalicio).
   El primer año se cuenta desde el ingreso ORIGINAL a OPEN (fechaIngreso / fechaEgreso no cambian).
   "Cancelar upgrade" (solo mientras está pendiente) deja el acuerdo como estaba.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, update, push } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { parsearMonto, formatMonto, hoyISO } from './util-pagos.js';
import { VITALICIO, cargarPreciosProgramas, tipoCambioConfigurado, CONDICIONES_ACTUALES } from './ciclos.js';
import { generarPdfAcuerdo } from './pdf-acuerdo.js';
import { escaparHtml } from './util-html.js';

let pendienteActual = false;

// ¿El acuerdo abierto está en pleno upgrade (pendiente de firma)? Lo usa pagos.js para guardar el firmado aparte.
export function upgradePendiente() { return pendienteActual; }

function limpiar(obj) { return obj === undefined ? null : JSON.parse(JSON.stringify(obj)); }

export async function pintarPanelUpgrade(cicloId, acuerdo, refrescar) {
  const cont = document.getElementById('panel-upgrade-vitalicio');
  const btnSubir = document.getElementById('btn-subir-acuerdo-firmado');
  const btnEliminar = document.getElementById('btn-eliminar-acuerdo-firmado');
  pendienteActual = false;
  if (!cont) return;
  const snap = await get(ref(db, `ciclos/${cicloId}`));
  const ciclo = snap.exists() ? snap.val() : null;
  if (!ciclo || ciclo.programa !== 'open') { cont.classList.add('hidden'); cont.innerHTML = ''; return; }
  const up = ciclo.upgradeVitalicio || null;
  const moneda = (acuerdo && acuerdo.moneda) || 'CLP';
  cont.classList.remove('hidden');

  if (up && up.estado === 'pendiente_firma') {
    pendienteActual = true;
    const anterior = (acuerdo && acuerdo.acuerdoAnterior) || {};
    const firmadoNuevo = !!(acuerdo && acuerdo.pdfFirmadoUrl && acuerdo.pdfFirmadoUrl !== anterior.pdfFirmadoUrl);
    // Mientras está pendiente, se sube el firmado nuevo (el anterior queda guardado como respaldo).
    if (btnSubir) btnSubir.classList.toggle('hidden', firmadoNuevo);
    if (btnEliminar) btnEliminar.classList.add('hidden');
    cont.innerHTML = `
      <p style="margin:0 0 6px;"><strong>⏳ Upgrade a OPEN Vitalicio pendiente de firma</strong></p>
      <p class="text-soft" style="margin:0 0 10px; font-size:13px;">El alumno sigue activo con todo su acceso. El acuerdo nuevo ya está generado (reemplaza al anterior, que queda guardado como respaldo). Cuando esté firmado, súbelo más abajo ("Subir Acuerdo Firmado") y confirma la firma: desde ahí es Vitalicio.</p>
      <p style="margin:0 0 10px; font-size:13px;">Acuerdo nuevo firmado: <strong>${firmadoNuevo ? '✅ subido' : 'aún no subido'}</strong></p>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn btn--accent" id="btn-confirmar-upgrade" ${firmadoNuevo ? '' : 'disabled'}>Confirmar firma y activar Vitalicio</button>
        <button type="button" class="btn btn--ghost" id="btn-cancelar-upgrade">Cancelar upgrade</button>
      </div>`;
    cont.querySelector('#btn-confirmar-upgrade').addEventListener('click', () => confirmarFirma(cicloId, ciclo, refrescar));
    cont.querySelector('#btn-cancelar-upgrade').addEventListener('click', () => cancelarUpgrade(cicloId, ciclo, acuerdo, refrescar));
    return;
  }

  if (ciclo.vitalicio === true) {
    cont.innerHTML = `<p style="margin:0;"><strong>∞ Alumno OPEN Vitalicio</strong>${up && up.firmadoEn ? ` <span class="text-soft" style="font-size:12.5px;">(upgrade firmado el ${new Intl.DateTimeFormat('es-CL').format(new Date(up.firmadoEn))})</span>` : ''}</p>
      <p class="text-soft" style="margin:6px 0 0; font-size:13px;">Su primer año corre desde su ingreso a OPEN (${escaparHtml(ciclo.fechaIngreso || '—')}); desde el segundo se comporta como Vitalicio.</p>`;
    return;
  }

  if (ciclo.estadoProceso === 'matricula_finalizada' && ciclo.estadoAlumno === 'activo') {
    cont.innerHTML = `
      <p style="margin:0 0 6px;"><strong>⭐ ¿Pasa a OPEN Vitalicio?</strong></p>
      <p class="text-soft" style="margin:0 0 10px; font-size:13px;">Para alumnos OPEN que ya pagaron la versión anual. Se regenera el acuerdo (valor de OPEN Vitalicio, con la diferencia por pagar) y vuelve a firmarse. Todo lo que el alumno hizo en la app se mantiene.</p>
      <button type="button" class="btn btn--accent" id="btn-iniciar-upgrade">Pasar a OPEN Vitalicio</button>`;
    cont.querySelector('#btn-iniciar-upgrade').addEventListener('click', (e) => iniciarUpgrade(cicloId, ciclo, acuerdo, refrescar, e.currentTarget));
    return;
  }
  cont.classList.add('hidden'); cont.innerHTML = '';
}

async function iniciarUpgrade(cicloId, ciclo, acuerdo, refrescar, btn) {
  const moneda = (acuerdo && acuerdo.moneda) || 'CLP';
  await cargarPreciosProgramas(true);
  let precioNuevo = VITALICIO.precioClp;
  if (moneda !== 'CLP') {
    const tc = tipoCambioConfigurado();
    if (!(tc > 0)) { alert('Este alumno paga en ' + moneda + ' y falta el tipo de cambio en Configuración > Precios de los programas.'); return; }
    precioNuevo = Math.round((VITALICIO.precioClp / tc) * 100) / 100;
  }
  const totalAnterior = parsearMonto(acuerdo && acuerdo.montoTotal) - parsearMonto(acuerdo && acuerdo.descuento);
  const diferencia = Math.max(0, Math.round((precioNuevo - totalAnterior) * 100) / 100);
  const avisoFechas = ciclo.condiciones === CONDICIONES_ACTUALES ? '' : `\n\nOjo: este alumno entró con las condiciones anteriores; revisa su fecha de egreso (${ciclo.fechaEgreso || '—'}) en "Ciclo Actual" si corresponde ajustarla.`;
  const ok = confirm(`¿Pasar a este alumno a OPEN Vitalicio?\n\nValor de OPEN Vitalicio: ${formatMonto(precioNuevo, moneda)} ${moneda}\nValor del OPEN que ya contrató: ${formatMonto(totalAnterior, moneda)} ${moneda}\nDiferencia por pagar: ${formatMonto(diferencia, moneda)} ${moneda} (queda como una cuota con fecha de hoy, que puedes editar)\n\nSe genera el acuerdo nuevo y vuelve a firmarse; el alumno sigue activo mientras tanto.${avisoFechas}`);
  if (!ok) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Preparando…'; }
  try {
    const anterior = limpiar({
      montoTotal: acuerdo.montoTotal || '', descuento: acuerdo.descuento || '', abono: acuerdo.abono || '',
      fechaAbono: acuerdo.fechaAbono || null, cuotas: acuerdo.cuotas || null,
      pdfUrl: acuerdo.pdfUrl || null, pdfFirmadoUrl: acuerdo.pdfFirmadoUrl || null,
      moneda, archivadoEn: Date.now()
    });
    const cambios = { acuerdoAnterior: anterior, montoTotal: formatMonto(precioNuevo, moneda) };
    if (diferencia > 0) {
      const nuevaCuota = push(ref(db, `acuerdosPago/${cicloId}/cuotas`)).key;
      cambios[`cuotas/${nuevaCuota}`] = { fecha: hoyISO(), monto: formatMonto(diferencia, moneda), estado: 'pendiente', fechaPago: null };
    }
    await update(ref(db, `acuerdosPago/${cicloId}`), cambios);
    await update(ref(db, `ciclos/${cicloId}`), {
      condiciones: CONDICIONES_ACTUALES,
      upgradeVitalicio: { estado: 'pendiente_firma', iniciadoEn: Date.now(), condicionesPrevias: ciclo.condiciones || null }
    });
    try {
      await generarPdfAcuerdo(ciclo.alumnoId, cicloId);
    } catch (err) {
      console.error('No se pudo generar el PDF del upgrade:', err);
      alert('El upgrade quedó iniciado, pero el PDF no se pudo generar. Pulsa "🔄 Regenerar PDF" para intentarlo de nuevo. Detalle: ' + (err && err.message ? err.message : err));
    }
    await refrescar();
  } catch (err) {
    console.error('No se pudo iniciar el upgrade:', err);
    alert('No se pudo iniciar el upgrade. Detalle: ' + (err && err.message ? err.message : err));
    await refrescar();
  }
}

async function confirmarFirma(cicloId, ciclo, refrescar) {
  if (!confirm('¿Confirmas que el acuerdo de OPEN Vitalicio ya está firmado? Desde ahora el alumno pasa a Vitalicio (lleva el ∞ y, pasado su primer año, el modo Vitalicio).')) return;
  try {
    await update(ref(db, `ciclos/${cicloId}`), {
      vitalicio: true,
      upgradeVitalicio: { ...(ciclo.upgradeVitalicio || {}), estado: 'firmado', firmadoEn: Date.now() }
    });
    await refrescar();
  } catch (err) {
    alert('No se pudo confirmar la firma. Detalle: ' + (err && err.message ? err.message : err));
  }
}

async function cancelarUpgrade(cicloId, ciclo, acuerdo, refrescar) {
  const ant = acuerdo && acuerdo.acuerdoAnterior;
  if (!ant) { alert('No encontré el acuerdo anterior para restaurarlo.'); return; }
  if (!confirm('¿Cancelar el upgrade? El acuerdo vuelve exactamente a como estaba antes (monto, cuotas y PDF).')) return;
  try {
    await update(ref(db, `acuerdosPago/${cicloId}`), {
      montoTotal: ant.montoTotal || '', descuento: ant.descuento || '', abono: ant.abono || '',
      fechaAbono: ant.fechaAbono || null, cuotas: ant.cuotas || null,
      pdfUrl: ant.pdfUrl || null, pdfFirmadoUrl: ant.pdfFirmadoUrl || null,
      acuerdoAnterior: null
    });
    await update(ref(db, `ciclos/${cicloId}`), {
      condiciones: (ciclo.upgradeVitalicio && ciclo.upgradeVitalicio.condicionesPrevias) || null,
      upgradeVitalicio: null
    });
    await refrescar();
  } catch (err) {
    alert('No se pudo cancelar el upgrade. Detalle: ' + (err && err.message ? err.message : err));
  }
}
