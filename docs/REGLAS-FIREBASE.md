# Reglas de Firebase: cambios y pruebas

Los archivos `database.rules.json` y `storage.rules` de la raíz son la fuente de verdad.
**Mergear este PR no los publica**: hay que pegarlos en la consola de Firebase
(Realtime Database → Reglas, y Storage → Reglas) o desplegarlos con Firebase CLI.
El primer commit del PR son las reglas originales; el segundo, los cambios.

## Qué cambia
Realtime Database
1. `usuarios/$uid`: nadie puede darse a sí mismo `roles` (director/coach/mentor), `rol`,
   `coachCabeceraBegin` ni reactivar un `activo:false`. Solo el director. Además un usuario sin
   nodo en `usuarios` (p. ej. un alumno) ya no puede crear uno.
2. `acuerdosPago`: escritura solo director/coach (antes cualquier usuario con sesión).
3. `alumnos`, `ciclos`, `bitacora`: escritura solo director/coach (antes cualquier cuenta que
   no fuera alumno, incluidos mentores).
4. `alumnoPorAuthUid/$uid`: solo director o coach lo crean (antes cualquiera, para cualquier uid);
   el staff sigue pudiendo borrar su propio mapeo (cierre de sesión / salir del modo demo).

Storage
5. Carpetas con dueño (`fotos-perfil`, `fotos-perfil-ia`, `resumenes-mentorias`,
   `conocimiento-mentor`, `resumenes-sesiones-begin`): solo el dueño sube o borra.
6. Tope de tamaño (25 MB; fotos 10 MB y solo imágenes) en todas las carpetas.

## Lo que NO se resuelve aquí
- Storage no puede leer roles de Realtime Database. Contratos (`acuerdos*`) siguen siendo
  accesibles para cualquier usuario con sesión; arreglarlo requiere custom claims.
- Los mentores siguen pudiendo **leer** todos los alumnos.
- `hitos/*/estado` sigue siendo escribible por cualquier alumno.
- El registro de cuentas en Firebase Auth debe seguir habilitado: la app crea cuentas desde el cliente
  (`createUserWithEmailAndPassword` con app secundaria).

## Lista de pruebas antes de publicar (simulador de reglas o app en pruebas)
- Director: iniciar sesión; crear coach, mentor y alumno con acceso; editar "Mis roles" en Mis Datos;
  crear ciclo y acuerdo de pago; generar PDF; subir acuerdo firmado; modo demo y salir del modo demo.
- Coach: ver y editar alumnos de su ciclo; crear acceso de alumno; bitácora.
- Mentor: editar sus datos, foto, temas; subir resumen de mentoría y archivo de conocimiento; responder BOX.
- Alumno: iniciar sesión; ver su ficha; subir foto; publicar hito/presentación; preguntar al BOX.
- Negativas (deben fallar): un alumno escribe `usuarios/<su uid>/roles/director = true`;
  un alumno escribe en `acuerdosPago`; un mentor escribe en `alumnos`.
