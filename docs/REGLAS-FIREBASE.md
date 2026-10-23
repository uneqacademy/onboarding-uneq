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

## Mi Ficha: el alumno completa sus datos
`alumnos/$alumnoId` ahora permite al **propio alumno** (mapeado en `alumnoPorAuthUid`) escribir solo:
`rut`, `fechaNacimiento`, `genero`, `telefono`, `ocupacion`, `ocupacionEspecialidad`, `direccion` y
`actualizadoPorAlumnoEn`, y **solo mientras el ciclo esté en `asignado` o `en_onboarding`**.
Desde que se genera el acuerdo (`enviado_firma` en adelante) esos campos quedan bloqueados para el alumno; el coach ya
quedaba bloqueado en esos estados por la interfaz, y el director siempre puede editar.

- Nombre, apellido y correo **no** son editables por el alumno.
- El formato (RUT ≤ 40 caracteres, fecha `AAAA-MM-DD`, género y ocupación de listas fijas, teléfono `+` y 8–15 dígitos,
  dirección con calle, número, país, región y comuna) se exige **dentro de la regla de escritura del alumno**, no como
  validación general, para no bloquear al equipo cuando crea fichas.
- Pruebas en el simulador de reglas (como alumno con ciclo en `asignado`): escribir `alumnos/<su id>/rut` = permitido;
  `alumnos/<su id>/nombre` = denegado; `alumnos/<id de otro>/rut` = denegado; con el ciclo en `enviado_firma` = denegado.

## Reacciones a comentarios
Se agregó `reacciones/$uid` bajo cada comentario de Hitos, Presentaciones e Historias
(`hitos/$hitoId/comentarios/$comentarioId/reacciones/$uid`, y lo mismo bajo `comunidad/presentaciones/$alumnoId/...` y
`comunidad/historiasReales/$historiaId/...`). Cada persona (alumno o staff) solo escribe o quita **su propia** reacción
(`auth.uid === $uid`), con `nombre` como texto de hasta 120 caracteres. Igual que las reacciones a la publicación.
Prueba en el simulador: escribir `hitos/<id>/comentarios/<id>/reacciones/<tu uid>` = permitido; con el uid de otra persona = denegado.

## Preguntas de la Comunidad (`comunidad/preguntasLibres`)
Nodo nuevo, con la misma forma que `historiasReales`: lectura para cualquier sesión; crear = cualquiera (con su propio
`autorId`); editar o borrar = el autor durante 24 h, y el director siempre. Comentarios, reacciones y respuestas igual
que en Historias (solo el autor de la pregunta responde a un comentario).
- `fijadaEn` y `estado` solo los puede **cambiar el director** (`.validate`): un autor no puede fijar su pregunta.
- `titulo` entre 3 y 120 caracteres; `texto` hasta 3000.
- El tope de **3 preguntas fijadas** lo controla la interfaz (las reglas no pueden contar registros).
Pruebas en el simulador: como alumno, crear `comunidad/preguntasLibres/<id>` con `autorId` = su uid = permitido; con
`fijadaEn` = denegado; `fijadaEn` como director sobre una pregunta existente = permitido.
