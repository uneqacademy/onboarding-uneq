/* ============================================================
   hitos.js — "Mis Hitos" (alumno) / "Hitos Estudiantes" (staff)
   Los alumnos publican hitos predefinidos (uno por proyecto, no se
   puede repetir), con su propio texto y fotos. Sus compañeros (y el
   staff) comentan y reaccionan. Todos (alumnos y staff) ven los
   hitos de los 3 programas, cada uno con la etiqueta (logo) de su
   programa. Moderación: cualquier alumno puede denunciar (queda
   oculto hasta que el director decide); el autor puede borrar lo
   suyo en cualquier momento; el director puede eliminar directo.
   ============================================================ */

import { db, auth, storage } from './firebase-config.js';
import { ref, get, set, push, update, remove } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { getCurrentRole } from './main.js';

const FASES_HITOS = { fase1: 'Fase 1: Claridad y Fundamentos', fase2: 'Fase 2: Cliente Soñado', fase3: 'Fase 3: Oferta y Método', fase4: 'Fase 4: Acción y Sistemas' };
const TAMANO_MAXIMO_FOTO_HITO = 10 * 1024 * 1024;

function formatFechaHito(ts) {
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
}

function linkifyTexto(texto) {
  if (!texto) return '';
  const escapado = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escapado.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
}

let fotosSeleccionadasHito = [];

const PLACEHOLDER_FOTO_HITO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="40" fill="#E4E7EC"/><circle cx="40" cy="32" r="14" fill="#9AA4B2"/><ellipse cx="40" cy="70" rx="24" ry="18" fill="#9AA4B2"/></svg>'
);
const COMENTARIOS_VISIBLES_POR_DEFECTO = 2;

// Publicaciones con todos sus comentarios desplegados (se mantiene al
// recargar el feed, p. ej. después de comentar).
const hitosComentariosExpandidos = new Set();
// Último render de cada publicación, para desplegar/plegar comentarios
// sin volver a pedir todo a Firebase.
const datosRenderHitos = new Map();

// --- Fotos: se leen en vivo (si el alumno cambia su foto, se actualiza
//     sola) y se guardan en caché durante la sesión. Las reglas permiten
//     leer solo alumnos/{id}/fotoUrl, ciclos/{id}/alumnoIds y
//     alumnoPorAuthUid/{uid}. ---
const cacheFotoAlumno = new Map();
const cacheIdsProyecto = new Map();
const cacheAlumnoIdPorAuth = new Map();

function leerConCache(cache, clave, lector) {
  if (!clave) return Promise.resolve(null);
  if (!cache.has(clave)) cache.set(clave, lector().catch(() => null));
  return cache.get(clave);
}
function fotoDeAlumno(alumnoId) {
  return leerConCache(cacheFotoAlumno, alumnoId, async () => {
    const snap = await get(ref(db, `alumnos/${alumnoId}/fotoUrl`));
    return snap.exists() ? snap.val() : null;
  });
}
function idsDeProyecto(cicloId) {
  return leerConCache(cacheIdsProyecto, cicloId, async () => {
    const snap = await get(ref(db, `ciclos/${cicloId}/alumnoIds`));
    if (!snap.exists()) return null;
    const val = snap.val();
    return Array.isArray(val) ? val.filter(Boolean) : Object.values(val || {}).filter(Boolean);
  });
}
function alumnoIdDeAuth(authUid) {
  return leerConCache(cacheAlumnoIdPorAuth, authUid, async () => {
    const snap = await get(ref(db, `alumnoPorAuthUid/${authUid}`));
    return snap.exists() ? snap.val() : null;
  });
}

async function prepararFotosFeed(lista, usuarios) {
  const fotosPublicacion = new Map(); // hitoId -> [fotoUrl, ...] (1 o 2 si son socios)
  const fotoPorAutorComentario = new Map(); // authUid -> fotoUrl
  const autoresComentarios = new Set();

  await Promise.all(lista.map(async ([hitoId, h]) => {
    let ids = await idsDeProyecto(h.proyectoId);
    if (!ids || !ids.length) ids = [h.alumnoIdPublicador];
    // El publicador primero
    ids = [h.alumnoIdPublicador, ...ids.filter(id => id !== h.alumnoIdPublicador)].filter(Boolean).slice(0, 2);
    fotosPublicacion.set(hitoId, await Promise.all(ids.map(async id => (await fotoDeAlumno(id)) || PLACEHOLDER_FOTO_HITO)));
    Object.values(h.comentarios || {}).forEach(c => { if (c && c.autorId) autoresComentarios.add(c.autorId); });
  }));

  await Promise.all([...autoresComentarios].map(async authUid => {
    if (usuarios[authUid]) {
      fotoPorAutorComentario.set(authUid, usuarios[authUid].fotoUrl || PLACEHOLDER_FOTO_HITO);
      return;
    }
    const alumnoId = await alumnoIdDeAuth(authUid);
    fotoPorAutorComentario.set(authUid, (alumnoId && await fotoDeAlumno(alumnoId)) || PLACEHOLDER_FOTO_HITO);
  }));

  return { fotosPublicacion, fotoPorAutorComentario };
}

// Pestaña activa del alumno: 'mis' (su progreso, publicar y sus hitos)
// o 'comunidad' (solo el feed de hitos publicados de su comunidad).
let pestanaHitosAlumno = 'mis';
let hashHitoProcesado = false;
// Cada carga tiene un número: si el alumno cambia de pestaña o filtro
// mientras una carga anterior sigue esperando datos, la anterior se
// descarta y no pisa la pantalla (causa del astronauta/botón que
// aparecía en "Hitos de la Comunidad").
let contadorCargaHitos = 0;

const IDS_FILTROS_ALUMNO = ['hitos-falumno-desde', 'hitos-falumno-hasta', 'hitos-falumno-estudiante', 'hitos-falumno-fase', 'hitos-falumno-hito'];

function limpiarFiltrosAlumno() {
  IDS_FILTROS_ALUMNO.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

document.querySelectorAll('[data-hitos-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (pestanaHitosAlumno === btn.dataset.hitosTab) return;
    pestanaHitosAlumno = btn.dataset.hitosTab;
    limpiarFiltrosAlumno();
    cargarMisHitos();
  });
});

IDS_FILTROS_ALUMNO.forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    if (id === 'hitos-falumno-fase') {
      const hitoEl = document.getElementById('hitos-falumno-hito');
      if (hitoEl) hitoEl.value = '';
    }
    cargarMisHitos();
  });
});
document.getElementById('btn-hitos-falumno-limpiar')?.addEventListener('click', () => {
  limpiarFiltrosAlumno();
  cargarMisHitos();
});

