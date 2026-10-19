# UNEQ APP (onboarding-uneq)

Web estática publicada en GitHub Pages (`app.uneqacademy.com`, ver `CNAME`). PWA con Firebase.
**Sin npm ni build**: HTML + módulos ES + CSS. El SDK de Firebase (12.17.1) se carga desde gstatic.

## Estructura
- `index.html`: app principal (login, app-shell y todas las vistas).
- `js/`: un módulo por área. `auth.js` (login y roles), `main.js` (shell/navegación),
  `alumnos.js`, `alumno-portal.js`, `mentores.js`, `coaches.js`, `hitos.js`, `pagos.js`,
  `comunidad-uneq.js`, `configuracion.js`, `firebase-config.js`.
- `agendamiento/`: módulo aparte para closers y director comercial (ver `DISENO-AGENDAMIENTO.md`).
- `nps*.html`, `arreglar-correo.html`: páginas sueltas.
- `version.json` + `js/version-check.js`: aviso de nueva versión.

## Roles (`/usuarios/{uid}`)
`director`, `coach`, `mentor`; el alumno se resuelve por `/alumnoPorAuthUid/{uid}`.
Agendamiento: `agendamiento/staff/{uid}` (closer, director comercial).

## Reglas de trabajo
- Cada cambio va en una rama y un PR; no se trabaja directo en `main` (cada merge a `main` publica).
- Al cambiar JS/CSS/HTML, subir `version.json` (formato `YYYYMMDDx`).
- Todo texto que venga de la base de datos y se pinte con `innerHTML` debe pasar por un escape HTML.
- Las claves de `firebase-config.js` son públicas por diseño; la seguridad real está en las reglas de
  Realtime Database/Storage (no están en el repo, ver `docs/REVISION.md`).
- Idioma de UI y comentarios: español.
