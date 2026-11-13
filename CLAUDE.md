# UNEQ APP (onboarding-uneq)

Web estática publicada en GitHub Pages (`app.uneqacademy.com`, ver `CNAME`). PWA con Firebase.
**Sin npm ni build**: HTML + módulos ES + CSS. El SDK de Firebase (12.17.1) se carga desde gstatic.

## Estructura
- `index.html`: app principal (login, app-shell y todas las vistas).
- `js/`: un módulo por área. `auth.js` (login y roles), `main.js` (shell/navegación),
  `alumnos.js`, `alumno-portal.js`, `mentores.js`, `coaches.js`, `hitos.js`, `pagos.js`,
  `comunidad-uneq.js`, `configuracion.js`, `firebase-config.js`, `ranking.js` (ranking mensual), `gamificacion-puntos.js`
  (tabla de puntos) y `puntos-marcas.js` (entrada diaria y compartir; los puntos los calcula la función `actualizarRankingProgramado`).
  Pagos: `pagos.js` (acuerdo en la ficha del alumno), `pagos-consolidado.js` (sección Pagos del director: matriz de abonos y cuotas)
  y `util-pagos.js` (cálculos comunes). Ambas vistas leen y escriben `acuerdosPago/{cicloId}`, con cuotas de id estable y `fechaPago`.
- `agendamiento/`: módulo aparte para closers y director comercial (ver `DISENO-AGENDAMIENTO.md`).
- `nps*.html`, `arreglar-correo.html`: páginas sueltas.
- `version.json` + `js/version-check.js`: aviso de nueva versión.

## Roles (`/usuarios/{uid}`)
`director`, `coach`, `mentor`; el alumno se resuelve por `/alumnoPorAuthUid/{uid}`.
**En pantalla el rol `coach` se llama "Copiloto"** (menú, fichas, correos, PDF del acuerdo, IA). Internamente se sigue
llamando `coach` (base de datos, reglas, `coachId`, ids y clases): no se renombra. La ocupación "Coach" del alumno
(profesión) tampoco cambia.
Agendamiento: `agendamiento/staff/{uid}` (closer, director comercial).

## Reglas de trabajo
- Cada cambio va en una rama y un PR; no se trabaja directo en `main` (cada merge a `main` publica).
- Al cambiar JS/CSS/HTML, subir `version.json` (formato `YYYYMMDDx`).
- Todo texto que venga de la base de datos y se pinte con `innerHTML` debe pasar por un escape HTML.
- Las claves de `firebase-config.js` son públicas por diseño; la seguridad real está en las reglas de
  Realtime Database/Storage (no están en el repo, ver `docs/REVISION.md`).
- Idioma de UI y comentarios: español.

## Niveles (programas)
`open` (2 meses, $497.000), `begin`, `next` y `exit`. OPEN se comporta como BEGIN (sin copiloto individual, lo ve el Copiloto de Cabecera, tema visual `tema-begin` + `tema-open`) pero: sin mentorías en vivo generales, BOX de 3 preguntas/semana (1 por mentor) y acceso de 2 meses. Las sesiones en vivo llevan su público: mentorías con `exclusivaPrograma` (`begin`/`open`/vacío = general) y sesiones de cabecera con `audiencia` (`begin`/`open`/`ambos`).

## Chat de soporte (alumnos)
`soporte-chat.js`: burbuja flotante solo para el rol alumno (el bloque `#soporte-chat` lleva `data-role="alumno"`). Llama a la función `chatSoporteAlumno`, que identifica a la persona por su sesión y lee solo SUS datos (programa, fase, copiloto, pagos); el navegador nunca envía un id de alumno. Historial en `soporteChat/{uid}`. Nombre y foto en `configuracion/general` (`soporteIaNombre`, `soporteIaFotoUrl`), editables en Configuración. La guía de la app que usa la IA está en `functions/index.js` (`GUIA_APP_ALUMNO`): si cambia el menú o un programa, hay que actualizarla ahí.

## Precios y moneda
Los precios de los programas (CLP) y el tipo de cambio (CLP por USD) se editan en Configuración > Precios de los programas (`configuracion/general`: `precioOpenClp`, `precioBeginClp`, `precioNextClp`, `precioExitClp`, `tipoCambioUsd`); `ciclos.js` los carga con `cargarPreciosProgramas()` y los de `PROGRAMAS` son solo de respaldo. La moneda del acuerdo depende del país: Chile siempre CLP, extranjero USD (`alumno.residencia`: `chile` | `extranjero`; en alumnos antiguos se deduce de la dirección o del teléfono).

