/* ============================================================
   pdf-acuerdo.js
   Genera el Acuerdo de Prestación de Servicios de Mentoría real
   (texto legal completo de UNEQ) y lo sube a Firebase Storage en
   /acuerdos/{cicloId}.pdf, guardando la URL en
   acuerdosPago/{cicloId}/pdfUrl. Se dispara desde el botón del
   coach "Generar Acuerdo y Enviar a Revisión".

   Nota de diseño: los títulos de cláusula van en negrita; el
   texto DENTRO de los párrafos va en formato normal, sin
   negritas a media frase (mezclar negrita/normal en la misma
   línea con jsPDF requiere posicionamiento manual palabra por
   palabra — no cambia el contenido ni el valor legal).

   fecha_ingreso/fecha_egreso: como no existen aún en este punto
   del flujo (se fijan recién al marcar Firma Procesada), se usa
   la fecha de generación del documento como inicio estimado —
   NO se guarda en el ciclo, es solo para el texto del PDF.
   ============================================================ */

import { db, storage } from './firebase-config.js';
import { ref, get, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { jsPDF } from "https://esm.sh/jspdf@4.2.1";
import { programaLabel, calcularFechaEgreso } from './ciclos.js';

const MARGEN_X = 20;
const ANCHO_UTIL = 170;
const ALTO_MAX = 277;

function parsearMontoCLP(valor) {
  if (typeof valor === 'number') return valor;
  if (!valor) return 0;
  const limpio = valor.toString().replace(/\./g, '').replace(',', '.');
  return parseFloat(limpio) || 0;
}

function formatFechaLarga(fechaStr) {
  if (!fechaStr) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(fechaStr + 'T00:00:00'));
}

function formatDireccion(dir) {
  if (!dir) return '—';
  const partes = [
    [dir.calle, dir.numero].filter(Boolean).join(' '),
    dir.departamento,
    dir.comuna,
    dir.region,
    dir.pais
  ].filter(Boolean);
  return partes.length ? partes.join(', ') : '—';
}

