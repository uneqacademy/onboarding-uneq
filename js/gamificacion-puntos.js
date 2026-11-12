/* ============================================================
   gamificacion-puntos.js — acciones que dan puntos en el ranking.
   Los valores de aquí son los iniciales; el director los edita en
   Configuración (configuracion/gamificacion/puntos). El cálculo real
   lo hace la función actualizarRankingProgramado (repo de funciones),
   que tiene esta misma tabla como respaldo.
   tope = máximo de veces por día que suma esa acción (0 = sin tope).
   topeEditable: false cuando la acción ya tiene un límite natural.
   ============================================================ */

// Mientras Contenidos no esté abierto a los alumnos, sus acciones no se muestran en "Cómo sumar puntos".
// Cuando se abra la sección a los alumnos, cambiar a true.
export const CONTENIDOS_ABIERTO_A_ALUMNOS = false;

export const ACCIONES_PUNTOS = [
  { clave: 'hito', etiqueta: 'Publicar un hito', puntos: 20, tope: 0, topeEditable: true },
  { clave: 'presentacion', etiqueta: 'Presentación aprobada', puntos: 30, tope: 0, topeEditable: false },
  { clave: 'historia', etiqueta: 'Publicar una Historia real', puntos: 30, tope: 0, topeEditable: true },
  { clave: 'preguntaComunidad', etiqueta: 'Publicar una Pregunta de la Comunidad', puntos: 10, tope: 3, topeEditable: true },
  { clave: 'preguntaBox', etiqueta: 'Hacer una pregunta al BOX', puntos: 5, tope: 3, topeEditable: true },
  { clave: 'comentario', etiqueta: 'Comentar en una publicación de otro alumno', puntos: 3, tope: 5, topeEditable: true },
  { clave: 'reaccionRecibida', etiqueta: 'Recibir un ❤️ en tu publicación', puntos: 1, tope: 10, topeEditable: true },
  { clave: 'comentarioRecibido', etiqueta: 'Recibir un comentario en tu publicación', puntos: 2, tope: 10, topeEditable: true },
  { clave: 'entrada', etiqueta: 'Entrar a la app (una vez al día)', puntos: 1, tope: 1, topeEditable: false },
  { clave: 'compartir', etiqueta: 'Compartir una publicación por WhatsApp', puntos: 2, tope: 3, topeEditable: true },
  { clave: 'fase', etiqueta: 'Pasar de fase', puntos: 50, tope: 0, topeEditable: false },
  // Contenidos (clases). Entre estas cuatro hay un tope diario conjunto de 30 puntos (lo aplica el servidor).
  { clave: 'claseConcluida', etiqueta: 'Concluir una lección (cada una cuenta una vez; hay que haber visto al menos el 70% del video)', puntos: 5, tope: 5, topeEditable: true, deContenidos: true },
  { clave: 'comentarioClase', etiqueta: 'Comentar en una lección (mínimo 15 letras)', puntos: 3, tope: 5, topeEditable: true, deContenidos: true },
  { clave: 'comentarioClaseRecibido', etiqueta: 'Recibir una respuesta a tu comentario de una lección', puntos: 1, tope: 5, topeEditable: true, deContenidos: true },
  { clave: 'valoracionClase', etiqueta: 'Valorar una lección con estrellas (una vez por lección)', puntos: 1, tope: 3, topeEditable: true, deContenidos: true },
  { clave: 'tiempoVideo', etiqueta: 'Ver video de las lecciones (cada 5 minutos realmente vistos)', puntos: 1, tope: 8, topeEditable: true, deContenidos: true },
  { clave: 'moduloCompleto', etiqueta: 'Completar un módulo entero (con 2 lecciones o más)', puntos: 25, tope: 0, topeEditable: false, deContenidos: true }
];

// Mezcla lo guardado con los valores iniciales (lo que falte o venga mal usa el inicial).
export function tablaPuntos(guardada) {
  return ACCIONES_PUNTOS.map(a => {
    const g = (guardada && guardada[a.clave]) || {};
    return {
      ...a,
      puntos: typeof g.puntos === 'number' && g.puntos >= 0 ? g.puntos : a.puntos,
      tope: typeof g.tope === 'number' && g.tope >= 0 ? g.tope : a.tope
    };
  });
}
