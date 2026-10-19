/* ============================================================
   util-ficha.js — listas y validaciones de los "Datos Generales"
   del alumno, usadas por el formulario que el alumno completa él
   mismo desde "Mi Ficha". Son las mismas opciones que ofrece el
   formulario del equipo (index.html, pestaña Datos Generales).
   ============================================================ */

export const GENEROS = ['Femenino', 'Masculino', 'Otro', 'Prefiere no decir'];

export const OCUPACIONES = [
  { valor: 'Coach', etiqueta: 'Coach (Definir Especialidad)' },
  { valor: 'Terapeuta', etiqueta: 'Terapeuta (Definir Especialidad)' },
  { valor: 'Psicólogo/a', etiqueta: 'Psicólogo/a' },
  { valor: 'Ingeniero/a', etiqueta: 'Ingeniero/a (Definir Especialidad)' },
  { valor: 'Abogado/a', etiqueta: 'Abogado/a' },
  { valor: 'Consultor/a', etiqueta: 'Consultor/a (Definir Especialidad)' },
  { valor: 'Otro', etiqueta: 'Otro' }
];

export const OCUPACIONES_CON_ESPECIALIDAD = ['Coach', 'Terapeuta', 'Ingeniero/a', 'Consultor/a', 'Otro'];

/* --- RUT chileno: dígito verificador (módulo 11) --- */
function limpiarRut(valor) {
  return String(valor || '').replace(/[.\s-]/g, '').toUpperCase();
}

function digitoVerificador(cuerpo) {
  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

export function validarRut(valor) {
  const limpio = limpiarRut(valor);
  if (!/^\d{7,8}[\dK]$/.test(limpio)) return false;
  const cuerpo = limpio.slice(0, -1);
  return digitoVerificador(cuerpo) === limpio.slice(-1);
}

// 123456785 -> 12.345.678-5
export function formatearRut(valor) {
  const limpio = limpiarRut(valor);
  if (limpio.length < 2) return limpio;
  const cuerpo = limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${limpio.slice(-1)}`;
}

/* --- Validación completa del formulario del alumno ---
   datos: { rut, fechaNacimiento, genero, telefono, ocupacion, ocupacionEspecialidad,
            direccion: { calle, numero, departamento, pais, region, comuna } }
   Devuelve { errores: [mensaje], limpio: datos normalizados }.
   En Chile el RUT se valida con su dígito verificador; en otros países es
   un documento de identidad libre (mínimo 5 caracteres). */
export function validarFichaAlumno(datos, hoy = new Date()) {
  const errores = [];
  const txt = v => String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  const d = datos || {};
  const dir = d.direccion || {};
  const esChile = txt(dir.pais) === 'Chile';

  let rut = txt(d.rut);
  if (!rut) errores.push('Ingresa tu RUT o documento de identidad.');
  else if (esChile) {
    if (!validarRut(rut)) errores.push('El RUT no es válido. Revisa los números y el dígito verificador.');
    else rut = formatearRut(rut);
  } else if (rut.length < 5) errores.push('El documento de identidad es muy corto.');

  const fecha = txt(d.fechaNacimiento);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) {
    errores.push('Ingresa una fecha de nacimiento válida.');
  } else {
    const nac = new Date(fecha + 'T00:00:00');
    const edad = (hoy - nac) / (365.25 * 86400000);
    if (edad < 16 || edad > 100) errores.push('Revisa la fecha de nacimiento.');
  }

  const genero = txt(d.genero);
  if (!GENEROS.includes(genero)) errores.push('Selecciona tu género.');

  // Formato internacional sin espacios (+56912345678), igual al que guarda el formulario del equipo.
  const telefono = txt(d.telefono).replace(/[\s()-]/g, '');
  if (!/^\+\d{8,15}$/.test(telefono)) errores.push('Ingresa tu teléfono con código de país, por ejemplo +56 9 1234 5678.');

  const ocupacion = txt(d.ocupacion);
  if (!OCUPACIONES.some(o => o.valor === ocupacion)) errores.push('Selecciona tu ocupación.');
  const especialidad = txt(d.ocupacionEspecialidad);
  if (OCUPACIONES_CON_ESPECIALIDAD.includes(ocupacion) && !especialidad) errores.push('Indica tu especialidad.');

  const direccion = {
    calle: txt(dir.calle), numero: txt(dir.numero), departamento: txt(dir.departamento),
    pais: txt(dir.pais), region: txt(dir.region), comuna: txt(dir.comuna)
  };
  if (!direccion.calle) errores.push('Ingresa la calle.');
  if (!direccion.numero) errores.push('Ingresa el número.');
  if (!direccion.pais) errores.push('Selecciona el país.');
  if (!direccion.region) errores.push('Selecciona la región o estado.');
  if (!direccion.comuna) errores.push('Ingresa la comuna o ciudad.');

  const largos = [rut, telefono, especialidad, ...Object.values(direccion)];
  if (largos.some(v => v.length > 120)) errores.push('Alguno de los textos es demasiado largo.');

  return {
    errores,
    limpio: {
      rut, fechaNacimiento: fecha, genero, telefono, ocupacion,
      ocupacionEspecialidad: OCUPACIONES_CON_ESPECIALIDAD.includes(ocupacion) ? especialidad : '',
      direccion
    }
  };
}
