/* ============================================================
   pdf-acuerdo.js
   Genera el PDF del acuerdo (alumno + programa + condiciones de
   pago + cuotas) y lo sube a Firebase Storage en
   /acuerdos/{cicloId}.pdf, guardando la URL en
   acuerdosPago/{cicloId}/pdfUrl. Se dispara desde el botón del
   coach "Generar Acuerdo y Enviar a Revisión" — es el "Coach
   genera el acuerdo" del proceso original.
   ============================================================ */

import { db, storage } from './firebase-config.js';
import { ref, get, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { jsPDF } from "https://esm.sh/jspdf@4.2.1";
import { programaLabel } from './ciclos.js';

export async function generarPdfAcuerdo(alumnoId, cicloId) {
  const [alumnoSnap, cicloSnap, acuerdoSnap] = await Promise.all([
    get(ref(db, `alumnos/${alumnoId}`)),
    get(ref(db, `ciclos/${cicloId}`)),
    get(ref(db, `acuerdosPago/${cicloId}`))
  ]);
  const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
  const ciclo = cicloSnap.exists() ? cicloSnap.val() : {};
  const acuerdo = acuerdoSnap.exists() ? acuerdoSnap.val() : {};
  const moneda = acuerdo.moneda || '';

  const doc = new jsPDF();
  let y = 22;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Acuerdo de Mentoría — UNEQ Mentoring', 20, y);
  y += 14;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Alumno: ${alumno.nombre || ''} ${alumno.apellido || ''}`, 20, y); y += 7;
  doc.text(`RUT: ${alumno.rut || '—'}`, 20, y); y += 7;
  doc.text(`Programa: ${programaLabel(ciclo.programa)}`, 20, y); y += 14;

  doc.setFont('helvetica', 'bold');
  doc.text('Condiciones de pago', 20, y); y += 8;
  doc.setFont('helvetica', 'normal');

  const montoTotal = parseFloat(acuerdo.montoTotal) || 0;
  const descuento = parseFloat(acuerdo.descuento) || 0;
  const abono = parseFloat(acuerdo.abono) || 0;
  const saldo = montoTotal - descuento - abono;

  doc.text(`Monto total: ${acuerdo.montoTotal || '—'} ${moneda}`, 20, y); y += 7;
  doc.text(`Descuento: ${acuerdo.descuento || '0'}`, 20, y); y += 7;
  doc.text(`Abono: ${acuerdo.abono || '0'} ${moneda}`, 20, y); y += 7;
  doc.text(`Saldo a financiar: ${saldo.toLocaleString('es-CL')} ${moneda}`, 20, y); y += 14;

  if (acuerdo.cuotas && Object.keys(acuerdo.cuotas).length) {
    doc.setFont('helvetica', 'bold');
    doc.text('Cuotas', 20, y); y += 8;
    doc.setFont('helvetica', 'normal');
    Object.values(acuerdo.cuotas)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
      .forEach(c => {
        if (y > 275) { doc.addPage(); y = 20; }
        doc.text(`${c.fecha || '—'}    ${c.monto || '—'} ${moneda}`, 20, y);
        y += 7;
      });
  }

  const blob = doc.output('blob');
  const archivoRef = storageRef(storage, `acuerdos/${cicloId}.pdf`);
  await uploadBytes(archivoRef, blob);
  const url = await getDownloadURL(archivoRef);

  await update(ref(db, `acuerdosPago/${cicloId}`), { pdfUrl: url });
  return url;
}
