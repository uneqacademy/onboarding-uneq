/* ============================================================
   nps-mentoria-form.js
   Lógica de nps-mentoria.html — página pública sin login, para
   evaluar UNA mentoría en vivo puntual. Link personalizado
   (?mentor={uid}&mentoria={id}&tema=...), una sola pregunta
   (0-10) + comentario opcional, guardado anónimo en
   /npsMentorias/{mentorId}/{mentoriaId}/{entryId}.

   Lee sin login usuarios/{mentorId}/nombre, /fotoUrl y /temasBox
   (reglas con .read público solo en esos 3 campos) para armar la
   tarjeta del mentor y las preguntas personalizadas:
   - Nombre: primer nombre del mentor.
   - Temáticas: las 3 primeras de temasBox (mismas que Preguntas en
     Vivo). Si no tiene, se usa el tema del link.
   Si la lectura falla, se usa "el mentor" + tema del link.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, push, set, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

const params = new URLSearchParams(window.location.search);
const mentorId = params.get('mentor');
const mentoriaId = params.get('mentoria');
const tema = params.get('tema') || 'esta sesión';

const root = document.getElementById('nps-mentoria-root');
const temaEl = document.getElementById('nps-mentoria-tema');
if (temaEl) temaEl.textContent = tema;

function unirTemas(lista) {
  if (lista.length <= 1) return lista.join('');
  return `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`;
}

function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function cargarMentor() {
  const datos = { nombre: null, fotoUrl: null, temas: tema };
  if (!mentorId) return datos;

  const [nombreRes, fotoRes, temasRes] = await Promise.allSettled([
    get(ref(db, `usuarios/${mentorId}/nombre`)),
    get(ref(db, `usuarios/${mentorId}/fotoUrl`)),
    get(ref(db, `usuarios/${mentorId}/temasBox`))
  ]);
  const nombre = nombreRes.status === 'fulfilled' ? nombreRes.value.val() : null;
  const fotoUrl = fotoRes.status === 'fulfilled' ? fotoRes.value.val() : null;
  const temasBox = temasRes.status === 'fulfilled' ? temasRes.value.val() : null;

  if (nombre) datos.nombre = String(nombre).trim().split(/\s+/)[0];
  if (fotoUrl) datos.fotoUrl = fotoUrl;
  const listaTemas = (Array.isArray(temasBox) ? temasBox : (temasBox ? Object.values(temasBox) : []))
    .map(t => String(t || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  if (listaTemas.length) datos.temas = unirTemas(listaTemas);

  // Tarjeta del mentor
  document.getElementById('nps-mentoria-mentor-nombre').textContent = datos.nombre || 'Mentoría';
  if (temaEl) temaEl.textContent = datos.temas;
  if (datos.fotoUrl) {
    const img = document.getElementById('nps-mentoria-mentor-foto');
    img.src = datos.fotoUrl;
    img.alt = datos.nombre || '';
    img.classList.remove('nm-mentor__foto--logo');
  }
  return datos;
}

if (!mentorId || !mentoriaId) {
  root.innerHTML = `
    <section class="nm-tarjeta nm-mensaje">
      <h3>Link no válido</h3>
      <p>Falta identificar la mentoría. Pide al mentor que te reenvíe el link correcto.</p>
    </section>`;
} else {
  let puntaje = 5;
  let mentor = { nombre: null, fotoUrl: null, temas: tema };

  function posicionarBurbuja() {
    const input = document.getElementById('input-puntaje-mentoria');
    const burbuja = document.getElementById('valor-puntaje-mentoria');
    const anchoThumb = 26;
    const pct = puntaje / 10;
    burbuja.style.left = `calc(${pct} * (100% - ${anchoThumb}px) + ${anchoThumb / 2}px)`;
    burbuja.textContent = puntaje;
    input.setAttribute('aria-valuetext', `${puntaje} de 10`);
  }

  function render() {
    const nombreMentor = escaparHtml(mentor.nombre || 'el mentor');
    const temasMentor = escaparHtml(mentor.temas);
    root.innerHTML = `
      <section class="nm-tarjeta nm-pregunta">
        <p class="nm-pregunta__texto">En una escala del 0 al 10, ¿qué tan probable es que recomiendes la mentoría en vivo de <span class="nm-destacado">${nombreMentor}</span> sobre <span class="nm-destacado">${temasMentor}</span> a un colega emprendedor?</p>
        <div class="nm-slider">
          <div class="nm-slider__burbuja" id="valor-puntaje-mentoria">${puntaje}</div>
          <input type="range" min="0" max="10" step="1" value="${puntaje}" id="input-puntaje-mentoria" aria-label="Puntaje de 0 a 10">
          <div class="nm-slider__etiquetas">
            <span>0.<br>Nada probable</span>
            <span>10.<br>Muy probable</span>
          </div>
        </div>
        <div class="nm-campo">
          <label for="nps-mentoria-comentario">¿Cuál es la razón principal de tu calificación para ${nombreMentor} en esta sesión? <span class="nm-opcional">(opcional)</span></label>
          <textarea id="nps-mentoria-comentario" placeholder="Respuesta libre, completamente anónima"></textarea>
        </div>
        <button class="nm-boton" id="btn-nps-mentoria-enviar">Enviar Evaluación</button>
      </section>`;

    document.getElementById('input-puntaje-mentoria').addEventListener('input', (ev) => {
      puntaje = parseInt(ev.target.value, 10);
      posicionarBurbuja();
    });
    document.getElementById('btn-nps-mentoria-enviar').addEventListener('click', enviar);
    posicionarBurbuja();
  }

  async function enviar() {
    const btn = document.getElementById('btn-nps-mentoria-enviar');
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      const comentario = document.getElementById('nps-mentoria-comentario').value.trim();
      const entradaRef = push(ref(db, `npsMentorias/${mentorId}/${mentoriaId}`));
      await set(entradaRef, { puntaje, comentario: comentario || null, createdAt: Date.now() });

      root.innerHTML = `
        <section class="nm-tarjeta nm-mensaje">
          <h3>¡Gracias por tu evaluación! 🙌</h3>
          <p>Tu respuesta quedó guardada de forma anónima.</p>
        </section>`;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Enviar Evaluación';
      alert('No se pudo enviar. Revisa tu conexión e intenta de nuevo.');
    }
  }

  root.innerHTML = `<section class="nm-tarjeta nm-mensaje"><p>Cargando...</p></section>`;
  cargarMentor().then(datos => { mentor = datos; render(); });
}
