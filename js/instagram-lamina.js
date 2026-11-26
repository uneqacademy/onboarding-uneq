/* ============================================================
   instagram-lamina.js — dibuja las láminas de un carrusel (1080x1350, formato 4:5 de Instagram)
   ============================================================
   La IA escribe el texto; aquí la app lo dibuja en el navegador con la marca de la persona (colores, fuente, @usuario).
   No hay costo de IA ni se sube nada a servicios externos. Las funciones puras (colores y ajuste de texto) no tocan
   el DOM, así que se pueden probar sin navegador (tests/instagram-lamina.test.mjs). */

export const ANCHO = 1080;
export const ALTO = 1350;

export const PLANTILLAS = [
  { id: 'degradado', nombre: 'Degradado' },
  { id: 'claro', nombre: 'Claro' },
  { id: 'oscuro', nombre: 'Oscuro' }
];
export const FUENTES = { sora: 'Sora', inter: 'Inter', serif: 'Georgia' };
export const MARCA_BASE = { color1: '#2f76ff', color2: '#8e0da4', fuente: 'sora', plantilla: 'degradado', usuario: '' };

const MARGEN = 90;
const CAJA = { x: MARGEN, y: 230, ancho: ANCHO - MARGEN * 2, alto: 880 };

/* ---------------- Colores ---------------- */

