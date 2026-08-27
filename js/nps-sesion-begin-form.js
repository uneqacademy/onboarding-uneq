/* ============================================================
   nps-sesion-begin-form.js
   Lógica de nps-sesion-begin.html — página pública sin login,
   para evaluar UNA sesión grupal BEGIN puntual. Link personalizado
   (?coach={uid}&sesion={id}&tema=...), una sola pregunta (0-10) +
   comentario opcional, guardado anónimo en
   /npsSesionesBegin/{coachId}/{sesionId}/{entryId}.
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, push, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

const params = new URLSearchParams(window.location.search);
const coachId = params.get('coach');
const sesionId = params.get('sesion');
const tema = params.get('tema') || 'esta sesión';

const root = document.getElementById('nps-sesion-begin-root');
const temaEl = document.getElementById('nps-sesion-begin-tema');
if (temaEl) temaEl.textContent = tema;

if (!coachId || !sesionId) {
  root.innerHTML = `
    <div class="panel"><div class="panel__body">
      <p>Este link no es válido — falta identificar la sesión. Pide al coach que te reenvíe el link correcto.</p>
    </div></div>`;
} else {
  let puntaje = 5;

  function render() {
    root.innerHTML = `
      <div class="panel mb-16">
        <div class="panel__body">
          <div class="test-question">
            <div class="test-question__text">En una escala de 0 a 10, ¿qué tan buena te pareció esta sesión grupal?</div>
            <div class="test-slider-row">
              <input type="range" min="0" max="10" step="1" value="${puntaje}" id="input-puntaje-sesion-begin">
              <div class="test-slider-value" id="valor-puntaje-sesion-begin">${puntaje}</div>
            </div>
            <div class="test-slider-labels"><span>0 · Nada buena</span><span>10 · Excelente</span></div>
          </div>
          <div class="field mb-16">
            <label>¿Algo que quieras agregar? (opcional)</label>
            <textarea id="nps-sesion-begin-comentario" placeholder="Comentario libre, completamente anónimo..."></textarea>
          </div>
          <button class="btn btn--primary" id="btn-nps-sesion-begin-enviar" style="width:100%;">Enviar evaluación</button>
        </div>
      </div>`;

    document.getElementById('input-puntaje-sesion-begin').addEventListener('input', (ev) => {
      puntaje = parseInt(ev.target.value, 10);
      document.getElementById('valor-puntaje-sesion-begin').textContent = puntaje;
    });
    document.getElementById('btn-nps-sesion-begin-enviar').addEventListener('click', enviar);
  }

  async function enviar() {
    const btn = document.getElementById('btn-nps-sesion-begin-enviar');
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      const comentario = document.getElementById('nps-sesion-begin-comentario').value.trim();
      const entradaRef = push(ref(db, `npsSesionesBegin/${coachId}/${sesionId}`));
      await set(entradaRef, { puntaje, comentario: comentario || null, createdAt: Date.now() });

      root.innerHTML = `
        <div class="panel"><div class="panel__body" style="text-align:center; padding:32px 20px;">
          <h3 style="margin-bottom:8px;">¡Gracias por tu evaluación! 🙌</h3>
          <p class="text-soft">Tu respuesta quedó guardada de forma anónima.</p>
        </div></div>`;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Enviar evaluación';
      alert('No se pudo enviar. Revisa tu conexión e intenta de nuevo.');
    }
  }

  render();
}
