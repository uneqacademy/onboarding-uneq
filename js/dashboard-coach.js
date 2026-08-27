/* ============================================================
   dashboard-coach.js
   Coach de Cabecera (BEGIN): panel para crear y gestionar las
   sesiones grupales semanales exclusivas para alumnos BEGIN.
   Solo visible/activo si usuarios/{uid}.coachCabeceraBegin === true.
   Misma lógica que "Mis Mentorías" (mentores.js), pero en
   /sesionesBegin/{coachId}/{sesionId} y
   /preguntasVivoBegin/{coachId}/{sesionId}/{preguntaId}.
   ============================================================ */

import { db, auth, storage } from './firebase-config.js';
import { ref, get, set, update, push } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getCurrentRole } from './main.js';

function formatFechaCortaBegin(fechaStr) {
  if (!fechaStr) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(fechaStr + 'T00:00:00'));
}

function construirLinkNpsSesionBegin(coachId, sesionId, tema) {
  const url = new URL('nps-sesion-begin.html', window.location.href);
  url.searchParams.set('coach', coachId);
  url.searchParams.set('sesion', sesionId);
  url.searchParams.set('tema', tema);
  return url.href;
}

async function cargarSesionesBeginTabla(uid) {
  const tbody = document.getElementById('tabla-sesiones-begin-body');
  if (!tbody) return;

  const [sesionesSnap, npsSnap] = await Promise.all([
    get(ref(db, `sesionesBegin/${uid}`)),
    get(ref(db, `npsSesionesBegin/${uid}`))
  ]);
  const sesiones = sesionesSnap.exists() ? sesionesSnap.val() : {};
  const npsTodas = npsSnap.exists() ? npsSnap.val() : {};

  tbody.innerHTML = '';
  Object.entries(sesiones)
    .sort((a, b) => (b[1].fecha || '').localeCompare(a[1].fecha || ''))
    .forEach(([sesionId, s]) => {
      const entradas = npsTodas[sesionId] ? Object.values(npsTodas[sesionId]) : [];
      const puntajes = entradas.map(e => e.puntaje).filter(p => typeof p === 'number');
      const promedioTexto = puntajes.length
        ? `${(puntajes.reduce((a, b) => a + b, 0) / puntajes.length).toFixed(1)} ★ (${puntajes.length})`
        : '—';

      const tr = document.createElement('tr');
      const noDictada = s.estado === 'no_dictada';
      tr.innerHTML = `
        <td>${formatFechaCortaBegin(s.fecha)}</td>
        <td>${s.hora || '—'}</td>
        <td>${s.link ? `<a href="${s.link}" target="_blank" rel="noopener">Ir al link</a>` : '—'}</td>
        <td>${promedioTexto}</td>
        <td>
          ${s.resumenUrl ? `<a href="${s.resumenUrl}" target="_blank" rel="noopener">Ver Resumen ↗</a><br>` : ''}
          <button class="btn btn--ghost btn-subir-resumen-begin" style="font-size:11px; padding:4px 8px; margin-top:4px;">${s.resumenUrl ? 'Reemplazar' : 'Subir Resumen'}</button>
          <input type="file" class="input-resumen-sesion-begin hidden" accept=".doc,.docx">
        </td>
        <td><button class="btn btn--ghost btn-ver-preguntas-begin" style="font-size:11px; padding:4px 8px;">Ver Preguntas</button></td>
        <td><button class="btn btn--ghost btn-copiar-link-nps-begin" style="font-size:11px; padding:4px 8px;">Copiar Link NPS</button></td>
        <td>
          <button class="btn btn--ghost btn-toggle-no-dictada-begin" style="font-size:11px; padding:4px 8px; ${noDictada ? 'color:#C0392B;' : ''}" ${noDictada ? 'disabled' : ''}>${noDictada ? '✓ No Dictada' : 'Marcar No Dictada'}</button>
        </td>`;
      tbody.appendChild(tr);

      tr.querySelector('.btn-copiar-link-nps-begin').addEventListener('click', () => {
        const url = construirLinkNpsSesionBegin(uid, sesionId, '');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url)
            .then(() => alert('Link copiado — mándalo a los asistentes al terminar la sesión.'))
            .catch(() => prompt('Copia este link manualmente:', url));
        } else {
          prompt('Copia este link manualmente:', url);
        }
      });

      if (!noDictada) {
        tr.querySelector('.btn-toggle-no-dictada-begin').addEventListener('click', async () => {
          const confirmado = confirm('¿Marcar esta sesión como "No Dictada"? Esta acción no se puede deshacer — si necesitas agendarla de nuevo, tendrás que crear una sesión nueva.');
          if (!confirmado) return;
          await update(ref(db, `sesionesBegin/${uid}/${sesionId}`), { estado: 'no_dictada' });
          await cargarSesionesBeginTabla(uid);
        });
      }

      let filaPreguntas = null;
      tr.querySelector('.btn-ver-preguntas-begin').addEventListener('click', async () => {
        if (filaPreguntas) { filaPreguntas.remove(); filaPreguntas = null; return; }
        const snap = await get(ref(db, `preguntasVivoBegin/${uid}/${sesionId}`));
        const preguntasObj = snap.exists() ? snap.val() : {};
        const preguntas = Object.entries(preguntasObj).sort((a, b) => a[1].createdAt - b[1].createdAt);
        filaPreguntas = document.createElement('tr');
        filaPreguntas.innerHTML = `
          <td colspan="8" style="background:#F7F8FA; padding:14px 16px;">
            ${preguntas.length ? preguntas.map(([preguntaId, p]) => `
              <div class="pregunta-vivo-item" data-pregunta-id="${preguntaId}" style="padding:8px 0; border-bottom:0.5px solid var(--border); font-size:13px;">
                <strong>${p.alumnoNombre || 'Alumno'}</strong>
                <p style="margin:4px 0;">${p.texto || ''}</p>
                ${(p.imagenes || []).map(url => `<img src="${url}" alt="" style="max-width:120px; border-radius:6px; margin:4px 4px 0 0;">`).join('')}
                ${p.revisada
                  ? '<span class="badge badge--activo" style="font-size:10px;">✓ Revisada</span>'
                  : '<button type="button" class="btn btn--ghost btn-marcar-revisada-begin" style="font-size:11px; padding:3px 8px;">Marcar Revisada</button>'}
              </div>`).join('') : '<p class="text-soft" style="font-size:13px;">Aún no hay preguntas para esta sesión.</p>'}
          </td>`;
        tr.insertAdjacentElement('afterend', filaPreguntas);

        filaPreguntas.querySelectorAll('.btn-marcar-revisada-begin').forEach(btn => {
          btn.addEventListener('click', async () => {
            const item = btn.closest('.pregunta-vivo-item');
            const preguntaId = item.dataset.preguntaId;
            btn.disabled = true;
            try {
              await update(ref(db, `preguntasVivoBegin/${uid}/${sesionId}/${preguntaId}`), { revisada: true });
              btn.outerHTML = '<span class="badge badge--activo" style="font-size:10px;">✓ Revisada</span>';
            } catch (err) {
              alert('No se pudo marcar. Intenta de nuevo.');
              btn.disabled = false;
            }
          });
        });
      });

      const btnSubirResumen = tr.querySelector('.btn-subir-resumen-begin');
      const inputResumen = tr.querySelector('.input-resumen-sesion-begin');
      btnSubirResumen.addEventListener('click', () => inputResumen.click());
      inputResumen.addEventListener('change', async () => {
        const file = inputResumen.files[0];
        if (!file) return;
        const textoOriginal = btnSubirResumen.textContent;
        btnSubirResumen.disabled = true;
        btnSubirResumen.textContent = 'Subiendo...';
        try {
          const archivoRef = storageRef(storage, `resumenes-sesiones-begin/${uid}/${sesionId}`);
          await uploadBytes(archivoRef, file);
          const url = await getDownloadURL(archivoRef);
          await update(ref(db, `sesionesBegin/${uid}/${sesionId}`), { resumenUrl: url });
          await cargarSesionesBeginTabla(uid);
        } catch (err) {
          alert('No se pudo subir el resumen. Intenta de nuevo.');
          btnSubirResumen.disabled = false;
          btnSubirResumen.textContent = textoOriginal;
        }
      });
    });
}

