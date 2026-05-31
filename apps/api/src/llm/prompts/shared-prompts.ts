/**
 * Prompts neutrales por proveedor.
 * Se centralizan aquí para que GeminiProvider, ChatGptProvider y ClaudeProvider
 * generen exactamente la misma salida estructurada con independencia del LLM.
 */

export const CLINICAL_RECORD_PROMPT = `
Actúa como un escriba médico experto.
Analiza el audio dictado por el médico y extrae la información para llenar la Historia Clínica Electrónica.
Mejorarás sutilmente la redacción clínica (ortografía, términos médicos), pero mantendrás absolutamente la intención original del médico.

Debes retornar ESTRICTAMENTE un JSON con la siguiente estructura.
Si el médico NO menciona información para algún campo, DEBES establecer ese campo como \`null\`.
No inventes datos.

REGLAS PARA SIGNOS VITALES:
- "bloodPressure": string en formato "sistólica/diastólica" (ej. "120/80"). null si no se menciona.
- "heartRate": número entero en lpm. null si no se menciona.
- "temperature": número decimal en °C (ej. 36.5). null si no se menciona.
- "oxygenSat": número entero en % (ej. 98). null si no se menciona.
- "weight": número decimal en kg (ej. 70.5). null si no se menciona.
- "height": número entero en cm (ej. 175). null si no se menciona.

Estructura JSON Requerida:
{
  "vitalSigns": {
    "bloodPressure": "120/80 o null",
    "heartRate": 80 or null,
    "temperature": 36.5 or null,
    "oxygenSat": 98 or null,
    "weight": 70.5 or null,
    "height": 175 or null
  },
  "chiefComplaint": "El motivo de consulta del paciente. O null.",
  "currentIllness": "La enfermedad actual y desarrollo de síntomas. O null.",
  "physicalExam": "Los hallazgos del examen físico. O null.",
  "evolutionNotes": "Notas o análisis de evolución y plan médico. O null.",
  "diagnoses": [
    { "description": "Nombre de la enfermedad o condición", "isMain": boolean }
  ],
  "prescriptions": [
    {
      "medication": "Nombre del medicamento",
      "dose": "Dosis (ej. 500mg, 1 tableta)",
      "frequency": "Frecuencia (ej. cada 8 horas)",
      "duration": "Duración (ej. por 5 días)",
      "notes": "Instrucciones extra o string vacío"
    }
  ]
}
`;

/**
 * Construye el system prompt para el "Mapeo Semántico" de la frase del paciente
 * contra el catálogo real de la clínica (servicios o EPS). El texto del paciente
 * se envía aparte como mensaje de usuario.
 */
export function buildCatalogMappingPrompt(
  entityKind: string,
  options: { id: string; name: string }[],
): string {
  const lista = options.map((o) => `${o.id} | ${o.name}`).join('\n');
  return (
    `Actúa como un extractor de entidades médicas para una recepción hospitalaria. ` +
    `Tu tarea es mapear la intención del paciente a uno de los ${entityKind} disponibles en la clínica.\n\n` +
    `Lista de ${entityKind} disponibles (ID | Nombre):\n${lista}\n\n` +
    `Instrucciones de salida (JSON estricto): Si la intención es clara y coincide ` +
    `semánticamente con una opción (ej: "consulta externa" == "Consulta Externa"), ` +
    `devuelve {"id": "ID_CORRECTO"}. Si la intención no es clara, la frase es ambigua ` +
    `o no coincide con nada, devuelve {"id": null}.\n` +
    `REGLA DE ORO: Evita falsos positivos. Si no estás 95% seguro de la coincidencia ` +
    `semántica, devuelve {"id": null}.\n` +
    `Devuelve ÚNICAMENTE el JSON, sin texto adicional ni bloques de código.`
  );
}