export function normalizarHex(valor, porDefecto) {
  const s = String(valor || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : porDefecto;
}

function rgb(hex) {
  const h = normalizarHex(hex, '#000000');
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// Luminancia relativa (0 = negro, 1 = blanco), la fórmula de accesibilidad WCAG.
export function luminancia(hex) {
  const [r, g, b] = rgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function mezclar(hexA, hexB, t = 0.5) {
  const a = rgb(hexA), b = rgb(hexB);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

// Contraste entre dos colores (1 a 21, la medida de accesibilidad WCAG). 3 o más sirve para adornos y flechas.
export function contraste(hexA, hexB) {
  const a = luminancia(hexA), b = luminancia(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Devuelve el color aclarado u oscurecido lo justo para que se vea sobre el fondo (contraste mínimo 3).
export function acentoLegible(color, fondo) {
  let c = normalizarHex(color, MARCA_BASE.color1);
  const hacia = luminancia(fondo) < 0.5 ? '#ffffff' : '#000000';
  for (let i = 0; i < 8 && contraste(c, fondo) < 3; i++) c = mezclar(c, hacia, 0.18);
  return c;
}

// Letra clara u oscura según el fondo, para que siempre se lea.
export function colorTextoSobre(hexFondo) {
  return luminancia(hexFondo) > 0.42 ? '#1B2333' : '#FFFFFF';
}

/* ---------------- Texto ---------------- */

// Parte el texto en líneas que caben en anchoMax. `medir(texto)` devuelve el ancho en píxeles. Respeta los saltos de línea.
export function partirLineas(texto, anchoMax, medir) {
  const lineas = [];
  String(texto || '').split(/\r?\n/).forEach(parrafo => {
    const palabras = parrafo.split(/\s+/).filter(Boolean);
    if (!palabras.length) { lineas.push(''); return; }
    let actual = '';
    palabras.forEach(p => {
      const prueba = actual ? `${actual} ${p}` : p;
      if (medir(prueba) <= anchoMax || !actual) actual = prueba;
      else { lineas.push(actual); actual = p; }
    });
    if (actual) lineas.push(actual);
  });
  return lineas;
}

// Busca el tamaño de letra más grande (entre tamMax y tamMin) con el que el texto cabe en la caja.
// `medirCon(tam)` devuelve la función medir para ese tamaño.
export function ajustarTexto({ texto, anchoMax, altoMax, medirCon, tamMax, tamMin, interlineado = 1.22 }) {
  let tam = tamMax, lineas = [];
  for (; tam >= tamMin; tam -= 2) {
    lineas = partirLineas(texto, anchoMax, medirCon(tam));
    if (lineas.length * tam * interlineado <= altoMax) return { tam, lineas, interlineado };
  }
  tam = tamMin;
  lineas = partirLineas(texto, anchoMax, medirCon(tam));
  return { tam, lineas, interlineado };
}

/* ---------------- Dibujo ---------------- */

function paleta(marca, plantilla) {
  const c1 = normalizarHex(marca.color1, MARCA_BASE.color1);
  const c2 = normalizarHex(marca.color2, MARCA_BASE.color2);
  if (plantilla === 'claro') return { fondo: '#F7F7F5', texto: '#1B2333', acento: acentoLegible(c1, '#F7F7F5'), acento2: c2, suave: '#5B6472' };
  if (plantilla === 'oscuro') {
    const fondo = mezclar('#0b0f1f', c1, 0.14);
    return { fondo, texto: '#FFFFFF', acento: acentoLegible(c2, fondo), acento2: c1, suave: '#B8BED0' };
  }
  const medio = mezclar(c1, c2, 0.5);
  const texto = colorTextoSobre(medio);
  return { degradado: [c1, c2], fondo: medio, texto, acento: texto, acento2: texto, suave: texto === '#FFFFFF' ? 'rgba(255,255,255,.78)' : 'rgba(27,35,51,.72)' };
}

function nombreFuente(marca) { return FUENTES[marca.fuente] || FUENTES.sora; }
function ponerFuente(ctx, marca, peso, tam) { ctx.font = `${peso} ${tam}px "${nombreFuente(marca)}", system-ui, sans-serif`; }

/* Dibuja UNA lámina en un contexto 2D de 1080x1350.
   opciones: { texto, n (desde 0), total, marca, plantilla } */
export function dibujarLamina(ctx, { texto, n, total, marca, plantilla }) {
  const m = { ...MARCA_BASE, ...(marca || {}) };
  const p = paleta(m, plantilla || m.plantilla);
  const esPortada = n === 0, esCierre = n === total - 1 && total > 1;

  // Fondo
  if (p.degradado) {
    const g = ctx.createLinearGradient(0, 0, ANCHO, ALTO);
    g.addColorStop(0, p.degradado[0]); g.addColorStop(1, p.degradado[1]);
    ctx.fillStyle = g;
  } else ctx.fillStyle = p.fondo;
  ctx.fillRect(0, 0, ANCHO, ALTO);

  // Adorno: barra de acento arriba a la izquierda
  ctx.fillStyle = p.acento;
  ctx.globalAlpha = p.degradado ? 0.9 : 1;
  ctx.fillRect(MARGEN, 120, esPortada ? 200 : 110, 12);
  ctx.globalAlpha = 1;

  // Contador arriba a la derecha
  ponerFuente(ctx, m, 600, 34);
  ctx.fillStyle = p.suave; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  if (total > 1) ctx.fillText(`${n + 1} / ${total}`, ANCHO - MARGEN, 140);

  // Texto principal, centrado en vertical dentro de la caja
  const peso = esPortada || esCierre ? 700 : 600;
  const tamMax = esPortada ? 100 : esCierre ? 78 : 66;
  const ajuste = ajustarTexto({
    texto, anchoMax: CAJA.ancho, altoMax: CAJA.alto, tamMax, tamMin: 36,
    medirCon: (tam) => { ponerFuente(ctx, m, peso, tam); return (s) => ctx.measureText(s).width; }
  });
  ponerFuente(ctx, m, peso, ajuste.tam);
  ctx.fillStyle = p.texto; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const alto = ajuste.lineas.length * ajuste.tam * ajuste.interlineado;
  let y = CAJA.y + (CAJA.alto - alto) / 2 + ajuste.tam;
  ajuste.lineas.forEach(l => { ctx.fillText(l, CAJA.x, y); y += ajuste.tam * ajuste.interlineado; });

  // Pie: @usuario a la izquierda y flecha para seguir deslizando a la derecha
  const usuario = String(m.usuario || '').replace(/^@+/, '');
  if (usuario) {
    ponerFuente(ctx, m, 600, 38);
    ctx.fillStyle = esCierre ? p.texto : p.suave; ctx.textAlign = 'left';
    ctx.fillText(`@${usuario}`, MARGEN, ALTO - 110);
  }
  if (!esCierre && total > 1) {
    ponerFuente(ctx, m, 700, 54);
    ctx.fillStyle = p.acento; ctx.textAlign = 'right';
    ctx.fillText('→', ANCHO - MARGEN, ALTO - 104);
  }
}