// Carpeta de imágenes de fase según nivel: BEGIN tiene las suyas;
// NEXT y eXIT usan las de NEXT.
function carpetaFasesPrograma(programa) {
  return programa === 'begin' ? 'begin' : 'next';
}

function imagenFaseCiclo(ciclo) {
  if (!ciclo) return 'inicio';
  if (ciclo.estadoAlumno === 'egresado') return 'final';
  if (ciclo.faseMetodologia && /\d/.test(ciclo.faseMetodologia)) return `fase${ciclo.faseMetodologia.match(/\d/)[0]}`;
  return 'inicio';
}

// Hasta qué fase ve el checklist: 0 = sin fase marcada por el coach,
// 1-4 = fase actual, 4 = egresado (ve todas).
function faseMaximaChecklist(ciclo) {
  if (!ciclo) return 0;
  if (ciclo.estadoAlumno === 'egresado') return 4;
  if (ciclo.faseMetodologia && /\d/.test(ciclo.faseMetodologia)) return Math.min(4, parseInt(ciclo.faseMetodologia.match(/\d/)[0], 10));
  return 0;
}

export async function cargarMisHitos() {
  const role = getCurrentRole();
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid) return;
  const cargaId = ++contadorCargaHitos;
  const cargaVigente = () => cargaId === contadorCargaHitos;

  const esAlumno = role === 'alumno';
  const esStaff = !esAlumno;
  const esDirector = role === 'director';

  if (!esAlumno) pestanaHitosAlumno = 'mis';
  const enMisHitos = esAlumno && pestanaHitosAlumno === 'mis';

  const tituloVistaEl = document.getElementById('hitos-titulo-vista');
  if (tituloVistaEl) tituloVistaEl.textContent = esAlumno ? 'Mis Hitos' : 'Hitos Estudiantes';
  document.getElementById('hitos-tabs')?.classList.toggle('hidden', !esAlumno);
  document.querySelectorAll('[data-hitos-tab]').forEach(btn => {
    const activa = btn.dataset.hitosTab === pestanaHitosAlumno;
    btn.classList.toggle('is-active', activa);
    btn.setAttribute('aria-selected', activa ? 'true' : 'false');
  });

  // Todo lo que no es de la pestaña actual se oculta de inmediato,
  // antes de esperar datos.
  document.getElementById('hitos-seguimiento-panel')?.classList.toggle('hidden', !enMisHitos);
  document.getElementById('hitos-publicar-panel')?.classList.toggle('hidden', !enMisHitos);
  document.getElementById('hitos-filtros-panel')?.classList.toggle('hidden', !esStaff);
  document.getElementById('hitos-filtros-alumno-panel')?.classList.toggle('hidden', !esAlumno);
  document.getElementById('hitos-falumno-estudiante-campo')?.classList.toggle('hidden', enMisHitos);
  if (!enMisHitos) {
    const heroEl = document.getElementById('hitos-hero-fase');
    if (heroEl) { heroEl.classList.add('hidden'); heroEl.innerHTML = ''; }
    const contEl = document.getElementById('hitos-contenidos-hotmart');
    if (contEl) { contEl.classList.add('hidden'); contEl.innerHTML = ''; }
  }

  // --- Determinar alumnoId/proyecto/programa (si es alumno) ---
  let alumnoIdPropio = null;
  let cicloIdPropio = null;
  let programaPropio = null;
  let idsProyectoPropio = [];
  let cicloPropio = null;
  if (esAlumno) {
    const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
    alumnoIdPropio = mapaSnap.exists() ? mapaSnap.val() : null;
    if (alumnoIdPropio) {
      const alumnoSnap = await get(ref(db, `alumnos/${alumnoIdPropio}`));
      cicloIdPropio = alumnoSnap.exists() ? alumnoSnap.val().cicloActualId : null;
      if (cicloIdPropio) {
        const cicloSnap = await get(ref(db, `ciclos/${cicloIdPropio}`));
        if (cicloSnap.exists()) {
          cicloPropio = cicloSnap.val();
          programaPropio = cicloSnap.val().programa || null;
          idsProyectoPropio = Array.isArray(cicloSnap.val().alumnoIds) ? cicloSnap.val().alumnoIds : [alumnoIdPropio];
        }
      }
    }
  }
  if (!cargaVigente()) return;

  // --- Hitos definidos (activos e inactivos — los inactivos igual
  //     hay que poder mostrarlos si ya fueron publicados) ---
  const [hitosDefSnap, hitosSnap, usuariosSnap, configSnap] = await Promise.all([
    get(ref(db, 'configuracion/hitosDefinidos')),
    get(ref(db, 'hitos')),
    get(ref(db, 'usuarios')),
    enMisHitos ? get(ref(db, 'configuracion/general')) : Promise.resolve(null)
  ]);
  if (!cargaVigente()) return;
  const hitosDefinidos = hitosDefSnap.exists() ? hitosDefSnap.val() : {};
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() : {};
  const todosLosHitos = hitosSnap.exists() ? Object.entries(hitosSnap.val()) : [];
  const config = configSnap && configSnap.exists() ? configSnap.val() : {};

  // --- Filtro de visibilidad: alumnos y staff ven los hitos de los 3
  //     programas (cada publicación lleva la etiqueta de su programa).
  //     Los "oculto_denuncia" no los ve nadie excepto el director. ---
  const hitosVisibles = todosLosHitos
    .filter(([, h]) => !(h.estado === 'oculto_denuncia' && !esDirector))
    .sort((a, b) => b[1].createdAt - a[1].createdAt);

  // --- Link directo a un hito de otro proyecto (compartido por WhatsApp):
  //     se abre en la pestaña "Hitos de la Comunidad" para que aparezca ---
  const hashInicial = window.location.hash;
  if (esAlumno && enMisHitos && !hashHitoProcesado && hashInicial && hashInicial.startsWith('#hito-')) {
    hashHitoProcesado = true;
    const hitoDestino = hitosVisibles.find(([id]) => `#hito-${id}` === hashInicial);
    if (hitoDestino && hitoDestino[1].proyectoId !== cicloIdPropio) {
      pestanaHitosAlumno = 'comunidad';
      return cargarMisHitos();
    }
  }

  // --- Pestaña "Mis Hitos": astronauta de la fase (los 3 niveles) y
  //     botón de Contenidos en Hotmart (link según nivel) ---
  if (enMisHitos) {
    const heroFaseEl = document.getElementById('hitos-hero-fase');
    if (heroFaseEl) {
      const mostrarHero = !!programaPropio;
      heroFaseEl.classList.toggle('hidden', !mostrarHero);
      heroFaseEl.innerHTML = mostrarHero
        ? `<img src="assets/fases/${carpetaFasesPrograma(programaPropio)}/${imagenFaseCiclo(cicloPropio)}.webp" alt="Tu fase actual">`
        : '';
    }
    const contenidosEl = document.getElementById('hitos-contenidos-hotmart');
    if (contenidosEl) {
      const urlContenidos = programaPropio === 'begin' ? config.contenidoHotmartBegin
        : programaPropio === 'next' ? config.contenidoHotmartNext
        : programaPropio === 'exit' ? config.contenidoHotmartExit : '';
      contenidosEl.classList.toggle('hidden', !urlContenidos);
      contenidosEl.innerHTML = urlContenidos
        ? `<a href="${urlContenidos}" target="_blank" rel="noopener" class="btn btn-contenidos-hotmart">Ver Contenidos en <img src="assets/logos/hotmart.png" alt="Hotmart" style="height:18px; width:auto; vertical-align:middle;"> hotmart</a>`
        : '';
    }
  }

  // --- Seguimiento personal + selector de publicar (solo alumno) ---
  if (enMisHitos && cicloIdPropio) {
    const misHitosPublicadosDefIds = new Set(
      todosLosHitos.filter(([, h]) => h.proyectoId === cicloIdPropio).map(([, h]) => h.hitoDefId)
    );
    renderSeguimientoPersonal(hitosDefinidos, misHitosPublicadosDefIds, faseMaximaChecklist(cicloPropio));
    poblarSelectorPublicar(hitosDefinidos, misHitosPublicadosDefIds);
  } else if (enMisHitos) {
    const seg = document.getElementById('hitos-seguimiento-contenido');
    if (seg) seg.innerHTML = '<p class="text-soft">Todavía no tienes un ciclo asignado.</p>';
  }

  // --- Filtros de staff: poblar selector de alumno ---
  if (esStaff) {
    const filtroAlumnoEl = document.getElementById('hitos-filtro-alumno');
    if (filtroAlumnoEl && !filtroAlumnoEl.dataset.cargado) {
      const nombresUnicos = [...new Set(todosLosHitos.map(([, h]) => h.nombreAutor))].sort((a, b) => a.localeCompare(b, 'es'));
      filtroAlumnoEl.innerHTML = '<option value="">Todos los alumnos</option>' + nombresUnicos.map(n => `<option value="${n}">${n}</option>`).join('');
      filtroAlumnoEl.dataset.cargado = '1';
    }
    ['hitos-filtro-alumno', 'hitos-filtro-programa', 'hitos-filtro-fase', 'hitos-filtro-denunciados'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.dataset.conectado) {
        el.addEventListener('change', cargarMisHitos);
        el.dataset.conectado = '1';
      }
    });
  }

  // Pestaña "Mis Hitos": solo los de su proyecto. "Hitos de la Comunidad":
  // todos los visibles para su nivel.
  const hitosParaFeed = enMisHitos
    ? hitosVisibles.filter(([, h]) => h.proyectoId === cicloIdPropio)
    : hitosVisibles;

  if (esAlumno) poblarFiltrosAlumno(hitosParaFeed, hitosDefinidos, enMisHitos);

  const fotosFeed = await prepararFotosFeed(hitosParaFeed, usuarios);
  if (!cargaVigente()) return;
  renderFeedHitos(hitosParaFeed, usuarios, { esAlumno, esStaff, esDirector, uid, alumnoIdPropio, idsProyectoPropio, enMisHitos, ...fotosFeed });

  // --- Link directo a un hito (compartido por WhatsApp) ---
  const hash = window.location.hash;
  if (hash && hash.startsWith('#hito-')) {
    const elDestino = document.getElementById(hash.slice(1));
    if (elDestino) {
      setTimeout(() => elDestino.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    }
  }
}

