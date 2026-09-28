/* ============================================================
   gtm-config.js — Google Tag Manager del sistema de agendamiento.

   Contenedor: GTM-WVQXZ9VC
   Si algún día cambias de contenedor, edita SOLO la línea de
   window.GTM_ID de más abajo.

   OJO: este archivo ya trae tu ID. Si lo reemplazas por una copia
   antigua o por el marcador GTM-XXXXXXX, el seguimiento se apaga
   sin avisar (el sistema sigue funcionando, pero sin medir nada).
   ============================================================ */
window.GTM_ID = 'GTM-WVQXZ9VC';

(function () {
  window.dataLayer = window.dataLayer || [];

  // Avisa a GTM qué tipo de página es, para poder separar en GTM el
  // tráfico real de leads (publica) del uso interno (director / closer).
  var ruta = location.pathname;
  var tipo = ruta.indexOf('director-comercial') !== -1 ? 'director'
           : ruta.indexOf('closer') !== -1 ? 'closer'
           : 'publica';
  window.dataLayer.push({ tipo_pagina: tipo });

  // Sin ID válido, no se carga GTM.
  if (window.GTM_ID === 'GTM-XXXXXXX' || !/^GTM-[A-Z0-9]+$/.test(window.GTM_ID)) return;

  // Código oficial de Google Tag Manager (parte del <head>).
  (function (w, d, s, l, i) {
    w[l] = w[l] || [];
    w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var f = d.getElementsByTagName(s)[0], j = d.createElement(s), dl = l != 'dataLayer' ? '&l=' + l : '';
    j.async = true;
    j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
    f.parentNode.insertBefore(j, f);
  })(window, document, 'script', 'dataLayer', window.GTM_ID);
})();
