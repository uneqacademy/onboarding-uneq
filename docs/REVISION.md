# Revisión inicial (2026-10-19)

Revisión de lectura; no se modificó código de la app.

## Hallazgos
1. **XSS por `innerHTML` sin escapar (alto).** Hay ~200 usos de `innerHTML`. Solo 5 archivos tienen
   helper de escape (`asistente-uneq`, `clon-entrenamiento`, `panel-sesiones`, `nps-mentoria-form`, `mentores`),
   cada uno con su copia. Ejemplos sin escapar:
   - `js/main.js:79-80`: `nombre` del usuario va directo a `sidebar-user-info`.
   - `js/comunidad-uneq.js:511,598,605`: nombres de archivo, `c.nombre`/`c.email` y nombres en `<option>`.
   Un nombre con HTML guardado en la base de datos se ejecutaría para quien lo vea. Más grave en módulos con
   contenido de usuarios (comunidad, hitos, bitácora, alumnos).
   **Propuesta:** un único `js/util-html.js` con `escaparHtml` y aplicarlo módulo por módulo.
2. **Reglas de Firebase fuera del repo (alto, a verificar).** Con la config pública, todo el control de acceso
   (roles, ver fichas, pagos) depende de las reglas de Realtime Database y Storage. Conviene versionarlas
   (`database.rules.json`, `storage.rules`) y revisar que un alumno no pueda leer `alumnos/*`, `pagos` ni
   escribir en `usuarios/*`.
3. **Contraseña mínima de 6 caracteres** (`js/auth.js:148`). Subir a 8-10.
4. **Contraseñas iniciales visibles** en pantalla al crear alumno/coach/mentor (`index.html` ~584, 929, 985).
   Mejor enviar enlace de restablecimiento.
5. **Limpieza de `alumnoPorAuthUid` en el cliente** (`js/auth.js:82-103, 236-243`) depende de que las reglas lo permitan;
   es un parche del modo demo. Revisar.
6. **Sin README, sin pruebas, sin CI.** `version.json` se sube a mano.
7. **Archivos duplicados:** `agendamiento/logos/` y `agendamiento/assets/logos/(logos/)`.
8. **Archivos muy grandes:** `index.html` 142 KB, `alumno-portal.js` 126 KB, `mentores.js` 100 KB.

## Siguientes pasos sugeridos
1. PR de reglas de Firebase versionadas (requiere exportarlas desde la consola).
2. PR de `util-html.js` + escape en `main.js` y `comunidad-uneq.js`.
3. Continuar por hitos, bitácora, alumnos, mentores y alumno-portal.
