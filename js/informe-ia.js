/* ============================================================
   informe-ia.js
   Rendimiento IA (Director): por cada mentor, cuántas respuestas
   de su Mentor IA fueron confirmadas (3 pts), intervenidas
   (1 pt) o quedaron sin revisar (no suman). Ordenable por
   columna, por defecto Puntaje Total de mayor a menor.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentRole } from './main.js';

let filasRendimiento = [];
let ordenActual = { campo: 'puntaje', asc: false };

function renderTablaRendimiento() {
  const tbody = document.getElementById('tabla-rendimiento-ia-body');
  if (!tbody) return;

  const filas = [...filasRendimiento].sort((a, b) => {
    const dir = ordenActual.asc ? 1 : -1;
    if (typeof a[ordenActual.campo] === 'string') return a[ordenActual.campo].localeCompare(b[ordenActual.campo]) * dir;
    return (a[ordenActual.campo] - b[ordenActual.campo]) * dir;
  });

  tbody.innerHTML = filas.length
    ? filas.map(f => `
        <tr>
          <td>${f.nombre}</td>
          <td><strong>${f.puntaje}</strong></td>
          <td>${f.confirmadas}</td>
          <td>${f.intervenidas}</td>
          <td>${f.sinRevisar}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="text-soft">Aún no hay actividad del Mentor IA.</td></tr>';

  document.querySelectorAll('.th-orden-ia').forEach(th => {
    const flecha = th.dataset.campo === ordenActual.campo ? (ordenActual.asc ? ' ▲' : ' ▼') : '';
    th.textContent = th.textContent.replace(/ ▲| ▼/g, '') + flecha;
  });
}

export async function cargarRendimientoIA() {
  if (getCurrentRole() !== 'director') return;
  const tbody = document.getElementById('tabla-rendimiento-ia-body');
  if (!tbody) return;

  const usuariosSnap = await get(ref(db, 'usuarios'));
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
  const mentores = Object.entries(usuarios).filter(([, u]) => {
    const roles = (u.roles && typeof u.roles === 'object') ? u.roles : (u.rol ? { [u.rol]: true } : {});
    return !!roles.mentor;
  });

  const boxSnaps = await Promise.all(mentores.map(([uid]) => get(ref(db, `box/${uid}`))));

  filasRendimiento = mentores.map(([uid, m], idx) => {
    const snap = boxSnaps[idx];
    const preguntas = snap.exists() ? Object.values(snap.val()) : [];
    let confirmadas = 0, intervenidas = 0, sinRevisar = 0;

    preguntas.forEach(p => {
      if (!p.respuesta) { sinRevisar++; return; }
      const estado = p.respuesta.estadoRevision || 'sin_revisar';
      if (estado === 'confirmada') confirmadas++;
      else if (estado === 'intervenida') intervenidas++;
      else sinRevisar++;
    });

    return {
      nombre: m.nombre || m.email,
      confirmadas,
      intervenidas,
      sinRevisar,
      puntaje: confirmadas * 3 + intervenidas * 1
    };
  });

  renderTablaRendimiento();
}

document.querySelectorAll('.th-orden-ia').forEach(th => {
  th.addEventListener('click', () => {
    const campo = th.dataset.campo;
    if (ordenActual.campo === campo) {
      ordenActual.asc = !ordenActual.asc;
    } else {
      ordenActual = { campo, asc: false };
    }
    renderTablaRendimiento();
  });
});

document.querySelectorAll('.nav-item[data-nav="rendimiento-ia"]').forEach(item => {
  item.addEventListener('click', cargarRendimientoIA);
});
