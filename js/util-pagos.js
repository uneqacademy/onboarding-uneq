/* ============================================================
   util-pagos.js — cálculos de pagos compartidos por la ficha del
   alumno (pagos.js) y la sección "Pagos" del director
   (pagos-consolidado.js). Una sola fuente de verdad:
   acuerdosPago/{cicloId} = { montoTotal, moneda, descuento, abono, fechaAbono,
   cuotas: { id: { fecha (vencimiento), monto, estado, fechaPago } } }
   ============================================================ */

// Los montos se guardan como texto ("1.500.000" o "1500000"; en USD puede venir "1.250,50").
export function parsearMonto(valor) {
  if (typeof valor === 'number') return valor;
  if (!valor) return 0;
  return parseFloat(valor.toString().replace(/\./g, '').replace(',', '.')) || 0;
}

export function formatMonto(numero, moneda) {
  return (numero || 0).toLocaleString('es-CL', { maximumFractionDigits: moneda === 'USD' ? 2 : 0 });
}

export function hoyISO() {
  return new Intl.DateTimeFormat('en-CA').format(new Date()); // "2026-10-29", hora local
}

export function fechaCorta(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}-${m}-${a}`;
}

// Igual que el aviso de atraso de la ficha y del alumno: vencida = fecha de hoy o anterior y no pagada.
export function cuotaVencida(cuota) {
  if (!cuota || !cuota.fecha || cuota.estado === 'pagada') return false;
  return cuota.fecha <= hoyISO();
}

// Todo lo que la matriz y la ficha necesitan saber de un acuerdo.
export function resumenAcuerdo(acuerdo) {
  const a = acuerdo || {};
  const moneda = a.moneda || 'CLP';
  const monto = parsearMonto(a.montoTotal);
  const descuento = parsearMonto(a.descuento);
  const total = Math.max(monto - descuento, 0);
  const abono = parsearMonto(a.abono);
  const cuotas = Object.entries(a.cuotas || {}).sort((x, y) => (x[1].fecha || '').localeCompare(y[1].fecha || ''));
  const pagadoCuotas = cuotas.filter(([, c]) => c.estado === 'pagada').reduce((s, [, c]) => s + parsearMonto(c.monto), 0);
  const pagado = abono + pagadoCuotas; // el abono cuenta como pagado
  const atrasadoMonto = cuotas.filter(([, c]) => cuotaVencida(c) || c.estado === 'impaga')
    .reduce((s, [, c]) => s + parsearMonto(c.monto), 0);
  return {
    moneda, monto, descuento, total, abono, fechaAbono: a.fechaAbono || '',
    cuotas, pagado, porCubrir: Math.max(total - pagado, 0), atrasadoMonto,
    atrasado: cuotas.some(([, c]) => cuotaVencida(c) || c.estado === 'impaga')
  };
}
