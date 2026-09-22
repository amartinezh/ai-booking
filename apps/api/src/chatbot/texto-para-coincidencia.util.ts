/**
 * Normaliza un mensaje del paciente ANTES de compararlo con los diccionarios
 * anclados del bot ("hola", "particular", "cancelar cita", "chao"…).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * POR QUE HACE FALTA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Los patrones de `chatbot-patterns.txt` se compilan a expresiones ANCLADAS
 * (`/^(hola)$/i`). Comparadas contra el texto crudo, cualquier adorno las
 * tumba. Y los adornos no son raros: los pone el propio bot.
 *
 *   · «también puede escribirme *"Hola"*»  → llega `"Hola"` (o `*"Hola"*`).
 *     Las comillas son texto LITERAL que el bot imprimió; los asteriscos son
 *     el marcado de WhatsApp, que viaja al copiar un mensaje.
 *   · «agendar como *Particular*»          → llega `*Particular*`.
 *   · «responda *cancelar cita*»           → llega `*cancelar cita*`.
 *
 * Copiar la frase que a uno le dan es lo más natural del mundo — y estas tres
 * son SALIDAS DE EMERGENCIA: las lee alguien a quien el bot ya le dijo que no.
 * Si fallan, el paciente se queda sin camino de vuelta.
 *
 * Hay un segundo caso, menos visible y probablemente más frecuente: las
 * TRANSCRIPCIONES de las notas de voz vienen puntuadas. Un paciente que dice
 * «hola» por audio produce `Hola.`, que contra `/^(hola)$/i` tampoco coincide.
 *
 * Se confirmó el 2026-09-22 que `"Hola"` SÍ funciona desde una sesión cerrada
 * —estando en reposo el bot da la bienvenida ante casi cualquier cosa—, así
 * que el agujero no está en el arranque sino A MITAD de conversación, que es
 * donde estas palabras son la única salida.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠️ SOLO PARA COMPARAR, NUNCA PARA GUARDAR
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Esto destruye información a propósito. El nombre, la cédula y la dirección
 * del paciente se guardan SIEMPRE con el texto original: aquí un apellido como
 * «D'Angelo» perdería el apóstrofo. Úsese al decidir «¿esto es un saludo?»,
 * jamás al construir lo que se escribe en la historia clínica.
 *
 * Tampoco quita tildes: los diccionarios distinguen «adios» de «adiós» y los
 * listan por separado. Quitarlas aquí obligaría a reescribirlos.
 *
 * Se comprobó que NINGÚN patrón de `chatbot-patterns.txt` contiene signos de
 * puntuación, así que esta normalización no puede impedir una coincidencia
 * que antes ocurriera: solo permite las que antes se perdían.
 */
export function textoParaCoincidencia(
  texto: string | undefined | null,
): string {
  if (!texto) return '';
  return (
    texto
      .toLowerCase()
      // Signos, comillas, asteriscos, emojis → espacio. Espacio y no vacío:
      // así «cancelar-cita» se vuelve «cancelar cita» y no «cancelarcita».
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
