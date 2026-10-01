/* ============================================================
   bitacora.js
   Entradas de bitácora (/bitacora/{cicloId}/{entradaId}).
   Habilitada solo si ciclo.estadoProceso === "matricula_finalizada".
   Cualquiera de los dos roles (director o coach) puede agregar
   entradas — es un registro de seguimiento compartido, no editable
   ni borrable una vez guardado (bitácora = historial, no se toca).

   Las notas se escriben en un editor con formato básico (negrita,
   cursiva, subrayado, viñetas) y se guardan como HTML — así se ven
   después exactamente como se dejaron, saltos de párrafo incluidos.
   En el listado, cada entrada se recorta a ~5 líneas con un botón
   "Ver más / Ver menos" si el texto es más largo que eso.
   ============================================================ */

import { db, auth } from './firebase-config.js';
import { ref, get, push, set, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getCurrentUserNombre, getCurrentRole } from './main.js';

let cicloIdActual = null;
let entradaIdEnEdicion = null; // null = modo "agregar nueva"; si no, estamos editando esta entrada

function formatFecha(fechaStr) {
  if (!fechaStr) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(fechaStr + 'T00:00:00'));
}

/* --- Barra de formato del editor de notas ---
   execCommand sigue siendo, hoy por hoy, la forma más simple de dar
   negrita/cursiva/subrayado/viñetas a un <div contenteditable> sin
   agregar una librería de edición de texto enriquecido completa. */
function inicializarToolbarBitacora() {
  const editor = document.getElementById('bitacora-notas');
  if (!editor || editor.dataset.toolbarListo) return;
  editor.dataset.toolbarListo = '1';

  document.querySelectorAll('.bitacora-toolbar-btn').forEach(btn => {
    // mousedown (no click) + preventDefault: si no, el editor pierde el
    // foco y la selección de texto ANTES de alcanzar a aplicar el comando.
    btn.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      editor.focus();
      document.execCommand(btn.dataset.cmd, false, null);
    });
  });

  editor.addEventListener('keyup', actualizarEstadoToolbar);
  editor.addEventListener('mouseup', actualizarEstadoToolbar);
}

function actualizarEstadoToolbar() {
  document.querySelectorAll('.bitacora-toolbar-btn').forEach(btn => {
    try {
      btn.classList.toggle('is-activo', document.queryCommandState(btn.dataset.cmd));
    } catch (err) { /* ignorar si el comando no aplica en este punto */ }
  });
}

