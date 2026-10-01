/* ============================================================
   version-check.js
   No es un módulo — se carga primero que nada, sin esperar a
   Firebase ni a nada más, para detectar lo antes posible si hay
   una versión más nueva publicada.

   Cómo funciona: version.json se pide SIEMPRE con cache: 'no-store'
   (nunca de caché, cueste lo que cueste) y se compara contra
   VERSION_ACTUAL (la que viene escrita en este mismo index.html que
   ya se cargó). Si son distintas, es porque hay un deploy más nuevo
   que este navegador: recarga la página una sola vez (con guarda
   contra loops) para que vuelva a pedir index.html fresco — y con
   eso, las URLs versionadas de css/js que trae ese index.html nuevo
   fuerzan que el navegador las pida de nuevo también, en vez de
   servir las viejas de caché.

   No hay Service Worker en esta app (se revisó y no existe), así que
   no hay nada de eso que "desinstalar" — el problema es caché normal
   del navegador en los archivos .js/.css, no un Service Worker.
   De todas formas, se limpia Cache Storage por si alguna vez se
   agrega uno — no cuesta nada tenerlo. ============================================================ */

(function () {
  function limpiarCacheStorage() {
    if (!('caches' in window)) return Promise.resolve();
    return caches.keys().then(function (claves) {
      return Promise.all(claves.map(function (k) { return caches.delete(k); }));
    }).catch(function () { /* nada que hacer si falla */ });
  }

  function pedirVersionRemota() {
    return fetch('version.json?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (datos) { return datos.version; });
  }

  // Revisa si hay una versión nueva. Si feedback=true (botón manual),
  // avisa igual cuando ya está al día — si no, es el chequeo
  // automático de fondo y no hace falta molestar con nada.
  function verificarActualizacion(feedback) {
    const boton = document.getElementById('btn-buscar-actualizacion');
    if (feedback && boton) { boton.disabled = true; boton.textContent = 'Buscando...'; }

    return pedirVersionRemota().then(function (versionRemota) {
      const huboCambio = versionRemota && versionRemota !== window.VERSION_ACTUAL;
      if (huboCambio) {
        const yaRecargadoPorEstaVersion = sessionStorage.getItem('uneq_recargado_por') === versionRemota;
        if (!yaRecargadoPorEstaVersion) {
          sessionStorage.setItem('uneq_recargado_por', versionRemota);
          return limpiarCacheStorage().then(function () {
            if (feedback && boton) boton.textContent = 'Actualizando...';
            location.reload();
          });
        }
      }
      if (feedback && boton) {
        boton.disabled = false;
        boton.textContent = huboCambio ? '🔄 Buscar actualización' : '✓ Estás al día';
        if (!huboCambio) setTimeout(function () { boton.textContent = '🔄 Buscar actualización'; }, 2500);
      }
    }).catch(function (err) {
      console.error('No se pudo revisar la versión:', err);
      if (feedback && boton) { boton.disabled = false; boton.textContent = '🔄 Buscar actualización'; }
    });
  }

  // Chequeo automático apenas carga la página (silencioso).
  verificarActualizacion(false);

  // Botón manual, para cuando alguien no quiere esperar: se conecta
  // solo si existe en esta vista (está en el topbar, para todos los
  // roles).
  document.addEventListener('DOMContentLoaded', function () {
    const boton = document.getElementById('btn-buscar-actualizacion');
    if (boton) boton.addEventListener('click', function () { verificarActualizacion(true); });
  });
})();
