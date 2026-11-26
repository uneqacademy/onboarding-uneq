/* ============================================================
   instagram-carrusel.js — "Diseñar y publicar": convierte un carrusel del Laboratorio en láminas y lo publica en Instagram
   ============================================================
   Flujo: la persona abre una propuesta de carrusel → ve las láminas dibujadas con su marca (colores, fuente, @usuario) →
   puede ajustar textos y marca → confirma → las láminas se suben (JPEG) a una carpeta temporal de Storage → el servidor
   las manda a Instagram (acción publicarCarrusel) y borra los archivos. Nada se publica sin el clic de confirmación.
   Fase 3 (prueba): solo equipo UNEQ y Alumno Demo. */

import { auth, db, storage } from './firebase-config.js';
import { ref, get, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { escaparHtml as esc } from './util-html.js';
import { getCurrentRole, esModoDemo } from './main.js';
import { llamarInstagram } from './instagram-api.js';
import { ANCHO, ALTO, PLANTILLAS, FUENTES, MARCA_BASE, normalizarHex, dibujarLamina } from './instagram-lamina.js';

const MAX_LAMINAS = 10;

// El botón "Diseñar y publicar" sale en las propuestas del Alumno Demo. El equipo, al revisar el Laboratorio de un
// alumno real (solo lectura), NO lo ve: no debe publicar contenido de un alumno. Cuando se abra a los alumnos, aquí se
// cambia la condición por (r === 'alumno').
export function puedePublicarInstagram() {
  return getCurrentRole() === 'alumno' && esModoDemo();
}

// Carrusel de ejemplo para probar la publicación sin generar nada con IA (lo usa el equipo y la revisión de Meta).
export const CARRUSEL_EJEMPLO = {
  laminas: [
    'Así se ve un carrusel hecho en Universo UNEQ',
    'Escribes el texto, eliges tu marca y lo publicas en un clic.',
    'Esta es una publicación de ejemplo.'
  ],
  descripcion: 'Publicación de ejemplo de Universo UNEQ. Se puede borrar.'
};

async function leerMarca(uid, usuarioIg) {
  let m = {};
  try { const s = await get(ref(db, `instagramMarca/${uid}`)); m = s.val() || {}; } catch (err) { console.error('Instagram: no se pudo leer la marca:', err); }
  return {
    color1: normalizarHex(m.color1, MARCA_BASE.color1), color2: normalizarHex(m.color2, MARCA_BASE.color2),
    fuente: FUENTES[m.fuente] ? m.fuente : MARCA_BASE.fuente, plantilla: PLANTILLAS.some(p => p.id === m.plantilla) ? m.plantilla : MARCA_BASE.plantilla,
    usuario: String(m.usuario || usuarioIg || '').replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30)
  };
}

async function leerEstadoIg(uid) {
  try { const s = await get(ref(db, `instagramEstado/${uid}`)); const v = s.val(); return v && v.conectado ? v : null; } catch (err) { return null; }
}

function cargarFuente(familia) {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all([`600 40px "${familia}"`, `700 40px "${familia}"`].map(f => document.fonts.load(f, 'Aáéíóúñ0123456789').catch(() => null)));
}

function canvasABlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen.'))), 'image/jpeg', 0.92));
}