## Alta de alumno (director)
Un solo formulario (Nuevo Alumno): nombre, apellido, teléfono, correo, programa, copiloto (BEGIN y OPEN: el de cabecera, automático; NEXT y eXIT: se elige), fechas de ingreso (hoy) y egreso (según los meses de ACCESO del programa: OPEN 2, BEGIN 4, NEXT 6, eXIT 12; membresía sin egreso fijo), país (define la moneda), monto, descuento, total, abono, cuotas y saldo. Al guardar, el ciclo nace con `acuerdoCerrado: true` y las fechas puestas, así que el copiloto lo ve de inmediato; el resto de la ficha lo completa él. Los meses de acceso están en `PROGRAMAS` (`ciclos.js`). En eXIT el acompañamiento de Maca y Felipe y sus 8 sesiones son solo los primeros 6 meses.

## Laboratorio IA (`js/laboratorio-ia.js`, `js/laboratorio-ia-config.js`, `css/laboratorio-ia.css`)
Sección donde el alumno crea contenido (Reels, carruseles, DMs, WhatsApp) para las 4 etapas del funnel: Atracción, Conexión, Encuentro y Venta (NO son las Fases 1-4 de la metodología 2E, pero se abren según ellas: Fase 3 = ficha 1 y 2 + Atracción/Conexión; Fase 4 = ficha 3 + Encuentro/Venta). Flujo: bienvenida con frase personalizada → la IA arma un borrador de la FICHA (voz, Cliente Soñado, producto) desde los hitos publicados y las notas del copiloto → el alumno la edita y aprueba → un botón por etapa genera las propuestas. Toda la IA corre en el repo de funciones (`functions/laboratorio-ia.js`: `laboratorioAbrir`, `laboratorioBorradorFicha`, `laboratorioGuardarFicha`, `laboratorioGenerar`, `laboratorioConfigDirector`); el navegador nunca manda un id de alumno y la fase la lee el servidor. Datos en `laboratorioIA/` (fichas, generaciones: solo las escribe el servidor; `config` y `prompts`: solo el Director). El Director edita preguntas, etapas, formatos y prompts en Configuración > Laboratorio IA; lo que no toque usa los valores por defecto del servidor. Los alumnos NO lo ven hasta que la dueña avise: `LABORATORIO_ABIERTO_A_ALUMNOS` en `js/main.js` (hoy false; lo ven director, copilotos y el Alumno Demo). El copiloto y el director ven las fichas y contenidos de los alumnos en solo lectura.

## Campos de teléfono
Todos los campos de teléfono llevan selector de país con bandera (`js/telefono-pais.js` + `css/telefono-pais.css`, Chile +56 por defecto). Un campo nuevo solo necesita `type="tel"` o el atributo `data-telefono`: `activarSelectoresTelefono()` lo detecta (también los que se dibujan con JavaScript) y su `.value` sigue siendo el teléfono completo (`+56 987654321`; con `data-telefono-formato="digitos"`, `56987654321`). `data-tel-manual` lo deja para quien lo monte a mano (Nuevo Alumno). La página pública de agendamiento usa intl-tel-input aparte.

## Alumno Demo
Director, copiloto y mentor pueden "Ver como Alumno" (Dashboard; ids `demo-open|begin|next|exit`, `esDemo:true`). En modo demo `document.body` lleva la clase `modo-demo` (`esModoDemo()` en `main.js`) y la sesión queda mapeada en `alumnoPorAuthUid` hasta salir. **Lo que el demo escribe en lo público no lo ven los alumnos reales**: `js/demo.js` marca lo que se guarda (`...marcaDemo()`) y filtra al leer (`sinDemo`, `ocultarParaAlumno`); también reconoce lo antiguo por el id `demo-` o el nombre "(… · DEMO)". Cada lugar nuevo donde un alumno escriba algo visible para otros debe usar `marcaDemo()` y filtrar al mostrarlo. En las funciones el demo se excluye del ranking y de los avisos. La sección Contenidos solo la ven el staff y el Alumno Demo mientras no se abra a los alumnos.
