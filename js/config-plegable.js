/* Configuración: secciones plegables, agrupadas por tema.
   Todo arranca cerrado; se abre una sección para editarla (solo una a la vez).
   No cambia los datos ni los ids: solo reordena y pliega lo que ya existe. */
const GRUPOS = [
  { titulo: 'Equipo y accesos', icono: '👥', claves: ['panel-subdirectora'] },
  { titulo: 'Programas y precios', icono: '💳', claves: ['precios', 'hotmart', 'grabaciones', 'whatsapp', 'comunidad'] },
  { titulo: 'Inteligencia Artificial', icono: '🤖', claves: ['metodologia', 'director-ia', 'soporte-ia', 'config-laboratorio-ia', 'config-laboratorio-guia'] },
  { titulo: 'Alumnos y gamificación', icono: '🏆', claves: ['config-gamificacion', 'hitos', 'box'] }
];

function claveDe(panel) {
  if (panel.dataset.configSeccion) return panel.dataset.configSeccion;
  if (panel.id) return panel.id;
  const t = (panel.querySelector('h3') || {}).textContent || '';
  if (/Hitos por Fase/i.test(t)) return 'hitos';
  if (/BOX Inteligente/i.test(t)) return 'box';
  return '';
}

function organizar(vista) {
  if (vista.dataset.cfgListo) return;
  const paneles = Array.from(vista.children).filter(el => el.classList.contains('panel'));
  if (!paneles.length) return;
  vista.dataset.cfgListo = '1';
  const porClave = new Map(paneles.map(p => [claveDe(p), p]));
  const usados = new Set();
  const frag = document.createDocumentFragment();
  const poner = (p) => { p.classList.add('cfg-plegable', 'cfg-cerrado'); usados.add(p); frag.appendChild(p); };
  GRUPOS.forEach(g => {
    const ps = g.claves.map(c => porClave.get(c)).filter(Boolean);
    if (!ps.length) return;
    const h = document.createElement('h2');
    h.className = 'cfg-grupo';
    if (g.claves[0] === 'panel-subdirectora') h.classList.add('cfg-grupo--equipo');
    h.textContent = `${g.icono}  ${g.titulo}`;
    frag.appendChild(h);
    ps.forEach(poner);
  });
  const sueltos = paneles.filter(p => !usados.has(p));
  if (sueltos.length) {
    const h = document.createElement('h2'); h.className = 'cfg-grupo'; h.textContent = '⚙️  Otros'; frag.appendChild(h);
    sueltos.forEach(poner);
  }
  vista.appendChild(frag);
  vista.classList.add('cfg-vista');
}

function alternar(panel, abrir) {
  const vista = panel.parentElement;
  if (abrir) vista.querySelectorAll('.cfg-plegable:not(.cfg-cerrado)').forEach(p => { if (p !== panel) p.classList.add('cfg-cerrado'); });
  panel.classList.toggle('cfg-cerrado', !abrir);
  if (abrir) setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

export function iniciarConfigPlegable() {
  const vista = document.getElementById('view-configuracion');
  if (!vista) return;
  organizar(vista);
  if (vista.dataset.cfgClick) return;
  vista.dataset.cfgClick = '1';
  vista.addEventListener('click', (e) => {
    const cab = e.target.closest('.cfg-plegable > .panel__header');
    if (!cab || e.target.closest('button, a, input, select, textarea, label')) return;
    const panel = cab.parentElement;
    alternar(panel, panel.classList.contains('cfg-cerrado'));
  });
  // Al pulsar «Editar» o «Guardar» en un panel cerrado, se abre solo.
  vista.addEventListener('click', (e) => {
    const b = e.target.closest('.btn-editar-config-seccion');
    const p = b && b.closest('.cfg-plegable.cfg-cerrado');
    if (p) alternar(p, true);
  });
}
