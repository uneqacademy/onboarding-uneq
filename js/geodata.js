/* ============================================================
   geodata.js
   País → Región/Estado → Comuna/Ciudad, en cascada, para el campo
   de dirección de "Datos Generales".

   - País: los 250 del mundo.
   - Región/Estado: completo, para cualquier país.
   - Comuna/Ciudad: cascada real (con selector) SOLO para Chile,
     Colombia y México — que es de donde son la gran mayoría de los
     alumnos. Para cualquier otro país, ese campo pasa a ser de
     texto libre (sigue siendo obligatorio, solo que sin lista).

   Los 3 JSON se cargan solo la primera vez que hacen falta (no de
   entrada, para no pesar la carga inicial de la app), y quedan en
   memoria el resto de la sesión.
   ============================================================ */

const PAISES_CON_COMUNAS = ['CL', 'CO', 'MX'];

let paisesCache = null;
let estadosCache = null;
let comunasCache = null;
let cargandoPromesa = null;

async function asegurarDatosGeograficosCargados() {
  if (paisesCache && estadosCache && comunasCache) return;
  if (cargandoPromesa) return cargandoPromesa;

  cargandoPromesa = (async () => {
    const [paisesRes, estadosRes, comunasRes] = await Promise.all([
      fetch('assets/geodata/paises.json'),
      fetch('assets/geodata/estados.json'),
      fetch('assets/geodata/comunas.json')
    ]);
    paisesCache = await paisesRes.json();
    estadosCache = await estadosRes.json();
    comunasCache = await comunasRes.json();
  })();
  return cargandoPromesa;
}

function poblarSelectPaises(selectEl, codigoSeleccionado) {
  selectEl.innerHTML = paisesCache.map(p => `<option value="${p.codigo}">${p.nombre}</option>`).join('');
  selectEl.value = codigoSeleccionado || 'CL';
}

function poblarSelectRegiones(selectEl, codigoPais, nombreSeleccionado) {
  const regiones = estadosCache.filter(e => e.pais === codigoPais);
  if (!regiones.length) {
    selectEl.innerHTML = '<option value="">Sin regiones para este país</option>';
    return;
  }
  selectEl.innerHTML = '<option value="">Selecciona...</option>' + regiones.map(r => `<option value="${r.codigo}">${r.nombre}</option>`).join('');
  if (nombreSeleccionado) {
    const match = regiones.find(r => r.nombre === nombreSeleccionado);
    if (match) selectEl.value = match.codigo;
  }
}

// Comuna/Ciudad: select con cascada real (CL/CO/MX) o input de texto
// libre (cualquier otro país) — reemplaza el contenido del div
// contenedor, pero SIEMPRE deja el campo con id="datos-direccion-comuna",
// para que el resto del código (guardar/cargar) no tenga que saber
// si por debajo es un select o un input.
function renderCampoComuna(contenedorEl, codigoPais, codigoRegion, valorGuardado) {
  if (PAISES_CON_COMUNAS.includes(codigoPais) && codigoRegion) {
    const ciudades = (comunasCache[codigoPais] || []).filter(c => c[1] === codigoRegion);
    if (ciudades.length) {
      contenedorEl.innerHTML = `<select id="datos-direccion-comuna"><option value="">Selecciona...</option>${ciudades.map(c => `<option value="${c[0]}">${c[0]}</option>`).join('')}</select>`;
      if (valorGuardado) document.getElementById('datos-direccion-comuna').value = valorGuardado;
      return;
    }
  }
  contenedorEl.innerHTML = `<input id="datos-direccion-comuna" placeholder="Escribe tu comuna o ciudad" value="${(valorGuardado || '').replace(/"/g, '&quot;')}">`;
}

// Conecta los selects de País/Región/Comuna de "Datos Generales" con
// la cascada — se llama una sola vez, al cargar la app.
export function conectarCascadaDireccion() {
  const selectPais = document.getElementById('datos-direccion-pais');
  const selectRegion = document.getElementById('datos-direccion-region');
  const contenedorComuna = document.getElementById('campo-datos-direccion-comuna');
  if (!selectPais || !selectRegion || !contenedorComuna) return;

  selectPais.addEventListener('change', () => {
    poblarSelectRegiones(selectRegion, selectPais.value, null);
    renderCampoComuna(contenedorComuna, selectPais.value, null, null);
  });
  selectRegion.addEventListener('change', () => {
    renderCampoComuna(contenedorComuna, selectPais.value, selectRegion.value, null);
  });
}

// Deja los 3 campos listos para que el coach/director empiece a
// escribir desde cero (alumno nuevo, sin dirección guardada) — Chile
// por defecto, como ya era antes.
export async function prepararCamposDireccionVacios() {
  await asegurarDatosGeograficosCargados();
  const selectPais = document.getElementById('datos-direccion-pais');
  const selectRegion = document.getElementById('datos-direccion-region');
  const contenedorComuna = document.getElementById('campo-datos-direccion-comuna');
  if (!selectPais || !selectRegion || !contenedorComuna) return;

  poblarSelectPaises(selectPais, 'CL');
  poblarSelectRegiones(selectRegion, 'CL', null);
  renderCampoComuna(contenedorComuna, 'CL', null, null);
}

// Carga la dirección YA GUARDADA de un alumno, dejando los 3 selects
// en cascada correctamente pre-seleccionados (país -> región ->
// comuna), en ese orden.
export async function precargarDireccionGuardada({ pais, region, comuna }) {
  await asegurarDatosGeograficosCargados();
  const selectPais = document.getElementById('datos-direccion-pais');
  const selectRegion = document.getElementById('datos-direccion-region');
  const contenedorComuna = document.getElementById('campo-datos-direccion-comuna');
  if (!selectPais || !selectRegion || !contenedorComuna) return;

  const paisMatch = pais ? paisesCache.find(p => p.nombre === pais) : null;
  const codigoPais = paisMatch ? paisMatch.codigo : 'CL';

  poblarSelectPaises(selectPais, codigoPais);
  poblarSelectRegiones(selectRegion, codigoPais, region);
  renderCampoComuna(contenedorComuna, codigoPais, selectRegion.value, comuna);
}

// El resto del código guarda/lee estos 3 campos por su .value — para
// País necesita el NOMBRE completo (no el código ISO), así que este
// helper hace esa traducción al momento de guardar.
export function nombrePaisDesdeCodigo(codigo) {
  if (!paisesCache) return codigo;
  const match = paisesCache.find(p => p.codigo === codigo);
  return match ? match.nombre : codigo;
}