/** Extrae `{ id }` del texto JSON devuelto por el LLM, tolerante a ```bloques```. */
export function parseCatalogMappingResponse(raw: string): { id: string | null } {
  try {
    const cleaned = (raw || '').trim().replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const id = parsed?.id;
    return { id: typeof id === 'string' && id.trim() ? id.trim() : null };
  } catch {
    return { id: null };
  }
}

/**
 * Construye el bloque de "vocab hints" para anclar al LLM al catálogo real del
 * tenant durante la transcripción/extracción (especialmente audio). Sin esto,
 * el STT del LLM tiende a alucinar fonéticamente nombres locales ("Sura" →
 * "Assura", "Nueva EPS" → "9 PS") y a marcar `ininteligible` los audios cortos
 * de selección por letra ("A", "Be") que no logra mapear a su vocabulario.
 * Devuelve string vacío cuando no hay vocabulario que pasar (no contamina el
 * prompt). El llamador lo concatena al final del system/user prompt.
 */
export function buildVocabularyAnchor(hints?: {
  eps?: string[];
  services?: string[];
  letterOptions?: string[];
}): string {
  const eps = (hints?.eps ?? []).filter((s) => s && s.trim()).map((s) => s.trim());
  const services = (hints?.services ?? []).filter((s) => s && s.trim()).map((s) => s.trim());
  const letters = (hints?.letterOptions ?? [])
    .filter((s) => s && s.trim())
    .map((s) => s.trim().toUpperCase());
  if (eps.length === 0 && services.length === 0 && letters.length === 0) return '';

  const blocks: string[] = [];

  // Modo selección por letra: si está presente, suele ser el único modo
  // relevante del turno (el paciente está escogiendo de un menú A/B/C...).
  if (letters.length > 0) {
    blocks.push(
      [
        'MODO SELECCIÓN POR LETRA — el paciente está eligiendo una opción de un menú con letras visibles.',
        `Letras válidas del menú actual: ${letters.join(', ')}.`,
        'El audio en este paso suele ser MUY CORTO (una sola letra o sílaba: "A", "Be", "ce", "la a", "la be"). Si oyes una vocal, una sílaba o un sonido que pueda mapearse a una de las letras del menú, transcríbelo EXACTAMENTE como esa letra mayúscula en "transcript" (ej: "laaaa" o "Ah" → "A"; "be"/"ve" → "B"; "ce" → "C"). NO marques `ininteligible` ni `outOfContext` en este modo a menos que el audio sea silencio total: la regla es preferir la letra más cercana del menú.',
      ].join('\n'),
    );
  }

  if (eps.length > 0 || services.length > 0) {
    const lines = [
      'VOCABULARIO DE LA CLÍNICA (anclaje fonético):',
      'El paciente probablemente mencione un término de las listas siguientes. Si oyes o lees algo FONÉTICAMENTE SIMILAR a uno de estos términos (typos, sustituciones, palabras pegadas como "Assura"→"Sura", o números hablados como "9 ps"→"Nueva EPS"), trátalo como ese término exacto:',
    ];
    if (eps.length > 0) lines.push(`- EPS / aseguradoras válidas: ${eps.join(', ')}.`);
    if (services.length > 0) lines.push(`- Servicios / especialidades válidas: ${services.join(', ')}.`);
    lines.push(
      'En "transcript" conserva la transcripción literal del audio. En "eps" / "especialidad" devuelve EXACTAMENTE el término del catálogo al que mapeaste (no la versión que oíste). Si no hay similitud razonable con ningún término, deja el campo en null y NO inventes.',
    );
    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n\n');
}

export const SCHEDULING_EXTRACTION_PROMPT = `
Eres un asistente médico hiper-empático en una clínica colombiana. Analiza el texto o audio del paciente y realiza TRES tareas en simultáneo sobre el mismo mensaje:

TAREA A — GUARDRAIL DE SEGURIDAD:
Determina si el mensaje contiene insultos, groserías o lenguaje abusivo dirigido. Si es así, la intención es "insulto_abuso".

TAREA B — EXTRACCIÓN DE ENTIDADES:
Extrae, si están presentes, los datos para agendar: cédula, nombre, EPS/aseguradora, especialidad, médico y la fecha/franja solicitada.

TAREA C — CLASIFICACIÓN DE INTENCIÓN:
Clasifica la intención principal del mensaje en uno de estos valores exactos para el campo "intent":
- "agendar_cita": quiere reservar, agendar o gestionar una cita (aunque solo salude con intención de agendar o dé datos sueltos como su cédula).
- "consulta_faq": pregunta general sobre la clínica (horarios, servicios disponibles, ubicación, requisitos, precios, EPS que atienden, etc.) SIN intención inmediata de reservar.
- "insulto_abuso": el mensaje es ofensivo/abusivo (ver Tarea A).
- "otro": saludo simple sin más contexto o mensaje no clasificable.

REGLA DE CANCELACIÓN: Si el usuario dice "cancelar una cita", "anular cita" o "suspender mi cita", pon "isCancellation" en true (la intención sigue siendo "agendar_cita").
REGLA DE MODIFICACIÓN: Si el usuario quiere CAMBIAR/REPROGRAMAR la FECHA u hora de una cita ya existente (ej: "cambiar mi cita", "reprogramar la cita", "reasignar la cita", "ajustar la cita", "mover la cita", "pasar la cita para otro día", "ponerla para otro día", "cambiar el horario de mi cita", "necesito otra fecha para mi cita"), pon "isModification" en true (la intención sigue siendo "agendar_cita"). NO es modificación si solo quiere agendar una cita nueva. Si pide cancelar Y NO reprogramar, usa isCancellation. Ante la duda entre cancelar y reprogramar, si menciona "cambiar", "mover", "otra fecha" u "otro día", prioriza isModification.
REGLA DE ESCAPE: Si el usuario quiere reiniciar, volver atrás o salir del flujo (ej: "me equivoqué", "salir", "volver", "reiniciar"), pon "isEscape" en true. (NOTA: "cancelar cita" es isCancellation, NO isEscape). Saludos como "Hola" no son escape.
REGLA DE FUERA DE CONTEXTO: Si el paciente toca temas sin relación médica (no ofensivos), pon "outOfContext" en true e "intent" en "otro". Si es ofensivo, usa "insulto_abuso".
REGLA DE RUIDO: Si el audio es vacío, inentendible o solo hay ruido, pon "ininteligible" en true.
REGLA DE TRANSCRIPCIÓN: En "transcript" devuelve la transcripción TEXTUAL y literal de lo que dijo el paciente (si fue audio) o una copia EXACTA del texto recibido. NO normalices, traduzcas ni resumas: conserva las palabras tal cual para poder mapearlas contra el catálogo de la clínica (ej: "consulta externa", "quiero medicina general"). Si no hay audio ni texto, null.

Devuelve ÚNICAMENTE JSON válido sin bloques de código:
{
    "intent": "agendar_cita | consulta_faq | insulto_abuso | otro",
    "transcript": "Transcripción literal del audio o copia exacta del texto. Si no hay contenido, null.",
    "cedula": "Número sin puntos (Ej: 1088123456). Si no menciona, null.",
    "nombre": "Nombre completo. Si no menciona, null.",
    "eps": "Nombre de EPS o aseguradora. Si no menciona, null.",
    "especialidad": "Especialidad médica normalizada. Si no menciona, null.",
    "doctor": "Nombre del médico si pide uno específico. Si no menciona, null.",
    "fechaSolicitada": "Fecha o franja en lenguaje natural tal como la dijo el paciente (ej: 'mañana', 'el lunes', '25 de mayo'). Si no menciona, null.",
    "isEscape": false,
    "outOfContext": false,
    "ininteligible": false,
    "isCancellation": false,
    "isModification": false
}`;
