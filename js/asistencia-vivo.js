/* ============================================================
   asistencia-vivo.js — asistencia a mentorías en vivo (Mis Mentorías) y a sesiones de cabecera.
   El mentor/copiloto abre un popup con los alumnos activos (solo nombre y casilla), marca quiénes
   estuvieron y guarda. Queda en asistenciaVivo/{tipo}/{ownerUid}/{sesionId}/{alumnoId} = { fecha, at }
   (tipo: "mentorias" o "sesionesBegin"). Cada asistencia suma puntos al ranking
   (acción "asistenciaVivo", editable en Configuración); el cálculo lo hace la función del ranking.
   ============================================================ */
import { db } from './firebase-config.js';
import { escaparHtml } from './util-html.js';
import { ref, get, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

export function textoAsistentes(n) {
  return n > 0 ? `✓ ${n} ${n === 1 ? 'asistente' : 'asistentes'}` : 'Sin registrar';
}

export function botonAsistenciaHtml(cantidad) {
  return `<button type="button" class="btn btn--ghost btn-asistencia-vivo" style="font-size:11px; padding:4px 8px;">Registrar asistencia</button>
    <div class="text-soft asistencia-vivo-contador" style="font-size:11px; margin-top:4px;">${textoAsistentes(cantidad)}</div>`;
}

function cerrar() { document.getElementById('asistencia-vivo-modal')?.remove(); }

export async function abrirAsistenciaVivo({ tipo, ownerUid, sesionId, fecha, alGuardar }) {
  cerrar();
  const modal = document.createElement('div');
  modal.id = 'asistencia-vivo-modal';
  modal.className = 'asis-modal';
  modal.innerHTML = `<div class="asis-caja"><p class="text-soft" style="margin:0;">Cargando alumnos…</p></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (ev) => { if (ev.target === modal) cerrar(); });

  const ruta = `asistenciaVivo/${tipo}/${ownerUid}/${sesionId}`;
  let alumnos, ciclos, previa;
  try {
    const [alumnosSnap, ciclosSnap, previaSnap] = await Promise.all([get(ref(db, 'alumnos')), get(ref(db, 'ciclos')), get(ref(db, ruta))]);
    alumnos = alumnosSnap.exists() ? alumnosSnap.val() : {};
    ciclos = ciclosSnap.exists() ? ciclosSnap.val() : {};
    previa = previaSnap.exists() ? previaSnap.val() : {};
  } catch (err) {
    console.error('No se pudo cargar la asistencia:', err);
    modal.querySelector('.asis-caja').innerHTML = '<p>No se pudieron cargar los alumnos. Intenta de nuevo.</p><button type="button" class="btn btn--ghost" data-asis="cancelar">Cerrar</button>';
    modal.querySelector('[data-asis="cancelar"]').addEventListener('click', cerrar);
    return;
  }

  const activos = Object.entries(alumnos)
    .filter(([, a]) => {
      const ciclo = a && a.cicloActualId ? ciclos[a.cicloActualId] : null;
      return a && !a.esDemo && ciclo && !ciclo.esDemo && ciclo.estadoAlumno === 'activo';
    })
    .map(([id, a]) => ({ id, nombre: `${a.nombre || ''} ${a.apellido || ''}`.trim() || 'Alumno' }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));

  const fechaTxt = fecha ? new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${fecha}T12:00:00`)) : '';
  modal.querySelector('.asis-caja').innerHTML = `
    <h3 style="margin:0 0 2px;">Asistencia</h3>
    <p class="text-soft" style="margin:0 0 10px; font-size:12.5px;">${escaparHtml(fechaTxt)} · marca a quienes estuvieron</p>
    <input type="search" class="asis-buscar" placeholder="Buscar alumno…" autocomplete="off">
    <div class="asis-lista">
      ${activos.length ? activos.map(a => `
        <label class="asis-fila" data-nombre="${escaparHtml(a.nombre.toLowerCase())}">
          <span>${escaparHtml(a.nombre)}</span>
          <input type="checkbox" value="${escaparHtml(a.id)}" ${previa[a.id] ? 'checked' : ''}>
        </label>`).join('') : '<p class="text-soft">No hay alumnos activos.</p>'}
    </div>
    <p class="asis-error hidden" style="color:#C0392B; font-size:12.5px; margin:8px 0 0;"></p>
    <div class="asis-pie">
      <button type="button" class="btn btn--ghost" data-asis="cancelar">Cancelar</button>
      <button type="button" class="btn btn--primary" data-asis="guardar">Guardar</button>
    </div>`;

  const buscar = modal.querySelector('.asis-buscar');
  buscar.addEventListener('input', () => {
    const q = buscar.value.trim().toLowerCase();
    modal.querySelectorAll('.asis-fila').forEach(f => f.classList.toggle('hidden', !!q && !f.dataset.nombre.includes(q)));
  });
  modal.querySelector('[data-asis="cancelar"]').addEventListener('click', cerrar);
  modal.querySelector('[data-asis="guardar"]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true; btn.textContent = 'Guardando…';
    const dia = fecha || new Date().toISOString().slice(0, 10);
    const cambios = {};
    let total = 0;
    modal.querySelectorAll('.asis-lista input[type="checkbox"]').forEach(cb => {
      const id = cb.value;
      if (cb.checked) { total++; cambios[id] = previa[id] || { fecha: dia, at: Date.now() }; }
      else if (previa[id]) cambios[id] = null; // se desmarcó: se quita
    });
    try {
      if (Object.keys(cambios).length) await update(ref(db, ruta), cambios);
      if (alGuardar) alGuardar(total);
      cerrar();
    } catch (err) {
      console.error('No se pudo guardar la asistencia:', err);
      const e = modal.querySelector('.asis-error');
      e.textContent = 'No se pudo guardar. Intenta de nuevo.'; e.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  });
}
