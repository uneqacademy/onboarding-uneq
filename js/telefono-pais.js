/* ============================================================
   telefono-pais.js
   Campo de teléfono con selector de código de país (bandera + código),
   Chile (+56) por defecto. Envuelve un <input> existente: el input queda
   para el número sin código y el selector lleva el código.

   obtenerNumero() devuelve el teléfono completo, "+56 987654321", que es
   el formato que usa el resto de la app (los enlaces de WhatsApp toman
   solo los dígitos). Si se pega un número completo ("+54 9 11 ..."), se
   reconoce el país y se separa solo.

   Las banderas son imágenes de flagcdn.com (Windows no dibuja los emojis
   de bandera); si no cargan, queda el código del país.
   ============================================================ */

// iso|nombre|código. Para los países que comparten el +1 se usan sus códigos de área.
const DATOS_PAISES = `CL|Chile|56
AR|Argentina|54
BO|Bolivia|591
BR|Brasil|55
CO|Colombia|57
CR|Costa Rica|506
CU|Cuba|53
EC|Ecuador|593
SV|El Salvador|503
ES|España|34
US|Estados Unidos|1
GT|Guatemala|502
HN|Honduras|504
MX|México|52
NI|Nicaragua|505
PA|Panamá|507
PY|Paraguay|595
PE|Perú|51
PR|Puerto Rico|1787
DO|República Dominicana|1809
UY|Uruguay|598
VE|Venezuela|58
AF|Afganistán|93
AL|Albania|355
DE|Alemania|49
AD|Andorra|376
AO|Angola|244
AI|Anguila|1264
AG|Antigua y Barbuda|1268
SA|Arabia Saudita|966
DZ|Argelia|213
AM|Armenia|374
AW|Aruba|297
AU|Australia|61
AT|Austria|43
AZ|Azerbaiyán|994
BS|Bahamas|1242
BH|Baréin|973
BD|Bangladés|880
BB|Barbados|1246
BE|Bélgica|32
BZ|Belice|501
BJ|Benín|229
BY|Bielorrusia|375
MM|Birmania|95
BA|Bosnia y Herzegovina|387
BW|Botsuana|267
BN|Brunéi|673
BG|Bulgaria|359
BF|Burkina Faso|226
BI|Burundi|257
BT|Bután|975
CV|Cabo Verde|238
KH|Camboya|855
CM|Camerún|237
CA|Canadá|1
QA|Catar|974
TD|Chad|235
CN|China|86
CY|Chipre|357
KM|Comoras|269
CG|Congo|242
CD|Congo (Rep. Dem.)|243
KP|Corea del Norte|850
KR|Corea del Sur|82
CI|Costa de Marfil|225
HR|Croacia|385
CW|Curazao|599
DK|Dinamarca|45
DM|Dominica|1767
EG|Egipto|20
AE|Emiratos Árabes Unidos|971
ER|Eritrea|291
SK|Eslovaquia|421
SI|Eslovenia|386
EE|Estonia|372
SZ|Esuatini|268
ET|Etiopía|251
PH|Filipinas|63
FI|Finlandia|358
FJ|Fiyi|679
FR|Francia|33
GA|Gabón|241
GM|Gambia|220
GE|Georgia|995
GH|Ghana|233
GI|Gibraltar|350
GD|Granada|1473
GR|Grecia|30
GL|Groenlandia|299
GP|Guadalupe|590
GU|Guam|1671
GF|Guayana Francesa|594
GN|Guinea|224
GQ|Guinea Ecuatorial|240
GW|Guinea-Bisáu|245
GY|Guyana|592
HT|Haití|509
HU|Hungría|36
IN|India|91
ID|Indonesia|62
IQ|Irak|964
IR|Irán|98
IE|Irlanda|353
IS|Islandia|354
KY|Islas Caimán|1345
CK|Islas Cook|682
FO|Islas Feroe|298
FK|Islas Malvinas|500
MH|Islas Marshall|692
SB|Islas Salomón|677
TC|Islas Turcas y Caicos|1649
VG|Islas Vírgenes Británicas|1284
VI|Islas Vírgenes de EE. UU.|1340
IL|Israel|972
IT|Italia|39
JM|Jamaica|1876
JP|Japón|81
JO|Jordania|962
KE|Kenia|254
KG|Kirguistán|996
KI|Kiribati|686
XK|Kosovo|383
KW|Kuwait|965
LA|Laos|856
LS|Lesoto|266
LV|Letonia|371
LB|Líbano|961
LR|Liberia|231
LY|Libia|218
LI|Liechtenstein|423
LT|Lituania|370
LU|Luxemburgo|352
MK|Macedonia del Norte|389
MG|Madagascar|261
MY|Malasia|60
MW|Malaui|265
MV|Maldivas|960
ML|Malí|223
MT|Malta|356
MA|Marruecos|212
MQ|Martinica|596
MU|Mauricio|230
MR|Mauritania|222
FM|Micronesia|691
MD|Moldavia|373
MC|Mónaco|377
MN|Mongolia|976
ME|Montenegro|382
MS|Montserrat|1664
MZ|Mozambique|258
NA|Namibia|264
NR|Nauru|674
NP|Nepal|977
NE|Níger|227
NG|Nigeria|234
NO|Noruega|47
NC|Nueva Caledonia|687
NZ|Nueva Zelanda|64
OM|Omán|968
NL|Países Bajos|31
PK|Pakistán|92
PW|Palaos|680
PS|Palestina|970
PG|Papúa Nueva Guinea|675
PL|Polonia|48
PT|Portugal|351
PF|Polinesia Francesa|689
GB|Reino Unido|44
CF|República Centroafricana|236
CZ|República Checa|420
RE|Reunión|262
RW|Ruanda|250
RO|Rumania|40
RU|Rusia|7
KZ|Kazajistán|7
WS|Samoa|685
AS|Samoa Americana|1684
KN|San Cristóbal y Nieves|1869
SM|San Marino|378
VC|San Vicente y las Granadinas|1784
LC|Santa Lucía|1758
ST|Santo Tomé y Príncipe|239
SN|Senegal|221
RS|Serbia|381
SC|Seychelles|248
SL|Sierra Leona|232
SG|Singapur|65
SX|Sint Maarten|1721
SY|Siria|963
SO|Somalia|252
LK|Sri Lanka|94
ZA|Sudáfrica|27
SD|Sudán|249
SS|Sudán del Sur|211
SE|Suecia|46
CH|Suiza|41
SR|Surinam|597
TH|Tailandia|66
TW|Taiwán|886
TZ|Tanzania|255
TJ|Tayikistán|992
TL|Timor Oriental|670
TG|Togo|228
TO|Tonga|676
TT|Trinidad y Tobago|1868
TN|Túnez|216
TM|Turkmenistán|993
TR|Turquía|90
TV|Tuvalu|688
UA|Ucrania|380
UG|Uganda|256
UZ|Uzbekistán|998
VU|Vanuatu|678
VN|Vietnam|84
YE|Yemen|967
DJ|Yibuti|253
ZM|Zambia|260
ZW|Zimbabue|263`;

