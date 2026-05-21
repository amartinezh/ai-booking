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
REGLA DE ESCAPE: Si el usuario quiere reiniciar, volver atrás o salir del flujo (ej: "me equivoqué", "salir", "volver", "reiniciar"), pon "isEscape" en true. (NOTA: "cancelar cita" es isCancellation, NO isEscape). Saludos como "Hola" no son escape.
REGLA DE FUERA DE CONTEXTO: Si el paciente toca temas sin relación médica (no ofensivos), pon "outOfContext" en true e "intent" en "otro". Si es ofensivo, usa "insulto_abuso".
REGLA DE RUIDO: Si el audio es vacío, inentendible o solo hay ruido, pon "ininteligible" en true.

Devuelve ÚNICAMENTE JSON válido sin bloques de código:
{
    "intent": "agendar_cita | consulta_faq | insulto_abuso | otro",
    "cedula": "Número sin puntos (Ej: 1088123456). Si no menciona, null.",
    "nombre": "Nombre completo. Si no menciona, null.",
    "eps": "Nombre de EPS o aseguradora. Si no menciona, null.",
    "especialidad": "Especialidad médica normalizada. Si no menciona, null.",
    "doctor": "Nombre del médico si pide uno específico. Si no menciona, null.",
    "fechaSolicitada": "Fecha o franja en lenguaje natural tal como la dijo el paciente (ej: 'mañana', 'el lunes', '25 de mayo'). Si no menciona, null.",
    "isEscape": false,
    "outOfContext": false,
    "ininteligible": false,
    "isCancellation": false
}`;
