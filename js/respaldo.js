/* ============================================================
   respaldo.js
   Herramientas de respaldo para el Director (botones viven en la
   vista Alumnos, ya protegidos porque esa vista es director-only):

   - Descargar CSV: Nombre, Apellido, RUT, Fecha de Nacimiento, Edad,
     Programa Cursado, Monto Acordado (total, esté pendiente o no),
     País, Género, Teléfono, Dirección. Un alumno por fila.
   - Descargar JSON: respaldo COMPLETO de toda la base (no solo
     alumnos) — requiere el permiso de lectura de raíz para
     director agregado en database.rules.json.
   - Importar JSON: restaura alumnos + ciclos + acuerdosPago desde
     un respaldo anterior (reemplaza lo actual, con confirmación).
     No toca /usuarios a propósito, para no romper logins reales.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { programaLabel } from './ciclos.js';

function fechaParaNombreArchivo() {
  return new Date().toISOString().slice(0, 10);
}

function formatFechaCorta(fechaStr) {
  if (!fechaStr) return '';
  const [y, m, d] = fechaStr.split('-');
  return `${d}-${m}-${y}`;
}

function calcularEdadLocal(fechaNacStr) {
  if (!fechaNacStr) return '';
  const nacimiento = new Date(fechaNacStr + 'T00:00:00');
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const noHaCumplidoAunEsteAnio = (hoy.getMonth() < nacimiento.getMonth()) ||
    (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate());
  if (noHaCumplidoAunEsteAnio) edad--;
  return edad >= 0 ? edad : '';
}

function csvEscape(valor) {
  const texto = (valor === null || valor === undefined) ? '' : String(valor);
  if (/[;"\n]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

function descargarArchivo(contenido, nombreArchivo, tipoMime) {
  const blob = new Blob([contenido], { type: tipoMime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function obtenerDatosDeAlumnos() {
  const [alumnosSnap, ciclosSnap, acuerdosSnap] = await Promise.all([
    get(ref(db, 'alumnos')),
    get(ref(db, 'ciclos')),
    get(ref(db, 'acuerdosPago'))
  ]);
  return {
    alumnos: alumnosSnap.exists() ? alumnosSnap.val() : {},
    ciclos: ciclosSnap.exists() ? ciclosSnap.val() : {},
    acuerdosPago: acuerdosSnap.exists() ? acuerdosSnap.val() : {}
  };
}

/* --- Descargar CSV (columnas fijas pedidas) --- */
const btnExportarExcel = document.getElementById('btn-exportar-excel');
if (btnExportarExcel) {
  btnExportarExcel.addEventListener('click', async () => {
    btnExportarExcel.disabled = true;
    btnExportarExcel.textContent = 'Generando...';
    try {
      const { alumnos, ciclos, acuerdosPago } = await obtenerDatosDeAlumnos();

      const encabezados = [
        'Nombre', 'Apellido', 'RUT', 'Fecha de Nacimiento', 'Edad',
        'Programa Cursado', 'Monto Acordado', 'País', 'Género', 'Teléfono', 'Dirección'
      ];
      const filas = [encabezados.join(';')];

      Object.values(alumnos).forEach(alumno => {
        const ciclo = alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
        const acuerdo = alumno.cicloActualId ? acuerdosPago[alumno.cicloActualId] : null;
        const dir = alumno.direccion || {};

        const direccionTexto = [
          [dir.calle, dir.numero].filter(Boolean).join(' '),
          dir.departamento,
          dir.comuna,
          dir.region
        ].filter(Boolean).join(', ');

        const montoTexto = acuerdo && acuerdo.montoTotal ? `${acuerdo.montoTotal} ${acuerdo.moneda || ''}`.trim() : '';

        const fila = [
          alumno.nombre || '',
          alumno.apellido || '',
          alumno.rut || '',
          formatFechaCorta(alumno.fechaNacimiento),
          calcularEdadLocal(alumno.fechaNacimiento),
          ciclo ? programaLabel(ciclo.programa) : '',
          montoTexto,
          dir.pais || '',
          alumno.genero || '',
          alumno.telefono || '',
          direccionTexto
        ].map(csvEscape).join(';');

        filas.push(fila);
      });

      // BOM al inicio para que Excel abra tildes/ñ correctamente
      descargarArchivo('\uFEFF' + filas.join('\n'), `respaldo-alumnos-${fechaParaNombreArchivo()}.csv`, 'text/csv;charset=utf-8;');
    } catch (err) {
      alert('No se pudo generar el CSV. Intenta de nuevo.');
    } finally {
      btnExportarExcel.disabled = false;
      btnExportarExcel.textContent = 'Descargar Excel';
    }
  });
}

/* --- Descargar JSON: TODA la base, no solo alumnos --- */
const btnExportarJson = document.getElementById('btn-exportar-json');
if (btnExportarJson) {
  btnExportarJson.addEventListener('click', async () => {
    btnExportarJson.disabled = true;
    btnExportarJson.textContent = 'Generando...';
    try {
      const snap = await get(ref(db, '/'));
      const datos = snap.exists() ? snap.val() : {};
      descargarArchivo(JSON.stringify(datos, null, 2), `respaldo-completo-${fechaParaNombreArchivo()}.json`, 'application/json');
    } catch (err) {
      alert('No se pudo generar el JSON. Revisa que las reglas de seguridad tengan el permiso de lectura de raíz para director (database.rules.json actualizado).');
    } finally {
      btnExportarJson.disabled = false;
      btnExportarJson.textContent = 'Descargar JSON';
    }
  });
}

/* --- Importar JSON: restaura solo alumnos + ciclos + acuerdosPago
       (no toca /usuarios, para no romper logins reales) --- */
const btnImportarJson = document.getElementById('btn-importar-json');
const inputImportarJson = document.getElementById('input-importar-json');
if (btnImportarJson && inputImportarJson) {
  btnImportarJson.addEventListener('click', () => inputImportarJson.click());

  inputImportarJson.addEventListener('change', async () => {
    const file = inputImportarJson.files[0];
    if (!file) return;

    const confirmado = confirm(
      '⚠️ Esto va a REEMPLAZAR todos los alumnos, ciclos y acuerdos de pago actuales por los del archivo importado ' +
      '(no toca las cuentas de usuarios/coaches). Esta acción no se puede deshacer. ¿Confirmas que quieres continuar?'
    );
    if (!confirmado) { inputImportarJson.value = ''; return; }

    try {
      const texto = await file.text();
      const datos = JSON.parse(texto);

      if (!datos.alumnos || !datos.ciclos) {
        alert('El archivo no tiene el formato esperado (faltan "alumnos" o "ciclos"). No se importó nada.');
        return;
      }

      await Promise.all([
        set(ref(db, 'alumnos'), datos.alumnos || {}),
        set(ref(db, 'ciclos'), datos.ciclos || {}),
        set(ref(db, 'acuerdosPago'), datos.acuerdosPago || {})
      ]);

      alert('Importación completa. La página se va a recargar para reflejar los datos nuevos.');
      window.location.reload();
    } catch (err) {
      alert('No se pudo leer o importar el archivo. Verifica que sea un JSON de respaldo válido generado por esta misma app.');
    } finally {
      inputImportarJson.value = '';
    }
  });
}