// Opciones de los filtros del alumno (conserva lo ya elegido si sigue válido)
function poblarFiltrosAlumno(lista, hitosDefinidos, enMisHitos) {
  const estudianteEl = document.getElementById('hitos-falumno-estudiante');
  if (estudianteEl && !enMisHitos) {
    const actual = estudianteEl.value;
    const nombres = [...new Set(lista.map(([, h]) => h.nombreAutor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    estudianteEl.innerHTML = '<option value="">Todos los estudiantes</option>' + nombres.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');
    if (nombres.includes(actual)) estudianteEl.value = actual;
  }
  const faseEl = document.getElementById('hitos-falumno-fase');
  const hitoEl = document.getElementById('hitos-falumno-hito');
  if (hitoEl) {
    const actual = hitoEl.value;
    const faseElegida = faseEl ? faseEl.value : '';
    const defs = Object.entries(hitosDefinidos)
      .filter(([, h]) => !faseElegida || h.fase === faseElegida)
      .sort((a, b) => (a[1].fase || '').localeCompare(b[1].fase || '') || (a[1].titulo || '').localeCompare(b[1].titulo || '', 'es', { numeric: true }));
    hitoEl.innerHTML = '<option value="">Todos los hitos</option>' + defs.map(([id, h]) => `<option value="${id}">${h.titulo}</option>`).join('');
    if (defs.some(([id]) => id === actual)) hitoEl.value = actual;
  }
}

function renderSeguimientoPersonal(hitosDefinidos, misHitosPublicadosDefIds, faseMaxima) {
  const cont = document.getElementById('hitos-seguimiento-contenido');
  if (!cont) return;
  if (!faseMaxima) {
    cont.innerHTML = '<p class="text-soft" style="margin:0; text-align:center;">Tu checklist de hitos aparecerá cuando tu coach marque tu fase.</p>';
    return;
  }
  const fasesVisibles = Object.keys(FASES_HITOS).filter(faseClave => parseInt(faseClave.replace('fase', ''), 10) <= faseMaxima);
  const activos = Object.entries(hitosDefinidos).filter(([, h]) => h.activo !== false && fasesVisibles.includes(h.fase));
  const totalPublicados = activos.filter(([id]) => misHitosPublicadosDefIds.has(id)).length;

  cont.innerHTML = `
    <p class="mb-16" style="font-weight:600;">${totalPublicados} de ${activos.length} hitos publicados</p>
    ${fasesVisibles.map(faseClave => {
      const deEstaFase = activos.filter(([, h]) => h.fase === faseClave);
      if (!deEstaFase.length) return '';
      return `
        <div class="hitos-fase-bloque hitos-fase-bloque--${faseClave}">
          <p class="hitos-fase-titulo">${FASES_HITOS[faseClave]}</p>
          ${deEstaFase.map(([id, h]) => `
            <p class="hitos-fase-item">${misHitosPublicadosDefIds.has(id) ? '✅' : '⬜'} ${h.titulo}</p>`).join('')}
        </div>`;
    }).join('')}`;
}

function poblarSelectorPublicar(hitosDefinidos, misHitosPublicadosDefIds) {
  const select = document.getElementById('hito-select-publicar');
  if (!select) return;
  const disponibles = Object.entries(hitosDefinidos).filter(([id, h]) => h.activo !== false && !misHitosPublicadosDefIds.has(id));
  select.innerHTML = '<option value="">Selecciona...</option>' + Object.keys(FASES_HITOS).map(faseClave => {
    const deEstaFase = disponibles.filter(([, h]) => h.fase === faseClave);
    if (!deEstaFase.length) return '';
    return `<optgroup label="${FASES_HITOS[faseClave]}">${deEstaFase.map(([id, h]) => `<option value="${id}">${h.titulo}</option>`).join('')}</optgroup>`;
  }).join('');
}

const btnAdjuntarFotoHito = document.getElementById('btn-adjuntar-foto-hito');
const inputFotoHito = document.getElementById('input-foto-hito');
if (btnAdjuntarFotoHito && inputFotoHito) {
  btnAdjuntarFotoHito.addEventListener('click', () => inputFotoHito.click());
  inputFotoHito.addEventListener('change', () => {
    const seleccionados = Array.from(inputFotoHito.files);
    const muyPesados = seleccionados.filter(f => f.size > TAMANO_MAXIMO_FOTO_HITO);
    if (muyPesados.length) {
      alert(`Estas fotos pesan más de 10MB: ${muyPesados.map(f => f.name).join(', ')}`);
      inputFotoHito.value = '';
      return;
    }
    fotosSeleccionadasHito = seleccionados;
    document.getElementById('hito-fotos-preview').innerHTML = fotosSeleccionadasHito
      .map(f => `<span class="text-soft" style="font-size:11px; background:#F0F1F3; padding:3px 8px; border-radius:6px;">🖼️ ${f.name}</span>`).join('');
  });
}

function programaLabelCorto(p) {
  return p === 'begin' ? 'Begin' : p === 'next' ? 'Next' : p === 'exit' ? 'eXIT' : '—';
}

// Etiqueta con el logo del programa (píldora negra, porque los logos
// tienen letras blancas). Sin programa conocido, no muestra nada.
function etiquetaProgramaHito(p) {
  if (!['begin', 'next', 'exit'].includes(p)) return '';
  return `<span class="hito-etiqueta-programa" title="${programaLabelCorto(p)}"><img src="assets/logos/wordmark-${p}.png" alt="${programaLabelCorto(p)}"></span>`;
}

function renderMiniaturasReacciones(hitoId, reacciones) {
  const lista = Object.values(reacciones || {});
  if (!lista.length) return '';
  const PLACEHOLDER = 'https://uneqacademy.github.io/onboarding-uneq/assets/logos/isotipo-uneq.png';
  const primeras5 = lista.slice(0, 5);
  return `
    <div style="display:flex; align-items:center; margin-top:8px;">
      <div style="display:flex;">
        ${primeras5.map((r, i) => `<img src="${(r && r.fotoUrl) || PLACEHOLDER}" alt="" title="${(r && r.nombre) || ''}" style="width:22px; height:22px; border-radius:50%; object-fit:cover; border:2px solid #fff; margin-left:${i === 0 ? '0' : '-8px'};">`).join('')}
      </div>
      ${lista.length > 5 ? `<button type="button" class="btn-ver-todas-reacciones" data-hito-id="${hitoId}" style="background:none; border:none; color:var(--color-accent); font-size:11.5px; cursor:pointer; margin-left:8px; padding:0;">Ver todos (${lista.length})</button>` : ''}
    </div>`;
}

function comentariosVisibles(comentarios, esDirector) {
  return Object.entries(comentarios || {})
    .filter(([, c]) => c && (c.estado !== 'oculto_denuncia' || esDirector))
    .sort((a, b) => a[1].createdAt - b[1].createdAt);
}

function renderComentarios(hitoId, comentarios, esDirector, fotoPorAutor, expandido) {
  const todos = comentariosVisibles(comentarios, esDirector);
  if (!todos.length) return '<p class="text-soft" style="font-size:12px;">Sin comentarios todavía — ¡sé el primero en animar!</p>';
  // Plegado: los 2 más recientes (el más nuevo abajo). Desplegado: todos.
  const lista = expandido ? todos : todos.slice(-COMENTARIOS_VISIBLES_POR_DEFECTO);
  return lista.map(([comentarioId, c]) => `
    <div data-comentario-id="${comentarioId}" style="padding:6px 0; border-bottom:0.5px solid var(--border);">
      <p class="hito-comentario" style="font-size:12.5px; margin:0;">
        <img src="${(fotoPorAutor && fotoPorAutor.get(c.autorId)) || PLACEHOLDER_FOTO_HITO}" alt="" class="hito-comentario__foto">
        <strong>${c.autorNombre || 'Alguien'}</strong>${c.autorTipo === 'staff' ? ' <span class="badge badge--activo" style="font-size:8px;">staff</span>' : ''}
        ${c.estado === 'oculto_denuncia' ? ' <span style="color:#C0392B; font-size:10px;">⚠️ denunciado</span>' : ''}
        : ${linkifyTexto(c.texto)}
      </p>
      <div style="display:flex; gap:10px; margin-top:2px;">
        <span class="text-soft" style="font-size:10px;">${formatFechaHito(c.createdAt)}</span>
        <button type="button" class="btn-eliminar-comentario" data-hito-id="${hitoId}" data-comentario-id="${comentarioId}" data-autor-id="${c.autorId}" style="font-size:10px; background:none; border:none; color:#9CA0A8; cursor:pointer; padding:0;">Eliminar</button>
        <button type="button" class="btn-denunciar-comentario" data-hito-id="${hitoId}" data-comentario-id="${comentarioId}" style="font-size:10px; background:none; border:none; color:#9CA0A8; cursor:pointer; padding:0;">Denunciar</button>
        ${c.estado === 'oculto_denuncia' && esDirector ? `
          <button type="button" class="btn-aceptar-denuncia-comentario" data-hito-id="${hitoId}" data-comentario-id="${comentarioId}" style="font-size:10px; background:none; border:none; color:#C0392B; cursor:pointer; padding:0;">Aceptar denuncia</button>
          <button type="button" class="btn-rechazar-denuncia-comentario" data-hito-id="${hitoId}" data-comentario-id="${comentarioId}" style="font-size:10px; background:none; border:none; color:#2F9E8F; cursor:pointer; padding:0;">Rechazar</button>` : ''}
      </div>
    </div>`).join('');
}

function renderFeedHitos(hitosVisibles, usuarios, ctx) {
  const feedEl = document.getElementById('hitos-feed');
  if (!feedEl) return;

  // Filtros de staff
  let lista = hitosVisibles;
  if (ctx.esStaff) {
    const fAlumno = document.getElementById('hitos-filtro-alumno')?.value || '';
    const fPrograma = document.getElementById('hitos-filtro-programa')?.value || '';
    const fFase = document.getElementById('hitos-filtro-fase')?.value || '';
    const fSoloDenunciados = document.getElementById('hitos-filtro-denunciados')?.checked || false;
    lista = lista.filter(([, h]) =>
      (!fAlumno || h.nombreAutor === fAlumno) &&
      (!fPrograma || h.programa === fPrograma) &&
      (!fFase || h.fase === fFase) &&
      (!fSoloDenunciados || h.estado === 'oculto_denuncia')
    );
  }

  // Filtros del alumno (ambas pestañas; estudiante solo en Comunidad)
  if (ctx.esAlumno) {
    const fDesde = document.getElementById('hitos-falumno-desde')?.value || '';
    const fHasta = document.getElementById('hitos-falumno-hasta')?.value || '';
    const fEstudiante = ctx.enMisHitos ? '' : (document.getElementById('hitos-falumno-estudiante')?.value || '');
    const fFase = document.getElementById('hitos-falumno-fase')?.value || '';
    const fHito = document.getElementById('hitos-falumno-hito')?.value || '';
    const desdeMs = fDesde ? new Date(`${fDesde}T00:00:00`).getTime() : null;
    const hastaMs = fHasta ? new Date(`${fHasta}T23:59:59.999`).getTime() : null;
    lista = lista.filter(([, h]) =>
      (desdeMs === null || h.createdAt >= desdeMs) &&
      (hastaMs === null || h.createdAt <= hastaMs) &&
      (!fEstudiante || h.nombreAutor === fEstudiante) &&
      (!fFase || h.fase === fFase) &&
      (!fHito || h.hitoDefId === fHito)
    );
  }

  if (!lista.length) {
    const hayFiltros = ctx.esAlumno && IDS_FILTROS_ALUMNO.some(id => document.getElementById(id)?.value);
    if (hayFiltros) {
      feedEl.innerHTML = '<p class="text-soft">No hay hitos que coincidan con los filtros.</p>';
      return;
    }
    feedEl.innerHTML = ctx.enMisHitos
      ? '<p class="text-soft">Aún no has publicado hitos — cuando logres uno, publícalo arriba.</p>'
      : '<p class="text-soft">Todavía no hay hitos publicados por acá.</p>';
    return;
  }

  feedEl.innerHTML = lista.map(([hitoId, h]) => {
    const esAutor = ctx.esAlumno && ctx.idsProyectoPropio.includes(h.alumnoIdPublicador);
    const puedeEliminar = esAutor || ctx.esDirector;
    const puedeDenunciar = ctx.esAlumno && !esAutor;
    const yaReacciono = h.reacciones && h.reacciones[ctx.uid];
    const totalReacciones = h.reacciones ? Object.keys(h.reacciones).length : 0;
    const esDenunciado = h.estado === 'oculto_denuncia';
    const totalComentarios = comentariosVisibles(h.comentarios, ctx.esDirector).length;
    const comentariosExpandidos = hitosComentariosExpandidos.has(hitoId);
    datosRenderHitos.set(hitoId, { comentarios: h.comentarios, esDirector: ctx.esDirector, fotoPorAutor: ctx.fotoPorAutorComentario });

    return `
    <div class="panel mb-16" id="hito-${hitoId}" data-hito-id="${hitoId}" ${esDenunciado ? 'style="border-color:#F5C6C6;"' : ''}>
      <div class="panel__body">
        <div class="flex-between">
          <div>
            <div class="hito-autor">
              <span class="hito-autor__fotos">${(ctx.fotosPublicacion && ctx.fotosPublicacion.get(hitoId) || [PLACEHOLDER_FOTO_HITO]).map(url => `<img src="${url}" alt="">`).join('')}</span>
              <strong>${h.nombreAutor}</strong>
              ${etiquetaProgramaHito(h.programa)}
            </div>
            <p class="text-soft" style="font-size:11px; margin:2px 0 0;">${FASES_HITOS[h.fase] || h.fase} · <strong>${h.tituloHito}</strong></p>
          </div>
          ${esDenunciado ? '<span class="badge" style="background:#FBE4E4; color:#C0392B; font-size:9px;">⚠️ Denunciado</span>' : ''}
        </div>
        ${h.descripcionHito ? `<p class="text-soft" style="font-size:12px; margin:8px 0 0; font-style:italic;">${h.descripcionHito}</p>` : ''}
        ${h.textoAlumno ? `<p style="margin:8px 0 0; white-space:pre-wrap;">${linkifyTexto(h.textoAlumno)}</p>` : ''}
        ${(h.fotos || []).map(f => `<img src="${f.url}" alt="" class="btn-ampliar-foto-hito" data-src="${f.url}" style="max-width:220px; max-height:220px; border-radius:8px; margin:8px 8px 0 0; object-fit:cover; cursor:zoom-in;">`).join('')}
        <p class="text-soft" style="font-size:11px; margin:8px 0 0;">${formatFechaHito(h.createdAt)}</p>

        <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; align-items:center;">
          <button type="button" class="btn ${yaReacciono ? 'btn--primary' : 'btn--ghost'} btn-reaccion-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:4px 10px;">❤️ ${totalReacciones}</button>
          <button type="button" class="btn ${comentariosExpandidos ? 'btn--primary' : 'btn--ghost'} btn-comentarios-hito" data-hito-id="${hitoId}" aria-expanded="${comentariosExpandidos}" title="Ver todos los comentarios" style="font-size:12px; padding:4px 10px;">💬 <span class="contador-comentarios-hito">${totalComentarios}</span></button>
          ${esAutor ? `<button type="button" class="btn btn--ghost btn-compartir-hito" data-hito-id="${hitoId}" data-titulo="${h.tituloHito}" style="font-size:12px; padding:4px 10px;">📤 Compartir</button>` : ''}
          ${puedeEliminar ? `<button type="button" class="btn btn--ghost btn-eliminar-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:4px 10px; color:#C0392B;">Eliminar</button>` : ''}
          ${puedeDenunciar ? `<button type="button" class="btn btn--ghost btn-denunciar-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:4px 10px;">Denunciar</button>` : ''}
          ${esDenunciado && ctx.esDirector ? `
            <button type="button" class="btn btn--ghost btn-aceptar-denuncia-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:4px 10px; color:#C0392B;">Aceptar denuncia (elimina)</button>
            <button type="button" class="btn btn--ghost btn-rechazar-denuncia-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:4px 10px; color:#2F9E8F;">Rechazar</button>` : ''}
        </div>
        ${renderMiniaturasReacciones(hitoId, h.reacciones)}

        <div class="comentarios-hito" data-hito-id="${hitoId}" style="margin-top:12px; border-top:0.5px solid var(--border); padding-top:10px;">
          ${renderComentarios(hitoId, h.comentarios, ctx.esDirector, ctx.fotoPorAutorComentario, comentariosExpandidos)}
        </div>
        <div style="display:flex; gap:8px; margin-top:10px;">
          <input class="input-comentario-hito" data-hito-id="${hitoId}" placeholder="Escribe un comentario de ánimo..." style="flex:1;">
          <button type="button" class="btn btn--ghost btn-emoji-picker" data-target-selector=".input-comentario-hito[data-hito-id='${hitoId}']" style="font-size:14px; padding:6px 10px;">😊</button>
          <button type="button" class="btn btn--primary btn-enviar-comentario-hito" data-hito-id="${hitoId}" style="font-size:12px; padding:6px 14px;">Enviar</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

const btnPublicarHito = document.getElementById('btn-publicar-hito');
if (btnPublicarHito) {
  btnPublicarHito.addEventListener('click', async () => {
    const errorEl = document.getElementById('hito-publicar-error');
    errorEl.classList.add('hidden');
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    const hitoDefId = document.getElementById('hito-select-publicar').value;
    const texto = document.getElementById('hito-texto-publicar').value.trim();

    if (!uid || !hitoDefId) {
      errorEl.textContent = 'Elige qué hito lograste antes de publicar.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnPublicarHito.disabled = true;
    try {
      const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
      const alumnoId = mapaSnap.exists() ? mapaSnap.val() : null;
      const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
      const alumno = alumnoSnap.exists() ? alumnoSnap.val() : {};
      const cicloId = alumno.cicloActualId;
      if (!cicloId) throw new Error('Sin ciclo asignado');
      const cicloSnap = await get(ref(db, `ciclos/${cicloId}`));
      const ciclo = cicloSnap.exists() ? cicloSnap.val() : {};

      // Nombre combinado del proyecto (si hay socia, van los 2 nombres)
      const idsProyecto = Array.isArray(ciclo.alumnoIds) ? ciclo.alumnoIds : [alumnoId];
      const nombresSnaps = await Promise.all(idsProyecto.map(id => get(ref(db, `alumnos/${id}`))));
      const nombreAutor = nombresSnaps.filter(s => s.exists()).map(s => `${s.val().nombre || ''} ${s.val().apellido || ''}`.trim()).filter(Boolean).join(' y ');

      const hitoDefSnap = await get(ref(db, `configuracion/hitosDefinidos/${hitoDefId}`));
      if (!hitoDefSnap.exists()) throw new Error('Hito no encontrado');
      const hitoDef = hitoDefSnap.val();

      // Doble chequeo: que el proyecto no lo haya publicado ya (por si
      // se abrieron 2 pestañas a la vez)
      const yaExistentesSnap = await get(ref(db, 'hitos'));
      const yaExistentes = yaExistentesSnap.exists() ? Object.values(yaExistentesSnap.val()) : [];
      if (yaExistentes.some(h => h.proyectoId === cicloId && h.hitoDefId === hitoDefId)) {
        errorEl.textContent = 'Este hito ya fue publicado por tu proyecto.';
        errorEl.classList.remove('hidden');
        return;
      }

      const nuevoRef = push(ref(db, 'hitos'));
      const fotos = [];
      for (let i = 0; i < fotosSeleccionadasHito.length; i++) {
        const archivoRef = storageRef(storage, `hitos/${nuevoRef.key}/${i}_${Date.now()}_${fotosSeleccionadasHito[i].name}`);
        await uploadBytes(archivoRef, fotosSeleccionadasHito[i]);
        fotos.push({ url: await getDownloadURL(archivoRef), nombre: fotosSeleccionadasHito[i].name });
      }

      await set(nuevoRef, {
        proyectoId: cicloId,
        alumnoIdPublicador: alumnoId,
        nombreAutor,
        programa: ciclo.programa || null,
        fase: hitoDef.fase,
        hitoDefId,
        tituloHito: hitoDef.titulo,
        descripcionHito: hitoDef.descripcion || '',
        textoAlumno: texto,
        fotos,
        createdAt: Date.now(),
        estado: 'visible'
      });

      document.getElementById('hito-texto-publicar').value = '';
      document.getElementById('hito-fotos-preview').innerHTML = '';
      fotosSeleccionadasHito = [];
      await cargarMisHitos();
    } catch (err) {
      console.error(err);
      errorEl.textContent = 'No se pudo publicar. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
    } finally {
      btnPublicarHito.disabled = false;
    }
  });
}

async function enviarComentario(hitoId, texto) {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  if (!uid || !texto.trim()) return;
  const role = getCurrentRole();
  const esAlumno = role === 'alumno';
  let autorNombre = '';
  if (esAlumno) {
    const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
    const alumnoId = mapaSnap.exists() ? mapaSnap.val() : null;
    const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
    const a = alumnoSnap.exists() ? alumnoSnap.val() : {};
    autorNombre = `${a.nombre || ''} ${a.apellido || ''}`.trim();
  } else {
    const usuarioSnap = await get(ref(db, `usuarios/${uid}`));
    autorNombre = usuarioSnap.exists() ? (usuarioSnap.val().nombre || '') : '';
  }
  await set(push(ref(db, `hitos/${hitoId}/comentarios`)), {
    autorId: uid,
    autorNombre,
    autorTipo: esAlumno ? 'alumno' : 'staff',
    texto: texto.trim(),
    createdAt: Date.now(),
    estado: 'visible'
  });
  await cargarMisHitos();
}

// Dominio propio (una vez que esté conectado) que arma la tarjeta de
// WhatsApp con la foto/título de CADA hito, y de ahí manda a la app
// real. Si cambias el subdominio elegido, solo hay que actualizar
// esta línea.
const DOMINIO_PREVIEW_HITOS = 'https://hitos.uneqacademy.com';

function compartirHitoWhatsapp(hitoId, titulo) {
  const url = `${DOMINIO_PREVIEW_HITOS}/?id=${hitoId}`;
  const mensaje = encodeURIComponent(`¡Quiero compartir con ustedes que logré "${titulo}" en mi programa con UNEQ Mentoring! 🎉\n\nMíralo y déjame un comentario acá:\n${url}`);
  window.open(`https://wa.me/?text=${mensaje}`, '_blank');
}

const feedHitosEl = document.getElementById('hitos-feed');
if (feedHitosEl) {
  feedHitosEl.addEventListener('click', async (ev) => {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid) return;

    const btnComentarios = ev.target.closest('.btn-comentarios-hito');
    if (btnComentarios) {
      const hitoId = btnComentarios.dataset.hitoId;
      const expandir = !hitosComentariosExpandidos.has(hitoId);
      if (expandir) hitosComentariosExpandidos.add(hitoId); else hitosComentariosExpandidos.delete(hitoId);
      const datos = datosRenderHitos.get(hitoId);
      const contenedor = feedHitosEl.querySelector(`.comentarios-hito[data-hito-id="${hitoId}"]`);
      if (datos && contenedor) {
        contenedor.innerHTML = renderComentarios(hitoId, datos.comentarios, datos.esDirector, datos.fotoPorAutor, expandir);
      }
      btnComentarios.classList.toggle('btn--primary', expandir);
      btnComentarios.classList.toggle('btn--ghost', !expandir);
      btnComentarios.setAttribute('aria-expanded', String(expandir));
      return;
    }

    const btnReaccion = ev.target.closest('.btn-reaccion-hito');
    if (btnReaccion) {
      const hitoId = btnReaccion.dataset.hitoId;
      const refReaccion = ref(db, `hitos/${hitoId}/reacciones/${uid}`);
      const yaExiste = (await get(refReaccion)).exists();
      if (yaExiste) {
        await remove(refReaccion);
      } else {
        const role = getCurrentRole();
        let nombre = '', fotoUrl = '';
        if (role === 'alumno') {
          const mapaSnap = await get(ref(db, `alumnoPorAuthUid/${uid}`));
          const alumnoId = mapaSnap.exists() ? mapaSnap.val() : null;
          const alumnoSnap = await get(ref(db, `alumnos/${alumnoId}`));
          const a = alumnoSnap.exists() ? alumnoSnap.val() : {};
          nombre = `${a.nombre || ''} ${a.apellido || ''}`.trim();
          fotoUrl = a.fotoUrl || '';
        } else {
          const usuarioSnap = await get(ref(db, `usuarios/${uid}`));
          const u = usuarioSnap.exists() ? usuarioSnap.val() : {};
          nombre = u.nombre || '';
          fotoUrl = u.fotoUrl || '';
        }
        await set(refReaccion, { nombre, fotoUrl });
      }
      await cargarMisHitos();
      return;
    }

    const imgAmpliar = ev.target.closest('.btn-ampliar-foto-hito');
    if (imgAmpliar) {
      const lightbox = document.getElementById('hito-lightbox-imagen');
      if (lightbox) {
        document.getElementById('hito-lightbox-imagen-img').src = imgAmpliar.dataset.src;
        lightbox.classList.remove('hidden');
      }
      return;
    }

    const btnVerTodasReacciones = ev.target.closest('.btn-ver-todas-reacciones');
    if (btnVerTodasReacciones) {
      const hitoId = btnVerTodasReacciones.dataset.hitoId;
      const snap = await get(ref(db, `hitos/${hitoId}/reacciones`));
      const lista = Object.values(snap.exists() ? snap.val() : {});
      const PLACEHOLDER = 'https://uneqacademy.github.io/onboarding-uneq/assets/logos/isotipo-uneq.png';
      const modal = document.getElementById('hito-modal-reacciones');
      const listaEl = document.getElementById('hito-modal-reacciones-lista');
      if (modal && listaEl) {
        listaEl.innerHTML = lista.map(r => `
          <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:0.5px solid var(--color-border);">
            <img src="${(r && r.fotoUrl) || PLACEHOLDER}" alt="" style="width:32px; height:32px; border-radius:50%; object-fit:cover;">
            <span style="font-size:13.5px;">${(r && r.nombre) || 'Alguien'}</span>
          </div>`).join('');
        modal.classList.remove('hidden');
      }
      return;
    }

    const btnCompartir = ev.target.closest('.btn-compartir-hito');
    if (btnCompartir) {
      compartirHitoWhatsapp(btnCompartir.dataset.hitoId, btnCompartir.dataset.titulo);
      return;
    }

    const btnEliminarHito = ev.target.closest('.btn-eliminar-hito');
    if (btnEliminarHito) {
      if (!confirm('¿Eliminar este hito? Esta acción no se puede deshacer.')) return;
      await remove(ref(db, `hitos/${btnEliminarHito.dataset.hitoId}`));
      await cargarMisHitos();
      return;
    }

    const btnDenunciarHito = ev.target.closest('.btn-denunciar-hito');
    if (btnDenunciarHito) {
      if (!confirm('¿Denunciar este hito? Quedará oculto hasta que el director/a lo revise.')) return;
      const hitoId = btnDenunciarHito.dataset.hitoId;
      await update(ref(db, `hitos/${hitoId}`), { estado: 'oculto_denuncia' });
      await update(ref(db, `hitos/${hitoId}/denuncia`), { denunciadoPor: uid, createdAt: Date.now() });
      await cargarMisHitos();
      return;
    }

    const btnAceptarDenunciaHito = ev.target.closest('.btn-aceptar-denuncia-hito');
    if (btnAceptarDenunciaHito) {
      if (!confirm('¿Eliminar este hito denunciado? Esta acción no se puede deshacer.')) return;
      await remove(ref(db, `hitos/${btnAceptarDenunciaHito.dataset.hitoId}`));
      await cargarMisHitos();
      return;
    }

    const btnRechazarDenunciaHito = ev.target.closest('.btn-rechazar-denuncia-hito');
    if (btnRechazarDenunciaHito) {
      const hitoId = btnRechazarDenunciaHito.dataset.hitoId;
      await update(ref(db, `hitos/${hitoId}`), { estado: 'visible' });
      await remove(ref(db, `hitos/${hitoId}/denuncia`));
      await cargarMisHitos();
      return;
    }

    const btnEnviarComentario = ev.target.closest('.btn-enviar-comentario-hito');
    if (btnEnviarComentario) {
      const hitoId = btnEnviarComentario.dataset.hitoId;
      const input = feedHitosEl.querySelector(`.input-comentario-hito[data-hito-id="${hitoId}"]`);
      if (input && input.value.trim()) {
        btnEnviarComentario.disabled = true;
        await enviarComentario(hitoId, input.value);
      }
      return;
    }

    const btnEliminarComentario = ev.target.closest('.btn-eliminar-comentario');
    if (btnEliminarComentario) {
      if (!confirm('¿Eliminar este comentario?')) return;
      await remove(ref(db, `hitos/${btnEliminarComentario.dataset.hitoId}/comentarios/${btnEliminarComentario.dataset.comentarioId}`));
      await cargarMisHitos();
      return;
    }

    const btnDenunciarComentario = ev.target.closest('.btn-denunciar-comentario');
    if (btnDenunciarComentario) {
      if (!confirm('¿Denunciar este comentario? Quedará oculto hasta que el director/a lo revise.')) return;
      const { hitoId, comentarioId } = btnDenunciarComentario.dataset;
      await update(ref(db, `hitos/${hitoId}/comentarios/${comentarioId}`), { estado: 'oculto_denuncia' });
      await update(ref(db, `hitos/${hitoId}/comentarios/${comentarioId}/denuncia`), { denunciadoPor: uid, createdAt: Date.now() });
      await cargarMisHitos();
      return;
    }

    const btnAceptarDenunciaComentario = ev.target.closest('.btn-aceptar-denuncia-comentario');
    if (btnAceptarDenunciaComentario) {
      if (!confirm('¿Eliminar este comentario denunciado?')) return;
      const { hitoId, comentarioId } = btnAceptarDenunciaComentario.dataset;
      await remove(ref(db, `hitos/${hitoId}/comentarios/${comentarioId}`));
      await cargarMisHitos();
      return;
    }

    const btnRechazarDenunciaComentario = ev.target.closest('.btn-rechazar-denuncia-comentario');
    if (btnRechazarDenunciaComentario) {
      const { hitoId, comentarioId } = btnRechazarDenunciaComentario.dataset;
      await update(ref(db, `hitos/${hitoId}/comentarios/${comentarioId}`), { estado: 'visible' });
      await remove(ref(db, `hitos/${hitoId}/comentarios/${comentarioId}/denuncia`));
      await cargarMisHitos();
      return;
    }
  });

  feedHitosEl.addEventListener('keypress', async (ev) => {
    if (ev.key === 'Enter' && ev.target.classList.contains('input-comentario-hito')) {
      const hitoId = ev.target.dataset.hitoId;
      if (ev.target.value.trim()) await enviarComentario(hitoId, ev.target.value);
    }
  });
}

document.querySelectorAll('.nav-item[data-nav="mis-hitos"]').forEach(item => {
  item.addEventListener('click', cargarMisHitos);
});

/* ============================================================
   Selector de emojis — compartido entre "publicar hito" y cada
   campo de comentario (agregados dinámicamente por hito). Un set
   acotado y motivacional, no el listado completo de Unicode.
   ============================================================ */
const EMOJIS_DISPONIBLES = ['🎉', '🚀', '💪', '🔥', '👏', '🙌', '❤️', '⭐', '✨', '🏆', '👍', '😃', '🥳', '💯', '🙏', '😍', '💡', '🎯', '☺️', '🤗', '👊', '💛', '🌟', '😊'];

function cerrarEmojiPopover() {
  const pop = document.getElementById('emoji-picker-popover');
  if (pop) pop.classList.add('hidden');
}

document.addEventListener('click', (ev) => {
  const btnEmoji = ev.target.closest('.btn-emoji-picker');
  const pop = document.getElementById('emoji-picker-popover');
  if (!pop) return;

  if (btnEmoji) {
    // Encuentra el campo de texto destino: por id fijo (publicar) o
    // por selector CSS (comentarios, que se generan de a uno por hito).
    const campo = btnEmoji.dataset.target
      ? document.getElementById(btnEmoji.dataset.target)
      : document.querySelector(btnEmoji.dataset.targetSelector);
    if (!campo) return;

    const yaAbiertoParaEsteBoton = !pop.classList.contains('hidden') && pop.dataset.abiertoPor === (btnEmoji.dataset.target || btnEmoji.dataset.targetSelector);
    if (yaAbiertoParaEsteBoton) { cerrarEmojiPopover(); return; }

    pop.innerHTML = EMOJIS_DISPONIBLES.map(e => `<button type="button" class="btn-emoji-opcion" style="font-size:19px; background:none; border:none; cursor:pointer; padding:4px; border-radius:6px;">${e}</button>`).join('');
    pop.dataset.abiertoPor = btnEmoji.dataset.target || btnEmoji.dataset.targetSelector;

    const rect = btnEmoji.getBoundingClientRect();
    const arribaDeLaMitad = rect.top < window.innerHeight / 2;
    pop.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;
    pop.style.top = arribaDeLaMitad ? `${rect.bottom + 6}px` : '';
    pop.style.bottom = arribaDeLaMitad ? '' : `${window.innerHeight - rect.top + 6}px`;
    pop.classList.remove('hidden');
    pop.dataset.campoId = campo.id || '';
    pop.dataset.campoSelector = campo.id ? '' : (btnEmoji.dataset.targetSelector || '');
    return;
  }

  const btnOpcion = ev.target.closest('.btn-emoji-opcion');
  if (btnOpcion) {
    const campo = pop.dataset.campoId ? document.getElementById(pop.dataset.campoId) : document.querySelector(pop.dataset.campoSelector);
    if (campo) {
      const inicio = campo.selectionStart ?? campo.value.length;
      const fin = campo.selectionEnd ?? campo.value.length;
      campo.value = campo.value.slice(0, inicio) + btnOpcion.textContent + campo.value.slice(fin);
      campo.focus();
      campo.selectionStart = campo.selectionEnd = inicio + btnOpcion.textContent.length;
    }
    return;
  }

  // Clic afuera del popover y de cualquier botón de emoji -> se cierra.
  if (!ev.target.closest('#emoji-picker-popover')) cerrarEmojiPopover();
});

// Cierre de la imagen ampliada y de la ventana "Ver todos" — clic
// afuera del contenido, o en el botón de cerrar de cada una.
const lightboxImagenHito = document.getElementById('hito-lightbox-imagen');
if (lightboxImagenHito) {
  lightboxImagenHito.addEventListener('click', (ev) => {
    if (ev.target === lightboxImagenHito || ev.target.classList.contains('btn-cerrar-lightbox')) {
      lightboxImagenHito.classList.add('hidden');
    }
  });
}
const modalReaccionesHito = document.getElementById('hito-modal-reacciones');
if (modalReaccionesHito) {
  modalReaccionesHito.addEventListener('click', (ev) => {
    if (ev.target === modalReaccionesHito || ev.target.classList.contains('btn-cerrar-modal-reacciones')) {
      modalReaccionesHito.classList.add('hidden');
    }
  });
}
