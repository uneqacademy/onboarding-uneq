/* ============================================================
   laboratorio-ia-config.js — Configuración > Laboratorio IA (solo Director)
   El Director Académico edita TODO lo del Laboratorio sin tocar código:
   - tope diario de generaciones por alumno
   - preguntas de cada ficha (agregar, quitar, reordenar, marcar opcionales)
   - etapas del funnel (nombre, descripción, desde qué fase, formatos, objetivo)
   - formatos (cantidad de propuestas, estructura e instrucción)
   - prompts internos de la IA (sistema, bienvenida, borrador de ficha, generación)
   Lo que se guarda: laboratorioIA/config y laboratorioIA/prompts (solo director).
   Los prompts solo se guardan si difieren del original, así las mejoras del
   original llegan solas a lo que no se tocó. "Restaurar" vuelve a lo original.
   La forma de la respuesta de la IA (JSON) la fija el servidor: no se edita.
   ============================================================ */

import { db, app } from './firebase-config.js';
import { escaparHtml } from './util-html.js';
import { ref, set } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";

const functions = getFunctions(app);
const pedirConfig = httpsCallable(functions, 'laboratorioConfigDirector', { timeout: 30000 });
const esc = escaparHtml;
const cuerpo = () => document.getElementById('labcfg-cuerpo');

const NOMBRES_PROMPT = {
  sistema: ['Personalidad y reglas generales de la IA', 'Se usa en TODO: bienvenida, borrador de ficha y contenidos. Define cómo habla y qué no debe hacer.'],
  bienvenida: ['Frase de bienvenida', 'Cómo debe ser la frase cálida que ve el alumno arriba al entrar al Laboratorio.'],
  fichaBorrador: ['Borrador de la ficha', 'Cómo debe redactar la IA el borrador de las respuestas de la ficha a partir de los hitos y notas del copiloto.'],
  generacion: ['Generación de contenidos', 'Instrucción general al crear Reels, carruseles, DMs y WhatsApp. El objetivo de cada etapa y la estructura de cada formato se editan más arriba.'],
  pagado: ['Contenido PAGADO: reglas de los anuncios', 'Cómo se escriben los anuncios: el llamado a la acción es el botón de la publicación. Puedes usar {destino} (página de registro, página puente o grupo) y {fecha}.'],
  angulos: ['Contenido PAGADO: cómo crear los ángulos comunicacionales', 'Cómo debe pensar la IA los ángulos (enfoques para conectar con el Cliente Soñado) que el alumno revisa y aprueba antes de generar contenido pagado.'],
  estrategia: ['Contenido ORGÁNICO: reglas de los llamados a la acción', 'Cómo se escriben los llamados a la acción en Encuentro. Puedes usar {palabra}, {link} y {fecha}: la app los reemplaza con lo que cada alumno definió en su estrategia.'],
  formatoTexto: ['Formato de los textos (párrafos y hashtags)', 'Cómo deben escribirse los textos para que queden como se publicarían: párrafos separados por una línea en blanco y hashtags al final. Además, la app ordena el texto sola al guardarlo.'],
  emoji0: ['Nivel de emojis: «Sin emojis»', 'Instrucción cuando la barra del alumno está en el extremo izquierdo. Además la app quita cualquier emoji que se cuele.'],
  emoji1: ['Nivel de emojis: «Pocos»', 'Instrucción cuando la barra está en la segunda posición.'],
  emoji2: ['Nivel de emojis: «Algunos»', 'Instrucción cuando la barra está en el medio (es la posición inicial).'],
  emoji3: ['Nivel de emojis: «Bastantes»', 'Instrucción cuando la barra está en la cuarta posición.'],
  emoji4: ['Nivel de emojis: «Todos los que quieras»', 'Instrucción cuando la barra está en el extremo derecho.'],
  openGeneral: ['OPEN · Encuentro: reglas para todo contenido', 'Se suma a TODO lo que se genere en Encuentro del programa OPEN, sea orgánico o pagado: la invitación a la comunidad gratuita de WhatsApp. Admite {palabra}, {grupo} y {puente}. Los llamados a la acción (comentar la palabra, link directo, botón del anuncio) los arma la app según lo que eligió el alumno.'],
  openAngulos: ['OPEN · cómo crear los ángulos (contenido pagado)', 'Cómo debe pensar la IA los ángulos de OPEN: enfoques para que las personas quieran sumarse a la comunidad de WhatsApp.'],
  ideasGrupo: ['OPEN · ideas para el grupo: directrices técnicas', 'Directrices que se suman a cada tipo de idea (encuestas, preguntas abiertas, videos, audios y textos) que se crean para mantener la conexión y la interacción en el grupo. Cuántas se crean de cada tipo y cómo se escriben se define más arriba. Admite {palabra}, {grupo} y {puente}.'],
  ideasGrupoCerrado: ['OPEN · ideas para el grupo: el grupo está cerrado', 'Explica a la IA que el grupo de WhatsApp está cerrado (solo escribe el experto) y cuál es el llamado a la acción: una reacción con emoji («Déjame un 💛 si…»), nunca comentar. Se aplica a todas las ideas salvo «Abrir el grupo por un tiempo», donde sí se invita a escribir.'],
  ideasMedioTexto: ['OPEN · ideas para el grupo: formato Texto', 'Cómo debe escribirse una idea cuando la persona elige Textos.'],
  ideasMedioVideo: ['OPEN · ideas para el grupo: formato Video', 'Cómo deben ser el guion y el texto que acompaña al video cuando la persona elige Videos (largo del guion, texto corto y preciso).'],
  ideasMedioAudio: ['OPEN · ideas para el grupo: formato Audio', 'Cómo deben ser el guion y el texto que acompaña al audio cuando la persona elige Audios.'],
  ideasMedioVariado: ['OPEN · ideas para el grupo: formatos variados', 'Cómo debe mezclar la IA texto, video y audio cuando la persona elige formatos variados con un solo tipo de idea. (En «Mezclado» el formato se reparte solo.)'],
  flujoEncuentro: ['Flujos de Encuentro: directrices técnicas', 'Directrices técnicas y objetivos de los flujos de mensajes para el grupo ANTES de la SDV (conectar, recordar fecha y hora, aumentar la asistencia en vivo). Se suman a las directrices de cada flujo y a lo que defines en cada mensaje.'],
  flujoVenta: ['Flujos de Venta: directrices técnicas', 'Directrices técnicas y objetivos de los flujos de mensajes para el grupo DESPUÉS de la SDV (comunicar la oferta que se creó en vivo). Se suman a las directrices de cada flujo y a lo que defines en cada mensaje.'],
  ventaGeneral: ['Venta: reglas para todo contenido', 'Se suma a TODO lo que se genere en Venta, sea orgánico o pagado: cómo usar el nombre, la promesa y el precio del producto. Admite {palabra}, {link} y {wa}. Los llamados a la acción por destino (DM, WhatsApp, página de venta) los arma la app.'],
  ventaAngulos: ['Venta: cómo crear los ángulos (contenido pagado)', 'Cómo debe pensar la IA los ángulos de Venta: nacen del producto, su promesa y el Cliente Soñado. Son distintos de los de Encuentro.'],
  encuentroGeneral: ['Encuentro: reglas para todo contenido', 'Se suma a TODO lo que se genere en Encuentro, sea orgánico o pagado: por ejemplo que la sesión es gratuita y que la información y los enlaces se comparten en el grupo. Admite {palabra}, {link} y {fecha}. Puede quedar vacía.'],
  tecnica_web: ['Técnica: SDV con Registro WEB y luego a Grupo', 'Explícale a la IA cómo funciona esta técnica y cómo debe hablar de ella. Se suma cuando el alumno elige esta técnica. Admite {palabra}, {link} y {fecha}. Puede quedar vacía.'],
  tecnica_puente: ['Técnica: SDV con Página Puente y luego a Grupo', 'Explícale a la IA cómo funciona esta técnica y cómo debe hablar de ella. Se suma cuando el alumno elige esta técnica. Puede quedar vacía.'],
  tecnica_directo: ['Técnica: SDV Directo a Grupo', 'Explícale a la IA cómo funciona esta técnica y cómo debe hablar de ella. Se suma cuando el alumno elige esta técnica. Puede quedar vacía.']
};
// Una instrucción por cada tipo de mensaje (medio) y tipo de contenido (orgánico o pagado) de Encuentro.
const NOMBRES_FORMATO_PROMPT = { reel: 'Reels', carrusel: 'Carruseles', historia: 'Historias', imagen: 'Imágenes estáticas', whatsapp: 'WhatsApp', dm: 'DMs', email: 'Emails' };
Object.entries(NOMBRES_FORMATO_PROMPT).forEach(([f, n]) => ['organico', 'pagado'].forEach(t => {
  const tipo = t === 'organico' ? 'orgánico' : 'pagado';
  NOMBRES_PROMPT[`fmt_${f}_${t}`] = [`${n} · contenido ${tipo}`, `Cómo deben escribirse los ${n.toLowerCase()} cuando el contenido de Encuentro es ${tipo}: tono, a quién les hablan, qué destacar. Admite {palabra}, {link} y {fecha}. Puede quedar vacía.`];
}));
// Cómo se agrupan en pantalla (de lo más general a lo más específico).
const GRUPOS_PROMPT = [
  { titulo: 'Instrucciones generales de la IA', ayuda: 'Valen para todas las etapas del funnel.', claves: ['sistema', 'generacion', 'formatoTexto', 'bienvenida', 'fichaBorrador', 'emoji0', 'emoji1', 'emoji2', 'emoji3', 'emoji4'] },
  { titulo: 'Flujos de mensajes para el grupo', ayuda: 'Directrices técnicas de los flujos de Encuentro (antes de la SDV) y de Venta (después de la SDV). Los flujos mismos se definen más arriba.', claves: ['flujoEncuentro', 'flujoVenta'] },
  { titulo: 'Programa OPEN: Encuentro (comunidad de WhatsApp)', ayuda: 'Solo para alumnos del programa OPEN: Encuentro lleva a una comunidad gratuita de WhatsApp y no hay Venta ni flujos.', claves: ['openGeneral', 'openAngulos', 'ideasGrupo', 'ideasGrupoCerrado', 'ideasMedioTexto', 'ideasMedioVideo', 'ideasMedioAudio', 'ideasMedioVariado'] },
  { titulo: 'Venta', ayuda: 'Instrucciones de la etapa Venta.', claves: ['ventaGeneral', 'ventaAngulos'] },
  { titulo: 'Encuentro: para todo contenido', ayuda: 'Se suma a todo lo que se genere en Encuentro.', claves: ['encuentroGeneral'] },
  { titulo: 'Encuentro: según la técnica de la SDV', ayuda: 'Se suma según la técnica que eligió el alumno.', claves: ['tecnica_web', 'tecnica_puente', 'tecnica_directo'] },
  { titulo: 'Encuentro: según sea orgánico o pagado', ayuda: 'Las reglas de cada tipo de contenido y la creación de ángulos.', claves: ['estrategia', 'pagado', 'angulos'] },
  { titulo: 'Encuentro: por tipo de mensaje y tipo de contenido', ayuda: 'Una instrucción para cada medio (reel, carrusel, historia, imagen, WhatsApp, DM, email), según sea orgánico o pagado. Se suma a la instrucción del formato.', claves: Object.keys(NOMBRES_PROMPT).filter(k => k.startsWith('fmt_')) }
];
const ETIQUETAS_FICHA = { fase1: 'Ficha 1', fase2: 'Ficha 2', fase3: 'Ficha 3', fase4: 'Ficha 4 (SDV)' };

