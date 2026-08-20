/* ============================================================
   coaches.js
   Vista "Coaches" (solo Director): lista real desde /usuarios,
   y eliminar un coach — bloqueado si tiene alumnos vigentes
   (activos, en proceso de matrícula, o pausados), para forzar
   la reasignación antes de borrarlo. La reasignación en sí ya
   existe en la ficha del alumno (pestaña Ciclo → Coach Asignado)
   y no pierde nada: bitácora, tests y datos quedan atados al
   ciclo, no al coach, así que el historial se mantiene intacto
   con el nuevo coach.

   Nota: esto borra el registro en /usuarios (le quita el acceso
   a la app), pero no borra la cuenta de Firebase Authentication
   en sí — eso hay que hacerlo manualmente en la consola si se
   quiere eliminar del todo.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole } from './main.js';

const ESTADOS_VIGENTES = ['activo', 'en_proceso_matricula', 'pausado'];

async function cargarCoachesView() {
  if (getCurrentRole() !== 'director') return;
  const tbody = document.getElementById('tabla-coaches-body');
  if (!tbody) return;

  const [usuariosSnap, alumnosSnap, ciclosSnap] = await Promise.all([
    get(ref(db, 'usuarios')),
    get(ref(db, 'alumnos')),
    get(ref(db, 'ciclos'))
  ]);
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
  const alumnos = alumnosSnap.exists() ? alumnosSnap.val() : {};
  const ciclos = ciclosSnap.exists() ? ciclosSnap.val() : {};

  tbody.innerHTML = '';

  Object.entries(usuarios)
    .filter(([, u]) => u.rol === 'coach')
    .forEach(([uid, coach]) => {
      const alumnosDeCoach = Object.entries(alumnos).filter(([, al]) => {
        const ciclo = al.cicloActualId ? ciclos[al.cicloActualId] : null;
        return ciclo && ciclo.coachId === uid;
      });
      const vigentes = alumnosDeCoach.filter(([, al]) => {
        const ciclo = ciclos[al.cicloActualId];
        return ciclo && ESTADOS_VIGENTES.includes(ciclo.estadoAlumno);
      });

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${coach.nombre || ''}</td>
        <td>${coach.email || ''}</td>
        <td>${alumnosDeCoach.length}</td>
        <td><span class="badge ${coach.activo === false ? 'badge--impaga' : 'badge--activo'}">${coach.activo === false ? 'Inactivo' : 'Activo'}</span></td>
        <td><button class="btn btn--ghost btn-eliminar-coach">Eliminar</button></td>`;
      tbody.appendChild(tr);

      tr.querySelector('.btn-eliminar-coach').addEventListener('click', () =>
        eliminarCoach(uid, coach.nombre || coach.email, vigentes)
      );
    });
}

async function eliminarCoach(uid, nombreCoach, vigentes) {
  if (vigentes.length > 0) {
    const nombresAlumnos = vigentes.map(([, al]) => `${al.nombre} ${al.apellido}`).join(', ');
    alert(
      `No puedes eliminar a ${nombreCoach} todavía — tiene ${vigentes.length} alumno(s) vigente(s): ${nombresAlumnos}.\n\n` +
      `Ve a la ficha de cada uno (pestaña "Ciclo Actual" → Coach Asignado) y reasígnalo a otro coach antes de eliminar. ` +
      `El historial completo (datos, tests, bitácora) se mantiene intacto y el nuevo coach lo ve todo.`
    );
    return;
  }

  const confirmado = confirm(
    `¿Eliminar a ${nombreCoach}? Ya no va a poder entrar a la app. Los alumnos que tuvo (con ciclo ya finalizado) mantienen su historial intacto, ` +
    `solo que el nombre del coach en esos registros antiguos quedará sin cuenta activa.`
  );
  if (!confirmado) return;

  await set(ref(db, `usuarios/${uid}`), null);
  await cargarCoachesView();
}

document.querySelectorAll('.nav-item[data-nav="coaches"]').forEach(item => {
  item.addEventListener('click', cargarCoachesView);
});

export { cargarCoachesView };
