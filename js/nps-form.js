/* ============================================================
   nps-form.js
   Lógica de nps.html — página PÚBLICA, sin login. Un alumno
   entra con un link personalizado (?coach={uid}&nombre=Camila&
   momento=medio|final), califica 6 áreas del coach (0-10) más
   un comentario libre opcional, y lo guarda de forma anónima
   en /nps/{coachId}/{entryId}. Escritura permitida sin auth
   por las reglas de seguridad (solo crear, nunca leer ni editar).
   ============================================================ */

import { db } from './firebase-config.js';
import { ref, push, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

const AREAS = [
  { key: 'dominio', pregunta: '¿Qué tan bien dominaba tu coach la metodología 2E y te ayudó a resolver tus dudas (técnicas, de plataforma o del funcionamiento del programa)?' },
  { key: 'acceso', pregunta: '¿Qué tan bien resolvió tu coach los problemas de acceso y fue liberando las lecciones a tiempo?' },
  { key: 'seguimiento', pregunta: '¿Qué tan constante fue tu coach en hacer seguimiento a tu avance?' },
  { key: 'cercania', pregunta: '¿Qué tan cercano/a, cálido/a y empático/a sentiste a tu coach durante el proceso?' },
  { key: 'motivacion', pregunta: '¿Qué tanto sentiste que tu coach te motivó y te dio herramientas para no detenerte?' },
  { key: 'mentorias', pregunta: '¿Qué tan bien te orientó tu coach sobre qué mentorías en vivo te convenía tomar según tu momento?' }
];

const params = new URLSearchParams(window.location.search);
const coachId = params.get('coach');
const nombreCoach = params.get('nombre') || 'tu coach';
const momento = params.get('momento') === 'final' ? 'final' : 'medio';

const root = document.getElementById('nps-root');
const nombreEl = document.getElementById('nps-coach-nombre');
if (nombreEl) nombreEl.textContent = nombreCoach;

if (!coachId) {
  root.innerHTML = `
    <div class="panel">
      <div class="panel__body">
        <p>Este link no es válido — falta identificar al coach. Pide a tu coach o al director/a que te reenvíe el link correcto.</p>
      </div>
    </div>`;
} else {
  const respuestas = {};
  AREAS.forEach(a => { respuestas[a.key] = 5; });

  function render() {
    const preguntasHtml = AREAS.map(a => `
      <div class="test-question">
        <div class="test-question__text">${a.pregunta}</div>
        <div class="test-slider-row">
          <input type="range" min="0" max="10" step="1" value="${respuestas[a.key]}" data-key="${a.key}">
          <div class="test-slider-value" data-value-for="${a.key}">${respuestas[a.key]}</div>
        </div>
        <div class="test-slider-labels"><span>0 · Nada de acuerdo</span><span>10 · Totalmente de acuerdo</span></div>
      </div>`).join('');

    root.innerHTML = `
      <div class="panel mb-16">
        <div class="panel__body">
          ${preguntasHtml}
          <div class="field mb-16">
            <label>¿Algo que quieras agregar? (opcional)</label>
            <textarea id="nps-comentario" placeholder="Comentario libre, completamente anónimo..."></textarea>
          </div>
          <button class="btn btn--primary" id="btn-nps-enviar" style="width:100%;">Enviar evaluación</button>
        </div>
      </div>`;

    root.querySelectorAll('input[type="range"]').forEach(input => {
      input.addEventListener('input', () => {
        respuestas[input.dataset.key] = parseInt(input.value, 10);
        root.querySelector(`[data-value-for="${input.dataset.key}"]`).textContent = input.value;
      });
    });

    document.getElementById('btn-nps-enviar').addEventListener('click', enviar);
  }

  async function enviar() {
    const btn = document.getElementById('btn-nps-enviar');
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      const comentario = document.getElementById('nps-comentario').value.trim();
      const entradaRef = push(ref(db, `nps/${coachId}`));
      await set(entradaRef, {
        areas: { ...respuestas },
        comentario: comentario || null,
        momento,
        createdAt: Date.now()
      });

      root.innerHTML = `
        <div class="panel">
          <div class="panel__body" style="text-align:center; padding:32px 20px;">
            <h3 style="margin-bottom:8px;">¡Gracias por tu evaluación! 🙌</h3>
            <p class="text-soft">Tu respuesta quedó guardada de forma anónima.</p>
          </div>
        </div>`;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Enviar evaluación';
      alert('No se pudo enviar. Revisa tu conexión e intenta de nuevo.');
    }
  }

  render();
}
