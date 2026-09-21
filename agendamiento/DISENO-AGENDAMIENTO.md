# Sistema de Agendamiento UNEQ — Diseño (v1)

Módulo aparte del proyecto onboarding-uneq. Vive en su propia página
(`agendamiento.html` + `js/agendamiento-*.js` + `css/agendamiento.css`),
usa el mismo proyecto de Firebase pero nodos NUEVOS en la base de datos
(bajo `agendamiento/`), y no modifica nada de `usuarios`, `alumnos`,
`hitos`, etc. Se integra a la app principal en un solo punto: la
pestaña "Recién Cerrados", visible solo para el Director.

## Roles nuevos
- **Closer** (3 personas): agenda propia, disponibilidad, bloqueos,
  bitácora de sus leads.
- **Director Comercial**: configura todo el sistema, ve la agenda de
  los 3 closers, sus bitácoras y reportes. No ve nada de alumnos.
Ambos inician sesión con Firebase Auth (mismo proyecto), pero sus
datos de rol viven en `agendamiento/staff/{uid}`, sin tocar `usuarios`.

## Flujo del lead (público, sin login)
1. **Calendario** (`agendamiento.html`): días con cupo (suma de los 3
   closers) dentro de la ventana configurada (días de anticipación /
   máximo a futuro).
2. **Horarios** del día elegido, en su hora local.
3. Al elegir horario → **hold de 10 min** (nadie más puede tomarlo).
   Countdown visible. Si expira sin confirmar, se libera solo.
4. **Preguntas** (config. por el Director Comercial: texto, texto
   largo, selección única/múltiple, número, sí/no, teléfono, correo;
   cada una obligatoria u opcional).
5. **Confirmar** → recién ahí: se asigna closer (rotación), se resta
   el cupo, se crea evento + Meet en su Calendar, se genera el link de
   reagendar/cancelar (token único, 1 uso para reagendar).
6. **Página de confirmación**: fecha/hora, botón "Agregar a mi
   calendario" (+ `.ics` adjunto), botón WhatsApp genérico de dudas.
   El lead NUNCA ve qué closer le tocó.
7. **Correo + WhatsApp** de confirmación, en simultáneo (MailerSend +
   FunnelChat — pendiente doc. de API).
8. **Recordatorios** (2), horario/plantilla/canal configurados por el
   Director Comercial.

## Reagendar / Cancelar (mismo link, `?token=...`)
- Reagendar: mismo calendario público. Intenta mantener al mismo
  closer; si no tiene cupo en el horario nuevo, reparte por rotación.
  Libera el cupo viejo, borra el evento viejo, crea el nuevo.
  **1 sola vez** — al segundo intento, mensaje + botón WhatsApp.
  No vuelve a pedir las preguntas.
- Cancelar: libera cupo, borra evento, avisa al closer (correo + app).
  Sin límite de usos.

## Rotación (reparto equitativo)
- Período configurable: semanal (default) / mensual / sin reinicio.
- Entre los closers disponibles en ese bloque, se asigna a quien tenga
  MENOS citas en el período actual.
- Empate → quien lleva más tiempo sin recibir una cita nueva.

## Estados de un lead (post-llamada) y bitácora
```
No-Show ────────────────────────────► archivada (recuperable)
Se presenta a llamada (activa)
  ├─ Cierra en llamada ──────────────► archivada (+ elige programa)
  └─ En Seguimiento (activa, bitácora)
       ├─ Cierra en Seguimiento ─────► archivada (+ elige programa)
       └─ Dado de baja ──────────────► archivada
```
- Bitácora: entradas de texto con fecha, visibles para el closer dueño
  y el Director Comercial. Archivadas y activas se ven separadas;
  una archivada se puede reabrir y seguir editando.
- Al "Cierra…", el closer elige programa (Begin/Next/eXIT) → el lead
  aparece en **Recién Cerrados** (Director, en la app principal) con
  nombre + teléfono + programa. Al tomarlo, abre el alta de alumno de
  siempre, prellenada. Sale de la lista al guardar la ficha.