/* Abre el editor para una propuesta de carrusel: pieza = { laminas: [texto...], descripcion, titulo }. */
export async function abrirDisenoCarrusel(pieza) {
  const u = auth.currentUser;
  if (!u) return;
  const textos = (pieza.laminas || []).map(t => String(t || '')).slice(0, MAX_LAMINAS);
  if (textos.length < 2) { alert('Un carrusel necesita al menos 2 láminas.'); return; }

  const estadoIg = await leerEstadoIg(u.uid);
  const marca = await leerMarca(u.uid, estadoIg && estadoIg.username);
  let guardarTimer = null, ocupado = false;

  const fondo = document.createElement('div');
  fondo.className = 'ig-modal';
  fondo.innerHTML = `
    <div class="ig-modal__caja" role="dialog" aria-modal="true" aria-label="Diseñar y publicar carrusel">
      <div class="ig-modal__cab"><strong>Diseñar y publicar en Instagram</strong><button type="button" class="ig-modal__x" data-cerrar aria-label="Cerrar">×</button></div>
      <div class="ig-modal__cuerpo">
        <div class="ig-modal__marca">
          <label>Plantilla<select data-plantilla>${PLANTILLAS.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></label>
          <label>Letra<select data-fuente>${Object.entries(FUENTES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
          <label>Color 1<input type="color" data-color1></label>
          <label>Color 2<input type="color" data-color2></label>
          <label class="ig-modal__usuario">Tu @usuario<input type="text" data-usuario maxlength="30" placeholder="tuusuario" autocomplete="off"></label>
        </div>
        <div class="ig-modal__laminas" data-laminas></div>
        <label class="ig-modal__etq">Texto de la publicación (lo que aparece bajo el carrusel)
          <textarea data-caption rows="6" maxlength="2200"></textarea></label>
        <p class="ig-modal__estado" data-estado></p>
        <div class="ig-modal__acciones" data-acciones>
          <button type="button" class="btn btn--ghost" data-descargar>Descargar imágenes</button>
          <button type="button" class="btn btn--primary" data-publicar>Publicar en Instagram</button>
        </div>
        <div class="ig-modal__confirmar hidden" data-confirmar>
          <p data-confirmar-texto></p>
          <div class="ig-modal__acciones"><button type="button" class="btn btn--ghost" data-no>Volver a revisar</button><button type="button" class="btn btn--primary" data-si>Sí, publicar ahora</button></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(fondo);
  document.body.classList.add('ig-modal-abierto');

  const $ = (s) => fondo.querySelector(s);
  const contLaminas = $('[data-laminas]'), estado = $('[data-estado]');
  $('[data-plantilla]').value = marca.plantilla; $('[data-fuente]').value = marca.fuente;
  $('[data-color1]').value = marca.color1; $('[data-color2]').value = marca.color2; $('[data-usuario]').value = marca.usuario;
  $('[data-caption]').value = String(pieza.descripcion || '');

  // Una lámina = una tarjeta con su vista previa (canvas) y su texto editable
  const canvases = [], areas = [];
  textos.forEach((t, n) => {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'ig-lam';
    const c = document.createElement('canvas');
    c.width = ANCHO; c.height = ALTO; c.className = 'ig-lam__canvas';
    const ta = document.createElement('textarea');
    ta.className = 'ig-lam__texto'; ta.rows = 4; ta.maxLength = 500; ta.value = t;
    ta.setAttribute('aria-label', `Texto de la lámina ${n + 1}`);
    tarjeta.append(c, ta);
    contLaminas.appendChild(tarjeta);
    canvases.push(c); areas.push(ta);
  });

  const marcaActual = () => ({
    plantilla: $('[data-plantilla]').value, fuente: $('[data-fuente]').value,
    color1: normalizarHex($('[data-color1]').value, MARCA_BASE.color1), color2: normalizarHex($('[data-color2]').value, MARCA_BASE.color2),
    usuario: $('[data-usuario]').value.replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30)
  });

  async function dibujar() {
    const m = marcaActual();
    await cargarFuente(FUENTES[m.fuente]);
    canvases.forEach((c, n) => dibujarLamina(c.getContext('2d'), { texto: areas[n].value, n, total: canvases.length, marca: m, plantilla: m.plantilla }));
  }
  function programarGuardadoMarca() {
    clearTimeout(guardarTimer);
    guardarTimer = setTimeout(() => { set(ref(db, `instagramMarca/${u.uid}`), marcaActual()).catch(err => console.error('Instagram: no se pudo guardar la marca:', err)); }, 900);
  }
  fondo.querySelectorAll('[data-plantilla],[data-fuente],[data-color1],[data-color2],[data-usuario]').forEach(el => el.addEventListener('input', () => { dibujar(); programarGuardadoMarca(); }));
  areas.forEach(ta => ta.addEventListener('input', dibujar));
  await dibujar();

  const mostrar = (texto, error) => { estado.textContent = texto || ''; estado.className = 'ig-modal__estado' + (error ? ' ig-modal__estado--error' : ''); };
  const cerrar = () => { if (ocupado) return; clearTimeout(guardarTimer); fondo.remove(); document.body.classList.remove('ig-modal-abierto'); };
  $('[data-cerrar]').addEventListener('click', cerrar);
  fondo.addEventListener('mousedown', e => { if (e.target === fondo) cerrar(); });

  // Descargar las imágenes (por si prefiere publicarlas a mano)
  $('[data-descargar]').addEventListener('click', async () => {
    mostrar('Preparando imágenes…');
    try {
      for (let n = 0; n < canvases.length; n++) {
        const blob = await canvasABlob(canvases[n]);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `carrusel-${String(n + 1).padStart(2, '0')}.jpg`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        await new Promise(r => setTimeout(r, 350));
      }
      mostrar('Listo: se descargaron las imágenes.');
    } catch (err) { mostrar((err && err.message) || 'No se pudieron descargar.', true); }
  });

  // Publicar: primero se pide confirmación explícita
  $('[data-publicar]').addEventListener('click', () => {
    if (!estadoIg) { mostrar('Primero conecta tu Instagram en el panel de arriba del Laboratorio.', true); return; }
    if (areas.some(a => !a.value.trim())) { mostrar('Ninguna lámina puede quedar vacía.', true); return; }
    mostrar('');
    $('[data-confirmar-texto]').textContent = `Se publicarán ${canvases.length} láminas en @${estadoIg.username} con el texto que ves. Después podrás borrarlas solo desde Instagram. ¿Publicar ahora?`;
    $('[data-acciones]').classList.add('hidden');
    $('[data-confirmar]').classList.remove('hidden');
  });
  $('[data-no]').addEventListener('click', () => { $('[data-confirmar]').classList.add('hidden'); $('[data-acciones]').classList.remove('hidden'); });

  $('[data-si]').addEventListener('click', async () => {
    if (ocupado) return;
    ocupado = true;
    fondo.querySelectorAll('button, textarea, input, select').forEach(el => { el.disabled = true; });
    const subidos = [];
    try {
      const pubId = String(Date.now());
      const urls = [];
      for (let n = 0; n < canvases.length; n++) {
        mostrar(`Subiendo lámina ${n + 1} de ${canvases.length}…`);
        const r = storageRef(storage, `instagram-temp/${u.uid}/${pubId}/${String(n + 1).padStart(2, '0')}.jpg`);
        await uploadBytes(r, await canvasABlob(canvases[n]), { contentType: 'image/jpeg' });
        subidos.push(r);
        urls.push(await getDownloadURL(r));
      }
      mostrar('Publicando en Instagram… puede tardar un minuto.');
      const res = await llamarInstagram('publicarCarrusel', { urls, caption: $('[data-caption]').value }, 280000);
      ocupado = false;
      $('[data-confirmar]').classList.add('hidden');
      estado.className = 'ig-modal__estado';
      estado.textContent = res.permalink ? '¡Publicado! Míralo aquí: ' : '¡Publicado en tu Instagram!';
      if (res.permalink) {
        const a = document.createElement('a');
        a.href = res.permalink; a.target = '_blank'; a.rel = 'noopener'; a.textContent = res.permalink;
        estado.appendChild(a);
      }
      const cierre = document.createElement('button');
      cierre.type = 'button'; cierre.className = 'btn btn--primary'; cierre.textContent = 'Cerrar';
      cierre.addEventListener('click', cerrar);
      $('[data-acciones]').replaceChildren(cierre);
      $('[data-acciones]').classList.remove('hidden');
      fondo.querySelectorAll('[data-laminas] textarea, [data-caption]').forEach(el => { el.disabled = true; });
      cierre.disabled = false;
      $('[data-cerrar]').disabled = false;
    } catch (err) {
      // Si algo falló, se intentan borrar los archivos temporales y se vuelve a habilitar la pantalla.
      subidos.forEach(r => deleteObject(r).catch(() => {}));
      ocupado = false;
      fondo.querySelectorAll('button, textarea, input, select').forEach(el => { el.disabled = false; });
      $('[data-confirmar]').classList.add('hidden');
      $('[data-acciones]').classList.remove('hidden');
      mostrar((err && err.message) || 'No se pudo publicar. Intenta de nuevo.', true);
    }
  });
}