let cfg = null;      // configuración efectiva en pantalla
let porDefecto = null;

const MAX_MENSAJES_FLUJO = 30;
const MAX_FLUJOS = 12;
const ETAPAS_FLUJO = { encuentro: 'Encuentro: antes de la SDV', venta: 'Venta: después de la SDV' };
// dia relativo a la SDV: -7 = 7 días antes, 0 = el día de la sesión, 1 = 1 día después
const cuandoDeDia = (dia) => (dia < 0 ? 'antes' : dia > 0 ? 'despues' : 'mismo');
const resumenFlujo = (f) => {
  const dias = f.mensajes.map(m => m.dia);
  const desde = Math.min(...dias), hasta = Math.max(...dias);
  return `${f.mensajes.length} ${f.mensajes.length === 1 ? 'mensaje' : 'mensajes'} en ${hasta - desde + 1} ${hasta - desde === 0 ? 'día' : 'días'}`;
};
const HORA_FLUJO_OK = /^(\d{1,2}:\d{2}|[+-]\d{1,3}[hm])$/i;

const NOMBRES_DESTINO_REC = { dm: 'conversación por DM', whatsapp: 'WhatsApp', pagina: 'página de venta' };
// Texto de grupo de una receta: «Encuentro · orgánico», «Venta · orgánico · WhatsApp», «Venta · pagado · página de venta».
function etiquetaGrupoReceta(r) {
  const etapa = r.etapa === 'venta' ? 'Venta' : r.etapa === 'open' ? 'OPEN · Encuentro (comunidad)' : 'Encuentro';
  return [etapa, r.tipo === 'pagado' ? 'pagado' : 'orgánico', r.destino ? NOMBRES_DESTINO_REC[r.destino] || r.destino : ''].filter(Boolean).join(' · ');
}