/* --- Llamada desde alumnos.js cada vez que se abre una ficha --- */
export async function cargarBitacoraParaCiclo(cicloId, habilitada) {
  cicloIdActual = cicloId;
  const banner = document.getElementById('bitacora-bloqueada');
  const contenido = document.getElementById('bitacora-contenido');
  if (!banner || !contenido) return;

  if (!habilitada || !cicloId) {
    banner.classList.remove('hidden');
    contenido.classList.add('hidden');
    return;
  }

  banner.classList.add('hidden');
  contenido.classList.remove('hidden');
  inicializarToolbarBitacora();
  cancelarEdicionBitacora(); // siempre arranca en modo "agregar nueva"

  const snap = await get(ref(db, `bitacora/${cicloId}`));
  const listadoEl = document.getElementById('bitacora-listado');
  const contadorEl = document.getElementById('bitacora-contador');
  listadoEl.innerHTML = '';

  if (!snap.exists()) {
    listadoEl.innerHTML = '<p class="text-soft">Aún no hay entradas registradas.</p>';
    if (contadorEl) contadorEl.textContent = '(0 entradas)';
    return;
  }

  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const esDirector = getCurrentRole() === 'director';

  const entradas = Object.entries(snap.val())
    .map(([entradaId, entrada]) => ({ entradaId, ...entrada }))
    .sort((a, b) => b.createdAt - a.createdAt);
  if (contadorEl) contadorEl.textContent = `(${entradas.length} ${entradas.length === 1 ? 'entrada' : 'entradas'})`;

  entradas.forEach(entrada => {
      const puedeEditar = esDirector || entrada.autorUid === uid;
      const div = document.createElement('div');
      div.style.cssText = 'padding:12px 0; border-bottom:0.5px solid var(--border);';
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <strong>${entrada.titulo || '(sin título)'}</strong>
          <span class="text-soft" style="font-size:12px;">${entrada.autorNombre || ''}</span>
        </div>
        <div class="text-soft" style="font-size:12px; margin-bottom:6px;">${formatFecha(entrada.fecha)} · ${entrada.canal || ''}${entrada.editadoEn ? ' · <em>editada</em>' : ''}</div>
        <div class="bitacora-nota-preview">${pareceTextoPlano(entrada.notas) ? textoPlanoAHtml(entrada.notas) : (entrada.notas || '')}</div>
        <button type="button" class="bitacora-btn-vermas hidden">Ver más</button>
        ${puedeEditar ? `<button type="button" class="bitacora-btn-editar" data-id="${entrada.entradaId}" style="display:block; margin-top:6px; background:none; border:0; padding:0; font-size:12px; color:var(--color-ink-soft); cursor:pointer; text-decoration:underline;">✏️ Editar</button>` : ''}`;
      listadoEl.appendChild(div);

      if (puedeEditar) {
        div.querySelector('.bitacora-btn-editar').addEventListener('click', () => entrarEnModoEdicion(entrada));
      }

      // Si el texto es más largo que el recorte (~5 líneas), muestra el
      // botón; si no, ni aparece — nada que expandir.
      const preview = div.querySelector('.bitacora-nota-preview');
      const btnVerMas = div.querySelector('.bitacora-btn-vermas');
      requestAnimationFrame(() => {
        if (preview.scrollHeight > preview.clientHeight + 2) {
          btnVerMas.classList.remove('hidden');
          btnVerMas.addEventListener('click', () => {
            const expandido = preview.classList.toggle('expandido');
            btnVerMas.textContent = expandido ? 'Ver menos' : 'Ver más';
          });
        }
      });
    });
}

// Las entradas de antes de este cambio guardaron "notas" como texto
// plano (con \n de verdad, pero sin ninguna etiqueta). Un salto de
// línea de texto no es un salto de línea en HTML, así que al abrirla
// para editar se vería toda corrida. Si detectamos que es texto plano
// (no trae ninguna etiqueta), la convertimos a párrafos/<br> reales
// ANTES de meterla al editor — así se ve igual que como se escribió
// originalmente, y al guardar queda ya convertida a formato real.
function pareceTextoPlano(notas) {
  return !/<[a-z][\s\S]*>/i.test(notas || '');
}
function textoPlanoAHtml(texto) {
  const escapado = (texto || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escapado
    .split(/\n{2,}/)
    .map(parrafo => `<p>${parrafo.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/* --- Editar una entrada propia (o cualquiera, si eres Director) ---
   Lleva lo ya guardado de vuelta al formulario de arriba, sin tocar
   autorUid/autorNombre/createdAt originales — solo se marca
   editadoEn, para que quede a la vista que esa entrada se modificó. */
function entrarEnModoEdicion(entrada) {
  entradaIdEnEdicion = entrada.entradaId;
  document.getElementById('bitacora-titulo').value = entrada.titulo || '';
  document.getElementById('bitacora-fecha').value = entrada.fecha || '';
  document.getElementById('bitacora-canal').value = entrada.canal || 'WhatsApp';
  document.getElementById('bitacora-notas').innerHTML = pareceTextoPlano(entrada.notas)
    ? textoPlanoAHtml(entrada.notas)
    : (entrada.notas || '');
  document.getElementById('btn-guardar-bitacora').textContent = '💾 Guardar cambios';
  document.getElementById('btn-cancelar-edicion-bitacora').classList.remove('hidden');
  document.getElementById('bitacora-contenido').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelarEdicionBitacora() {
  entradaIdEnEdicion = null;
  document.getElementById('bitacora-fecha').value = new Date().toISOString().slice(0, 10);
  document.getElementById('bitacora-titulo').value = '';
  document.getElementById('bitacora-notas').innerHTML = '';
  document.getElementById('btn-guardar-bitacora').textContent = '+ Agregar Entrada';
  document.getElementById('btn-cancelar-edicion-bitacora').classList.add('hidden');
}

const btnCancelarEdicion = document.getElementById('btn-cancelar-edicion-bitacora');
if (btnCancelarEdicion) btnCancelarEdicion.addEventListener('click', cancelarEdicionBitacora);

const btnGuardarBitacora = document.getElementById('btn-guardar-bitacora');
if (btnGuardarBitacora) {
  btnGuardarBitacora.addEventListener('click', async () => {
    if (!cicloIdActual) return;
    const titulo = document.getElementById('bitacora-titulo').value.trim();
    const fecha = document.getElementById('bitacora-fecha').value;
    const canal = document.getElementById('bitacora-canal').value;
    const editorNotas = document.getElementById('bitacora-notas');
    const notas = editorNotas.innerHTML.trim();
    const notasTextoPlano = editorNotas.textContent.trim();

    if (!titulo || !notasTextoPlano) {
      alert('Completa el título y las notas antes de guardar.');
      return;
    }

    btnGuardarBitacora.disabled = true;
    try {
      if (entradaIdEnEdicion) {
        await update(ref(db, `bitacora/${cicloIdActual}/${entradaIdEnEdicion}`), {
          titulo, fecha, canal, notas, editadoEn: Date.now()
        });
      } else {
        const entradaRef = push(ref(db, `bitacora/${cicloIdActual}`));
        await set(entradaRef, {
          titulo,
          fecha,
          canal,
          notas,
          autorUid: auth.currentUser ? auth.currentUser.uid : null,
          autorNombre: getCurrentUserNombre(),
          createdAt: Date.now()
        });
      }
      await cargarBitacoraParaCiclo(cicloIdActual, true);
    } finally {
      btnGuardarBitacora.disabled = false;
    }
  });
}

/* --- Descargar Word (.doc) con la bitácora completa —
       formato HTML-a-Word, el truco clásico y liviano que Word
       abre sin problema, sin necesitar ninguna librería externa.
       Pensado para subir manualmente a Drive y reemplazar la
       versión anterior cada vez. --- */
const btnDescargarWord = document.getElementById('btn-descargar-bitacora-word');
if (btnDescargarWord) {
  btnDescargarWord.addEventListener('click', async () => {
    if (!cicloIdActual) return;
    btnDescargarWord.disabled = true;
    btnDescargarWord.textContent = 'Generando...';
    try {
      const snap = await get(ref(db, `bitacora/${cicloIdActual}`));
      const entradas = snap.exists()
        ? Object.values(snap.val()).sort((a, b) => a.createdAt - b.createdAt)
        : [];

      const nombreAlumno = document.getElementById('ficha-nombre-alumno').textContent.trim() || 'Alumno';
      const programaTexto = document.getElementById('ficha-programa').textContent.trim() || '';

      // e.notas ya viene como HTML (negrita/cursiva/subrayado/viñetas
      // incluidos) desde el editor — Word lo interpreta directo, sin
      // necesidad de convertir saltos de línea a mano.
      const bloques = entradas.map(e => `
        <p style="font-family:Arial; font-weight:bold; font-size:18px; margin:0 0 2px 0;">${e.titulo || ''}</p>
        <p style="font-family:Arial; font-size:12px; margin:0;">Fecha: ${formatFecha(e.fecha)}</p>
        <p style="font-family:Arial; font-size:12px; margin:0 0 12px 0;">Canal: ${e.canal || ''}</p>
        <div style="font-family:Arial; font-size:12px; margin:0 0 20px 0;">${e.notas || ''}</div>
        <hr style="border:none; border-top:1px solid #999; margin:0 0 20px 0;">`
      ).join('');

      const html = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset="utf-8"><title>Bitácora</title></head>
        <body style="font-family:Arial, sans-serif;">
          <p style="font-family:Arial; font-weight:bold; font-size:20px; margin:0;">BITÁCORA "${nombreAlumno.toUpperCase()}"</p>
          <p style="font-family:Arial; font-size:14px; margin:0 0 28px 0;">ALUMNO "${programaTexto.toUpperCase()}"</p>
          ${bloques || '<p style="font-family:Arial; font-size:12px;">Sin entradas registradas.</p>'}
        </body>
        </html>`;

      const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Bitacora - ${nombreAlumno}.doc`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      btnDescargarWord.disabled = false;
      btnDescargarWord.textContent = 'Descargar Word';
    }
  });
}
