/* ============================================================
   ciclos.js
   Máquina de estados del proceso de onboarding + acuerdo de pago.

   estadoProceso: asignado -> en_onboarding -> enviado_firma
                  -> en_revision -> firma_procesada
   estadoAlumno:  activo | pausado | egresado | abandono
   ============================================================ */

import { db } from './firebase-config.js';
import {
  ref, push, set, update, get
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

export const PROGRAMAS = {
  begin: { label: 'Begin', meses: 3, precioClp: 1500000 },
  next:  { label: 'Next',  meses: 6, precioClp: 3000000 },
  exit:  { label: 'eXIT',  meses: 6, precioClp: 5000000 }
};

const ORDEN_ESTADOS = ['asignado', 'en_onboarding', 'enviado_firma', 'en_revision', 'firma_procesada', 'matricula_finalizada'];

const LABELS_ESTADO = {
  asignado: 'Asignado',
  en_onboarding: 'En Onboarding',
  enviado_firma: 'Enviado para Firma',
  en_revision: 'En Revisión',
  firma_procesada: 'Firma Procesada',
  matricula_finalizada: 'Proceso de Matrícula Finalizado'
};

export function programaLabel(key) {
  return PROGRAMAS[key] ? PROGRAMAS[key].label : key;
}

export function estadoProcesoLabel(estado) {
  return LABELS_ESTADO[estado] || estado;
}

/* --- Crea un ciclo nuevo (llamado desde alumnos.js al crear alumno) --- */
export async function crearCiclo({ alumnoId, coachId, programa, acuerdoPago }) {
  const cicloRef = push(ref(db, 'ciclos'));
  const cicloId = cicloRef.key;

  await set(cicloRef, {
    alumnoId,
    coachId,
    programa,
    estadoProceso: 'asignado',
    estadoAlumno: 'en_proceso_matricula',
    fechaIngreso: null,
    fechaEgreso: null,
    bloqueoCoach: false,
    facturacionActual: '',
    objetivoFacturacion: '',
    situacionPersonal: '',
    objetivosPersonales: '',
    createdAt: Date.now()
  });

  await set(ref(db, `acuerdosPago/${cicloId}`), acuerdoPago);
  await update(ref(db, `alumnos/${alumnoId}`), { cicloActualId: cicloId });

  return cicloId;
}

/* --- Auto-transición asignado -> en_onboarding, al primer guardado del coach --- */
export async function iniciarOnboardingSiCorresponde(cicloId) {
  const snap = await get(ref(db, `ciclos/${cicloId}/estadoProceso`));
  if (snap.exists() && snap.val() === 'asignado') {
    await update(ref(db, `ciclos/${cicloId}`), { estadoProceso: 'en_onboarding' });
  }
}

/* --- en_onboarding -> enviado_firma (coach genera el acuerdo) --- */
export async function generarAcuerdoYEnviarRevision(cicloId) {
  await update(ref(db, `ciclos/${cicloId}`), { estadoProceso: 'enviado_firma' });
}

/* --- enviado_firma -> en_revision (director confirma que lo envió a firmar) --- */
export async function marcarEnviadoParaFirma(cicloId) {
  await update(ref(db, `ciclos/${cicloId}`), { estadoProceso: 'en_revision' });
}

/* --- en_revision -> firma_procesada -> matricula_finalizada (automático e inmediato:
       el director fija la fecha real de firma y, en el mismo paso, se da por
       finalizado el proceso de matrícula) --- */
export async function marcarFirmaProcesada(cicloId, fechaFirmaStr) {
  const snap = await get(ref(db, `ciclos/${cicloId}/programa`));
  const programa = snap.val();
  const fechaEgreso = calcularFechaEgreso(fechaFirmaStr, programa);

  await update(ref(db, `ciclos/${cicloId}`), {
    estadoProceso: 'matricula_finalizada',
    estadoAlumno: 'activo',
    fechaIngreso: fechaFirmaStr,
    fechaEgreso,
    bloqueoCoach: true
  });
}

export function calcularFechaEgreso(fechaIngresoStr, programaKey) {
  const meses = PROGRAMAS[programaKey] ? PROGRAMAS[programaKey].meses : 3;
  const fecha = new Date(fechaIngresoStr + 'T00:00:00');
  fecha.setMonth(fecha.getMonth() + meses);
  return fecha.toISOString().slice(0, 10);
}

export async function toggleCandado(cicloId, bloqueado) {
  await update(ref(db, `ciclos/${cicloId}`), { bloqueoCoach: bloqueado });
}

/* --- Render del stepper visual según estadoProceso.
       El último paso, al llegar, se pinta también como "completado"
       (no solo "actual") para que la línea llegue verde hasta el final —
       si no, un paso que nunca tiene un siguiente jamás se marca is-done. --- */
export function renderStepper(estadoActual) {
  const idxActual = ORDEN_ESTADOS.indexOf(estadoActual);
  const esUltimoPaso = idxActual === ORDEN_ESTADOS.length - 1;
  return ORDEN_ESTADOS.map((estado, idx) => {
    let claseEstado = '';
    if (idx < idxActual || (idx === idxActual && esUltimoPaso)) claseEstado = 'is-done';
    else if (idx === idxActual) claseEstado = 'is-current';
    return `<div class="stepper__step ${claseEstado}">
              <div class="stepper__line"></div><div class="stepper__dot"></div>
              <div class="stepper__label">${LABELS_ESTADO[estado]}</div>
            </div>`;
  }).join('');
}

/* --- Decide qué panel de acción mostrar, según rol + estado --- */
export function renderAcciones(estadoProceso, role) {
  const panelCoach = document.getElementById('panel-accion-coach');
  const panelEnviarRevision = document.getElementById('panel-accion-enviar-revision');
  const panelFirmaProcesada = document.getElementById('panel-accion-firma-procesada');

  panelCoach.classList.toggle('hidden', !(role === 'coach' && estadoProceso === 'en_onboarding'));
  panelEnviarRevision.classList.toggle('hidden', !(role === 'director' && estadoProceso === 'enviado_firma'));
  panelFirmaProcesada.classList.toggle('hidden', !(role === 'director' && estadoProceso === 'en_revision'));

  const inputFecha = document.getElementById('input-fecha-firma');
  if (inputFecha && !inputFecha.value) {
    inputFecha.value = new Date().toISOString().slice(0, 10);
  }

  const banner = document.getElementById('banner-bloqueo-coach');
  banner.classList.toggle('hidden', !(role === 'coach' && (estadoProceso === 'enviado_firma' || estadoProceso === 'en_revision')));
}