function opcionesFase(sel) {
  return [1, 2, 3, 4].map(n => `<option value="${n}" ${Number(sel) === n ? 'selected' : ''}>Fase ${n}</option>`).join('');
}

function pintar() {
  const el = cuerpo();
  if (!el) return;
  const base = cfg.base;
  el.innerHTML = `
    <p class="text-soft mb-16" style="font-size:13px;">Todo lo que ves aquí lo puedes cambiar. Los cambios valen desde la próxima vez que un alumno use el Laboratorio.</p>

    <div class="labcfg-sub" style="margin-top:0;">General</div>
    <div class="labcfg-bloque">
      <div class="field" style="max-width:260px; margin:0;"><label>Generaciones por día por alumno</label>
        <input type="number" min="1" max="100" data-lc="limiteDia" value="${esc(cfg.limiteDia)}"></div>
    </div>

    <div class="labcfg-sub">Fichas (las preguntas que responde el alumno)</div>
    ${base.secciones.map(s => {
      const p = cfg.preguntas[s];
      return `
      <div class="labcfg-bloque" data-sec="${s}">
        <div class="labcfg-fila">
          <div class="field" style="margin:0;"><label>${ETIQUETAS_FICHA[s]}: título</label><input type="text" data-f="titulo" value="${esc(p.titulo)}" maxlength="80"></div>
          <div class="field" style="margin:0;"><label>Se activa desde</label><select data-f="desdeFase">${opcionesFase(p.desdeFase)}</select></div>
          <span></span>
        </div>
        <div class="field"><label>Descripción (la ve el alumno)</label><input type="text" data-f="descripcion" value="${esc(p.descripcion)}" maxlength="300"></div>
        <label style="font-size:12.5px; font-weight:600;">Preguntas</label>
        ${p.items.map((i, n) => `
          <div class="labcfg-fila" data-i="${n}" data-id="${esc(i.id)}" ${i.tipo ? `data-tipo="${esc(i.tipo)}"` : ''}>
            <input type="text" data-f="pregunta" placeholder="Pregunta" value="${esc(i.pregunta)}" maxlength="300">
            <input type="text" data-f="ayuda" placeholder="Ayuda (opcional)" value="${esc(i.ayuda)}" maxlength="300">
            <span style="display:flex; gap:4px; align-items:center; white-space:nowrap;">
              <label style="font-size:12px; display:flex; gap:3px; align-items:center;"><input type="checkbox" data-f="opcional" ${i.opcional ? 'checked' : ''}> opcional</label>
              <button type="button" class="btn btn--ghost labcfg-mini" data-act="up" title="Subir">↑</button>
              <button type="button" class="btn btn--ghost labcfg-mini" data-act="down" title="Bajar">↓</button>
              ${i.tipo ? `<span class="text-soft" style="font-size:11px;" title="Esta pregunta se pide con selector de ${i.tipo === 'fecha' ? 'fecha' : 'hora'} y alimenta los flujos de mensajes: no se puede quitar.">${i.tipo === 'fecha' ? '📅 fecha' : '🕒 hora'}</span>` : '<button type="button" class="btn btn--ghost labcfg-mini" data-act="del" title="Quitar">✕</button>'}
            </span>
          </div>`).join('')}
        <button type="button" class="btn btn--ghost labcfg-mini" data-act="add" data-sec="${s}">+ Agregar pregunta</button>
      </div>`;
    }).join('')}

    <div class="labcfg-sub">Etapas del funnel</div>
    ${base.etapas.map(id => {
      const e = cfg.etapas[id];
      return `
      <div class="labcfg-bloque" data-et="${id}">
        <div class="labcfg-fila">
          <div class="field" style="margin:0;"><label>Nombre</label><input type="text" data-f="nombre" value="${esc(e.nombre)}" maxlength="40"></div>
          <div class="field" style="margin:0;"><label>Se activa desde</label><select data-f="desdeFase">${opcionesFase(e.desdeFase)}</select></div>
          <label style="font-size:13px; display:flex; gap:5px; align-items:center; margin-top:22px;"><input type="checkbox" data-f="activa" ${e.activa ? 'checked' : ''}> Activa</label>
        </div>
        <div class="field"><label>Descripción (la ve el alumno)</label><input type="text" data-f="descripcion" value="${esc(e.descripcion)}" maxlength="300"></div>
        <label style="font-size:12.5px; font-weight:600;">Formatos que genera</label>
        <div class="labcfg-checks">${base.formatos.map(f => `<label><input type="checkbox" data-f="formato" value="${f}" ${e.formatos.includes(f) ? 'checked' : ''}> ${esc(cfg.formatos[f].nombre)}</label>`).join('')}</div>
        <label style="font-size:12.5px; font-weight:600;">Fichas que debe tener aprobadas</label>
        <div class="labcfg-checks">${base.secciones.map(s => `<label><input type="checkbox" data-f="ficha" value="${s}" ${e.requiereFichas.includes(s) ? 'checked' : ''}> ${esc(cfg.preguntas[s].titulo)}</label>`).join('')}</div>
        <div class="field"><label>Objetivo de la etapa (instrucción para la IA)</label><textarea data-f="objetivo" rows="3" maxlength="1500">${esc(e.objetivo)}</textarea></div>
      </div>`;
    }).join('')}

    <div class="labcfg-sub">Formatos</div>
    ${base.formatos.map(id => {
      const f = cfg.formatos[id];
      return `
      <div class="labcfg-bloque" data-fo="${id}">
        <div class="labcfg-fila">
          <div class="field" style="margin:0;"><label>Nombre</label><input type="text" data-f="nombre" value="${esc(f.nombre)}" maxlength="40"></div>
          <div class="field" style="margin:0;"><label>Propuestas por clic (1 a 6)</label><input type="number" min="1" max="6" data-f="cantidad" value="${esc(f.cantidad)}"></div>
          <span></span>
        </div>
        <div class="field"><label>Estructura de cada propuesta (secciones separadas por «;», en orden)</label><input type="text" data-f="estructura" value="${esc(f.estructura)}" maxlength="600"></div>
        <div class="field"><label>Instrucción para la IA</label><textarea data-f="instruccion" rows="3" maxlength="1500">${esc(f.instruccion)}</textarea></div>
      </div>`;
    }).join('')}

    <div class="labcfg-sub">Flujos de mensajes para el grupo (antes y después de la SDV)</div>
    <p class="text-soft" style="font-size:12.5px; margin:0 0 8px;">Define tú la estructura: cuántos mensajes, en qué día y con qué objetivo. Los flujos de Encuentro se envían <strong>antes</strong> de la SDV y los de Venta <strong>después</strong>. El día es relativo a la SDV: «antes» o «después» más la cantidad de días, o «el mismo día». La hora puede ser fija (19:00) o relativa a la hora de inicio de la SDV (-2h = 2 horas antes, -15m, +2h = 2 horas después); si la dejas vacía, se usa la hora de la SDV. Máximo ${MAX_MENSAJES_FLUJO} mensajes por flujo.</p>
    ${Object.entries(cfg.flujos || {}).map(([id, f]) => `
      <div class="labcfg-bloque" data-fl="${esc(id)}">
        <div class="labcfg-fila">
          <div class="field" style="margin:0;"><label>Nombre del flujo</label><input type="text" data-f="nombre" value="${esc(f.nombre)}" maxlength="60"></div>
          <div class="field" style="margin:0;"><label>Etapa</label><select data-f="etapa">${Object.entries(ETAPAS_FLUJO).map(([k, n]) => `<option value="${k}" ${f.etapa === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
          <label style="font-size:13px; display:flex; gap:5px; align-items:center; margin-top:22px;"><input type="checkbox" data-f="activa" ${f.activa ? 'checked' : ''}> Activo</label>
        </div>
        <div class="field"><label>Directrices técnicas y objetivos de este flujo (se suman a las generales de la etapa)</label><textarea data-f="directrices" rows="3" maxlength="1500">${esc(f.directrices)}</textarea></div>
        <label style="font-size:12.5px; font-weight:600;">Mensajes (en el orden en que se envían) · ${esc(resumenFlujo(f))}</label>
        ${f.mensajes.map((m, n) => `
          <div class="labcfg-pieza" data-m="${n}">
            <div class="labcfg-fila">
              <select data-f="cuando"><option value="antes" ${cuandoDeDia(m.dia) === 'antes' ? 'selected' : ''}>Días antes de la SDV</option><option value="mismo" ${cuandoDeDia(m.dia) === 'mismo' ? 'selected' : ''}>El mismo día de la SDV</option><option value="despues" ${cuandoDeDia(m.dia) === 'despues' ? 'selected' : ''}>Días después de la SDV</option></select>
              <span style="display:flex; gap:6px; align-items:center;"><input type="number" min="1" max="60" data-f="dias" value="${esc(Math.abs(m.dia) || 1)}" style="max-width:80px;" ${m.dia === 0 ? 'disabled' : ''}> <input type="text" data-f="hora" placeholder="Hora: 19:00 o -2h" value="${esc(m.hora || '')}" maxlength="8" style="max-width:150px;"></span>
              <span style="display:flex; gap:4px; align-items:center; white-space:nowrap;">
                <button type="button" class="btn btn--ghost labcfg-mini" data-act="fl-up" data-fl="${esc(id)}" data-n="${n}" title="Subir">↑</button>
                <button type="button" class="btn btn--ghost labcfg-mini" data-act="fl-down" data-fl="${esc(id)}" data-n="${n}" title="Bajar">↓</button>
                <button type="button" class="btn btn--ghost labcfg-mini" data-act="fl-del-m" data-fl="${esc(id)}" data-n="${n}" title="Quitar">✕</button>
              </span>
            </div>
            <div class="labcfg-fila">
              <input type="text" data-f="objetivo" placeholder="Objetivo de este mensaje (obligatorio)" value="${esc(m.objetivo)}" maxlength="300">
              <input type="text" data-f="nota" placeholder="Indicación extra para la IA (opcional)" value="${esc(m.nota || '')}" maxlength="600">
              <span></span>
            </div>
          </div>`).join('')}
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="btn btn--ghost labcfg-mini" data-act="fl-add-m" data-fl="${esc(id)}">+ Agregar mensaje</button>
          <button type="button" class="btn btn--ghost labcfg-mini" data-act="fl-dup" data-fl="${esc(id)}">Duplicar flujo</button>
          <button type="button" class="btn btn--ghost labcfg-mini" data-act="fl-borrar" data-fl="${esc(id)}" style="color:#C0392B;">Borrar flujo</button>
        </div>
      </div>`).join('') || '<p class="text-soft">Aún no hay flujos. Crea el primero con los botones de abajo.</p>'}
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
      <button type="button" class="btn btn--ghost labcfg-mini" data-act="fl-nuevo" data-etapa="encuentro">+ Nuevo flujo de Encuentro (antes de la SDV)</button>
      <button type="button" class="btn btn--ghost labcfg-mini" data-act="fl-nuevo" data-etapa="venta">+ Nuevo flujo de Venta (después de la SDV)</button>
    </div>

    <div class="labcfg-sub">Programa OPEN: ideas de contenido para el grupo de WhatsApp</div>
    <p class="text-soft" style="font-size:12.5px; margin:0 0 8px;">En OPEN, el alumno tiene un botón «Ideas para tu grupo»: elige un tipo de idea (o mezclado: 1 de cada tipo) y el formato (textos, videos, audios o variados; las encuestas no lo llevan). Aquí defines cuántas ideas se crean por clic cuando elige un solo tipo (0 apaga ese tipo) y cómo debe escribirlas la IA. Los videos y audios traen guion y un texto corto; nunca llevan hashtags. Los enlaces, días y horas salen como marcas ([LINK DEL RECURSO], [DÍA]…) para que el alumno las complete. Admiten {palabra}, {grupo} y {puente}.</p>
    ${Object.entries(cfg.ideas || {}).map(([id, i]) => `
      <div class="labcfg-bloque" data-id-idea="${esc(id)}">
        <div class="labcfg-fila">
          <div class="field" style="margin:0;"><label>Nombre</label><input type="text" data-f="nombre" value="${esc(i.nombre)}" maxlength="40"></div>
          <div class="field" style="margin:0;"><label>Ideas por clic (0 a 6)</label><input type="number" min="0" max="6" data-f="cantidad" value="${esc(i.cantidad)}"></div>
          <span></span>
        </div>
        <div class="field"><label>Cómo debe escribirlas la IA</label><textarea data-f="instruccion" rows="3" maxlength="800">${esc(i.instruccion)}</textarea></div>
      </div>`).join('')}

    <div class="labcfg-sub">Opciones de generación de Encuentro, Venta y OPEN (qué se genera según el contenido que elige el alumno)</div>
    ${Object.entries(cfg.recetas || {}).map(([id, r], idx, todas) => `
      ${(idx === 0 || etiquetaGrupoReceta(todas[idx - 1][1]) !== etiquetaGrupoReceta(r)) ? `<div class="labcfg-sub" style="font-size:13.5px;">${esc(etiquetaGrupoReceta(r))}</div>` : ''}
      <div class="labcfg-bloque" data-re="${id}">
        <div class="labcfg-fila">
          <div class="field" style="margin:0;"><label>Nombre (lo ve el alumno)</label><input type="text" data-f="nombre" value="${esc(r.nombre)}" maxlength="60"></div>
          <div class="field" style="margin:0;"><label>Etapa y tipo</label><input type="text" value="${esc(etiquetaGrupoReceta(r))}" disabled></div>
          <label style="font-size:13px; display:flex; gap:5px; align-items:center; margin-top:22px;"><input type="checkbox" data-f="activa" ${r.activa ? 'checked' : ''}> Activa</label>
        </div>
        <div class="field"><label>Descripción (la ve el alumno)</label><input type="text" data-f="descripcion" value="${esc(r.descripcion)}" maxlength="200"></div>
        <label style="font-size:13px; display:flex; gap:5px; align-items:center;"><input type="checkbox" data-f="preguntaWsp" ${r.preguntaWsp ? 'checked' : ''}> Antes de generar, preguntar si el WhatsApp es para grupos o privado</label>
        <label style="font-size:12.5px; font-weight:600;">Qué se genera (formato y cantidad en total; se reparte entre los ángulos que elija el alumno)</label>
        ${r.piezas.map((p, n) => `
          <div class="labcfg-pieza" data-p="${n}" ${p.sinAngulo ? 'data-sin-angulo="1"' : ''}>
            <div class="labcfg-fila">
              <select data-f="formato">${base.formatos.map(fo => `<option value="${fo}" ${p.formato === fo ? 'selected' : ''}>${esc(cfg.formatos[fo].nombre)}</option>`).join('')}</select>
              <input type="number" min="1" max="12" data-f="cantidad" value="${esc(p.cantidad)}">
              <span><button type="button" class="btn btn--ghost labcfg-mini" data-act="re-del" data-re="${id}" data-n="${n}" title="Quitar">✕</button></span>
            </div>
            <div class="labcfg-fila">
              <input type="text" data-f="etiqueta" placeholder="A quién va (opcional), ej: A toda tu lista" value="${esc(p.etiqueta || '')}" maxlength="80">
              <input type="text" data-f="nota" placeholder="Instrucción extra para la IA (opcional). Admite {palabra}, {link} y {fecha}" value="${esc(p.nota || '')}" maxlength="600">
              <label style="font-size:12px; display:flex; gap:3px; align-items:center; white-space:nowrap;"><input type="checkbox" data-f="secuencia" ${p.secuencia ? 'checked' : ''}> en secuencia</label>
            </div>
          </div>`).join('')}
        <button type="button" class="btn btn--ghost labcfg-mini" data-act="re-add" data-re="${id}">+ Agregar formato</button>
      </div>`).join('')}

    <div class="labcfg-sub">Ver la instrucción completa que recibe la IA</div>
    <div class="labcfg-bloque">
      <p class="text-soft" style="font-size:12.5px; margin:0 0 8px;">Elige una situación y mira EXACTAMENTE el texto que recibe la IA, armado con todas tus instrucciones (con datos de ejemplo de una persona). Sirve para comprobar que tu explicación llegó bien. Muestra lo que ya está guardado: si cambiaste algo, pulsa antes «Guardar cambios».</p>
      <div class="labcfg-fila">
        <div class="field" style="margin:0;"><label>Programa</label><select id="labcfg-vp-programa"><option value="">BEGIN, Next y eXIT</option><option value="open">OPEN</option></select></div>
        <div class="field" style="margin:0;"><label>Etapa</label><select id="labcfg-vp-etapa">${base.etapas.map(id => `<option value="${id}" ${id === 'encuentro' ? 'selected' : ''}>${esc(cfg.etapas[id].nombre)}</option>`).join('')}</select></div>
        <div class="field" style="margin:0;"><label>Tipo de mensaje</label><select id="labcfg-vp-formato">${base.formatos.map(f => `<option value="${f}">${esc(cfg.formatos[f].nombre)}</option>`).join('')}</select></div>
        <span></span>
      </div>
      <div class="labcfg-fila" style="margin-top:8px;">
        <div class="field" style="margin:0;"><label>Contenido (solo Encuentro)</label><select id="labcfg-vp-tipo"><option value="organico">Orgánico</option><option value="pagado">Pagado</option></select></div>
        <div class="field" style="margin:0;"><label>Técnica (solo Encuentro, sin OPEN)</label><select id="labcfg-vp-tecnica"><option value="web">SDV con Registro WEB y luego a Grupo</option><option value="puente">SDV con Página Puente y luego a Grupo</option><option value="directo">SDV Directo a Grupo</option></select></div>
        <div class="field" style="margin:0;"><label>Formato de las ideas (solo OPEN)</label><select id="labcfg-vp-medio"><option value="variado">Formatos variados</option><option value="texto">Textos</option><option value="video">Videos</option><option value="audio">Audios</option></select></div>
        <div class="field" style="margin:0;"><label>Cómo llegan al grupo (solo OPEN pagado)</label><select id="labcfg-vp-destino"><option value="grupo">Directo al grupo</option><option value="puente">A través de una página puente</option></select></div>
        <span></span>
      </div>
      <button type="button" class="btn btn--ghost labcfg-mini" id="labcfg-vp-ver" style="margin-top:8px;">Ver la instrucción completa</button>
      <p class="text-soft hidden" id="labcfg-vp-estado" style="font-size:12.5px;"></p>
      <textarea id="labcfg-vp-salida" class="hidden" rows="22" readonly style="margin-top:8px; font-size:12.5px;"></textarea>
    </div>

    <div class="labcfg-sub">Instrucciones de la IA (todas editables)</div>
    <p class="text-soft" style="font-size:12.5px; margin:0 0 8px;">Aquí le explicas a la IA cada cosa. Van de lo más general a lo más específico y se suman entre sí. Las de Encuentro admiten {palabra}, {link} y {fecha}: la app los reemplaza con lo que cada alumno definió en su estrategia. Lo único que no se puede cambiar es la forma técnica de la respuesta (para que la pantalla no se rompa).</p>
    ${GRUPOS_PROMPT.map(g => {
      const claves = g.claves.filter(k => cfg.prompts[k] !== undefined);
      if (!claves.length) return '';
      return `
      <div class="labcfg-sub" style="font-size:13.5px;">${esc(g.titulo)}</div>
      <p class="text-soft" style="font-size:12.5px; margin:0 0 6px;">${esc(g.ayuda)}</p>
      ${claves.map(k => `
      <div class="labcfg-bloque">
        <label style="font-size:13px; font-weight:700;">${esc(NOMBRES_PROMPT[k][0])}</label>
        <p class="text-soft" style="font-size:12.5px; margin:2px 0 6px;">${esc(NOMBRES_PROMPT[k][1])}</p>
        <textarea data-prompt="${k}" rows="${k === 'sistema' ? 12 : k.startsWith('fmt_') ? 4 : 6}" maxlength="8000">${esc(cfg.prompts[k])}</textarea>
        <button type="button" class="btn btn--ghost labcfg-mini" data-act="restaurar-prompt" data-k="${k}" style="margin-top:6px;">Restaurar el original</button>
      </div>`).join('')}`;
    }).join('')}

    <p id="labcfg-error" class="hidden" style="color:#C0392B; font-size:13px;"></p>
    <div class="labcfg-acciones">
      <button type="button" class="btn btn--primary" id="labcfg-guardar">Guardar cambios</button>
      <button type="button" class="btn btn--ghost" id="labcfg-restaurar-todo">Restaurar todo a lo original</button>
    </div>`;
  conectar(el);
}

/* Lee lo que hay en pantalla y lo deja en `cfg` */
function leer() {
  const el = cuerpo();
  cfg.limiteDia = Number(el.querySelector('[data-lc="limiteDia"]').value) || cfg.limiteDia;
  el.querySelectorAll('[data-sec]').forEach(bloque => {
    if (!bloque.matches('.labcfg-bloque')) return;
    const p = cfg.preguntas[bloque.dataset.sec];
    p.titulo = bloque.querySelector('[data-f="titulo"]').value.trim();
    p.descripcion = bloque.querySelector('[data-f="descripcion"]').value.trim();
    p.desdeFase = Number(bloque.querySelector('[data-f="desdeFase"]').value);
    p.items = [...bloque.querySelectorAll('.labcfg-fila[data-i]')].map(fila => ({
      id: fila.dataset.id,
      ...(fila.dataset.tipo ? { tipo: fila.dataset.tipo } : {}),
      pregunta: fila.querySelector('[data-f="pregunta"]').value.trim(),
      ayuda: fila.querySelector('[data-f="ayuda"]').value.trim(),
      opcional: fila.querySelector('[data-f="opcional"]').checked
    }));
  });
  el.querySelectorAll('[data-et]').forEach(bloque => {
    const e = cfg.etapas[bloque.dataset.et];
    e.nombre = bloque.querySelector('[data-f="nombre"]').value.trim();
    e.descripcion = bloque.querySelector('[data-f="descripcion"]').value.trim();
    e.desdeFase = Number(bloque.querySelector('[data-f="desdeFase"]').value);
    e.activa = bloque.querySelector('[data-f="activa"]').checked;
    e.formatos = [...bloque.querySelectorAll('[data-f="formato"]:checked')].map(c => c.value);
    e.requiereFichas = [...bloque.querySelectorAll('[data-f="ficha"]:checked')].map(c => c.value);
    e.objetivo = bloque.querySelector('[data-f="objetivo"]').value.trim();
  });
  el.querySelectorAll('[data-fo]').forEach(bloque => {
    const f = cfg.formatos[bloque.dataset.fo];
    f.nombre = bloque.querySelector('[data-f="nombre"]').value.trim();
    f.cantidad = Number(bloque.querySelector('[data-f="cantidad"]').value) || f.cantidad;
    f.estructura = bloque.querySelector('[data-f="estructura"]').value.trim();
    f.instruccion = bloque.querySelector('[data-f="instruccion"]').value.trim();
  });
  el.querySelectorAll('[data-id-idea]').forEach(bloque => {
    const i = (cfg.ideas || {})[bloque.dataset.idIdea];
    if (!i) return;
    i.nombre = bloque.querySelector('[data-f="nombre"]').value.trim();
    const c = Math.round(Number(bloque.querySelector('[data-f="cantidad"]').value));
    i.cantidad = Number.isFinite(c) ? c : i.cantidad;
    i.instruccion = bloque.querySelector('[data-f="instruccion"]').value.trim();
  });
  el.querySelectorAll('[data-re]').forEach(bloque => {
    if (!bloque.matches('.labcfg-bloque')) return;
    const r = (cfg.recetas || {})[bloque.dataset.re];
    if (!r) return;
    r.nombre = bloque.querySelector('[data-f="nombre"]').value.trim();
    r.descripcion = bloque.querySelector('[data-f="descripcion"]').value.trim();
    r.activa = bloque.querySelector('[data-f="activa"]').checked;
    r.preguntaWsp = bloque.querySelector('[data-f="preguntaWsp"]').checked;
    r.piezas = [...bloque.querySelectorAll('.labcfg-pieza[data-p]')].map(fila => {
      const etiqueta = fila.querySelector('[data-f="etiqueta"]').value.trim();
      const nota = fila.querySelector('[data-f="nota"]').value.trim();
      return {
        formato: fila.querySelector('[data-f="formato"]').value,
        cantidad: Math.round(Number(fila.querySelector('[data-f="cantidad"]').value)) || 1,
        ...(etiqueta ? { etiqueta } : {}),
        ...(nota ? { nota } : {}),
        ...(fila.querySelector('[data-f="secuencia"]').checked ? { secuencia: true } : {}),
        ...(fila.dataset.sinAngulo === '1' ? { sinAngulo: true } : {})
      };
    });
  });
  el.querySelectorAll('[data-fl]').forEach(bloque => {
    if (!bloque.matches('.labcfg-bloque')) return;
    const fl = (cfg.flujos || {})[bloque.dataset.fl];
    if (!fl) return;
    fl.nombre = bloque.querySelector('[data-f="nombre"]').value.trim();
    fl.etapa = bloque.querySelector('[data-f="etapa"]').value;
    fl.activa = bloque.querySelector('[data-f="activa"]').checked;
    fl.directrices = bloque.querySelector('[data-f="directrices"]').value.trim();
    fl.mensajes = [...bloque.querySelectorAll('.labcfg-pieza[data-m]')].map(fila => {
      const cuando = fila.querySelector('[data-f="cuando"]').value;
      const n = Math.max(1, Math.min(60, Math.round(Number(fila.querySelector('[data-f="dias"]').value)) || 1));
      const nota = fila.querySelector('[data-f="nota"]').value.trim();
      return {
        dia: cuando === 'antes' ? -n : cuando === 'despues' ? n : 0,
        hora: fila.querySelector('[data-f="hora"]').value.trim(),
        objetivo: fila.querySelector('[data-f="objetivo"]').value.trim(),
        ...(nota ? { nota } : {})
      };
    });
  });
  el.querySelectorAll('[data-prompt]').forEach(t => { cfg.prompts[t.dataset.prompt] = t.value; });
}

function mostrarError(texto) {
  const e = document.getElementById('labcfg-error');
  e.textContent = texto;
  e.classList.remove('hidden');
}

function validar() {
  for (const s of cfg.base.secciones) {
    const p = cfg.preguntas[s];
    if (!p.titulo) return `La ${ETIQUETAS_FICHA[s]} necesita un título.`;
    if (!p.items.length || p.items.some(i => !i.pregunta)) return `Revisa las preguntas de la ${ETIQUETAS_FICHA[s]}: no pueden quedar vacías ni sin preguntas.`;
  }
  for (const id of cfg.base.etapas) {
    const e = cfg.etapas[id];
    if (!e.nombre) return 'Cada etapa necesita un nombre.';
    if (!e.formatos.length) return `La etapa «${e.nombre}» necesita al menos un formato.`;
  }
  for (const id of cfg.base.formatos) {
    const f = cfg.formatos[id];
    if (!f.nombre || !f.estructura) return 'Cada formato necesita nombre y estructura.';
    if (!(f.cantidad >= 1 && f.cantidad <= 6)) return `Las propuestas de «${f.nombre}» deben ser entre 1 y 6.`;
  }
  for (const i of Object.values(cfg.ideas || {})) {
    if (!i.nombre) return 'Cada tipo de idea para el grupo necesita un nombre.';
    if (!(i.cantidad >= 0 && i.cantidad <= 6)) return `Las ideas de «${i.nombre}» deben ser entre 0 y 6.`;
  }
  for (const r of Object.values(cfg.recetas || {})) {
    if (!r.nombre) return 'Cada receta necesita un nombre.';
    if (!r.piezas.length) return `La receta «${r.nombre}» necesita al menos un formato.`;
    if (r.piezas.some(p => !(p.cantidad >= 1 && p.cantidad <= 12))) return `Las cantidades de la receta «${r.nombre}» deben ser entre 1 y 12.`;
  }
  for (const fl of Object.values(cfg.flujos || {})) {
    if (!fl.nombre) return 'Cada flujo de mensajes necesita un nombre.';
    if (!fl.mensajes.length) return `El flujo «${fl.nombre}» necesita al menos un mensaje.`;
    if (fl.mensajes.length > MAX_MENSAJES_FLUJO) return `El flujo «${fl.nombre}» tiene más de ${MAX_MENSAJES_FLUJO} mensajes.`;
    if (fl.mensajes.some(m => !m.objetivo)) return `Todos los mensajes del flujo «${fl.nombre}» necesitan un objetivo.`;
    if (fl.mensajes.some(m => m.hora && !HORA_FLUJO_OK.test(m.hora))) return `Revisa las horas del flujo «${fl.nombre}»: usa 19:00 o una hora relativa como -2h, -15m o +2h.`;
  }
  if (!(cfg.limiteDia >= 1 && cfg.limiteDia <= 100)) return 'El tope diario debe estar entre 1 y 100.';
  if (!cfg.prompts.sistema.trim()) return 'La personalidad general de la IA no puede quedar vacía (usa «Restaurar el original»).';
  return '';
}

let delegadoListo = false;

function conectar(el) {
  // El clic delegado se registra una sola vez (el contenido se repinta, el contenedor no).
  if (!delegadoListo) {
    delegadoListo = true;
    el.addEventListener('click', alHacerClic);
    // Flujos: «El mismo día» no lleva cantidad de días.
    el.addEventListener('change', (ev) => {
      if (!ev.target.matches('[data-f="cuando"]')) return;
      const dias = ev.target.closest('.labcfg-pieza').querySelector('[data-f="dias"]');
      if (dias) dias.disabled = ev.target.value === 'mismo';
    });
  }
  conectarBotones();
}

async function alHacerClic(ev) {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'restaurar-prompt') {
      leer();
      cfg.prompts[b.dataset.k] = porDefecto.prompts[b.dataset.k];
      pintar();
      return;
    }
    if (act.startsWith('fl-')) {
      leer();
      const flujos = cfg.flujos = cfg.flujos || {};
      const id = b.dataset.fl;
      const fl = flujos[id];
      if (act === 'fl-nuevo') {
        if (Object.keys(flujos).length >= MAX_FLUJOS) { alert(`Puedes tener hasta ${MAX_FLUJOS} flujos.`); return; }
        flujos['flujo_' + Date.now().toString(36)] = { nombre: 'Nuevo flujo', etapa: b.dataset.etapa === 'venta' ? 'venta' : 'encuentro', activa: true, directrices: '', mensajes: [{ dia: b.dataset.etapa === 'venta' ? 1 : -1, hora: '10:00', objetivo: '' }] };
      } else if (fl && act === 'fl-add-m') {
        if (fl.mensajes.length >= MAX_MENSAJES_FLUJO) { alert(`Un flujo puede tener hasta ${MAX_MENSAJES_FLUJO} mensajes.`); return; }
        const ult = fl.mensajes[fl.mensajes.length - 1];
        fl.mensajes.push({ dia: ult ? ult.dia : 0, hora: ult ? ult.hora : '', objetivo: '' });
      } else if (fl && act === 'fl-del-m') {
        if (fl.mensajes.length > 1) fl.mensajes.splice(Number(b.dataset.n), 1);
      } else if (fl && (act === 'fl-up' || act === 'fl-down')) {
        const n = Number(b.dataset.n);
        const k = act === 'fl-up' ? n - 1 : n + 1;
        if (k >= 0 && k < fl.mensajes.length) [fl.mensajes[n], fl.mensajes[k]] = [fl.mensajes[k], fl.mensajes[n]];
      } else if (fl && act === 'fl-dup') {
        if (Object.keys(flujos).length >= MAX_FLUJOS) { alert(`Puedes tener hasta ${MAX_FLUJOS} flujos.`); return; }
        flujos['flujo_' + Date.now().toString(36)] = { ...JSON.parse(JSON.stringify(fl)), nombre: `${fl.nombre} (copia)` };
      } else if (fl && act === 'fl-borrar') {
        if (!confirm(`¿Borrar el flujo «${fl.nombre}»? Los mensajes ya generados de los alumnos no se tocan.`)) return;
        delete flujos[id];
      }
      pintar();
      return;
    }
    if (act === 're-add' || act === 're-del') {
      leer();
      const r = (cfg.recetas || {})[b.dataset.re];
      if (!r) return;
      if (act === 're-add') r.piezas.push({ formato: cfg.base.formatos[0], cantidad: 1 });
      else if (r.piezas.length > 1) r.piezas.splice(Number(b.dataset.n), 1);
      pintar();
      return;
    }
    if (act === 'add') {
      leer();
      cfg.preguntas[b.dataset.sec].items.push({ id: 'p' + Date.now().toString(36), pregunta: '', ayuda: '', opcional: false });
      pintar();
      return;
    }
    const fila = b.closest('.labcfg-fila[data-i]');
    if (!fila) return;
    leer();
    const sec = b.closest('[data-sec]').dataset.sec;
    const items = cfg.preguntas[sec].items;
    const n = Number(fila.dataset.i);
    if (act === 'del') {
      if (items.length <= 1) return;
      items.splice(n, 1);
    } else if (act === 'up' && n > 0) {
      [items[n - 1], items[n]] = [items[n], items[n - 1]];
    } else if (act === 'down' && n < items.length - 1) {
      [items[n + 1], items[n]] = [items[n], items[n + 1]];
    }
    pintar();
}

function conectarBotones() {
  document.getElementById('labcfg-guardar').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    leer();
    const problema = validar();
    if (problema) { mostrarError(problema); return; }
    document.getElementById('labcfg-error').classList.add('hidden');
    btn.disabled = true;
    try {
      const guardarConfig = {
        limiteDia: cfg.limiteDia,
        preguntas: cfg.preguntas,
        etapas: cfg.etapas,
        formatos: cfg.formatos,
        recetas: cfg.recetas || {},
        flujos: cfg.flujos || {},
        ideas: cfg.ideas || {},
        flujosGuardados: true
      };
      const prompts = {};
      Object.keys(NOMBRES_PROMPT).forEach(k => {
        if (cfg.prompts[k] === undefined || porDefecto.prompts[k] === undefined) return;
        if (cfg.prompts[k].trim() !== porDefecto.prompts[k].trim()) prompts[k] = cfg.prompts[k].trim();   // vacío también se guarda: borrar una instrucción es válido
      });
      await set(ref(db, 'laboratorioIA/config'), guardarConfig);
      await set(ref(db, 'laboratorioIA/prompts'), Object.keys(prompts).length ? prompts : null);
      btn.textContent = 'Guardado ✓';
      setTimeout(() => { btn.textContent = 'Guardar cambios'; }, 2000);
    } catch (err) {
      console.error('No se pudo guardar la configuración del Laboratorio:', err);
      mostrarError('No se pudo guardar. Revisa que las reglas de Firebase estén publicadas e intenta de nuevo.');
    } finally {
      btn.disabled = false;
    }
  });

  // Programa OPEN: el selector de tipo de mensaje suma las ideas para el grupo (y se fuerza la etapa Encuentro).
  const selPrograma = document.getElementById('labcfg-vp-programa');
  if (selPrograma) selPrograma.addEventListener('change', () => {
    const sf = document.getElementById('labcfg-vp-formato');
    sf.querySelectorAll('option[data-idea]').forEach(o => o.remove());
    if (selPrograma.value === 'open') {
      Object.entries(cfg.ideas || {}).forEach(([id, i]) => sf.insertAdjacentHTML('beforeend', `<option value="idea:${esc(id)}" data-idea="1">Idea para el grupo: ${esc(i.nombre)}</option>`));
      document.getElementById('labcfg-vp-etapa').value = 'encuentro';
    }
  });

  // Ver la instrucción completa que recibe la IA en una situación (lo ya guardado).
  const verPrompt = document.getElementById('labcfg-vp-ver');
  if (verPrompt) verPrompt.addEventListener('click', async () => {
    const estado = document.getElementById('labcfg-vp-estado');
    const salida = document.getElementById('labcfg-vp-salida');
    estado.textContent = 'Armando la instrucción…';
    estado.classList.remove('hidden');
    salida.classList.add('hidden');
    verPrompt.disabled = true;
    try {
      const q = (id) => document.getElementById(id).value;
      const r = await pedirConfig({ vistaPrompt: { programa: q('labcfg-vp-programa'), etapa: q('labcfg-vp-etapa'), formato: q('labcfg-vp-formato'), tipo: q('labcfg-vp-tipo'), tecnica: q('labcfg-vp-tecnica'), destino: q('labcfg-vp-destino'), medio: q('labcfg-vp-medio') } });
      const v = r.data.vistaPrompt;
      salida.value = `=== INSTRUCCIÓN GENERAL (sistema) ===\n${v.sistema}\n\n=== PEDIDO PARA ESTA SITUACIÓN ===\n${v.pedido}`;
      salida.classList.remove('hidden');
      estado.classList.add('hidden');
    } catch (err) {
      console.error('No se pudo armar la vista:', err);
      estado.textContent = 'No se pudo armar la instrucción. Puede que la función aún no esté publicada.';
    } finally {
      verPrompt.disabled = false;
    }
  });

  document.getElementById('labcfg-restaurar-todo').addEventListener('click', async () => {
    if (!confirm('Se borrarán TODOS tus cambios del Laboratorio IA (preguntas, etapas, formatos y prompts) y se volverá a lo original. Las fichas y contenidos de los alumnos no se tocan. ¿Continuar?')) return;
    try {
      await set(ref(db, 'laboratorioIA/config'), null);
      await set(ref(db, 'laboratorioIA/prompts'), null);
      await cargarConfigLaboratorio();
    } catch (err) {
      console.error('No se pudo restaurar:', err);
      mostrarError('No se pudo restaurar. Intenta de nuevo.');
    }
  });
}

export async function cargarConfigLaboratorio() {
  const el = cuerpo();
  if (!el) return;
  el.innerHTML = '<p class="text-soft">Cargando…</p>';
  try {
    const r = await pedirConfig({});
    cfg = r.data;
    porDefecto = r.data.porDefecto;
    pintar();
  } catch (err) {
    console.error('No se pudo cargar la configuración del Laboratorio:', err);
    el.innerHTML = '<p style="color:#C0392B; font-size:13px;">No se pudo cargar. Puede que la función aún no esté publicada.</p>';
  }
}

document.querySelectorAll('.nav-item[data-nav="configuracion"]').forEach(item => {
  item.addEventListener('click', cargarConfigLaboratorio);
});