## Estructura de datos (Realtime Database, todo bajo `agendamiento/`)
```
agendamiento/
  config/general          → duración, colchón, díasAnticipación,
                             díasMáximoFuturo, rotaciónPeríodo,
                             recordatorio1{horario,canal,plantilla},
                             recordatorio2{...}, whatsappDudasNumero
  config/preguntas/{id}    → tipo, texto, obligatoria, opciones[], orden
  staff/{uid}              → rol(closer|directorComercial), nombre,
                             correo, activo, calendarId (Google)
  disponibilidad/{uid}/{diaSemana} → bloques [{horaInicio,horaFin}]
  bloqueos/{uid}/{fecha}   → rangos bloqueados puntuales
  holds/{diaHora}/{holdId} → expira a los 10 min (TTL vía función)
  citas/{citaId}           → leadNombre, leadCorreo, leadTelefono,
                             respuestas{}, closerUid, fechaHoraInicio,
                             estado(agendada|cancelada|reagendada),
                             tokenAcceso, eventoGoogleId, meetLink,
                             reagendoUsado(bool)
  leadsPorCloser/{closerUid}/{citaId} → estadoLead, programa,
                             bitacora/{entradaId}{texto,fecha,autor},
                             archivada(bool)
  recienCerrados/{id}      → nombre, telefono, correo, programa,
                             closerUid, createdAt
```

## Integraciones pendientes de datos externos
- **FunnelChat**: falta doc/captura de su API o webhooks (endpoint,
  auth, si usa plantillas aprobadas de WhatsApp).
- **Google Calendar**: falta saber si la cuenta de cada closer es
  Gmail personal o `@uneqacademy.com` (Workspace) — define cómo se
  comparte cada calendario con la cuenta de servicio.
- Ambas integraciones se construyen como funciones disparadas por
  cambios en la base de datos (no HTTPS públicas), para evitar la
  política de Google Cloud del proyecto que bloquea crear funciones
  públicas nuevas.

## Plan de construcción (por fases, cada una revisable)
1. ✅ Página pública del lead (calendario → horarios → preguntas →
   confirmación).
2. ✅ Panel del Director Comercial (config: ventana, duración,
   preguntas, rotación, recordatorios, altas de closers).
3. ✅ Panel del Closer (disponibilidad, bloqueos, agenda, bitácora,
   estados).
4. ✅ Conectado a Firebase real (nodos `agendamiento/` + reglas +
   login con Firebase Auth, mismo proyecto).
5. ✅ Cloud Functions: hold de 10 min con validación atómica de cupo,
   rotación con empate, confirmar/reagendar/cancelar por token, alta
   de closer (crea su cuenta y le envía el acceso por correo),
   recordatorios (correo real; WhatsApp queda pendiente del punto 7).
6. ⏳ Integración Google Calendar + Meet — pendiente saber si la
   cuenta de cada closer es Gmail personal o `@uneqacademy.com`
   (Workspace). Mientras tanto, cada cita queda con
   `calendarPendiente: true`.
7. ⏳ Integración FunnelChat (WhatsApp) — pendiente su documentación
   de API/Webhooks. Mientras tanto, cada cita queda con
   `whatsappPendiente: true` y el correo de confirmación sale igual,
   con el `.ics` adjunto.
8. ⏳ Pestaña "Recién Cerrados" dentro de la app principal
   (onboarding-uneq), visible solo para el Director — único punto de
   contacto con esa app. El closer ya escribe en
   `agendamiento/recienCerrados` (fase 5); falta la pestaña que lo
   muestra y el botón "Crear ficha de alumno" prellenada.

## Cómo probar hoy, sin las fases 6 y 7
Todo lo demás ya funciona de punta a punta: un lead puede agendar,
reagendar y cancelar; el correo de confirmación llega con el archivo
para el calendario; los closers ven su agenda, marcan resultados y
llevan la bitácora; el Director Comercial configura todo y ve la
agenda general. Lo único “de mentira” por ahora es que no se crea el
evento en Google Calendar ni se envía el WhatsApp — el resto es real.