function capitalizar(texto) {
  if (!texto) return '';
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/* --- Beneficios por programa (texto estático, tal cual lo definiste) --- */
const BENEFICIOS = {
  begin: {
    items: [
      'Contenido pregrabado de ejecución práctica — Nivel Inicial, para las 4 fases de la metodología 2E (acceso: 1 año)',
      'Buzón de consultas sobre el contenido, respondida por cualquiera de nuestros mentores, quienes conocen la metodología completa y las distintas temáticas (tiempo de respuesta: hasta 3 días hábiles). Se pueden realizar hasta 2 preguntas por semana. — vigente durante el programa: 3 meses',
      'Comunidad UNEQ Mentoring en Hotmart (acceso: 6 meses)',
      'Sesiones semanales grupales con coach de cabecera capacitado para revisar avances y resolver dudas de contenidos, además de responder preguntas previamente recibidas y algunas en vivo si el tiempo lo permite (vigente durante el programa: 3 meses)',
      '1 sesión mensual grupal con Maca y Felipe (vigente durante el programa: 3 meses)',
      'Acceso a Membresía ONE, con clases todos los miércoles a las 9:00 hrs (acceso: 3 meses)',
      'Acceso al Programa de Acompañamiento Sinergia (acceso: de por vida)',
      'Acceso al Curso Tu Cliente Soñado (acceso: de por vida)',
      'Grupo de WhatsApp exclusivo Begin (acceso: 6 meses)',
      'Grupo de WhatsApp Ex-Alumnos Begin (acceso: de por vida, una vez finalizado el programa)',
      'Plantillas prediseñadas listas para usar'
    ],
    duracion: 'Duración del programa (sesiones en vivo y BOX de consultas): 3 meses.',
    nota: null
  },
  next: {
    items: [
      'Contenido pregrabado de ejecución práctica — Nivel Inicial + Nivel Intermedio, para las 4 fases de la metodología 2E (acceso: de por vida)',
      'BOX Inteligente de consultas específicas por temática disponible 24/7, con Mentor IA, el cual es un CLON entrenado personalmente por el Mentor Humano especialista en esa temática. Las respuestas son revisadas y validadas por el mentor Humano y las complementa en caso de ser necesario (tiempo de respuesta: 10 segundos). Los alumnos podrán enviar 1 pregunta por Mentor por semana — vigente durante el programa: 6 meses',
      'Comunidad UNEQ Mentoring en Hotmart (vigente durante el programa: 6 meses)',
      'Coach personalizado disponible de Lunes a viernes de 9:00 a 18:00 hrs. por whatsapp, para accountability, motivación, guía para el consumo de contenidos y resolución de dudas sobre el funcionamiento del programa. (vigente durante el programa: 6 meses)',
      'Mentorías en vivo de lunes a viernes, con temáticas: Lunes Copywriting, Martes Mentalidad-Estrategia-Tráfico, Miércoles Identidad Visual y Redes Sociales, Jueves Ventas Energéticas, Viernes Gestión de Proyectos y Estructuración de Calendarios. Puedes enviar preguntas hasta 12 horas antes para cada sesión y serán respondidas de forma personalizada. (vigente durante el programa: 6 meses)',
      'Acceso a Membresía ONE, con clases todos los miércoles a las 9:00 hrs (acceso: 6 meses)',
      'Acceso al Programa de Acompañamiento Sinergia (acceso: de por vida)',
      'Acceso al Curso Tu Cliente Soñado (acceso: de por vida)',
      'Plantillas prediseñadas listas para usar',
      'Acceso a equipo del alumno, si lo requiere (hasta 2 personas)',
      'Grupo de WhatsApp UNEQ Mentoring (acceso: 6 meses)',
      'Grupo de WhatsApp Ex-Alumnos UNEQ Mentoring (acceso: de por vida, una vez finalizado el programa)',
      'Hotseat el primer martes de cada mes (acceso: 1 año)',
      'Acceso gratuito a todos los eventos online que realice la Academia (acceso: 1 año)',
      '1 acceso general al evento presencial Sinergia on Stage'
    ],
    duracion: 'Duración del programa (sesiones en vivo y BOX Inteligente de consultas): 6 meses.',
    nota: null
  },
  exit: {
    items: [
      'Contenido pregrabado de ejecución práctica — Nivel Básico, Intermedio y Avanzado, para las 4 fases de la metodología 2E (acceso: de por vida)',
      'BOX Inteligente de consultas específicas por temática disponible 24/7, con Mentor IA, el cual es un CLON entrenado personalmente por el Mentor Humano especialista en esa temática. Las respuestas son revisadas y validadas por el mentor Humano y las complementa en caso de ser necesario (tiempo de respuesta: 10 segundos). Los alumnos podrán enviar 1 pregunta por Mentor por semana — vigente durante el programa: 6 meses',
      'Comunidad UNEQ Mentoring en Hotmart (vigente durante el programa: 6 meses)',
      'Mentorías en vivo de lunes a viernes, con temáticas: Lunes Copywriting, Martes Mentalidad-Estrategia-Tráfico, Miércoles Identidad Visual y Redes Sociales, Jueves Ventas Energéticas, Viernes Gestión de Proyectos y Estructuración de Calendarios. Puedes enviar preguntas hasta 12 horas antes para cada sesión y serán respondidas de forma personalizada. (vigente durante el programa: 6 meses)',
      'Acceso a Membresía ONE, con clases todos los miércoles a las 9:00 hrs (acceso: 1 año)',
      'Acceso al Programa de Acompañamiento Sinergia (acceso: de por vida)',
      'Acceso al Curso Tu Cliente Soñado (acceso: de por vida)',
      'Plantillas prediseñadas listas para usar',
      'Acceso a equipo del alumno, si lo requiere (hasta 2 personas)',
      'Grupo de WhatsApp UNEQ Mentoring (vigente durante el programa: 6 meses)',
      'Grupo de WhatsApp privado y exclusivo con Maca y Felipe (vigente durante el programa: 6 meses)',
      'Grupo de WhatsApp Ex-Alumnos UNEQ Mentoring (acceso: de por vida, una vez finalizado el programa)',
      '8 sesiones personalizadas en Zoom con Maca y Felipe, directo (deben utilizarse dentro de los primeros 6 meses del programa)',
      'Hotseat el primer martes de cada mes (acceso: 1 año)',
      'Acceso gratuito a todos los eventos online que realice la Academia (acceso: 1 año)',
      '1 acceso general al evento presencial Sinergia on Stage'
    ],
    duracion: 'Duración del programa (sesiones en vivo y BOX Inteligente de consultas): 6 meses.',
    nota: '(En eXIT no se incluye Coach Personalizado; este es reemplazado por el acompañamiento directo de Maca y Felipe a través de WhatsApp privado y las sesiones personalizadas en Zoom.)'
  }
};

export async function generarPdfAcuerdo(alumnoId, cicloId) {
  const [alumnoSnap, cicloSnap, acuerdoSnap] = await Promise.all([
    get(ref(db, `alumnos/${alumnoId}`)),
    get(ref(db, `ciclos/${cicloId}`)),
    get(ref(db, `acuerdosPago/${cicloId}`))
  ]);
  const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
  const ciclo = cicloSnap.exists() ? cicloSnap.val() : {};
  const acuerdo = acuerdoSnap.exists() ? acuerdoSnap.val() : {};
  const moneda = acuerdo.moneda || 'CLP';

  // --- Socio/a: si el ciclo tiene más de una persona, el acuerdo se
  //     redacta y firma a nombre de ambas. ---
  const idsProyectoAcuerdo = Array.isArray(ciclo.alumnoIds) && ciclo.alumnoIds.length ? ciclo.alumnoIds : [alumnoId];
  const otrosSnaps = await Promise.all(idsProyectoAcuerdo.filter(id => id !== alumnoId).map(id => get(ref(db, `alumnos/${id}`))));
  const alumnosProyecto = [alumno, ...otrosSnaps.filter(s => s.exists()).map(s => s.val())];

  const hoyStr = new Date().toISOString().slice(0, 10);
  const fechaIngresoEstimada = hoyStr;
  const fechaEgresoEstimada = calcularFechaEgreso(hoyStr, ciclo.programa);

  const montoTotal = parsearMontoCLP(acuerdo.montoTotal);
  const descuento = parsearMontoCLP(acuerdo.descuento);
  const abono = parsearMontoCLP(acuerdo.abono);
  const saldo = montoTotal - descuento - abono;

  const nombreCompleto = alumnosProyecto
    .map(a => `${a.nombre || ''} ${a.apellido || ''}`.trim())
    .filter(Boolean)
    .join(' y ');
  let nombreCoach = '—';
  if (ciclo.coachId) {
    const coachSnap = await get(ref(db, `usuarios/${ciclo.coachId}/nombre`));
    if (coachSnap.exists()) nombreCoach = coachSnap.val();
  }
  const clausulaCoach = ciclo.programa === 'begin'
    ? 'El Alumno/a será acompañado/a durante este proceso por el Coach de Cabecera del programa BEGIN.'
    : `El Alumno/a será acompañado/a durante este proceso por su coach asignado/a, ${nombreCoach}.`;

  const doc = new jsPDF();
  let y = 22;

  function saltoDePaginaSiNecesario(altura) {
    if (y + altura > ALTO_MAX) {
      doc.addPage();
      y = 20;
    }
  }

  function parrafo(texto, { size = 10.5, style = 'normal', spacingAfter = 5, indentPrimeraLinea = 0 } = {}) {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
    const lineas = doc.splitTextToSize(texto, ANCHO_UTIL - indentPrimeraLinea);
    const alturaLinea = size * 0.42;
    lineas.forEach(linea => {
      saltoDePaginaSiNecesario(alturaLinea);
      doc.text(linea, MARGEN_X, y);
      y += alturaLinea;
    });
    y += spacingAfter;
  }

  function tituloSeccion(texto) {
    saltoDePaginaSiNecesario(12);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(texto, MARGEN_X, y);
    y += 7;
  }

  function bullets(items) {
    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'normal');
    const alturaLinea = 4.4;
    items.forEach(item => {
      const lineas = doc.splitTextToSize('•  ' + item, ANCHO_UTIL - 4);
      lineas.forEach((linea, idx) => {
        saltoDePaginaSiNecesario(alturaLinea);
        doc.text(linea, MARGEN_X + (idx === 0 ? 0 : 4), y);
        y += alturaLinea;
      });
    });
    y += 3;
  }

  function tablaCuotas(cuotas) {
    if (!cuotas.length) {
      parrafo('Sin cuotas registradas.', { style: 'normal' });
      return;
    }
    saltoDePaginaSiNecesario(10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('Fecha', MARGEN_X, y);
    doc.text('Monto', MARGEN_X + 55, y);
    y += 2;
    doc.setDrawColor(180);
    doc.line(MARGEN_X, y, MARGEN_X + ANCHO_UTIL, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    cuotas.forEach(c => {
      saltoDePaginaSiNecesario(6);
      doc.text(formatFechaLarga(c.fecha), MARGEN_X, y);
      doc.text(`${c.monto || '—'} ${moneda}`, MARGEN_X + 55, y);
      y += 6;
    });
    y += 4;
  }

  // --- Título ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('ACUERDO DE PRESTACIÓN DE SERVICIOS DE MENTORÍA', 105, y, { align: 'center' });
  y += 12;

  // --- Intro y partes — con socio/a, se nombra y describe a ambas
  //     personas por separado (RUT y domicilio propios de cada una) ---
  const descripcionPartes = alumnosProyecto
    .map(a => `${`${a.nombre || ''} ${a.apellido || ''}`.trim()}, RUT ${a.rut || '—'}, con domicilio en ${formatDireccion(a.direccion)}`)
    .join(', y ');
  parrafo(
    `En Santiago de Chile, con fecha ${formatFechaLarga(hoyStr)}, entre AGENCIA UNEQ LTDA., RUT 77.438.998-9, representada en este acto por don Luis Felipe Gostling, RUT 13.673.392-3, y doña Macarena Francisca Cruz Montt, RUT 16.143.054-4, en adelante "UNEQ"; y ${descripcionPartes}, en adelante "el/la Alumno/a" (o "los/las Alumnos/as" si corresponde a más de una persona); se acuerda celebrar el presente Acuerdo de Prestación de Servicios de Mentoría, sujeto a las siguientes cláusulas:`
  );

  // --- PRIMERO ---
  tituloSeccion('PRIMERO: Objeto del Acuerdo');
  parrafo(
    `UNEQ se compromete a prestar al Alumno/a servicios de mentoría bajo el programa ${programaLabel(ciclo.programa)}, basado en la metodología propia 2E, con fecha de inicio el ${formatFechaLarga(fechaIngresoEstimada)} y fecha de término estimada el ${formatFechaLarga(fechaEgresoEstimada)}.`
  );
  parrafo(clausulaCoach);

  // --- SEGUNDO ---
  tituloSeccion('SEGUNDO: Condiciones Económicas');
  const textoDescuento = descuento > 0 ? ', que incluye un descuento aplicado sobre el valor de lista' : '';
  parrafo(`El valor total del programa ${programaLabel(ciclo.programa)} es de ${acuerdo.montoTotal || '—'} ${moneda}${textoDescuento}.`);
  parrafo('La forma de pago acordada es la siguiente:');
  const fechaAbono = ciclo.createdAt ? new Date(ciclo.createdAt).toISOString().slice(0, 10) : null;
  parrafo(`Abono inicial: ${acuerdo.abono || '0'} ${moneda}, pagado con fecha ${formatFechaLarga(fechaAbono)}`);
  parrafo(`Saldo: ${saldo.toLocaleString('es-CL')} ${moneda}, según el siguiente calendario de cuotas:`);

  const cuotasArr = acuerdo.cuotas ? Object.values(acuerdo.cuotas).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')) : [];
  tablaCuotas(cuotasArr);

  parrafo('En Chile, UNEQ emite factura por los servicios prestados. Para alumnos extranjeros, el comprobante de pago es emitido a través de la plataforma Hotmart.');

  // --- TERCERO ---
  tituloSeccion('TERCERO: Compromisos de UNEQ');
  parrafo('UNEQ se compromete a otorgar al Alumno/a acceso a los siguientes contenidos y beneficios, correspondientes al programa contratado:');
  const beneficios = BENEFICIOS[ciclo.programa] || BENEFICIOS.begin;
  bullets(beneficios.items);
  parrafo(beneficios.duracion, { style: 'bold' });
  if (beneficios.nota) parrafo(beneficios.nota, { style: 'italic' });

  // --- CUARTO ---
  tituloSeccion('CUARTO: Compromisos del Alumno/a');
  parrafo('El Alumno/a se compromete a participar activamente, asistir a las sesiones acordadas, y cumplir con los pagos en las fechas establecidas.');
  parrafo('El Alumno/a declara comprender que los resultados de esta mentoría no dependen exclusivamente de UNEQ, sino principalmente del esfuerzo, compromiso y ejecución del propio Alumno/a, y que dichos resultados están sujetos a múltiples variables externas que escapan del control de UNEQ (mercado, industria, contexto económico, entre otras). Cada proyecto es único, por lo que los resultados obtenidos por otros alumnos no constituyen garantía ni referencia vinculante de los resultados que el Alumno/a pueda obtener.');
  parrafo('Asimismo, el Alumno/a declara entender que, para aplicar correctamente los contenidos entregados y obtener resultados, es probable que deba considerar inversión adicional propia en publicidad y/o herramientas digitales, según su caso particular.');

  // --- QUINTO ---
  tituloSeccion('QUINTO: Atraso en Pagos');
  parrafo('En caso de atraso en el pago de alguna cuota acordada, el Alumno/a podría perder el acceso a los activos del programa y a las mentorías en vivo mientras dicho atraso se mantenga vigente. El acceso se restablece una vez regularizado el pago.');

  // --- SEXTO ---
  tituloSeccion('SEXTO: Retiro y Congelamiento');
  parrafo('En caso de retiro voluntario del Alumno/a durante el desarrollo del programa, no procederá devolución de los montos pagados.');
  parrafo('El Alumno/a tendrá derecho a solicitar un (1) congelamiento de su participación en el programa, por un período máximo de tres (3) meses. La fecha de término del programa se extenderá automáticamente por el mismo número de días que dure el congelamiento.');

  // --- SÉPTIMO ---
  tituloSeccion('SÉPTIMO: Comportamiento y Convivencia en la Comunidad');
  parrafo('El respeto hacia el equipo de UNEQ, coaches y demás miembros de la comunidad es un valor fundamental e innegociable. Cualquier conducta que atente contra este principio, o contra los valores de UNEQ, será causal de expulsión inmediata del programa, sin derecho a devolución de los montos pagados.');

  // --- OCTAVO ---
  tituloSeccion('OCTAVO: Confidencialidad y Propiedad Intelectual');
  parrafo('La metodología 2E, materiales, contenidos y demás recursos entregados durante el programa son de propiedad exclusiva de UNEQ, y su uso queda restringido exclusivamente al desarrollo personal del Alumno/a, quedando prohibida su reproducción, distribución o uso comercial no autorizado.');

  // --- NOVENO ---
  tituloSeccion('NOVENO: Protección de Datos Personales');
  parrafo('UNEQ Mentoring protege la información personal del Alumno/a conforme a la normativa vigente. Los datos ingresados en la plataforma se almacenan en la infraestructura de Google Cloud / Firebase, con acceso restringido por reglas de seguridad y autenticación, y cifrado tanto en tránsito como en reposo.');
  parrafo('Las respuestas generadas por inteligencia artificial se procesan a través de la API paga de Google Gemini, bajo la cual Google se compromete contractualmente a no utilizar la información enviada (preguntas, respuestas, ni contenido de mentores o alumnos) para entrenar o mejorar sus propios modelos de IA.');
  parrafo('UNEQ Mentoring tampoco utiliza los datos personales de sus alumnos con fines distintos a la prestación del servicio contratado.');

  // --- DÉCIMO ---
  tituloSeccion('DÉCIMO: Jurisdicción');
  parrafo('Para todos los efectos legales derivados del presente acuerdo, las partes fijan su domicilio en la ciudad de Santiago de Chile, sometiéndose a la jurisdicción de sus Tribunales.');

  // --- FIRMAS ---
  tituloSeccion('FIRMAS');
  parrafo('Firmado electrónicamente por las partes a través de Google Workspace.', { spacingAfter: 22 });
  parrafo('Felipe Gostling, RUT 13.673.392-3 en representación de Agencia UNEQ Ltda.', { spacingAfter: 22 });
  parrafo('Macarena Cruz, RUT 16.143.054-4 en representación de Agencia UNEQ Ltda.', { spacingAfter: 22 });
  alumnosProyecto.forEach((a, idx) => {
    const nombreFirma = `${a.nombre || ''} ${a.apellido || ''}`.trim();
    parrafo(`${nombreFirma}, RUT: ${a.rut || '—'}`, { spacingAfter: idx === alumnosProyecto.length - 1 ? 10 : 22 });
  });

  // --- Subir a Storage y guardar la URL ---
  const blob = doc.output('blob');
  const archivoRef = storageRef(storage, `acuerdos/${cicloId}.pdf`);
  await uploadBytes(archivoRef, blob);
  const url = await getDownloadURL(archivoRef);

  await update(ref(db, `acuerdosPago/${cicloId}`), { pdfUrl: url });
  return url;
}
