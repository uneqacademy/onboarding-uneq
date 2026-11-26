// Pruebas de las funciones puras de js/instagram-lamina.js. Ejecutar: node --test tests/instagram-lamina.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { normalizarHex, luminancia, colorTextoSobre, mezclar, partirLineas, ajustarTexto } from '../js/instagram-lamina.js';

// "Medir" de mentira: 10 píxeles por letra.
const medir = (s) => s.length * 10;

test('normalizarHex acepta #rrggbb y cae al valor por defecto si no', () => {
  assert.strictEqual(normalizarHex('#2F76FF', '#000000'), '#2f76ff');
  assert.strictEqual(normalizarHex('azul', '#123456'), '#123456');
  assert.strictEqual(normalizarHex('#fff', '#123456'), '#123456');
  assert.strictEqual(normalizarHex(null, '#123456'), '#123456');
});

test('colorTextoSobre elige letra blanca en fondos oscuros y oscura en claros', () => {
  assert.strictEqual(colorTextoSobre('#000000'), '#FFFFFF');
  assert.strictEqual(colorTextoSobre('#1B2A4A'), '#FFFFFF');
  assert.strictEqual(colorTextoSobre('#FFFFFF'), '#1B2333');
  assert.strictEqual(colorTextoSobre('#F7F7F5'), '#1B2333');
  assert.strictEqual(colorTextoSobre('#ffe14d'), '#1B2333');
});

test('luminancia va de 0 a 1', () => {
  assert.ok(Math.abs(luminancia('#000000')) < 1e-9);
  assert.ok(Math.abs(luminancia('#ffffff') - 1) < 1e-9);
});

test('mezclar devuelve el punto medio', () => {
  assert.strictEqual(mezclar('#000000', '#ffffff', 0.5), '#808080');
  assert.strictEqual(mezclar('#102030', '#102030', 0.3), '#102030');
});

test('partirLineas respeta el ancho y los saltos de línea', () => {
  assert.deepStrictEqual(partirLineas('uno dos tres', 70, medir), ['uno dos', 'tres']);
  assert.deepStrictEqual(partirLineas('uno\n\ndos', 500, medir), ['uno', '', 'dos']);
  assert.deepStrictEqual(partirLineas('', 100, medir), ['']);
});

test('partirLineas no pierde una palabra más larga que la línea', () => {
  assert.deepStrictEqual(partirLineas('supercalifragilistico', 50, medir), ['supercalifragilistico']);
});

test('ajustarTexto baja el tamaño hasta que el texto cabe', () => {
  const medirCon = (tam) => (s) => s.length * tam * 0.5;
  const texto = 'palabra '.repeat(40).trim();
  const a = ajustarTexto({ texto, anchoMax: 900, altoMax: 400, medirCon, tamMax: 100, tamMin: 30 });
  assert.ok(a.tam < 100 && a.tam >= 30);
  assert.ok(a.lineas.length * a.tam * a.interlineado <= 400 || a.tam === 30);
  const corto = ajustarTexto({ texto: 'hola', anchoMax: 900, altoMax: 400, medirCon, tamMax: 100, tamMin: 30 });
  assert.strictEqual(corto.tam, 100);
});

import { contraste, acentoLegible } from '../js/instagram-lamina.js';

test('contraste: negro sobre blanco es 21 y igual sobre igual es 1', () => {
  assert.ok(Math.abs(contraste('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(contraste('#336699', '#336699') - 1) < 1e-9);
});

test('acentoLegible aclara un color oscuro sobre fondo oscuro y oscurece uno claro sobre fondo claro', () => {
  const fondoOscuro = '#101528';
  const a = acentoLegible('#8e0da4', fondoOscuro);
  assert.ok(contraste(a, fondoOscuro) >= 3);
  const fondoClaro = '#f7f7f5';
  const b = acentoLegible('#ffe14d', fondoClaro);
  assert.ok(contraste(b, fondoClaro) >= 3);
  // un color que ya se ve no se toca
  assert.strictEqual(acentoLegible('#2f76ff', fondoOscuro), '#2f76ff');
});