export const PAISES_TELEFONO = DATOS_PAISES.split('\n').map(linea => {
  const [iso, nombre, codigo] = linea.split('|');
  return { iso, nombre, codigo };
});

const PAIS_POR_ISO = Object.fromEntries(PAISES_TELEFONO.map(p => [p.iso, p]));
// Para detectar el país de un número completo: el código más largo que coincida.
const PAISES_POR_CODIGO_LARGO = [...PAISES_TELEFONO].sort((a, b) => b.codigo.length - a.codigo.length);

const urlBandera = (iso) => `https://flagcdn.com/w40/${iso.toLowerCase()}.png`;
const imgBandera = (iso) => `<img class="tel-pais__bandera" src="${urlBandera(iso)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
const escapar = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "+54 9 11 5555 5555" → { iso: 'AR', nacional: '91155555555' } (solo si empieza con "+").
export function separarNumeroCompleto(texto) {
  const t = String(texto || '').trim();
  if (!t.startsWith('+')) return null;
  const digitos = t.replace(/[^0-9]/g, '');
  const pais = PAISES_POR_CODIGO_LARGO.find(p => digitos.startsWith(p.codigo));
  if (!pais) return null;
  return { iso: pais.iso, nacional: digitos.slice(pais.codigo.length) };
}

// El "value" nativo de un <input>: con él se lee y escribe el texto que muestra el campo (solo el número,
// sin el código), aunque el campo tenga su propia propiedad "value" (ver valorCompleto).
const descriptorValor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const leerCrudo = (input) => descriptorValor.get.call(input);
const escribirCrudo = (input, texto) => descriptorValor.set.call(input, texto);

/**
 * Envuelve `input` con el selector de país.
 * opciones.onCambio(iso, { manual, cambio }) se llama al cambiar el país (por elegirlo o por pegar un número completo).
 * opciones.valorCompleto: el `.value` del campo pasa a ser el teléfono COMPLETO ("+56 987654321") al leer y acepta un
 *   teléfono completo al escribir; así el código que ya usa el campo (guardar, cargar) no necesita cambios.
 * opciones.formato: 'completo' ("+56 987654321", por defecto) o 'digitos' ("56987654321").
 * Montar dos veces el mismo campo devuelve el selector ya creado.
 */
export function montarSelectorTelefono(input, opciones = {}) {
  if (input._selectorTelefono) return input._selectorTelefono;

  const contenedor = document.createElement('div');
  contenedor.className = 'tel-pais';
  input.parentNode.insertBefore(contenedor, input);

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'tel-pais__boton';
  boton.setAttribute('aria-haspopup', 'listbox');
  boton.setAttribute('aria-expanded', 'false');
  boton.setAttribute('aria-label', 'Código de país del teléfono');

  const lista = document.createElement('div');
  lista.className = 'tel-pais__lista hidden';
  lista.innerHTML = `<input type="search" class="tel-pais__buscar" placeholder="Buscar país o código..." aria-label="Buscar país"><div class="tel-pais__items" role="listbox"></div>`;

  const valorInicial = leerCrudo(input);
  contenedor.append(boton, input, lista);
  input.classList.add('tel-pais__numero');
  input.setAttribute('inputmode', 'tel');

  const buscar = lista.querySelector('.tel-pais__buscar');
  const items = lista.querySelector('.tel-pais__items');
  let iso = 'CL';

  function pintarBoton() {
    const pais = PAIS_POR_ISO[iso];
    boton.innerHTML = `${imgBandera(iso)}<span class="tel-pais__codigo">+${pais.codigo}</span><span class="tel-pais__flecha" aria-hidden="true">▾</span>`;
    boton.title = `${pais.nombre} (+${pais.codigo})`;
  }

  function pintarItems(filtro = '') {
    const q = filtro.trim().toLowerCase().replace(/^\+/, '');
    const visibles = PAISES_TELEFONO.filter(p => !q || p.nombre.toLowerCase().includes(q) || p.codigo.startsWith(q) || p.iso.toLowerCase() === q);
    items.innerHTML = visibles.map(p => `
      <button type="button" class="tel-pais__item${p.iso === iso ? ' is-activo' : ''}" role="option" data-iso="${p.iso}">
        ${imgBandera(p.iso)}<span class="tel-pais__nombre">${escapar(p.nombre)}</span><span class="tel-pais__cod">+${p.codigo}</span>
      </button>`).join('') || '<p class="tel-pais__vacio">Sin resultados</p>';
  }

  function abrir() {
    pintarItems();
    buscar.value = '';
    lista.classList.remove('hidden');
    boton.setAttribute('aria-expanded', 'true');
    items.querySelector('.is-activo')?.scrollIntoView({ block: 'center' });
    if (!window.matchMedia('(pointer: coarse)').matches) buscar.focus();
  }
  function cerrar() {
    lista.classList.add('hidden');
    boton.setAttribute('aria-expanded', 'false');
  }

  function establecerIso(nuevoIso, { manual = false, silencioso = false } = {}) {
    if (!PAIS_POR_ISO[nuevoIso]) return;
    const cambio = nuevoIso !== iso;
    iso = nuevoIso;
    pintarBoton();
    if (!silencioso && opciones.onCambio) opciones.onCambio(iso, { manual, cambio });
  }

  const digitosCrudos = () => leerCrudo(input).replace(/[^0-9]/g, '').replace(/^0+/, '');

  const api = {
    obtenerIso: () => iso,
    establecerIso,
    // Teléfono completo: "+56 987654321" (o "56987654321" con formato 'digitos'); '' si no hay número.
    obtenerNumero() {
      const nacional = digitosCrudos();
      if (!nacional) return '';
      const codigo = PAIS_POR_ISO[iso].codigo;
      return opciones.formato === 'digitos' ? `${codigo}${nacional}` : `+${codigo} ${nacional}`;
    },
    // Cuántos dígitos tiene el número sin el código (para validar).
    digitosNacionales: () => digitosCrudos().length,
    // Acepta "+56 9...", "56 9..." o solo el número nacional (que queda con Chile, el país por defecto).
    establecerNumero(texto, { silencioso = false } = {}) {
      let t = String(texto || '').trim();
      // Con formato 'digitos' el valor guardado ya trae el código del país (sin el +): se trata como número completo.
      if (opciones.formato === 'digitos' && t && !t.startsWith('+')) t = '+' + t.replace(/[^0-9]/g, '');
      const completo = separarNumeroCompleto(t);
      if (completo) {
        escribirCrudo(input, completo.nacional);
        establecerIso(completo.iso, { manual: false, silencioso });
        return;
      }
      const digitos = t.replace(/[^0-9]/g, '');
      const esChileConCodigo = digitos.startsWith('56') && digitos.length >= 11;
      escribirCrudo(input, esChileConCodigo ? digitos.slice(2) : digitos);
      establecerIso('CL', { manual: false, silencioso });
    },
    restablecer() {
      escribirCrudo(input, '');
      establecerIso('CL', { silencioso: true });
    }
  };

  boton.addEventListener('click', () => (lista.classList.contains('hidden') ? abrir() : cerrar()));
  buscar.addEventListener('input', () => pintarItems(buscar.value));
  buscar.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { cerrar(); boton.focus(); }
    if (ev.key === 'Enter') { ev.preventDefault(); items.querySelector('.tel-pais__item')?.click(); }
  });
  items.addEventListener('click', (ev) => {
    const item = ev.target.closest('.tel-pais__item');
    if (!item) return;
    establecerIso(item.dataset.iso, { manual: true });
    cerrar();
    input.focus();
  });
  document.addEventListener('click', (ev) => { if (!contenedor.contains(ev.target)) cerrar(); });

  // Si se pega un número completo ("+54 9 11 ..." o "56987654321"), se reconoce el país y se separa.
  input.addEventListener('input', () => {
    const crudo = leerCrudo(input);
    const completo = separarNumeroCompleto(crudo);
    if (completo) {
      escribirCrudo(input, completo.nacional);
      establecerIso(completo.iso, { manual: false });
      return;
    }
    const digitos = crudo.replace(/[^0-9]/g, '');
    const codigo = PAIS_POR_ISO[iso].codigo;
    // "56987654321" pegado sin el "+" en Chile; o el código del país actual pegado sin el "+"
    if (iso === 'CL' && digitos.startsWith('56') && digitos.length >= 11) escribirCrudo(input, digitos.slice(2));
    else if (codigo !== '56' && digitos.startsWith(codigo) && digitos.length >= codigo.length + 8) escribirCrudo(input, digitos.slice(codigo.length));
  });

  pintarBoton();
  if (valorInicial && valorInicial.trim()) api.establecerNumero(valorInicial, { silencioso: true });

  if (opciones.valorCompleto) {
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => api.obtenerNumero(),
      set: (texto) => api.establecerNumero(texto, { silencioso: true })
    });
  }

  input._selectorTelefono = api;
  return api;
}

const SELECTOR_CAMPOS_TELEFONO = 'input[type="tel"], input[data-telefono]';

function montarSiCorresponde(input) {
  // Los campos con data-tel-manual los monta su propio módulo (con sus propias reacciones al cambio de país).
  if (input.dataset.telManual !== undefined || input._selectorTelefono) return;
  montarSelectorTelefono(input, {
    valorCompleto: true,
    formato: input.dataset.telefonoFormato === 'digitos' ? 'digitos' : 'completo'
  });
}

/**
 * Pone el selector de país a TODOS los campos de teléfono (input type="tel" o con data-telefono),
 * los que ya están en la página y los que se creen después (formularios que se dibujan con JavaScript).
 * Son campos "valorCompleto": todo el código que los lee o los llena sigue funcionando igual.
 */
export function activarSelectoresTelefono() {
  document.querySelectorAll(SELECTOR_CAMPOS_TELEFONO).forEach(montarSiCorresponde);
  new MutationObserver((cambios) => {
    for (const cambio of cambios) {
      cambio.addedNodes.forEach(nodo => {
        if (nodo.nodeType !== 1) return;
        if (nodo.matches?.(SELECTOR_CAMPOS_TELEFONO)) montarSiCorresponde(nodo);
        nodo.querySelectorAll?.(SELECTOR_CAMPOS_TELEFONO).forEach(montarSiCorresponde);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
}