export async function cargarSesionesBeginCoach() {
  if (getCurrentRole() !== 'coach') return;
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const panel = document.getElementById('panel-sesiones-begin');
  if (!uid || !panel) return;

  const perfilSnap = await get(ref(db, `usuarios/${uid}`));
  const esCabecera = perfilSnap.exists() && perfilSnap.val().coachCabeceraBegin === true;

  panel.classList.toggle('hidden', !esCabecera);
  if (!esCabecera) return;

  await cargarSesionesBeginTabla(uid);
}

const btnAgregarSesionBegin = document.getElementById('btn-agregar-sesion-begin');
if (btnAgregarSesionBegin) {
  btnAgregarSesionBegin.addEventListener('click', async () => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const fecha = document.getElementById('sesion-begin-fecha').value;
    const hora = document.getElementById('sesion-begin-hora').value;
    const link = document.getElementById('sesion-begin-link').value.trim();

    if (!uid || !fecha) {
      alert('Completa al menos la Fecha.');
      return;
    }

    btnAgregarSesionBegin.disabled = true;
    try {
      const nuevaRef = push(ref(db, `sesionesBegin/${uid}`));
      await set(nuevaRef, { fecha, hora, link, createdAt: Date.now() });

      document.getElementById('sesion-begin-fecha').value = '';
      document.getElementById('sesion-begin-hora').value = '';
      document.getElementById('sesion-begin-link').value = '';

      await cargarSesionesBeginTabla(uid);
    } catch (err) {
      console.error('Error al agregar sesión BEGIN:', err);
      alert('No se pudo agregar la sesión. Revisa tu conexión e intenta de nuevo. Si el problema sigue, avisa al director.');
    } finally {
      btnAgregarSesionBegin.disabled = false;
    }
  });
}

document.querySelectorAll('.nav-item[data-nav="dashboard"]').forEach(item => {
  item.addEventListener('click', cargarSesionesBeginCoach);
});
