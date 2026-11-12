/* ============================================================
   demo.js — Alumno Demo: lo que escribe o hace en la app no lo ven
   los alumnos reales.
   - Al estar en modo demo (director, copiloto o mentor mirando "como
     alumno"), todo lo que se guarda en lo público lleva esDemo:true
     (marcaDemo).
   - Cuando quien mira es un alumno real, las publicaciones, comentarios,
     respuestas y reacciones del demo se descartan (sinDemo /
     ocultarParaAlumno). El staff y el propio demo sí las ven.
   - Lo antiguo (sin la marca) se reconoce por el id "demo-..." o por el
     nombre "Alumno Demo (… · DEMO)".
   ============================================================ */

import { getCurrentRole, esModoDemo } from './main.js';

const ES_ID_DEMO = /^demo-/;
const ES_NOMBRE_DEMO = /Alumno Demo|\bDEMO\b/;
const CAMPOS_ID = ['alumnoId', 'alumnoIdPublicador', 'proyectoId'];
const CAMPOS_NOMBRE = ['alumnoNombre', 'nombreAutor', 'autorNombre', 'nombre'];

// Se agrega con "...marcaDemo()" a lo que se escribe en lo público.
export function marcaDemo() {
  return esModoDemo() ? { esDemo: true } : {};
}

export function esDelDemo(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.esDemo === true) return true;
  if (CAMPOS_ID.some(c => typeof item[c] === 'string' && ES_ID_DEMO.test(item[c]))) return true;
  return CAMPOS_NOMBRE.some(c => typeof item[c] === 'string' && ES_NOMBRE_DEMO.test(item[c]));
}

// Solo se oculta cuando mira un alumno real (no el demo ni el staff).
function miraAlumnoReal() {
  return getCurrentRole() === 'alumno' && !esModoDemo();
}

export function ocultarParaAlumno(item) {
  return miraAlumnoReal() && esDelDemo(item);
}

// Recibe un objeto { id: item } (comentarios, respuestas, reacciones) y devuelve el mismo
// sin lo del demo, si quien mira es un alumno real.
export function sinDemo(obj) {
  if (!obj || typeof obj !== 'object' || !miraAlumnoReal()) return obj;
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => !esDelDemo(v)));
}

/* --- Fase simulada del Alumno Demo ---
   El demo elige en qué fase "está" (0 = inicio, 1-4, 5 = final/egresado) para previsualizar lo que cada
   fase desbloquea o muestra. Todas las pantallas que dependen de la fase leen el ciclo a través de
   cicloParaVista(). Solo actúa en modo demo. */
const CLAVE_FASE_DEMO = 'uneq.demoFase';
let faseDemoSel = 1;
try { const g = parseInt(sessionStorage.getItem(CLAVE_FASE_DEMO), 10); if (g >= 0 && g <= 5) faseDemoSel = g; } catch (e) { /* sin almacenamiento */ }

export const getFaseDemo = () => faseDemoSel;
export function setFaseDemo(n) {
  faseDemoSel = Math.min(5, Math.max(0, Number(n) || 0));
  try { sessionStorage.setItem(CLAVE_FASE_DEMO, String(faseDemoSel)); } catch (e) { /* sin almacenamiento */ }
}
export function cicloParaVista(ciclo) {
  if (!ciclo || !esModoDemo()) return ciclo;
  const n = faseDemoSel;
  return {
    ...ciclo,
    faseMetodologia: n >= 1 && n <= 4 ? 'fase' + n : '',
    estadoAlumno: n === 5 ? 'egresado' : (ciclo.estadoAlumno === 'egresado' ? 'activo' : ciclo.estadoAlumno)
  };
}
