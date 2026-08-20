/* ============================================================
   respaldo.js
   Herramientas de respaldo para el Director (botones viven en la
   vista Alumnos, ya protegidos porque esa vista es director-only):
   - Descargar Excel con todos los alumnos, ciclos y acuerdos.
   - Descargar JSON completo de respaldo.
   - Importar un JSON de respaldo anterior (REEMPLAZA los datos
     actuales de alumnos/ciclos/acuerdosPago, con confirmación).
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

async function obtenerDatosCompletos() {
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

function fechaParaNombreArchivo() {
  return new Date().toISOString().slice(0, 10);
}

const btnExportarExcel = document.getElementById('btn-exportar-excel');
if (btnExportarExcel) {
  btnExportarExcel.addEventListener('click', async () => {
    btnExportarExcel.disabled = true;
    btnExportarExcel.textContent = 'Generando...';
    try {
      const { alumnos, ciclos, acuerdosPago } = await obtenerDatosCompletos();

      const filas = Object.entries(alumnos).map(([, alumno]) => {
        const ciclo = alumno.cicloActualId ? ciclos[alumno.cicloActualId] : null;
        const acuerdo = alumno.cicloActualId ? acuerdosPago[alumno.cicloActualId] : null;
        return {
          Nombre: alumno.nombre || '',
          Apellido: alumno.apellido || '',
          RUT: alumno.rut || '',
          Telefono: alumno.telefono || '',
          Programa: ciclo ? ciclo.programa || '' : '',
          'Estado Proceso': ciclo ? ciclo.estadoProceso || '' : '',
          'Estado Alumno': ciclo ? ciclo.estadoAlumno || '' : '',
          'Fecha Ingreso': ciclo ? ciclo.fechaIngreso || '' : '',
          'Fecha Egreso': ciclo ? ciclo.fechaEgreso || '' : '',
          'Monto Total': acuerdo ? acuerdo.montoTotal || '' : '',
          Moneda: acuerdo ? acuerdo.moneda || '' : '',
          Descuento: acuerdo ? acuerdo.descuento || '' : '',
          Abono: acuerdo ? acuerdo.abono || '' : ''
        };
      });

      const hoja = XLSX.utils.json_to_sheet(filas);
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, 'Alumnos');
      XLSX.writeFile(libro, `respaldo-alumnos-${fechaParaNombreArchivo()}.xlsx`);
    } catch (err) {
      alert('No se pudo generar el Excel. Intenta de nuevo.');
    } finally {
      btnExportarExcel.disabled = false;
      btnExportarExcel.textContent = 'Descargar Excel';
    }
  });
}

const btnExportarJson = document.getElementById('btn-exportar-json');
if (btnExportarJson) {
  btnExportarJson.addEventListener('click', async () => {
    btnExportarJson.disabled = true;
    btnExportarJson.textContent = 'Generando...';
    try {
      const datos = await obtenerDatosCompletos();
      descargarArchivo(JSON.stringify(datos, null, 2), `respaldo-onboarding-${fechaParaNombreArchivo()}.json`, 'application/json');
    } finally {
      btnExportarJson.disabled = false;
      btnExportarJson.textContent = 'Descargar JSON';
    }
  });
}

const btnImportarJson = document.getElementById('btn-importar-json');
const inputImportarJson = document.getElementById('input-importar-json');
if (btnImportarJson && inputImportarJson) {
  btnImportarJson.addEventListener('click', () => inputImportarJson.click());

  inputImportarJson.addEventListener('change', async () => {
    const file = inputImportarJson.files[0];
    if (!file) return;

    const confirmado = confirm(
      '⚠️ Esto va a REEMPLAZAR todos los alumnos, ciclos y acuerdos de pago actuales por los del archivo importado. ' +
      'Esta acción no se puede deshacer. ¿Confirmas que quieres continuar?'
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
