/* ============================================================
   laboratorio-uneq.js — "Laboratorio UNEQ"
   ============================================================
   Es el MISMO Laboratorio de los alumnos (laboratorio-ia.js en modo UNEQ), pero para el contenido de la marca UNEQ
   (@somosuneq): mismas fichas, mismas instrucciones por fase, misma estética y misma publicación en Instagram. Cambia solo:
   todas las fases están siempre abiertas, los formatos y las cantidades se eligen libremente, las fichas las completa solo la
   Directora Académica y todo el equipo trabaja sobre la misma cuenta de Instagram.

   Este archivo se ocupa de: quién ve el menú (Director/a, Sub-directora y quien ella asigne en laboratorioUneq/acceso/{uid})
   y del panel «Equipo con acceso» (solo Directora y Sub-directora). */

import { db, auth } from './firebase-config.js';
import { ref, get, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { escaparHtml } from './util-html.js';
import { cargarLaboratorioUneq as abrirLaboratorioUneq } from './laboratorio-ia.js';

const esc = escaparHtml;

let acceso = false;          // ¿puede usar el Laboratorio UNEQ?
let puedeAsignar = false;    // ¿puede decidir quién tiene acceso? (Directora Académica y Sub-directora)

/* ---------------- Quién ve la sección (menú) ---------------- */

window.addEventListener('uneq:rol-aplicado', async (e) => {
  const role = e.detail && e.detail.role;
  const nav = document.querySelector('.nav-item[data-nav="laboratorio-uneq"]');
  acceso = false; puedeAsignar = false;
  if (role === 'director') { acceso = true; puedeAsignar = true; }
  else if ((role === 'coach' || role === 'mentor') && auth.currentUser) {
    try { acceso = (await get(ref(db, `laboratorioUneq/acceso/${auth.currentUser.uid}`))).val() === true; } catch (err) { acceso = false; }
  }
  if (nav) nav.classList.toggle('hidden', !acceso);
});

/* ---------------- Equipo con acceso (solo Directora Académica y Sub-directora) ---------------- */

const ETIQUETA_ROL = { coach: 'Copiloto', mentor: 'Mentor/a' };

async function pintarEquipo() {
  const cont = document.getElementById('luneq-contenido');
  if (!cont) return;
  if (!puedeAsignar) { cont.classList.add('hidden'); cont.innerHTML = ''; return; }
  cont.classList.remove('hidden');
  cont.innerHTML = `
    <details class="lab-bloque luneq-det">
      <summary><strong>Equipo con acceso</strong> <span class="text-soft">Quién puede usar el Laboratorio UNEQ</span></summary>
      <div id="luneq-equipo"><p class="text-soft">Cargando…</p></div>
    </details>`;
  const caja = document.getElementById('luneq-equipo');
  let usuarios = {}, asignados = {};
  try {
    const [u, a] = await Promise.all([get(ref(db, 'usuarios')), get(ref(db, 'laboratorioUneq/acceso'))]);
    usuarios = u.val() || {}; asignados = a.val() || {};
  } catch (err) {
    console.error('Laboratorio UNEQ: no se pudo leer el equipo:', err);
    caja.innerHTML = '<p class="text-soft">No se pudo cargar el equipo.</p>';
    return;
  }
  // Solo personas que usan la app como Copiloto o Mentor/a (son quienes pueden entrar a esta sección).
  const gente = Object.entries(usuarios)
    .filter(([, u]) => u && u.activo !== false && ['coach', 'mentor'].some(r => (u.roles && u.roles[r] === true) || u.rol === r))
    .sort((a, b) => String(a[1].nombre || a[1].email || '').localeCompare(String(b[1].nombre || b[1].email || ''), 'es'));
  caja.innerHTML = `
    <p class="text-soft lab-bloque__sub">La Directora Académica y la Sub-directora siempre tienen acceso. Marca a las personas que también podrán crear y publicar el contenido de UNEQ.</p>
    ${gente.length ? `<ul class="luneq-equipo">${gente.map(([uid, u]) => `
      <li><label><input type="checkbox" data-acceso="${esc(uid)}"${asignados[uid] === true ? ' checked' : ''}>
        <span><strong>${esc(u.nombre || u.email || uid)}</strong> <span class="text-soft">${esc(u.email || '')}</span>
        ${Object.keys(ETIQUETA_ROL).filter(r => (u.roles && u.roles[r] === true) || u.rol === r).map(r => `<span class="badge">${esc(ETIQUETA_ROL[r])}</span>`).join(' ')}</span></label></li>`).join('')}</ul>`
      : '<p class="text-soft">No hay Copilotos ni Mentores activos para asignar.</p>'}
    <p class="text-soft luneq-ayuda" id="luneq-equipo-estado"></p>`;
  caja.querySelectorAll('[data-acceso]').forEach(chk => {
    chk.addEventListener('change', async () => {
      const estado = document.getElementById('luneq-equipo-estado');
      chk.disabled = true;
      try {
        await set(ref(db, `laboratorioUneq/acceso/${chk.dataset.acceso}`), chk.checked ? true : null);
        estado.textContent = chk.checked ? 'Acceso dado ✓ (la persona lo verá la próxima vez que entre a la app).' : 'Acceso quitado ✓';
      } catch (err) {
        chk.checked = !chk.checked;
        estado.textContent = 'No se pudo cambiar el acceso. Intenta de nuevo.';
        console.error(err);
      }
      chk.disabled = false;
    });
  });
}

/* ---------------- Entrada ---------------- */

async function entrar() {
  if (!acceso || !auth.currentUser) {
    const el = document.getElementById('lab-contenido');
    if (el) el.innerHTML = '<p class="text-soft">No tienes acceso al Laboratorio UNEQ.</p>';
    return;
  }
  const abierto = abrirLaboratorioUneq();   // el mismo Laboratorio de los alumnos, en modo UNEQ
  pintarEquipo();
  await abierto;
}

document.querySelectorAll('.nav-item[data-nav="laboratorio-uneq"]').forEach(item => {
  item.addEventListener('click', entrar);
});
