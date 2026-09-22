/* ============================================================
   texto-clamp.js — recorte de texto a 10 líneas + "Ver más/Ver
   menos", reutilizado en preguntas de BOX, texto de hitos y
   comentarios. Se usa así:
     <p class="texto-clamp" data-clamp>${texto}</p>
     <button type="button" class="btn-ver-mas-texto hidden" data-clamp-btn>Ver más</button>
   y después de insertar ese HTML en el DOM:
     aplicarClampTexto(contenedorDondeSeInsertó);
   Solo muestra el botón si el texto realmente se corta (evita
   mostrar "Ver más" en textos cortos que ya caben en 10 líneas).
   ============================================================ */
export function aplicarClampTexto(contenedor) {
  if (!contenedor) return;
  contenedor.querySelectorAll('[data-clamp]').forEach(p => {
    const btn = p.parentElement.querySelector('[data-clamp-btn]');
    if (!btn) return;
    // Si no se corta (todo el texto cabe), no mostramos el botón.
    if (p.scrollHeight <= p.clientHeight + 2) { btn.classList.add('hidden'); return; }
    btn.classList.remove('hidden');
    btn.textContent = 'Ver más';
    btn.onclick = () => {
      p.classList.toggle('texto-clamp');
      btn.textContent = p.classList.contains('texto-clamp') ? 'Ver más' : 'Ver menos';
    };
  });
}
