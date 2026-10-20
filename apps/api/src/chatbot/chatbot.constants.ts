export enum ChatState {
  IDLE = 'IDLE',
  AWAITING_SPECIALTY = 'AWAITING_SPECIALTY',
  AWAITING_EPS = 'AWAITING_EPS',
  AWAITING_DATE = 'AWAITING_DATE',
  AWAITING_NAME = 'AWAITING_NAME',
  // Los apellidos van en su PROPIA pregunta, no pegados al nombre.
  //
  // El HIS guarda nombres y apellidos en cuatro columnas separadas, y partir
  // "JUAN CARLOS PEREZ" es imposible sin adivinar: puede ser un nombre y dos
  // apellidos, o dos nombres y un apellido. Preguntando por separado, la
  // frontera la pone el paciente y no hay nada que adivinar.
  AWAITING_APELLIDOS = 'AWAITING_APELLIDOS',
  // Alta de paciente nuevo. El HIS del hospital exige nacimiento y sexo NOT
  // NULL en PACIENTES, y el régimen decide el convenio de facturación. Solo
  // se recorren cuando el paciente NO existe todavía: a quien ya está
  // registrado no se le pregunta nada de esto.
  AWAITING_BIRTHDATE = 'AWAITING_BIRTHDATE',
  AWAITING_GENDER = 'AWAITING_GENDER',
  AWAITING_REGIME = 'AWAITING_REGIME',
  AWAITING_CEDULA = 'AWAITING_CEDULA',
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  AWAITING_CANCEL_CEDULA = 'AWAITING_CANCEL_CEDULA',
  // La cédula consultada no tenía citas: preguntamos si desea intentar con otra
  // (SÍ → vuelve a AWAITING_CANCEL_CEDULA; NO → cierra). El loop también lo cierra
  // el cron de inactividad si el paciente deja de responder.
  AWAITING_CANCEL_RETRY_CEDULA = 'AWAITING_CANCEL_RETRY_CEDULA',
  AWAITING_CANCEL_SELECTION = 'AWAITING_CANCEL_SELECTION',
  AWAITING_CANCEL_CONFIRM = 'AWAITING_CANCEL_CONFIRM',
  AWAITING_WAITLIST_CONFIRM = 'AWAITING_WAITLIST_CONFIRM',
  AWAITING_WAITLIST_OPTIN = 'AWAITING_WAITLIST_OPTIN',
  AWAITING_POST_CANCEL_CHOICE = 'AWAITING_POST_CANCEL_CHOICE',
  // Estado de transición: el paciente pidió cancelar mientras agendaba.
  // Guardamos el estado previo y esperamos un SÍ/NO antes de abortar.
  AWAITING_INTERRUPT_CONFIRMATION = 'AWAITING_INTERRUPT_CONFIRMATION',
  // ── FLUJO DE MODIFICACIÓN (reprogramación de fecha) ──────────
  // El paciente quiere cambiar la fecha de una cita existente. Pasos:
  //   CEDULA → SELECTION (si tiene varias) → NEW_SLOT → CONFIRM.
  // Si no hay cupos para reprogramar, NO_SLOTS_CANCEL ofrece cancelarla.
  AWAITING_MODIFY_CEDULA = 'AWAITING_MODIFY_CEDULA',
  // La cédula consultada no tenía citas: preguntamos si desea intentar con otra
  // (SÍ → vuelve a AWAITING_MODIFY_CEDULA; NO → cierra). El loop también lo cierra
  // el cron de inactividad si el paciente deja de responder.
  AWAITING_MODIFY_RETRY_CEDULA = 'AWAITING_MODIFY_RETRY_CEDULA',
  AWAITING_MODIFY_SELECTION = 'AWAITING_MODIFY_SELECTION',
  AWAITING_MODIFY_NEW_SLOT = 'AWAITING_MODIFY_NEW_SLOT',
  AWAITING_MODIFY_CONFIRM = 'AWAITING_MODIFY_CONFIRM',
  AWAITING_MODIFY_NO_SLOTS_CANCEL = 'AWAITING_MODIFY_NO_SLOTS_CANCEL',
  // ── CONSULTA DE CITAS ("¿qué citas tengo?") ──────────────────
  // Solo lectura. Se pide la cédula cuando el remitente no identifica a un
  // único paciente; el detalle solo se muestra si quien escribe es el paciente
  // (si no, una respuesta mínima y se cierra). Tras el detalle, CHOICE ofrece
  // cancelar / reprogramar / agendar otra / nada más.
  AWAITING_LOOKUP_CEDULA = 'AWAITING_LOOKUP_CEDULA',
  AWAITING_LOOKUP_CHOICE = 'AWAITING_LOOKUP_CHOICE',
}

// Nombre canónico del registro EPS para pago directo (debe existir en BD por org).
// Fuente única de verdad en @agenia/shared; se re-exporta para no romper los
// imports existentes (`from './chatbot.constants'`).
export { PARTICULAR_EPS_NAME } from '@agenia/shared';

// Valor por defecto de reintentos. La cifra efectiva se lee de OrganizationSettings.
export const DEFAULT_MAX_RETRIES = 3;

// Tiempo de expiración de la sesión conversacional en Redis (1 hora)
export const SESSION_TTL = 3600;

// Cuánto recuerda el bot que ya se presentó («Le saluda Vicente…»). Dentro de
// esta ventana el menú de servicios sale sin presentación: tras un «comencemos
// de nuevo» volver a presentarse suena a que el bot no escuchó. La despedida y
// el cierre por inactividad la borran antes: una conversación nueva sí saluda.
export const PRESENTACION_TTL = 30 * 60;

// Cuánto recuerda el bot que ya le dijo a alguien de qué cita le escribimos tras
// su recordatorio (2026-10-22). Con agendar encendido, el siguiente saludo dentro
// de esta ventana abre el menú de siempre: ya sabe de su cita y busca otra cosa.
export const SALUDO_TRAS_RECORDATORIO_TTL = 6 * 60 * 60;

/**
 * Ventana de atención de Meta: 24 h desde el último mensaje del paciente.
 * Dentro se puede responder con texto libre; fuera hay que usar una plantilla
 * aprobada. En segundos, para el TTL de la clave en Redis.
 */
export const SERVICE_WINDOW_TTL = 24 * 60 * 60;

// Longitud mínima de dígitos para considerar una cédula válida.
export const MIN_CEDULA_LENGTH = 4;

// Timeout para el mapeo semántico de catálogo (servicio/EPS) vía LLM.
// Si la API tarda más, caemos al menú determinista (no degrada la UX de voz).
export const SEMANTIC_MAP_TIMEOUT_MS = 2500;

// Tiempo máximo para confirmar un cupo de waitlist (30 minutos)
export const WAITLIST_CONFIRM_TTL = 1800;

// Nombre del asistente (usado en todos los mensajes)
export const BOT_NAME = 'AgenIA';

// Estilos de comunicación soportados por el chatbot.
// Reflejan el enum CommunicationStyle del schema Prisma.
export type CommStyle = 'FORMAL' | 'INFORMAL';

// ─────────────────────────────────────────────────────────────
// Aviso de tratamiento de datos (Ley 1581 de 2012 — Habeas Data).
// Se inserta en el resumen previo a la confirmación de la cita: el
// "SÍ" del paciente en ese paso es el acto afirmativo que autoriza
// el tratamiento de sus datos personales y sensibles de salud.
// Mantener una sola fuente de verdad para el texto legal.
// ─────────────────────────────────────────────────────────────
// `policyUrl` (de PRIVACY_POLICY_URL en el .env) se enlaza en una línea aparte
// cuando está configurada; si falta, el aviso legal se mantiene sin el enlace.
export const CONSENT_1581_FORMAL = (policyUrl?: string) =>
  `🔒 Al responder *SÍ* confirma su asistencia y autoriza el tratamiento de sus ` +
  `datos personales —incluidos los datos sensibles de salud necesarios para su ` +
  `atención— conforme a la Ley 1581 de 2012 y nuestra política de tratamiento de datos.` +
  (policyUrl ? `\n📄 Consúltela aquí: ${policyUrl}` : '');

export const CONSENT_1581_INFORMAL = (policyUrl?: string) =>
  `🔒 Al responder *SÍ* confirmas tu asistencia y autorizas el tratamiento de tus ` +
  `datos personales —incluidos los datos sensibles de salud necesarios para tu ` +
  `atención— conforme a la Ley 1581 de 2012 y nuestra política de privacidad.` +
  (policyUrl ? `\n📄 Consúltala aquí: ${policyUrl}` : '');

// ─────────────────────────────────────────────────────────────
// SOLO CONSULTAS — la clínica apagó en /dashboard/configuracion las TRES
// operaciones del bot: agendar, cancelar y cambiar citas (`bookingEnabled`,
// `cancelEnabled`, `rescheduleEnabled`). El paciente solo consulta; a
// cualquier otra operación se le responde esto. Con solo una o dos apagadas
// se usa OPERACIÓN NO DISPONIBLE (abajo).
// `contacto` sale de contactoClinica / contactoClinicaSinTelefono.
// ─────────────────────────────────────────────────────────────
const SOLO_CONSULTAS_FORMAL = (contacto: string) =>
  `En este momento la plataforma no está activa para agendar, cancelar ni cambiar citas; solo está activa la *consulta de sus citas*. 🔍\n\n` +
  `Para agendar una cita o hacer cualquier cambio, por favor comuníquese con ${contacto}.\n\n` +
  `Si desea ver sus citas, escríbame *"consultar"*.`;

const SOLO_CONSULTAS_INFORMAL = (contacto: string) =>
  `Por ahora la plataforma no está activa para agendar, cancelar ni cambiar citas; solo está activa la *consulta de tus citas*. 🔍\n\n` +
  `Para agendar una cita o hacer cualquier cambio, comunícate con ${contacto}. 🙏\n\n` +
  `Si quieres ver tus citas, escríbeme *"consultar"*.`;

// ─────────────────────────────────────────────────────────────
// OPERACIÓN NO DISPONIBLE — la clínica apagó en /dashboard/configuracion UNA o
// dos de las operaciones del bot (agendar, cancelar, cambiar la fecha), no las
// tres (eso es SOLO CONSULTAS, arriba). El aviso dice cuál no está, con quién
// hacerla y qué SÍ se puede por aquí, con la frase exacta que lo abre.
//
// Los mensajes del pool reciben TEXTO ya armado (como `menuServicios` recibe
// sus `lineas`); estas piezas, iguales en los dos estilos, son con las que el
// servicio lo arma.
// ─────────────────────────────────────────────────────────────
export type OperacionDelPaciente = 'AGENDAR' | 'CANCELAR' | 'MODIFICAR';

/** Una opción del menú tras consultar las citas («¿Desea hacer algo con ellas?»). */
export type OpcionConsulta = OperacionDelPaciente | 'NADA';

/** Orden y texto de las opciones tras la consulta. */
export const OPCIONES_CONSULTA: ReadonlyArray<{
  opcion: OpcionConsulta;
  etiqueta: string;
}> = [
  { opcion: 'CANCELAR', etiqueta: 'Cancelar una cita' },
  { opcion: 'MODIFICAR', etiqueta: 'Cambiar la fecha de una cita' },
  { opcion: 'AGENDAR', etiqueta: 'Agendar una cita nueva' },
  { opcion: 'NADA', etiqueta: 'Nada más, gracias' },
];

/** Cómo se nombra cada operación en los avisos, y la frase que la abre. */
export const TEXTO_OPERACION: Record<
  OperacionDelPaciente,
  { nombre: string; hacerla: string; etiqueta: string; atajo: string }
> = {
  AGENDAR: {
    nombre: 'agendar citas',
    hacerla: 'agendar una cita',
    etiqueta: 'Agendar una cita',
    atajo: '"Hola"',
  },
  CANCELAR: {
    nombre: 'cancelar citas',
    hacerla: 'cancelar una cita',
    etiqueta: 'Cancelar una cita',
    atajo: '"cancelar cita"',
  },
  MODIFICAR: {
    nombre: 'cambiar la fecha de una cita',
    hacerla: 'cambiar la fecha de una cita',
    etiqueta: 'Cambiar la fecha de una cita',
    atajo: '"cambiar cita"',
  },
};

/** «a», «a o b», «a, b o c». */
export const unirConO = (partes: string[]): string =>
  partes.length <= 1
    ? (partes[0] ?? '')
    : `${partes.slice(0, -1).join(', ')} o ${partes[partes.length - 1]}`;

/** Las opciones tras la consulta, con su letra: «*A)* Cancelar una cita». */
export const lineasOpcionesConsulta = (opciones: OpcionConsulta[]): string =>
  opciones
    .map((o, i) => {
      const etiqueta = OPCIONES_CONSULTA.find((x) => x.opcion === o)!.etiqueta;
      return `*${String.fromCharCode(65 + i)})* ${etiqueta}`;
    })
    .join('\n');

/** «*A*, *B*, *C* o *D*» para las opciones mostradas. */
export const letrasOpcionesConsulta = (opciones: OpcionConsulta[]): string =>
  unirConO(opciones.map((_, i) => `*${String.fromCharCode(65 + i)}*`));

/** «cancelar una cita o cambiar la fecha de una cita»: lo que no se puede. */
export const accionesNoDisponibles = (ops: OperacionDelPaciente[]): string =>
  unirConO(
    ops.map((o) =>
      o === 'AGENDAR' ? 'agendar una cita nueva' : TEXTO_OPERACION[o].hacerla,
    ),
  );

// ─────────────────────────────────────────────────────────────
// LÍMITE DE CITAS POR PACIENTE — el paciente ya tiene el máximo de citas que
// la clínica permite el mismo día o el mismo mes (/dashboard/limites-citas).
// El aviso se disculpa, explica el límite, remite al teléfono del hospital y
// cierra con la revisión: el enlace para pedirla (`limiteCitasRevisionEnlace`),
// el aviso de que ya hay una en curso (`limiteCitasRevisionEnCurso`) o nada
// (el paciente ya radicó el máximo). Lleva un enlace: va como TEXTO, nunca a
// voz. Hay un mensaje por caso (día/mes × agendar/cambiar la fecha); las
// piezas las arma el servicio con estas funciones, iguales en los dos estilos.
// ─────────────────────────────────────────────────────────────

/** «una cita», «2 citas». */
export const unaOVariasCitas = (n: number): string =>
  n === 1 ? 'una cita' : `${n} citas`;

// ─────────────────────────────────────────────────────────────
// Helper: selección pseudo-aleatoria de variantes.
// Permite que el bot no repita exactamente la misma frase cada vez.
// ─────────────────────────────────────────────────────────────
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ═════════════════════════════════════════════════════════════
// POOL FORMAL  — Voz: recepcionista clínica institucional, "usted",
// tono neutral y resolutivo. Sin diminutivos, sin interjecciones
// emocionales y con emojis limitados a función estructural.
// Estructura clara con viñetas A) B) C) en líneas separadas.
// ═════════════════════════════════════════════════════════════
const FORMAL = {
  bienvenida: (
    clinicaName: string,
    servicios: string,
    botName: string = BOT_NAME,
  ) =>
    pick([
      `Buen día, soy *${botName}*, asistente de *${clinicaName}*.\n\n` +
        `Con gusto le ayudo a agendar su cita de forma ágil. 🏥\n\n` +
        `¿Para qué especialidad necesita su cita hoy?\n` +
        `_${servicios}_`,
      `Le saluda *${botName}*, su asistente de *${clinicaName}*.\n\n` +
        `Estoy a su disposición para agendar su cita de manera ágil y sencilla. 🏥\n\n` +
        `¿En qué servicio le puedo colaborar el día de hoy?\n` +
        `_${servicios}_`,
      `Bienvenido(a) a *${clinicaName}*. Soy *${botName}*, su asistente virtual.\n\n` +
        `Será un gusto ayudarle con su agendamiento. 🏥\n\n` +
        `Para comenzar, ¿qué especialidad está buscando?\n` +
        `_${servicios}_`,
    ]),

  menuServicios: (
    clinicaName: string,
    lineas: string,
    botName: string = BOT_NAME,
  ) =>
    pick([
      `Le saluda *${botName}*, su asistente en *${clinicaName}*.\n\n` +
        `Con gusto le ayudo a agendar su cita el día de hoy. 🏥\n\n` +
        `*¿En qué servicio le puedo colaborar?* Puede responder con la letra:\n\n` +
        `${lineas}\n` +
        `_También puede escribir el nombre del servicio o enviar un audio de voz._ 🎙️`,
      `Le habla *${botName}*, de *${clinicaName}*.\n\n` +
        `Permítame ayudarle a reservar su cita médica de forma ágil. 🏥\n\n` +
        `*¿Qué servicio necesita?* Estas son las opciones disponibles:\n\n` +
        `${lineas}\n` +
        `_Puede responder con la letra, el nombre del servicio o un audio._ 🎙️`,
      `Soy *${botName}*, su asistente virtual de *${clinicaName}*.\n\n` +
        `Estoy aquí para que su agendamiento sea sencillo. 🏥\n\n` +
        `*¿Cuál de estos servicios necesita hoy?*\n\n` +
        `${lineas}\n` +
        `_Responda con la letra, escriba el nombre o envíe un audio, como prefiera._ 🎙️`,
    ]),

  // El mismo menú, sin presentarse: el bot ya lo hizo en esta conversación.
  menuServiciosSinPresentacion: (lineas: string) =>
    pick([
      `Con gusto le ayudo. 🏥\n\n` +
        `*¿En qué servicio le puedo colaborar?* Puede responder con la letra:\n\n` +
        `${lineas}\n` +
        `_También puede escribir el nombre del servicio o enviar un audio de voz._ 🎙️`,
      `Claro que sí. 🏥\n\n` +
        `*¿Qué servicio necesita?* Estas son las opciones disponibles:\n\n` +
        `${lineas}\n` +
        `_Puede responder con la letra, el nombre del servicio o un audio._ 🎙️`,
    ]),

  servicioInvalido: (lineas: string) =>
    pick([
      `Disculpe, no logré entender bien su respuesta.\n\n` +
        `¿Me podría confirmar el servicio? Puede responder con la letra ` +
        `_(ej: A, B, C...)_ o escribir el nombre directamente.\n\n${lineas}`,
      `Esa opción no se logró identificar.\n\n` +
        `Intentémoslo de nuevo: responda con la letra _(A, B, C...)_ o escriba el nombre del servicio.\n\n${lineas}`,
      `El sistema no logró interpretar su respuesta. ¿Lo intentamos otra vez?\n\n` +
        `Puede elegir una letra _(A, B, C...)_ o escribir el nombre del servicio.\n\n${lineas}`,
    ]),

  menuEps: (servicio: string, lineas: string) =>
    pick([
      `Perfecto, *${servicio}*. 🩺\n\n` +
        `Para buscar el mejor espacio disponible, ¿a qué *EPS o aseguradora* está afiliado(a)?\n\n` +
        `Puede responder con la letra o escribir el nombre:\n\n${lineas}\n` +
        `_Si paga directamente la consulta, elija *Particular*._ 💳`,
      `Anotado: *${servicio}*. 🩺\n\n` +
        `Para revisar la agenda disponible, indíqueme con cuál *EPS* viene hoy:\n\n${lineas}\n` +
        `_Si paga por su cuenta, seleccione *Particular*._ 💳`,
      `Continuemos con *${servicio}*. 🩺 Siguiente paso:\n\n` +
        `¿Me indica el nombre de su *EPS* para verificar la disponibilidad? Puede elegir una opción o escribirla:\n\n${lineas}\n` +
        `_Si su consulta es particular, marque *Particular*._ 💳`,
    ]),

  // ⚠️ Estos mensajes NO pueden afirmar que el hospital "no tiene convenio"
  // con la EPS que nombró el paciente. La lista que ve viene de `Eps` filtrada
  // por `isActive`, y ese campo dice "agendable por WhatsApp hoy", no "hay
  // contrato". En el arranque de Anserma (2026-09-04) el hospital pidió salir
  // solo con Salud Total y Sura: Nueva EPS queda apagada teniendo convenio
  // vigente y miles de citas al trimestre. Decirle a uno de sus afiliados que
  // "no tenemos convenio con su EPS" es mandarlo a otro hospital con una
  // información falsa que se inventó AgenIA.
  epsInvalida: (lineas: string) =>
    pick([
      `Esa EPS no está entre las que puedo agendar por este medio en este momento. 🙏\n\n` +
        `Por favor, elija una de las siguientes opciones (con la letra o el nombre). Si paga directamente la consulta, escoja *Particular*:\n\n${lineas}`,
      `Por ahora no puedo agendar citas de esa EPS por WhatsApp. 🙏\n\n` +
        `¿Me confirma una de estas opciones, por favor? Puede responder con la letra o el nombre:\n\n${lineas}`,
      `Esa EPS no aparece entre las que puedo atender por este canal.\n\n` +
        `Estas son las disponibles — elija una con la letra o el nombre, o marque *Particular* si paga por su cuenta:\n\n${lineas}`,
    ]),

  pedirEps: () =>
    pick([
      `Para revisar la disponibilidad, ¿me indica el nombre de su *EPS o aseguradora*, por favor?\n\n` +
        `_(Si paga directamente la consulta, escriba *"Particular"*.)_ 💳`,
      `¿Con cuál *EPS* viene hoy? Así le busco el mejor espacio.\n\n` +
        `_(Si es por cuenta propia, escriba *"Particular"*.)_ 💳`,
    ]),

  // Los ejemplos NO llevan nombres de EPS quemados: eran "Sura, Sanitas, Nueva
  // EPS, Compensar", y nombrar una que hoy está apagada invita al paciente a
  // escribir justo lo que no se le puede agendar.
  epsNoEncontrada: (epsQuery: string) =>
    pick([
      `Disculpe, no logré identificar la EPS *"${epsQuery}"*.\n\n` +
        `¿Me la confirma, por favor? _(Si paga usted la consulta, escriba *Particular*.)_`,
      `La EPS *"${epsQuery}"* no me aparece.\n\n` +
        `¿Me la escribe nuevamente? _(Si paga usted la consulta, escriba *Particular*.)_`,
    ]),

  epsInactiva: (epsName: string) =>
    pick([
      `En este momento no tenemos convenio activo con *${epsName}*.\n\n` +
        `¿Desea continuar como *Particular* o cuenta con otra EPS?`,
      `Disculpe, por ahora no estamos atendiendo el convenio con *${epsName}*.\n\n` +
        `Si lo prefiere, podemos agendarle como *Particular*, o indíqueme si cuenta con otra EPS.`,
    ]),

  // La cédula no está en el padrón de pacientes dados de alta para esa EPS.
  // Mensaje amable + enlace al formulario público de solicitud de revisión.
  epsNoAfiliado: (epsName: string, enlace: string) =>
    pick([
      `Lo sentimos: verifiqué en nuestro sistema y su documento aún no figura *dado de alta* ` +
        `para agendar por *${epsName}* en esta institución. 🙏\n\n` +
        `Si considera que debería estar habilitado(a), con gusto puede radicar una *solicitud de revisión* ` +
        `en este enlace seguro y nuestro equipo estudiará su caso:\n${enlace}\n\n` +
        `_Cuando su alta sea aprobada, podrá agendar por su EPS. Si lo prefiere, también puede ` +
        `escribirme *"Hola"* y agendar como *Particular* (pago directo)._ 💙`,
      `Disculpe: revisé el listado de pacientes habilitados y su documento todavía no está ` +
        `*dado de alta* para *${epsName}* en esta institución. 🙏\n\n` +
        `Puede solicitar la revisión de su caso en este enlace seguro — allí nos cuenta por qué ` +
        `debería estar habilitado(a):\n${enlace}\n\n` +
        `_Apenas la institución apruebe su alta, podrá agendar por su EPS. Mientras tanto, si desea, ` +
        `escríbame *"Hola"* para agendar como *Particular*._ 💙`,
    ]),

  // ── LÍMITE DE CITAS POR PACIENTE ──────────────────────────────────────
  // `maximo` y `citas` salen de `unaOVariasCitas`; `dia`/`mes`, de
  // `etiquetaPeriodo`; `contacto`, de contactoClinica; `revision`, de
  // limiteCitasRevisionEnlace / limiteCitasRevisionEnCurso (o vacío).
  limiteCitasDia: (
    maximo: string,
    citas: string,
    dia: string,
    contacto: string,
    revision: string,
  ) =>
    `Lamentamos no poder agendarle esta cita por este medio. 🙏\n\n` +
    `Por disposición de la institución, cada paciente puede tener máximo *${maximo}* el mismo día, ` +
    `y usted ya tiene *${citas}* para el *${dia}*.\n\n` +
    `Si necesita atención adicional, por favor comuníquese con ${contacto}.${revision}\n\n` +
    `_Si lo prefiere, escríbame *"Hola"* y elija otro día._ 💙`,

  limiteCitasMes: (
    maximo: string,
    citas: string,
    mes: string,
    contacto: string,
    revision: string,
  ) =>
    `Lamentamos no poder agendarle esta cita por este medio. 🙏\n\n` +
    `Por disposición de la institución, cada paciente puede tener máximo *${maximo}* en un mismo mes, ` +
    `y usted ya tiene *${citas}* en *${mes}*.\n\n` +
    `Si necesita atención adicional, por favor comuníquese con ${contacto}.${revision}\n\n` +
    `_Si lo prefiere, escríbame *"Hola"* y elija una fecha de otro mes._ 💙`,

  limiteCitasCambioDia: (
    maximo: string,
    citas: string,
    dia: string,
    contacto: string,
    revision: string,
  ) =>
    `Lamentamos no poder cambiar su cita a esa fecha por este medio. 🙏\n\n` +
    `Por disposición de la institución, cada paciente puede tener máximo *${maximo}* el mismo día, ` +
    `y usted ya tiene *${citas}* para el *${dia}*.\n\n` +
    `Si necesita atención adicional, por favor comuníquese con ${contacto}.${revision}\n\n` +
    `_Su cita sigue como estaba. Si lo prefiere, escríbame *"cambiar cita"* y elija otro día._ 💙`,

  limiteCitasCambioMes: (
    maximo: string,
    citas: string,
    mes: string,
    contacto: string,
    revision: string,
  ) =>
    `Lamentamos no poder cambiar su cita a esa fecha por este medio. 🙏\n\n` +
    `Por disposición de la institución, cada paciente puede tener máximo *${maximo}* en un mismo mes, ` +
    `y usted ya tiene *${citas}* en *${mes}*.\n\n` +
    `Si necesita atención adicional, por favor comuníquese con ${contacto}.${revision}\n\n` +
    `_Su cita sigue como estaba. Si lo prefiere, escríbame *"cambiar cita"* y elija una fecha de otro mes._ 💙`,

  limiteCitasRevisionEnlace: (enlace: string) =>
    `\n\nSi considera que requiere más citas de las permitidas, puede elevar una *solicitud de revisión* ` +
    `en este enlace seguro, explicándonos por qué las necesita; nuestro equipo estudiará su caso:\n${enlace}`,

  // `periodo`: «ese día» o «ese mes».
  limiteCitasRevisionEnCurso: (periodo: string) =>
    `\n\nYa recibimos su *solicitud de revisión* para ${periodo} y nuestro equipo la está estudiando. ` +
    `Si la aprueban, podrá agendar por este medio.`,

  cuposDisponibles: (nombre: string, epsName: string, lineas: string) =>
    pick([
      `${nombre ? `${nombre}, ` : ''}estos son los horarios que encontré con *${epsName}*:\n\n${lineas}\n` +
        `_Responda con la letra del horario que más le acomode, por favor._`,
      `${nombre ? `${nombre}, ` : ''}con gusto. Estos son los espacios disponibles para *${epsName}*:\n\n${lineas}\n` +
        `_Indíqueme cuál le sirve mejor: responda con la letra._`,
      `${nombre ? `Listo, ${nombre}: ` : 'Listo: '}esta es la agenda disponible para *${epsName}*:\n\n${lineas}\n` +
        `_Elija el horario que más le convenga (responda con la letra)._`,
    ]),

  // Frase corta para AUDIO: no leemos todos los horarios en voz; el listado
  // completo va por texto. El paciente lo lee y responde con la letra.
  cuposDisponiblesAudio: (epsName: string) =>
    pick([
      `A continuación le presento las opciones que encontré con ${epsName}. Por favor, revíselas en el mensaje de texto y respóndame con la letra del horario que prefiera.`,
      `Estos son los horarios disponibles con ${epsName}. Se los dejo en el mensaje de texto; respóndame con la letra de la opción que más le acomode.`,
    ]),

  // Audio que SÍ lee las próximas opciones (las más cercanas), no solo anuncia.
  // `lineasHabladas` ya viene armado por el service en lenguaje natural
  // ("opción A, mañana a las 3 de la tarde con el Doctor Pérez"). El listado
  // completo con todas las letras sigue viajando por texto.
  cuposDisponiblesAudioHablado: (epsName: string, lineasHabladas: string) =>
    pick([
      `Con ${epsName} encontré estas opciones cercanas: ${lineasHabladas} Puede responderme con la letra, o decirme el día y la hora que prefiera. Le dejo el listado completo en el mensaje de texto.`,
      `Estas son las citas más próximas con ${epsName}: ${lineasHabladas} Respóndame con la letra de la que prefiera, o dígame directamente el día y la hora. En el mensaje de texto le dejo todas las opciones.`,
    ]),

  // Cupos filtrados por la fecha que pidió el paciente ("mañana", "el lunes"...).
  cuposParaFecha: (epsName: string, fechaLabel: string, lineas: string) =>
    pick([
      `Para *${fechaLabel}* con *${epsName}* tengo estos horarios:\n\n${lineas}\n` +
        `_Responda con la letra del horario que más le acomode, por favor._`,
      `Revisé la agenda para *${fechaLabel}* con *${epsName}* y esto es lo que encontré:\n\n${lineas}\n` +
        `_Indíqueme con la letra cuál le sirve mejor._`,
    ]),

  // Fallback suave: no hay cupos en la fecha pedida, pero sí los más próximos.
  sinCuposEsaFechaProximos: (
    fechaLabel: string,
    epsName: string,
    lineas: string,
  ) =>
    pick([
      `Para *${fechaLabel}* no encontré cupos disponibles, pero estos son los más próximos con *${epsName}*:\n\n${lineas}\n` +
        `_Si alguno le sirve, respóndame con la letra._`,
      `Por el momento no tengo espacios para *${fechaLabel}*. Le comparto los horarios más cercanos con *${epsName}*:\n\n${lineas}\n` +
        `_Responda con la letra del que prefiera, por favor._`,
    ]),

  preguntaWaitlist: (servicio: string, eps: string) =>
    pick([
      `Revisé la agenda para *${servicio}* con *${eps}* y por el momento no hay cupos disponibles.\n\n` +
        `Si lo desea, le anoto en nuestra *lista de espera* y le aviso por este medio en cuanto se libere un espacio.\n\n` +
        `¿Le parece bien? Responda *SÍ* para anotarle o *NO* si prefiere intentarlo más adelante.`,
      `La agenda de ${servicio.toLowerCase()} con *${eps}* está completa por estos días.\n\n` +
        `¿Desea que le anote en la *lista de espera*? En cuanto se libere un cupo, le escribo para reservárselo.\n\n` +
        `Responda *SÍ* o *NO*.`,
      `Por el momento la agenda de *${servicio}* (${eps}) está completa.\n\n` +
        `Si lo desea, puedo dejarle anotado(a) en la *lista de espera* y le aviso apenas se abra un espacio, sin compromiso.\n\n` +
        `¿Le parece? *SÍ* para anotarle, *NO* para dejarlo así.`,
    ]),

  unidoAWaitlist: (nombre: string, servicio: string, position: number) =>
    pick([
      `Listo${nombre ? `, ${nombre}` : ''}. Le anoté en la lista de espera para *${servicio}* — quedó en la posición *#${position}*.\n\n` +
        `Esté pendiente de su WhatsApp: apenas se libere un cupo, le escribo. Que tenga un buen día.`,
      `${nombre ? `Perfecto, ${nombre}. ` : 'Perfecto. '}Quedó anotado(a) en la lista de espera de *${servicio}* (posición *#${position}*).\n\n` +
        `En cuanto se libere un espacio, le aviso por este medio.`,
      `Hecho${nombre ? `, ${nombre}` : ''}. Le agregué a la lista para *${servicio}*, en la posición *#${position}*.\n\n` +
        `Le escribo apenas tenga novedades para usted.`,
    ]),

  noUnidoAWaitlist: () =>
    pick([
      `Entendido, no le anoto en la lista.\n\n` +
        `Cuando quiera intentarlo nuevamente, escríbame *"Hola"* y con gusto le atiendo. Que tenga un buen día.`,
      `Como prefiera.\n\n` +
        `Aquí estaré cuando quiera retomar — escríbame *"Hola"* y continuamos.`,
      `Lo dejamos así por ahora.\n\n` +
        `Cuando lo necesite, escríbame *"Hola"* y le ayudo. Que tenga un excelente día.`,
    ]),

  sinDisponibilidad: (
    nombre: string,
    epsName: string,
    especialidad: string,
    position: number,
  ) =>
    `${nombre}, revisé la agenda para *${epsName}* en *${especialidad}* ` +
    `y por el momento no hay cupos abiertos.\n\n` +
    `Ya le agregué a la lista de espera (posición *#${position}*). ` +
    `En cuanto se libere un espacio, le aviso por este medio.\n\n` +
    `¿Hay algo más en lo que le pueda colaborar?`,

  pedirCedulaPostSlot: (fechaFormateada: string) =>
    pick([
      `Excelente elección. Le aparté ese horario:\n📅 *${fechaFormateada}*\n\n` +
        `Para terminar de agendarle, ¿me indica su *número de cédula*, por favor?`,
      `Perfecto, ya casi terminamos. Le reservé tentativamente:\n📅 *${fechaFormateada}*\n\n` +
        `Solo me falta confirmar un dato: ¿me comparte su *cédula*?`,
      `Listo. Tengo ese espacio reservado para usted:\n📅 *${fechaFormateada}*\n\n` +
        `Para finalizar, ¿me indica su *número de cédula*? Solo el número, sin puntos.`,
    ]),

  especialidadConfirmada: (especialidad: string) =>
    `Perfecto, anotado: *${especialidad}*. 🩺\n\nPara revisar la agenda, ¿me indica su *número de cédula*?`,

  pedirCedula: (especialidad: string) =>
    `Anotado, busca cita para *${especialidad}*. 🩺\n\n¿Me comparte su *número de cédula*? Solo el número, sin puntos ni guiones.`,

  // 🪪 El nombre va en DOS pasos y se dice sin rodeos (2026-10-22: con «sus nombres
  // (solo los nombres…)» un paciente escribió el nombre completo y quedó con los
  // apellidos repetidos). Ver nombre-paciente-nuevo.ts.
  primeraVez: () =>
    pick([
      `Es un gusto recibirle por primera vez. Para registrarle le pido su nombre en *dos pasos*.\n\n*Paso 1 de 2:* escriba *solo sus NOMBRES*, sin apellidos.\nPor ejemplo: *María Fernanda*\n\n_Los apellidos se los pido en el siguiente mensaje._`,
      `Bienvenido(a). Para abrir su historia le pido su nombre en *dos pasos*.\n\n*Paso 1 de 2:* escriba *solo sus NOMBRES*, sin apellidos.\nPor ejemplo: *Juan Carlos*\n\n_Los apellidos van en la siguiente pregunta._`,
    ]),

  // ACK del Primer Turno (Fase 2): confirma al paciente las entidades que el
  // Agente entendió de su primer mensaje, antes de pedir lo que falta.
  ackTurno1: (p: {
    nombre?: string | null;
    cedula?: string | null;
    especialidad?: string | null;
    eps?: string | null;
    fecha?: string | null;
    botName?: string;
    clinicaName?: string;
  }) => {
    const detalles: string[] = [];
    if (p.nombre) detalles.push(`👤 *Paciente:* ${p.nombre}`);
    if (p.cedula) detalles.push(`🪪 *Cédula:* ${p.cedula}`);
    if (p.especialidad) detalles.push(`🏥 *Servicio:* ${p.especialidad}`);
    if (p.eps) detalles.push(`💳 *EPS:* ${p.eps}`);
    if (p.fecha) detalles.push(`📅 *Fecha preferida:* ${p.fecha}`);
    const saludo = p.nombre ? `Hola, ${p.nombre}.` : 'Buen día.';
    // Saludo + presentación como asistente de IA. Esta es la primera respuesta
    // que recibe el paciente cuando abre dando sus datos (nombre/cédula/EPS),
    // así que aquí debe identificarse explícitamente como asistente virtual con
    // IA (sentTurn1Ack suprime el saludo del menú posterior → sin doble saludo).
    const nombreBot = p.botName || BOT_NAME;
    const presentacion = p.clinicaName
      ? `Le saluda *${nombreBot}*, asistente virtual con inteligencia artificial de *${p.clinicaName}*.`
      : `Le saluda *${nombreBot}*, asistente virtual con inteligencia artificial.`;
    const bloque = detalles.length
      ? `\n\nEntendido, ya tomé nota de:\n${detalles.join('\n')}`
      : '';
    return `${saludo} ${presentacion} Con gusto le ayudo a agendar su cita.${bloque}`;
  },

  // Re-presentación cuando el paciente confirma que SÍ quiere agendar
  // (o expresa intención de cita) estando en el paso de selección de servicio,
  // pero su texto no mapeó a una opción. Evita el mensaje de "no entendí".
  repromptAgendarServicio: (lineas: string) =>
    `Perfecto, con gusto le agendo su cita. 📅\n\n` +
    `*¿Cuál de estos servicios necesita?* Puede responder con la letra o el nombre:\n\n${lineas}`,

  // Igual, pero en el paso de selección de EPS.
  repromptAgendarEps: (lineas: string) =>
    `Perfecto, continuemos. 📅\n\n*¿Con cuál EPS o entidad desea su cita?*\n\n${lineas}`,

  resumenCita: (
    nombre: string,
    cedula: string,
    eps: string,
    especialidad: string,
    fecha: string,
    policyUrl?: string,
  ) =>
    pick([
      `Listo${nombre ? `, ${nombre}` : ''}. Confirmemos los datos de su cita antes de agendarle:\n\n` +
        `👤 *Paciente:* ${nombre}\n🪪 *Cédula:* ${cedula}\n💳 *EPS:* ${eps}\n🏥 *Servicio:* ${especialidad}\n📅 *Fecha y hora:* ${fecha}\n\n` +
        `¿Está todo correcto? Responda *SÍ* para agendarle definitivamente o *NO* si necesita cambiar algo.\n\n${CONSENT_1581_FORMAL(policyUrl)}`,
      `Perfecto${nombre ? `, ${nombre}` : ''}. Reviso con usted la información antes de cerrar:\n\n` +
        `👤 ${nombre}\n🪪 Cédula ${cedula}\n💳 EPS: ${eps}\n🏥 ${especialidad}\n📅 ${fecha}\n\n` +
        `Si todo está bien, responda *SÍ* y lo dejo confirmado. Si algo no corresponde, escriba *NO*.\n\n${CONSENT_1581_FORMAL(policyUrl)}`,
      `Ya casi terminamos${nombre ? `, ${nombre}` : ''}. Estos son los datos de su cita:\n\n` +
        `👤 ${nombre}\n🪪 ${cedula}\n💳 ${eps}\n🏥 ${especialidad}\n📅 ${fecha}\n\n` +
        `¿Lo confirmamos? Responda *SÍ* para agendarle o *NO* si prefiere cancelar.\n\n${CONSENT_1581_FORMAL(policyUrl)}`,
    ]),

  // AUDIO del resumen (solo en flujo de voz). El paciente habló todo el flujo
  // y el resumen le llegaba SOLO por texto (retroalimentación 2026-09-24): el
  // último paso, el que pide el SÍ, era el único que no escuchaba. Aquí va lo
  // que se entiende de oído —servicio, día y hora, la pregunta— y el aviso de
  // datos en una frase; la cédula, la EPS, el texto legal completo y el enlace
  // a la política siguen llegando por escrito en el mismo turno (smartReply
  // con `audioText` envía siempre el texto).
  resumenCitaAudio: (
    nombre: string,
    especialidad: string,
    fechaHablada: string,
  ) =>
    pick([
      `${nombre ? `${nombre}, ` : ''}antes de agendarle confirmemos los datos: su cita de ${especialidad} quedaría para ${fechaHablada}. ` +
        `Si todo está correcto, respóndame sí y queda agendada; si necesita cambiar algo, dígame no. ` +
        `Al responder sí también autoriza el tratamiento de sus datos personales; le dejo los detalles y la política por escrito.`,
      `${nombre ? `${nombre}, ` : ''}revisemos antes de cerrar: ${especialidad}, ${fechaHablada}. ` +
        `¿Está todo bien? Respóndame sí para dejarla confirmada, o no si algo no corresponde. ` +
        `Con su sí autoriza además el tratamiento de sus datos personales; en el mensaje de texto le dejo el resumen completo y la política.`,
    ]),

  citaConfirmada: (clinicaName: string, fecha: string) =>
    pick([
      `Todo quedó confirmado. Su cita está reservada en *${clinicaName}*.\n\n📅 _${fecha}_\n\n` +
        `Le pido llegar *15 minutos antes* y traer su *documento de identidad*. 🪪\n\nQuedo atento(a) a cualquier inquietud.`,
      `Su cita en *${clinicaName}* quedó agendada con éxito.\n\n📅 _${fecha}_\n\n` +
        `Recuerde llegar *15 minutos antes* con su *cédula*. 🪪\n\nGracias por confiar en nosotros.`,
      `Su cita quedó confirmada en *${clinicaName}*.\n\n📅 _${fecha}_\n\n` +
        `Por favor, sea puntual: llegue *15 minutos antes* y traiga su *documento*. 🪪\n\nQue tenga un excelente día.`,
    ]),

  // Resumen de texto que se envía DESPUÉS de confirmar (solo en flujo de voz):
  // el paciente escuchó el audio de confirmación pero no vio los datos por
  // escrito, así que se los dejamos como respaldo. Sin SÍ/NO ni consentimiento
  // (ese paso ya ocurrió). Una sola versión (no `pick`): es un comprobante, no
  // conversación.
  resumenCitaConfirmadaTexto: (
    nombre: string,
    cedula: string,
    eps: string,
    especialidad: string,
    fecha: string,
  ) =>
    `📋 *Resumen de su cita*\n\n` +
    `👤 *Paciente:* ${nombre}\n🪪 *Cédula:* ${cedula}\n💳 *EPS:* ${eps}\n🏥 *Servicio:* ${especialidad}\n📅 *Fecha y hora:* ${fecha}`,

  citaNoConfirmada: () =>
    pick([
      `Entendido, cancelé la solicitud.\n\nCuando quiera intentarlo de nuevo, escríbame *"Hola"* y con gusto le ayudo.`,
      `Sin problema, lo dejamos por ahora.\n\nAquí estaré cuando quiera retomar — solo escríbame *"Hola"* y continuamos.`,
      `No se agendó nada todavía.\n\nCuando esté listo(a), escríbame *"Hola"* y lo intentamos otra vez. Que tenga un buen día.`,
    ]),

  // 🏥 H10 (docs/PLAN_AGENDA_HUECOS.md): la cita no se confirma hasta que el
  // hospital la registra. Esto se dice mientras se espera (unos segundos).
  confirmandoCita: () =>
    pick([
      `Un momento, por favor. Estoy confirmando su cita con el sistema del hospital; en unos segundos le doy la confirmación. ⏳`,
      `Deme unos segundos: estoy registrando su cita en el sistema del hospital. ⏳`,
    ]),

  // El hospital no respondió a tiempo: NO se confirma. Se le escribe después.
  citaEnRegistro: (fecha: string) =>
    `El hospital aún no termina de registrar su cita del _${fecha}_. ⏳\n\n` +
    `Apenas quede registrada le escribo por aquí para confirmársela. No necesita volver a agendarla.`,

  // El hospital la rechazó DESPUÉS del aviso anterior (llegó tarde el resultado).
  citaNoRegistradaEnHospital: (fecha: string, contacto: string) =>
    `Lo lamento: el hospital no pudo registrar su cita del _${fecha}_ porque ese horario ya no estaba disponible.\n\n` +
    `Escríbame *"Hola"* para elegir otro horario, o comuníquese con ${contacto}.`,

  // ── H10 para el CAMBIO de fecha: el cambio se confirma solo cuando el HIS
  //    lo registra. Mientras, la cita conserva también su hora de antes.
  confirmandoCambio: () =>
    pick([
      `Un momento, por favor. Estoy registrando el cambio de su cita en el sistema del hospital; en unos segundos le confirmo. ⏳`,
      `Deme unos segundos: estoy pasando su cita al nuevo horario en el sistema del hospital. ⏳`,
    ]),

  // El hospital no respondió a tiempo: se le escribe cuando quede.
  cambioEnRegistro: (fechaNueva: string) =>
    `El hospital aún no termina de registrar el cambio de su cita al _${fechaNueva}_. ⏳\n\n` +
    `Apenas quede registrado le escribo por aquí para confirmárselo. No necesita volver a pedirlo.`,

  // El hospital lo rechazó EN LA ESPERA: la cita sigue en su hora de antes y
  // a continuación se le ofrecen otros horarios.
  cambioRechazadoPorHospital: (fechaNueva: string, fechaAnterior: string) =>
    `Lo lamento: el hospital no pudo registrar el cambio al _${fechaNueva}_ porque ese horario ya no estaba disponible. ` +
    `Su cita *sigue el ${fechaAnterior}*.\n\nLe muestro otros horarios. 👇`,

  // El hospital lo rechazó DESPUÉS del aviso de registro (llegó tarde).
  cambioNoRegistradoEnHospital: (
    fechaNueva: string,
    fechaAnterior: string,
    contacto: string,
  ) =>
    `Lo lamento: el hospital no pudo registrar el cambio de su cita al _${fechaNueva}_ porque ese horario ya no estaba disponible. ` +
    `Su cita *sigue el ${fechaAnterior}*.\n\n` +
    `Si desea otro horario, escríbame *"cambiar cita"*, o comuníquese con ${contacto}.`,

  slotTomado: () =>
    pick([
      `Lo lamento, ese horario lo acaba de tomar otro paciente.\n\n¿Elegimos otro de los disponibles? Escriba la letra nuevamente, por favor.`,
      `Disculpe, ese espacio acaba de reservarse.\n\n¿Vemos otra opción? Indíqueme con qué letra prefiere quedarse.`,
    ]),

  // El médico dejó de aceptar reservas por WhatsApp mientras el paciente
  // decidía. NO es una colisión de cupo: el horario sigue libre, solo que no
  // por este canal — decirle que "otro paciente lo tomó" sería mentira, y el
  // paciente que llame a la clínica se encontrará con que el horario existe.
  medicoNoDisponiblePorWhatsapp: () =>
    pick([
      `Le pido disculpas: ese horario dejó de estar disponible para agendamiento por este medio.\n\n¿Elegimos otro de la lista? Escriba la letra, por favor.`,
      `Ese espacio ya no se puede reservar por este canal.\n\n¿Vemos otra opción? Indíqueme con qué letra prefiere quedarse.`,
    ]),

  // No es un horario ocupado: su EPS no tiene convenio vigente para su
  // régimen en esta clínica. Cambiar de horario no lo arregla — a propósito
  // NO se ofrece "elegir otro" aquí, para no hacerle perder el tiempo.
  epsRegimenNoFacturable: () =>
    pick([
      `Le pido disculpas: su EPS no tiene convenio vigente para agendar por este medio con su tipo de afiliación.\n\nPor favor comuníquese directamente con el hospital para gestionar su cita.`,
      `No es posible agendar esta cita por este canal: su EPS no cuenta con convenio para su régimen en este momento.\n\nLe recomiendo contactar directamente al hospital.`,
    ]),

  // El paciente nombró una EPS real que esta clínica no atiende. En vez de repetirle
  // el menú hasta agotar los reintentos, se le dice y se le ofrece la salida que sí
  // existe: la cita particular. SÍ → sigue como Particular; NO → se despide.
  // 🏥 La clínica atiende su EPS, pero no por el asistente (2026-10-21): por
  // teléfono, con su EPS. Sin ofrecerle la cita particular.
  epsSoloPorTelefono: (nombreEps: string, contacto: string) =>
    `Por este medio todavía no puedo agendar citas con *${nombreEps}*. 🙏\n\n` +
    `Para agendar su cita con su EPS, comuníquese con ${contacto}.`,

  epsNoDisponibleOfrecerParticular: (nombreEps: string) =>
    pick([
      `La EPS *${nombreEps}* no se encuentra disponible en este momento para agendamiento.\n\nTiene la opción de solicitar una cita *particular* (pago directo). ¿Desea agendarla? Responda *SÍ* o *NO*.`,
      `Por ahora no es posible agendar con la EPS *${nombreEps}*.\n\nSi lo desea, puede solicitar su cita como *particular* (pago directo). ¿Desea agendarla? Responda *SÍ* o *NO*.`,
    ]),

  // Nombró su EPS y también «particular» en la misma frase: se le pregunta cuál,
  // en vez de elegir por él (las dos opciones se facturan distinto).
  epsParticularOEps: (lineas: string) =>
    pick([
      `Menciona su EPS y también una cita *particular*. Para no equivocarme, ¿con cuál desea agendar? Escriba la letra:\n\n${lineas}`,
      `Para agendar correctamente: ¿desea la cita por su EPS o como *particular* (pago directo)? Indíqueme la letra:\n\n${lineas}`,
    ]),

  epsNoDisponibleDespedida: () =>
    pick([
      `Entendido. Si más adelante desea agendar una cita particular, con gusto le ayudo. ¡Que tenga un buen día!`,
      `Comprendo. Cuando lo necesite, puede escribirme de nuevo para agendar como particular. ¡Hasta pronto!`,
    ]),

  // ── Alta de paciente nuevo ────────────────────────────────────────────
  pedirNacimiento: () =>
    pick([
      `Gracias. ¿Cuál es su *fecha de nacimiento*?\n\nPuede escribirla como *15/03/1980* o "15 de marzo de 1980".`,
      `Perfecto. Para completar su registro, ¿me indica su *fecha de nacimiento*?\n\nPor ejemplo: *15/03/1980*.`,
    ]),

  // Se le devuelve al paciente lo que se entendió ANTES de seguir: una fecha
  // mal leída se propaga en silencio hasta su historia clínica.
  confirmarNacimiento: (fechaLegible: string) =>
    pick([
      `Entendí *${fechaLegible}*. ¿Es correcto? Responda *SÍ* o escríbala de nuevo.`,
      `Anoté *${fechaLegible}*. ¿Está bien? Conteste *SÍ*, o vuelva a escribirla si me equivoqué.`,
    ]),

  nacimientoNoEntendido: () =>
    pick([
      `No logré entender esa fecha. ¿Me la escribe como *15/03/1980*, por favor?`,
      `Disculpe, no interpreté bien la fecha. Escríbala así: *día/mes/año*, por ejemplo *15/03/1980*.`,
    ]),

  /**
   * La lista de espera NO alimenta al HIS: no necesita la frontera entre
   * nombres y apellidos, así que no se le cobra al paciente un turno extra.
   */
  nombreParaLista: () =>
    pick([
      `Para anotarle en la lista, ¿me indica su *nombre completo*?`,
      `¿Me da su *nombre completo* para dejarle en la lista de espera?`,
    ]),
  pedirApellidos: (nombres: string) =>
    pick([
      `Gracias. Nombres: *${nombres}*\n\n*Paso 2 de 2:* ahora escriba *solo sus APELLIDOS*.\nPor ejemplo: *Gómez Restrepo*`,
      `Anotado. Nombres: *${nombres}*\n\n*Paso 2 de 2:* escriba *solo sus APELLIDOS*.\nPor ejemplo: *Pérez Gil*`,
    ]),
  apellidosNoEntendidos: () =>
    pick([
      `No alcancé a leer los apellidos. ¿Me los escribe de nuevo, por favor? *Solo sus APELLIDOS*.`,
      `Disculpe, ¿me repite sus *APELLIDOS*? Solo los apellidos, por favor.`,
    ]),
  // Escribió lo mismo en los dos pasos: no se sabe dónde termina el nombre.
  apellidosRepetidos: (nombres: string) =>
    `Escribió lo mismo que en el paso anterior. 🙏\n\nSus nombres ya los tengo: *${nombres}*\n\n*Paso 2 de 2:* escriba *solo sus APELLIDOS*, por favor.`,
  pedirSexo: () =>
    pick([
      `¿Cuál es su *sexo*?\n\n*A)* Masculino\n*B)* Femenino`,
      `Para el registro, ¿me indica su *sexo*?\n\n*A)* Masculino\n*B)* Femenino`,
    ]),

  sexoNoEntendido: () =>
    pick([
      `No entendí. Responda *A* para masculino o *B* para femenino, por favor.`,
      `Disculpe, ¿*A)* Masculino o *B)* Femenino?`,
    ]),

  pedirRegimen: (epsName: string) =>
    pick([
      `Última pregunta: su afiliación a *${epsName}*, ¿es *subsidiada* o *contributiva*?\n\n*A)* Subsidiado (SISBÉN)\n*B)* Contributivo (cotizante o beneficiario)`,
      `Para terminar: en *${epsName}*, ¿su régimen es subsidiado o contributivo?\n\n*A)* Subsidiado (SISBÉN)\n*B)* Contributivo`,
    ]),

  regimenNoEntendido: () =>
    pick([
      `No entendí. Responda *A* si es subsidiado (SISBÉN) o *B* si es contributivo, por favor.`,
      `Disculpe: *A)* Subsidiado o *B)* Contributivo.`,
    ]),

  errorSlotInvalido: () =>
    pick([
      `Esa letra no aparece entre las opciones que le envié.\n\n¿Me la confirma, por favor? Recuerde que puede responder con la letra _(A, B, C...)_ o escribir *"Salir"* si prefiere cancelar.`,
      `Disculpe, no fue posible ubicar esa opción.\n\nResponda con una de las letras disponibles _(A, B, C...)_ o escriba *"Salir"* si desea terminar el proceso.`,
    ]),

  waitlistCupoDisponible: (
    nombre: string,
    especialidad: string,
    fecha: string,
    doctor: string,
  ) =>
    pick([
      `🔔 ${nombre}, tengo buenas noticias.\n\n` +
        `Se acaba de liberar un cupo en *${especialidad}* y usted era la siguiente persona en la lista.\n\n` +
        `📅 *${fecha}*\n👨‍⚕️ ${doctor}\n\nLe reservé este cupo por *30 minutos*. ¿Le interesa tomarlo?\n\nResponda *SÍ* para confirmarlo o *NO* si ya no lo necesita.`,
      `🔔 ${nombre}, le tengo una buena noticia.\n\n` +
        `Se liberó un espacio para *${especialidad}* y le corresponde a usted, que era la primera persona en espera.\n\n` +
        `📅 *${fecha}*\n👨‍⚕️ ${doctor}\n\nLe aparté el cupo por *30 minutos*. ¿Desea tomarlo?\n\nConfírmeme con *SÍ* o, si ya no le sirve, escriba *NO*.`,
    ]),

  waitlistCupoRechazado: () =>
    pick([
      `Sin problema. Libero ese cupo para otro paciente.\n\nUsted sigue en nuestra lista y le aviso apenas haya otra disponibilidad. Que tenga un excelente día.`,
      `Como prefiera. Libero el cupo para otra persona que también lo está esperando.\n\nUsted permanece en la lista, así que en cuanto aparezca otro espacio le aviso.`,
    ]),

  waitlistExpirado: () =>
    pick([
      `El tiempo para confirmar ese cupo ya finalizó. ⏳\n\nSi todavía le interesa la cita, escríbame *"Hola"* y con gusto le anoto nuevamente.`,
      `Disculpe, se venció el tiempo para reservar ese cupo. ⏳\n\nSi desea intentarlo otra vez, escríbame *"Hola"* y continuamos.`,
    ]),

  escape: () =>
    pick([
      `Listo, comencemos de nuevo. ¿En qué le puedo colaborar?`,
      `Sin problema, comencemos de nuevo. ¿En qué le ayudo el día de hoy?`,
      `Volvamos a empezar. ¿Qué necesita?`,
    ]),

  // 🔔 Baja de recordatorios (docs/PLAN_ALTA_EN_CALIENTE.md, D2). Se aclara lo que NO
  // cambia —la cita sigue en pie— para que nadie crea que se canceló al pedir la baja.
  recordatoriosBaja: () =>
    pick([
      `Listo: no le enviaremos más recordatorios de sus citas. 🔔\n\nSus citas siguen en pie; esto solo afecta los mensajes de aviso. Si más adelante quiere volver a recibirlos, escríbame *"activar recordatorios"*.`,
      `Hecho, dejamos de enviarle recordatorios. 🔔\n\nOjo: sus citas NO se cancelan, solo dejamos de avisarle. Para volver a recibirlos, escríbame *"activar recordatorios"*.`,
    ]),

  recordatoriosActivados: () =>
    pick([
      `Listo, volveremos a enviarle los recordatorios de sus citas. 🔔`,
      `Hecho: los recordatorios quedan activos otra vez. 🔔`,
    ]),

  recordatoriosSinRegistro: () =>
    pick([
      `No encuentro una historia registrada con este número, así que no hay recordatorios que desactivar. 🤔\n\nSi le llegan mensajes nuestros, por favor comuníquese con el hospital para revisarlo.`,
      `Con este número no tengo ninguna historia registrada, así que no le estamos enviando recordatorios. Si aun así los recibe, por favor avísele al hospital.`,
    ]),

  // ── Respuestas a un RECORDATORIO (ver respuesta-recordatorio.ts) ────
  // «Sí voy», «gracias», «ok» tras recibir el recordatorio de su cita.
  // ── Varias citas recordadas (2026-10-15) ─────────────────────────────
  // Una línea por cita: «• *Odontología* — viernes, 16 de octubre a las 10:10».
  lineaDeCita: (servicio: string, fecha: string) =>
    `• *${servicio}* — ${fecha}`,
  // …y con el nombre, cuando las citas son de varios pacientes del mismo número.
  lineaDeCitaDe: (servicio: string, fecha: string, nombre: string) =>
    `• *${servicio}* — ${fecha} (${nombre})`,

  recordatorioConfirmadoVarias: (lineas: string) =>
    `¡Gracias por confirmar! 🙌 Le esperamos en sus citas:\n\n${lineas}`,

  quienEscribeConCitas: (
    botName: string,
    clinicaName: string,
    lineas: string,
  ) =>
    `Le escribe *${botName}*, asistente virtual de *${clinicaName}*, por sus citas: 🏥\n\n${lineas}`,

  preguntaSobreCitas: (lineas: string, clinicaName: string, contacto: string) =>
    `Sus citas son en *${clinicaName}*: 🏥\n\n${lineas}\n\n` +
    `Si necesita indicaciones para llegar o tiene otra pregunta sobre sus citas, comuníquese con ${contacto}.`,

  avisoInasistenciaRegistradoVarias: (lineas: string, contacto: string) =>
    `Entendido. Dejé registrado su aviso de que no podrá asistir a estas citas, para que el personal del hospital lo revise: 📝\n\n${lineas}\n\n` +
    `Por este medio no puedo cancelarlas, así que por ahora siguen registradas. Si quiere cancelarlas de inmediato, comuníquese con ${contacto}.`,

  avisoCambioRegistradoVarias: (lineas: string, contacto: string) =>
    `Entendido. Dejé registrada su solicitud de cambiar estas citas, para que el personal del hospital la revise: 📝\n\n${lineas}\n\n` +
    `Por este medio no puedo cambiar las fechas, así que por ahora siguen igual. Si quiere cambiarlas de inmediato, comuníquese con ${contacto}.`,

  // Varias citas y quiere cancelar: que elija. `lineas` = «*A)* …» por cita.
  cancelarElegirCual: (lineas: string) =>
    `Entiendo que no podrá asistir. Estas son sus citas próximas:\n\n${lineas}\n\n` +
    `¿Cuál desea *cancelar*? Responda con la letra. Si son varias, se las cancelo una por una.`,

  // 🩺 Sus citas son de médicos fuera del asistente (odontología, psicología…).
  citasFueraDelAlcance: (contacto: string) =>
    `Las citas que tiene registradas no se pueden gestionar por este medio: se manejan directamente con el hospital. 🏥\n\n` +
    `Por favor comuníquese con ${contacto}.`,

  // La hora de la cita ya pasó (o está en curso): no se cancela por aquí.
  citaYaPaso: (contacto: string) =>
    `La hora de su cita ya pasó, así que no puedo cancelarla por este medio. 🕐\n\n` +
    `Si necesita algo sobre esa cita, comuníquese con ${contacto}.`,

  // 🩺 Citas con las que AgenIA no trabaja (otro servicio o médico sin WhatsApp
  // ON): no se tocan, pero el aviso queda en la Bandeja para el personal.
  avisoFueraDelAlcanceCancelar: (
    servicio: string,
    fecha: string,
    contacto: string,
  ) =>
    `Dejé su aviso para el personal del hospital: no podrá asistir a su cita de *${servicio}* del *${fecha}*. 📋\n\n` +
    `Esa cita no se gestiona por este medio, así que *todavía no está cancelada*: para cancelarla, comuníquese con ${contacto}.`,

  avisoFueraDelAlcanceCancelarVarias: (lineas: string, contacto: string) =>
    `Dejé su aviso para el personal del hospital: no podrá asistir a estas citas:\n\n${lineas}\n\n` +
    `Esas citas no se gestionan por este medio, así que *todavía no están canceladas*: para cancelarlas, comuníquese con ${contacto}.`,

  avisoFueraDelAlcanceCambiar: (
    servicio: string,
    fecha: string,
    contacto: string,
  ) =>
    `Dejé su aviso para el personal del hospital: desea cambiar la fecha de su cita de *${servicio}* del *${fecha}*. 📋\n\n` +
    `Esa cita no se gestiona por este medio, así que *sigue igual por ahora*: para cambiarla, comuníquese con ${contacto}.`,

  avisoFueraDelAlcanceCambiarVarias: (lineas: string, contacto: string) =>
    `Dejé su aviso para el personal del hospital: desea cambiar la fecha de estas citas:\n\n${lineas}\n\n` +
    `Esas citas no se gestionan por este medio, así que *siguen igual por ahora*: para cambiarlas, comuníquese con ${contacto}.`,

  // Tras cancelar una, si le quedan otras del recordatorio.
  cancelarOtraCita: () =>
    `Si también desea cancelar otra de sus citas, escríbame *"cancelar cita"*.`,

  recordatorioConfirmado: (fecha: string, servicio: string) =>
    `¡Gracias por confirmar! 🙌 Le esperamos el *${fecha}* para su cita de *${servicio}*.`,

  // «¿De dónde me hablan?» de quien acaba de recibir un recordatorio.
  quienEscribeConCita: (
    botName: string,
    clinicaName: string,
    servicio: string,
    fecha: string,
  ) =>
    `Le escribe *${botName}*, asistente virtual de *${clinicaName}*, por su cita de *${servicio}* del *${fecha}*. 🏥`,

  // «¿De dónde me hablan?» sin recordatorio reciente.
  quienEscribe: (botName: string, clinicaName: string) =>
    `Le escribe *${botName}*, asistente virtual de *${clinicaName}*. 🏥\n\n` +
    `Si desea ver sus citas, escríbame *"consultar"*.`,

  // Fuera de tema con agendar APAGADO: no invita a agendar. `disponibles`
  // sale de `lineaDisponible`; `contacto`, de contactoClinica.
  outOfContextSinAgendar: (
    botName: string,
    disponibles: string,
    contacto: string,
  ) =>
    `Disculpe, soy *${botName}* y por aquí solo puedo ayudarle con sus citas. 🏥\n\n` +
    `Puedo ayudarle a:\n${disponibles}\n\n` +
    `Para cualquier otra gestión, comuníquese con ${contacto}.`,

  // «esa cita es en q lugar», «¿a qué hora es?» de quien acaba de recibir su
  // recordatorio. `contacto`, de contactoClinica.
  preguntaSobreCita: (
    servicio: string,
    fecha: string,
    clinicaName: string,
    contacto: string,
  ) =>
    `Su cita de *${servicio}* es el *${fecha}*, en *${clinicaName}*. 🏥\n\n` +
    `Si necesita indicaciones para llegar o tiene otra pregunta sobre su cita, comuníquese con ${contacto}.`,

  // 🎫 Ya está en el hospital y pregunta su turno, su consultorio o dónde esperar
  // (2026-10-16): AgenIA no sabe el turno; se lo dan en la recepción.
  preguntaTurno: (
    servicio: string,
    fecha: string,
    medico: string,
    contacto: string,
  ) =>
    `Su cita de *${servicio}* es el *${fecha}* con *${medico}*. 🏥\n\n` +
    `El número de turno y el consultorio no los tengo por este medio: se los indican en la *recepción del hospital*. Acérquese, diga su nombre y que tiene cita a esa hora.\n\n` +
    `Si no encuentra a quién preguntar, comuníquese con ${contacto}.`,

  preguntaTurnoSinCita: (contacto: string) =>
    `El número de turno y el consultorio no los tengo por este medio: se los indican en la *recepción del hospital*. 🏥\n\n` +
    `Si no encuentra a quién preguntar, comuníquese con ${contacto}.`,

  // 🕐 Le dieron otra hora (2026-10-20: «en ventanilla me dijeron que a las 5:50»,
  // con la cita a las 6:10): la que está registrada, y que confirme la otra.
  otraHora: (
    servicio: string,
    fecha: string,
    medico: string,
    contacto: string,
  ) =>
    `En el sistema del hospital, su cita de *${servicio}* está registrada para el *${fecha}* con *${medico}*. 🏥\n\n` +
    `Si en ventanilla le indicaron otra hora —por ejemplo, llegar un poco antes para la admisión—, tenga en cuenta esa indicación o confírmela con ${contacto}.`,

  otraHoraSinCita: (contacto: string) =>
    `Por este medio no puedo confirmarle esa hora. 🏥 Para confirmarla, comuníquese con ${contacto}.`,

  // 👋 Un saludo a secas tras el recordatorio, con agendar apagado (2026-10-20: a
  // quien tenía el teléfono de otra paciente, «Hola buenos días» le contestó «no es
  // posible agendar»): de qué cita le escribimos, de quién, y que avise si no es suyo.
  saludoTrasRecordatorio: (
    botName: string,
    clinicaName: string,
    nombre: string,
    servicio: string,
    fecha: string,
    opciones: string,
  ) =>
    `¡Hola! Le saluda *${botName}*, asistente virtual de *${clinicaName}*. 👋\n\n` +
    `Le escribimos para recordarle la cita${nombre ? ` de *${nombre}*` : ''} de *${servicio}* el *${fecha}*.\n\n` +
    `Por aquí puedo ayudarle a:\n${opciones}\n\n` +
    `Si este número no es ${nombre ? `de *${nombre}*` : 'del paciente'}, por favor avísenos y no le enviaremos más recordatorios.`,

  saludoTrasRecordatorioVarias: (
    botName: string,
    clinicaName: string,
    citas: string,
    opciones: string,
  ) =>
    `¡Hola! Le saluda *${botName}*, asistente virtual de *${clinicaName}*. 👋\n\n` +
    `Le escribimos para recordarle estas citas:\n${citas}\n\n` +
    `Por aquí puedo ayudarle a:\n${opciones}\n\n` +
    `Si este número no es del paciente, por favor avísenos y no le enviaremos más recordatorios.`,

  // 📍 Avisa que ya está en el hospital (2026-10-17: «Acá estamos esperando»).
  yaLlego: (servicio: string, fecha: string, medico: string) =>
    `¡Gracias por avisar! 🙌 Su cita de *${servicio}* es el *${fecha}* con *${medico}*. 🏥\n\n` +
    `El número de turno y el consultorio se los indican en la *recepción del hospital*: acérquese y diga su nombre.`,

  yaLlegoSinCita: (contacto: string) =>
    `¡Gracias por avisar! 🙌 El número de turno y el consultorio se los indican en la *recepción del hospital*. 🏥\n\n` +
    `Si no encuentra a quién preguntar, comuníquese con ${contacto}.`,

  // …pero su cita es otro día: puede haber venido el día que no era.
  yaLlegoOtroDia: (servicio: string, fecha: string, contacto: string) =>
    `Gracias por avisar. 📅 Le cuento que su cita de *${servicio}* está registrada para el *${fecha}*, no para hoy.\n\n` +
    `Si cree que hay un error, pregunte en la recepción del hospital o comuníquese con ${contacto}.`,

  // «No puedo asistir» con cancelar APAGADO: el aviso queda para el personal; la
  // cita NO se cancela (y el mensaje no puede dar a entender que sí).
  avisoInasistenciaRegistrado: (
    servicio: string,
    fecha: string,
    contacto: string,
  ) =>
    `Entendido. Dejé registrado su aviso de que no podrá asistir a su cita de *${servicio}* del *${fecha}*, para que el personal del hospital lo revise. 📝\n\n` +
    `Por este medio no puedo cancelar la cita, así que por ahora sigue registrada. Si quiere cancelarla de inmediato, comuníquese con ${contacto}.`,

  // «Necesito reagendar» con cambiar fecha APAGADO.
  avisoCambioRegistrado: (servicio: string, fecha: string, contacto: string) =>
    `Entendido. Dejé registrada su solicitud de cambiar su cita de *${servicio}* del *${fecha}*, para que el personal del hospital la revise. 📝\n\n` +
    `Por este medio no puedo cambiar la fecha, así que por ahora su cita sigue igual. Si quiere cambiarla de inmediato, comuníquese con ${contacto}.`,

  // Tras dejar el aviso, si alguna operación sigue encendida. `lineas` sale de
  // lineaDisponible / lineaDisponibleConsultar.
  avisoTambienPuede: (lineas: string) =>
    `Por aquí también puedo ayudarle a:\n${lineas}`,

  // Quien contestó dice que el número no es del paciente.
  // ☎️ Escribe otra vez desde un número ya marcado como de otra persona (2026-10-21).
  numeroYaMarcado: (contacto: string) =>
    `Ya quedó registrado que este número no es del paciente: el hospital lo va a corregir y no le enviaremos más recordatorios. 🙏\n\n` +
    `Si usted tiene una cita propia, comuníquese con ${contacto}.`,

  numeroEquivocado: (clinicaName: string) =>
    `Disculpe la molestia y gracias por avisarnos. 🙏\n\n` +
    `El mensaje era de *${clinicaName}* para otra persona: no le enviaremos más recordatorios a este número.`,

  outOfContext: (botName: string = BOT_NAME) =>
    pick([
      `Disculpe, soy *${botName}* y le acompaño únicamente con el agendamiento de citas médicas. 🏥\n\n¿Me indica qué especialidad necesita o el nombre del médico que está buscando?`,
      `Mi labor es ayudarle a agendar citas médicas aquí en el hospital.\n\n¿Qué servicio o médico está buscando?`,
      `Únicamente puedo colaborarle con citas médicas.\n\n¿Me indica qué especialidad necesita o con cuál doctor desea su cita?`,
    ]),

  guardrailInsulto: (_phone: string, _botName: string) =>
    `Para poder brindarle la mejor ayuda, necesitamos mantener una conversación respetuosa.\n\n` +
    `Por ahora, cerraremos este chat. Estaremos listos para atenderle cuando lo desee de forma cordial.\n\n` +
    `Solo escriba *"Hola"* para reiniciar el asistente.`,

  // 🚑 Derivación de EMERGENCIA. Contrato del mensaje: (a) condicional
  // ("podría"), el bot NO diagnostica ni tranquiliza; (b) acción inmediata
  // (línea 123 / urgencias / equipo humano); (c) NO continúa el agendamiento;
  // (d) cierre no punitivo — puede volver con "Hola".
  guardrailEmergencia: (phone: string) =>
    `🚨 Lo que me describe podría requerir *atención médica inmediata* y no debería esperar una cita.\n\n` +
    `Por favor, actúe ahora mismo:\n` +
    `• Llame a la línea de emergencias *123* o diríjase de inmediato al servicio de *Urgencias* más cercano.\n` +
    (phone
      ? `• Si desea hablar con nuestro equipo humano, comuníquese al: 👉 *${phone}*\n`
      : '') +
    `\nSu salud es lo primero. 💙 Cuando se encuentre bien y desee agendar una cita, escríbame *"Hola"* y con gusto le atiendo.`,

  guardrailOffTopic: (phone: string, botName: string = BOT_NAME) =>
    `El sistema no está logrando interpretar correctamente su solicitud dentro del agendamiento de citas.\n\n` +
    `Para que reciba una mejor atención, le recomiendo comunicarse con nuestro equipo humano: 👉 *${phone}*\n\n` +
    `Cuando quiera intentarlo nuevamente conmigo, escríbame *"Hola"* y *${botName}* le atiende.`,

  ininteligible: () =>
    pick([
      `🎙️ El sistema no logró procesar bien su mensaje. ¿Me lo repite, por favor, con calma, o me lo escribe?`,
      `🎙️ No fue posible captar bien el audio. ¿Me lo envía otra vez o me lo escribe, por favor?`,
      `🎙️ El audio no quedó del todo claro. ¿Me lo reenvía con calma o me lo escribe?`,
    ]),

  iaCaida: (phone: string) =>
    `Nuestro sistema está pasando por un mantenimiento. 🛠️\n\n` +
    `Mientras tanto, le invito a comunicarse al *${phone}* para que le atiendan directamente.\n\n` +
    `Apenas estemos de vuelta, podremos continuar por aquí. Gracias por su paciencia.`,

  maxReintentos: (phone: string) =>
    `Disculpe, parece que estamos teniendo dificultades para entendernos.\n\n` +
    `Para no hacerle perder más tiempo, le comunico con nuestro equipo humano: 👉 https://wa.me/${phone}\n\n` +
    `Ellos le atenderán enseguida.`,

  maxReintentosReset: () =>
    pick([
      `Para mayor claridad, reinicié la conversación. 🔄\n\nCuando quiera retomar, escríbame *"Hola"* y comenzamos de nuevo.`,
      `Disculpe, es preferible empezar de cero para mayor claridad.\n\nEscríbame *"Hola"* cuando esté listo(a) y le atiendo con calma.`,
    ]),

  sesionExpirada: () =>
    pick([
      `Su sesión expiró antes de poder confirmar la cita. ⏳\n\nEscríbame *"Hola"* y comenzamos otra vez con gusto.`,
      `Se agotó el tiempo de la sesión. ⏳\n\nCuando desee volver a empezar, escríbame *"Hola"* y le atiendo.`,
    ]),

  cancelarPedirCedula: () =>
    pick([
      `Con gusto le ayudo con la cancelación de su cita. 📋\n\nPara ubicarla en el sistema, ¿me indica el *número de cédula* del paciente, por favor?`,
      `Con gusto le colaboro con eso.\n\nPara buscar la cita, ¿me comparte la *cédula* del paciente?`,
    ]),

  cancelarCedulaInvalida: () =>
    pick([
      `Ese número no corresponde a una cédula válida.\n\n¿Me la confirma, por favor? Solo el número, sin puntos ni espacios.\n_(Ej: 18531928)_`,
      `Disculpe, no fue posible identificar el número correctamente.\n\nEscríbame solo los dígitos, sin separadores. _(Ej: 1088123456)_`,
    ]),

  cancelarPacienteNoExiste: (cedula: string) =>
    pick([
      `No encuentro ningún paciente con la cédula *${cedula}* en el sistema. 🔍\n\n¿Me la confirma, por favor? O si prefiere terminar el proceso, escriba _*"Salir"*_.`,
      `Disculpe, esa cédula *${cedula}* no aparece registrada.\n\n¿La revisamos otra vez? Si desea terminar, escriba _*"Salir"*_.`,
    ]),

  cancelarSinCitas: (cedula: string) =>
    `El paciente con cédula *${cedula}* no tiene citas próximas agendadas`,

  // No se hallaron citas para cancelar: ofrecemos consultar con otra cédula (loop) o cerrar.
  cancelarSinCitasReintentar: (cedula: string) =>
    pick([
      `No encontré citas próximas agendadas para la cédula *${cedula}*. 🔍\n\n` +
        `¿Desea consultar con *otra cédula*? Responda *SÍ* para intentar con otro número, o *NO* para finalizar.`,
      `La cédula *${cedula}* no tiene citas próximas agendadas.\n\n` +
        `Si lo desea, puedo buscar con *otra cédula*. Responda *SÍ* para intentarlo de nuevo o *NO* para terminar.`,
    ]),

  cancelarSeleccionar: (nombre: string, lineas: string) =>
    pick([
      `Encontré estas citas a nombre de *${nombre}*:\n\n${lineas}\n¿Cuál de ellas le gustaría cancelar? Responda con la letra, por favor.`,
      `Estas son las citas que tengo para *${nombre}*:\n\n${lineas}\nIndíqueme con la letra cuál desea cancelar.`,
    ]),

  // Frase corta para AUDIO: el listado de citas va por texto.
  cancelarSeleccionarAudio: (nombre: string) =>
    pick([
      `${nombre}, encontré varias citas a su nombre. Se las dejo en el mensaje de texto; respóndame con la letra de la que desea cancelar.`,
      `A continuación le presento sus citas en el mensaje de texto. Respóndame con la letra de la que desea cancelar, por favor.`,
    ]),

  cancelarConfirmar: (servicio: string, doctor: string, fecha: string) =>
    `Esta es la cita que vamos a cancelar:\n\n🏥 *${servicio}*\n👨‍⚕️ ${doctor}\n📅 ${fecha}\n\n` +
    `⚠️ ¿Está completamente seguro(a)? Responda *SÍ* para cancelarla o *NO* si prefiere mantenerla.`,

  cancelarExitosa: () =>
    pick([
      `✅ Su cita quedó *cancelada con éxito* y el cupo ya está liberado para otro paciente.`,
      `✅ Cancelé su cita y dejé el espacio disponible para alguien más.`,
      `✅ Ya cancelé la cita y el cupo queda liberado.`,
    ]),

  cancelarOfreceAgendar: () =>
    pick([
      `¿Le gustaría agendar ahora una cita en *otro horario disponible*?\n\nResponda *SÍ* para continuar o *NO* si por ahora prefiere dejarlo así.`,
      `Si lo desea, le busco *otro horario* que le acomode. ¿Le parece?\n\n*SÍ* para continuar, *NO* para terminar.`,
    ]),

  cancelarDespedida: () =>
    pick([
      `Listo. Que tenga un buen día.\n\nCuando me necesite, aquí estaré con gusto. Hasta pronto.`,
      `Perfecto. Que esté muy bien.\n\nRecuerde que cuando lo necesite, aquí estoy para atenderle.`,
      `Listo, gracias por escribir. Que pase un excelente día.\n\nCualquier inquietud, escríbame *"Hola"* y le atiendo.`,
    ]),

  despedidaCorta: () =>
    pick([
      `Fue un gusto atenderle. Que tenga un buen día.\n\nCuando necesite algo más, aquí estaré. Hasta pronto.`,
      `Con gusto. Que esté muy bien.\n\nCualquier inquietud, escríbame *"Hola"* y le atiendo.`,
      `Listo, hasta luego. Que tenga una buena tarde.\n\nAquí estaré cuando me necesite.`,
    ]),

  cancelarAbortada: () =>
    pick([
      `✅ Su cita sigue *activa y agendada*, sin cambios.\n\n¿Le puedo ayudar con algo más?`,
      `✅ No realicé ningún cambio — su cita sigue *firme*.\n\n¿Le colaboro con algo más?`,
    ]),

  cancelarError: () =>
    `Lo lamento, el sistema presentó un inconveniente al intentar cancelar la cita.\n\nPara no dejar el proceso a medias, por favor comuníquese con nuestro Call Center y allí le ayudan enseguida.`,

  // «No puedo asistir» con cancelar ENCENDIDO: se le ofrece cancelar ESA cita.
  cancelarOfrecer: (servicio: string, doctor: string, fecha: string) =>
    `Entiendo que no podrá asistir a esta cita:\n\n🏥 *${servicio}*\n👨‍⚕️ ${doctor}\n📅 ${fecha}\n\n` +
    `¿Desea que la *cancele*? Así el cupo queda libre para otro paciente. Responda *SÍ* para cancelarla o *NO* para mantenerla.`,

  // 🏥 H10 de la cancelación: mientras el hospital la registra.
  confirmandoCancelacion: () =>
    pick([
      `Un momento, por favor. Estoy cancelando su cita en el sistema del hospital; en unos segundos le confirmo. ⏳`,
      `Deme unos segundos: estoy registrando la cancelación en el sistema del hospital. ⏳`,
    ]),

  // El hospital no respondió a tiempo: NO se confirma. Se le escribe después.
  cancelacionEnRegistro: (fecha: string) =>
    `El hospital aún no termina de registrar la cancelación de su cita del _${fecha}_. ⏳\n\n` +
    `Apenas quede registrada le escribo por aquí para confirmárselo. No necesita volver a pedirlo.`,

  // La confirmó DESPUÉS del aviso anterior.
  cancelacionConfirmadaDespues: (fecha: string) =>
    `✅ El hospital ya registró la cancelación de su cita del _${fecha}_. El cupo quedó libre para otro paciente.`,

  // En el hospital esa hora es de otro paciente: no se borró nada.
  cancelacionNoAplicada: (fecha: string, contacto: string) =>
    `No pude cancelar su cita del _${fecha}_ en el sistema del hospital: allí esa hora aparece a nombre de otra persona, así que no toqué nada. 🙏\n\n` +
    `El personal del hospital ya tiene el caso para revisarlo. Si lo prefiere, comuníquese con ${contacto}.`,

  // 🔐 La cédula es de un paciente que no es de quien escribe. `hacerla` sale de
  // TEXTO_OPERACION («cancelar una cita», «cambiar la fecha de una cita»).
  citaDeOtroCanal: (hacerla: string, contacto: string) =>
    `Por seguridad, solo puedo ${hacerla} desde el número o el chat registrado del paciente. 🔐\n\n` +
    `Si la cita es suya y me escribe desde otro número, comuníquese con ${contacto}.`,

  // ── CONSULTA DE CITAS ("¿qué citas tengo?") ──────────────────
  consultaPedirCedula: () =>
    pick([
      `Con gusto le consulto sus citas. 🔍\n\n¿Me indica el *número de cédula* del paciente, por favor?`,
      `Claro, reviso sus citas. 🔍\n\nPara ubicarlas, ¿me comparte la *cédula* del paciente?`,
    ]),

  // `cuerpo` ya trae las citas (ver armarCuerpoConsulta en el servicio).
  consultaDetalle: (nombre: string, cuerpo: string) =>
    `📋 Citas de *${nombre}*:\n\n${cuerpo}`,

  // Frase corta para AUDIO: el listado de citas va por texto.
  consultaDetalleAudio: (nombre: string) =>
    `${nombre}, le dejo sus citas en el mensaje de texto, con las opciones para cancelarlas o cambiarlas.`,

  consultaTituloHoy: () => `*Hoy:*`,
  consultaSinCitasHoy: () => `Hoy no tiene citas agendadas.`,
  consultaTituloProximas: () => `*Próximas:*`,

  // Solo las opciones que la clínica deja hacer por el bot, con letras seguidas.
  // `lineas` sale de `lineasOpcionesConsulta`: solo lo que se puede por el bot.
  consultaOpcionesDe: (lineas: string) =>
    `¿Desea hacer algo con ellas? Responda con la letra:\n\n` + lineas,

  // `letras` sale de `letrasOpcionesConsulta`; `lineas`, como arriba.
  consultaOpcionInvalidaDe: (letras: string, lineas: string) =>
    `Por favor responda con la letra ${letras}.\n\n` + lineas,

  consultaOpciones: () =>
    `¿Desea hacer algo con ellas? Responda con la letra:\n\n` +
    lineasOpcionesConsulta(OPCIONES_CONSULTA.map((o) => o.opcion)),

  consultaOpcionInvalida: () =>
    `Por favor responda con la letra *A*, *B*, *C* o *D*.\n\n` +
    lineasOpcionesConsulta(OPCIONES_CONSULTA.map((o) => o.opcion)),

  consultaSinCitas: (nombre: string) =>
    `*${nombre}* no tiene citas próximas registradas. 📭\n\nSi desea agendar una, escríbame *"Hola"* y le muestro los servicios.`,

  // Con quién se comunica el paciente: el hospital, con su teléfono si lo hay.
  contactoClinica: (telefono: string) => `el hospital al *${telefono}*`,
  contactoClinicaSinTelefono: () => `el hospital`,

  // Quien escribe NO es el paciente: ni nombre, ni especialidad, ni médico, ni
  // hora. Sin citas (o sin ese documento) usa consultaMinimaSinCitas, que no
  // distingue "no existe" de "no tiene citas".
  consultaMinima: (cantidad: string, contacto: string) =>
    `Con ese documento hay citas próximas registradas: *${cantidad}*. 🔒\n\n` +
    `Por seguridad, el detalle solo lo muestro cuando me escribe desde el WhatsApp registrado del paciente. ` +
    `Para más información comuníquese con ${contacto}.`,

  consultaMinimaSinCitas: (contacto: string) =>
    `No encuentro citas próximas registradas con ese documento. 🔍\n\nPara más información comuníquese con ${contacto}.`,

  // La clínica tiene hospital, pero el bot no le preguntó en vivo: una cita
  // agendada allá puede no haber llegado todavía.
  consultaAvisoHospital: (contacto: string) =>
    `ℹ️ Si agendó directamente en el hospital, es posible que alguna cita no aparezca aquí; puede confirmarla con ${contacto}.`,

  // ── Fase B: el bot le pregunta al hospital (docs/PLAN_CONSULTA_CITAS.md) ──
  // Promete solo lo que cumple: si el hospital no trae nada nuevo, el bot calla (D6).
  consultaConfirmandoHospital: () =>
    `⏳ Estoy confirmando con el hospital; si tiene alguna otra cita, le escribo en un momento.`,

  // Las citas que solo están en el hospital son de solo lectura (D7).
  consultaHisNuevas: (lineas: string, contacto: string) =>
    `🏥 El hospital tiene estas citas a su nombre:\n\n${lineas}\n\n` +
    `Para cambiarlas o cancelarlas, comuníquese con ${contacto}.`,

  consultaHisNoDisponible: (contacto: string) =>
    `No pude confirmar con el hospital en este momento. Si agendó directamente allá, puede confirmar su cita con ${contacto}.`,

  // Cuando el servicio de una cita del hospital no está homologado.
  consultaCitaHospital: () => `Cita en el hospital`,

  // ── SOLO CONSULTAS (ver SOLO_CONSULTAS_FORMAL) ───────────────
  soloConsultas: (contacto: string) => SOLO_CONSULTAS_FORMAL(contacto),

  // 🔁 Lo pide otra vez: la versión corta.
  soloConsultasCorto: (contacto: string) =>
    `Como le comenté, por este medio por ahora solo puedo mostrarle sus citas (escríbame *"consultar"*). 🙏 Para agendar o hacer cambios, comuníquese con ${contacto}.`,

  // El mismo aviso, presentándose: primer mensaje de la conversación.
  soloConsultasBienvenida: (
    clinicaName: string,
    contacto: string,
    botName: string = BOT_NAME,
  ) =>
    `Le saluda *${botName}*, asistente virtual de *${clinicaName}*.\n\n` +
    SOLO_CONSULTAS_FORMAL(contacto),

  // Cierre de la consulta sin las opciones A-D (cancelar, cambiar, agendar).
  consultaSoloLectura: (contacto: string) =>
    `Para cancelar o cambiar alguna de estas citas, o para agendar una nueva, comuníquese con ${contacto}: por ahora la plataforma solo permite consultarlas.`,

  consultaSinCitasSoloLectura: (nombre: string, contacto: string) =>
    `*${nombre}* no tiene citas próximas registradas. 📭\n\nPara agendar una cita, comuníquese con ${contacto}: por ahora la plataforma solo permite consultarlas.`,

  consultaDetalleAudioSoloLectura: (nombre: string) =>
    `${nombre}, le dejo sus citas en el mensaje de texto.`,

  // ── OPERACIÓN NO DISPONIBLE (ver TEXTO_OPERACION) ─────────────────────
  // `operacion` / `hacerla` salen de TEXTO_OPERACION; `disponibles`, de
  // `lineaDisponible`, una por cada cosa que sí se puede por aquí.
  operacionNoDisponible: (
    operacion: string,
    hacerla: string,
    contacto: string,
    disponibles: string,
  ) =>
    `En este momento no es posible *${operacion}* por este medio. 🙏\n\n` +
    `Para ${hacerla}, por favor comuníquese con ${contacto}.\n\n` +
    `Por aquí sí puedo ayudarle a:\n${disponibles}`,

  // 🔁 Lo pregunta otra vez (2026-10-17: cuatro veces seguidas «¿se puede para
  // el martes?»): el mismo aviso largo no le dice nada nuevo.
  operacionNoDisponibleCorto: (hacerla: string, contacto: string) =>
    `Como le comenté, por este medio no es posible ${hacerla}. 🙏 Para eso, por favor comuníquese con ${contacto}.`,

  // El mismo aviso, presentándose: primer mensaje de la conversación.
  operacionNoDisponibleBienvenida: (
    clinicaName: string,
    operacion: string,
    hacerla: string,
    contacto: string,
    disponibles: string,
    botName: string = BOT_NAME,
  ) =>
    `Le saluda *${botName}*, asistente virtual de *${clinicaName}*.\n\n` +
    `En este momento no es posible *${operacion}* por este medio. 🙏\n\n` +
    `Para ${hacerla}, por favor comuníquese con ${contacto}.\n\n` +
    `Por aquí sí puedo ayudarle a:\n${disponibles}`,

  // Una línea de lo que sí se puede: «• Cancelar una cita: escríbame "…"».
  lineaDisponible: (etiqueta: string, atajo: string) =>
    `• ${etiqueta}: escríbame *${atajo}*`,

  lineaDisponibleConsultar: () =>
    `• Consultar sus citas: escríbame *"consultar"*`,

  // Tras las opciones de la consulta: lo que no se puede hacer por el bot.
  // `acciones` sale de `accionesNoDisponibles`.
  consultaNoDisponibles: (acciones: string, contacto: string) =>
    `Para ${acciones}, comuníquese con ${contacto}.`,

  // Sin citas y sin poder agendar por el bot (cancelar o cambiar sí).
  consultaSinCitasSinAgendar: (nombre: string, contacto: string) =>
    `*${nombre}* no tiene citas próximas registradas. 📭\n\nPara agendar una cita, comuníquese con ${contacto}.`,

  // Cambiar la fecha sin cupos, cuando la clínica no deja cancelar por el bot:
  // no se ofrece cancelarla; la cita se queda como está.
  modificarSinCuposSinCancelar: (servicio: string, contacto: string) =>
    `Revisé la agenda de *${servicio}* y por el momento no hay *otros horarios disponibles* para reprogramar su cita, así que la conservo tal como está.\n\n` +
    `Si necesita cancelarla, por favor comuníquese con ${contacto}.`,

  respuestaInvalidaSiNo: () =>
    pick([
      `No logré interpretar su respuesta. ¿Me ayuda respondiendo *SÍ* para confirmar o *NO* para cancelar?`,
      `Para este paso necesito un *SÍ* o un *NO*, por favor.`,
      `Para asegurarnos, ¿me confirma con *SÍ* o *NO*?`,
    ]),

  audioPasoEstricto: () =>
    `🎙️ Para este paso en particular, por favor responda por *texto* _(la letra o un SÍ/NO)_ — así evitamos cualquier confusión.`,

  // Interrupción amable: el paciente pidió cancelar en medio del agendamiento.
  // Pedimos confirmación antes de abandonar el proceso en curso.
  interrupcionAgendamiento: () =>
    `Entiendo que desea cancelar una cita. ¿Confirma que desea interrumpir el proceso de agendamiento actual para proceder con la cancelación?`,

  // El paciente decidió NO interrumpir: retomamos el agendamiento donde iba.
  interrupcionRetomar: () =>
    `Perfecto, continuemos con su agendamiento justo donde lo dejamos.`,

  // ── MODIFICACIÓN / REPROGRAMACIÓN DE CITA ──────────────────────
  modificarPedirCedula: () =>
    pick([
      `Con gusto le ayudo a *modificar la fecha* de su cita. 🗓️\n\nPara ubicarla en el sistema, ¿me indica el *número de cédula* del paciente, por favor?`,
      `Claro, le ayudo a *reprogramar* su cita.\n\nPara buscarla, ¿me comparte la *cédula* del paciente?`,
    ]),

  modificarPacienteNoExiste: (cedula: string) =>
    pick([
      `No encuentro ningún paciente con la cédula *${cedula}* en el sistema. 🔍\n\n¿Me la confirma, por favor? O si prefiere terminar, escriba _*"Salir"*_.`,
      `Disculpe, esa cédula *${cedula}* no aparece registrada.\n\n¿La revisamos otra vez? Si desea terminar, escriba _*"Salir"*_.`,
    ]),

  modificarSinCitas: (cedula: string) =>
    `El paciente con cédula *${cedula}* no tiene citas próximas que se puedan reprogramar.`,

  // No se hallaron citas: ofrecemos consultar con otra cédula (loop) o cerrar.
  modificarSinCitasReintentar: (cedula: string) =>
    pick([
      `No encontré citas próximas para la cédula *${cedula}* que se puedan reprogramar. 🔍\n\n` +
        `¿Desea consultar con *otra cédula*? Responda *SÍ* para intentar con otro número, o *NO* para finalizar.`,
      `La cédula *${cedula}* no tiene citas próximas para reprogramar.\n\n` +
        `Si lo desea, puedo buscar con *otra cédula*. Responda *SÍ* para intentarlo de nuevo o *NO* para terminar.`,
    ]),

  modificarSeleccionar: (nombre: string, lineas: string) =>
    pick([
      `Encontré estas citas a nombre de *${nombre}*:\n\n${lineas}\n¿Cuál de ellas desea *reprogramar*? Responda con la letra, por favor.`,
      `Estas son las citas que tengo para *${nombre}*:\n\n${lineas}\nIndíqueme con la letra cuál desea *cambiar de fecha*.`,
    ]),

  // Frase corta para AUDIO: el listado de citas va por texto.
  modificarSeleccionarAudio: (nombre: string) =>
    pick([
      `${nombre}, encontré varias citas a su nombre. Se las dejo en el mensaje de texto; respóndame con la letra de la que desea reprogramar.`,
      `A continuación le presento sus citas en el mensaje de texto. Respóndame con la letra de la que desea cambiar de fecha, por favor.`,
    ]),

  modificarMostrarCupos: (
    servicio: string,
    fechaActual: string,
    lineas: string,
  ) =>
    pick([
      `Su cita de *${servicio}* está agendada para:\n📅 ${fechaActual}\n\n` +
        `Estos son los *nuevos horarios disponibles*:\n\n${lineas}\n` +
        `_Responda con la letra del horario al que desea moverla, por favor._`,
      `Actualmente su cita de *${servicio}* es el:\n📅 ${fechaActual}\n\n` +
        `Le muestro los espacios a los que puedo reprogramarla:\n\n${lineas}\n` +
        `_Elija el nuevo horario respondiendo con la letra._`,
    ]),

  // Frase corta para AUDIO: los nuevos horarios van por texto.
  modificarMostrarCuposAudio: (servicio: string) =>
    pick([
      `A continuación le presento los horarios disponibles para reprogramar su cita de ${servicio}. Los dejo en el mensaje de texto; respóndame con la letra del que prefiera.`,
      `Estos son los nuevos horarios para su cita de ${servicio}. Se los dejo en el mensaje de texto; respóndame con la letra de la opción que más le acomode.`,
    ]),

  // No hay cupos para reprogramar → ofrecemos cancelar la cita.
  modificarSinCupos: (servicio: string) =>
    pick([
      `Revisé la agenda de *${servicio}* y por el momento no hay *otros horarios disponibles* para reprogramar su cita.\n\n` +
        `¿Desea que *cancele la cita actual*? Responda *SÍ* para cancelarla o *NO* si prefiere conservarla tal como está.`,
      `Por ahora no tengo *cupos alternativos* en *${servicio}* para mover su cita.\n\n` +
        `Si lo desea puedo *cancelar la cita existente*. Responda *SÍ* para cancelar o *NO* para dejarla sin cambios.`,
    ]),

  modificarConfirmar: (
    servicio: string,
    doctor: string,
    fechaActual: string,
    fechaNueva: string,
  ) =>
    `Vamos a *reprogramar* esta cita:\n\n🏥 *${servicio}*\n👨‍⚕️ ${doctor}\n` +
    `📅 Actual: ${fechaActual}\n🆕 Nueva: ${fechaNueva}\n\n` +
    `¿Confirma el cambio? Responda *SÍ* para reprogramarla o *NO* para mantener la fecha actual.`,

  modificarExitosa: (fechaNueva: string) =>
    pick([
      `✅ Listo, su cita quedó *reprogramada* con éxito para:\n📅 ${fechaNueva}\n\nEl horario anterior queda liberado para otro paciente.`,
      `✅ Hecho. Moví su cita al nuevo horario:\n📅 ${fechaNueva}\n\nLiberé el espacio anterior. ¡Le esperamos!`,
    ]),

  // El paciente NO confirmó el cambio: dejamos la cita como estaba.
  modificarAbortada: () =>
    pick([
      `✅ No realicé ningún cambio — su cita sigue *firme* en la fecha original.\n\n¿Le puedo ayudar con algo más?`,
      `✅ Perfecto, dejé su cita tal como estaba, sin cambios.\n\n¿Le colaboro con algo más?`,
    ]),

  // No había cupos y el paciente decidió NO cancelar: todo queda intacto.
  modificarSinCambios: () =>
    pick([
      `Entendido, dejo su cita *tal como está*, sin ninguna modificación.\n\n¿Le puedo ayudar con algo más?`,
      `Listo, no toco nada — su cita sigue *activa y agendada* como estaba.\n\n¿Le colaboro con algo más?`,
    ]),

  modificarError: () =>
    `Lo lamento, el sistema presentó un inconveniente al intentar reprogramar la cita.\n\nPara no dejar el proceso a medias, por favor comuníquese con nuestro Call Center y allí le ayudan enseguida.`,

  inactividad: () =>
    `Buen día. Por inactividad cerré nuestra conversación para proteger sus datos. 🔒\n\nCuando quiera retomar, escríbame *"Hola"* y con gusto le atiendo.`,
};

// ═════════════════════════════════════════════════════════════
// POOL INFORMAL — Voz: cercana y cálida, "tú", manteniendo el
// profesionalismo médico. Las listas (servicios, EPS, horarios)
// conservan los saltos de línea para que el usuario las escanee
// hacia abajo, no en un bloque tipo párrafo.
// ═════════════════════════════════════════════════════════════
const INFORMAL = {
  bienvenida: (
    clinicaName: string,
    servicios: string,
    botName: string = BOT_NAME,
  ) =>
    pick([
      `¡Hola! ¿Cómo estás? 😊 Soy *${botName}* y te escribo desde *${clinicaName}*. Gracias por escribirnos.\n\n` +
        `Te ayudo a agendar tu cita médica de una. Cuéntame, ¿qué especialidad necesitas hoy?\n_${servicios}_`,
      `¡Hey, hola! 👋 Soy *${botName}*, de *${clinicaName}*. ¿Cómo vas?\n\n` +
        `Con gusto te ayudo a reservar tu cita rápido. ¿Para qué especialidad la necesitas?\n_${servicios}_`,
      `¡Hola! ¿Qué tal? 🌻 Soy *${botName}*, el asistente de *${clinicaName}*.\n\n` +
        `Aquí te ayudo a agendar tu cita sin filas ni esperas. Cuéntame qué buscas hoy.\n_${servicios}_`,
    ]),

  menuServicios: (
    clinicaName: string,
    lineas: string,
    botName: string = BOT_NAME,
  ) =>
    pick([
      `¡Hola! ¿Cómo estás? 😊 Soy *${botName}*, te escribo desde *${clinicaName}*. Gracias por escribirnos.\n\n` +
        `Te puedo ayudar a agendar tu cita médica. Estos son los servicios disponibles:\n\n` +
        `${lineas}\n` +
        `_Respóndeme con la letra, escríbeme el nombre o mándame un audio, como prefieras._ 🎙️`,
      `¡Hey! 👋 Soy *${botName}*, de *${clinicaName}*, un gusto saludarte.\n\n` +
        `Aquí te ayudo a reservar tu cita. Hoy tengo estos servicios para ti:\n\n` +
        `${lineas}\n` +
        `_Puedes responder con la letra (A, B, C...), escribirme el nombre o mandarme un audio._ 😊`,
      `¡Hola! ¿Qué tal? 🌻 Soy *${botName}*, tu asistente de *${clinicaName}*.\n\n` +
        `Estoy aquí para que reservar tu cita sea cosa de un minuto. ¿Cuál de estos servicios necesitas hoy?\n\n` +
        `${lineas}\n` +
        `_Respóndeme con la letra, el nombre o un audio de voz, como te parezca mejor._ 🎙️`,
    ]),

  menuServiciosSinPresentacion: (lineas: string) =>
    pick([
      `¡Claro! 😊 Estos son los servicios disponibles:\n\n` +
        `${lineas}\n` +
        `_Respóndeme con la letra, escríbeme el nombre o mándame un audio, como prefieras._ 🎙️`,
      `¡Con gusto! 🌻 ¿Cuál de estos servicios necesitas?\n\n` +
        `${lineas}\n` +
        `_Puedes responder con la letra (A, B, C...), escribirme el nombre o mandarme un audio._ 😊`,
    ]),

  servicioInvalido: (lineas: string) =>
    pick([
      `Parece que no logré captar bien tu respuesta. 🙏 ¿Me confirmas el servicio? Puedes mandarme la letra (A, B, C...) o escribirme el nombre directo:\n\n${lineas}`,
      `Esa opción no la pude identificar. Volvamos a intentarlo — me dices la letra o me escribes el nombre:\n\n${lineas}`,
      `No me quedó claro, dame otra oportunidad para entenderte. Mándame una letra (A, B, C...) o escríbeme el nombre del servicio:\n\n${lineas}`,
    ]),

  menuEps: (servicio: string, lineas: string) =>
    pick([
      `¡Listo, *${servicio}*! 🩺 Buena elección. Ahora cuéntame: ¿con qué *EPS* vienes hoy? Así te busco el mejor horario. Estas son las que manejamos:\n\n${lineas}\n` +
        `_Si pagas directo la consulta, elige *Particular*._ 💳`,
      `¡Perfecto, vamos por *${servicio}*! 🩺 Dime con cuál *EPS* estás afiliado(a). Estas son las opciones — me respondes con la letra o el nombre:\n\n${lineas}\n` +
        `_Y si pagas por tu cuenta, marca *Particular*, con confianza._ 💳`,
      `Genial, anotado *${servicio}*. 🩺 Siguiente paso: ¿de qué *EPS* eres? Aquí te dejo las que tenemos en convenio:\n\n${lineas}\n` +
        `_Si tu consulta es particular, escoge *Particular*._ 💳`,
    ]),

  // Ver la nota del pool FORMAL: no se afirma que no haya convenio, porque
  // `isActive` significa "agendable por WhatsApp hoy", no "hay contrato".
  epsInvalida: (lineas: string) =>
    pick([
      `Esa EPS no está entre las que puedo agendar por aquí ahorita. 🙏 Elige una de estas opciones con la letra o el nombre, o marca *Particular* si pagas directo:\n\n${lineas}`,
      `Uy, por ahora no puedo agendar citas de esa EPS por WhatsApp. ¿Eliges una de estas? Me dices la letra o el nombre:\n\n${lineas}`,
      `Esa EPS no aparece entre las que puedo atender por este medio. Aquí van las disponibles — escoge una con la letra o el nombre, o *Particular* si pagas por tu cuenta:\n\n${lineas}`,
    ]),

  pedirEps: () =>
    pick([
      `Cuéntame, ¿con qué *EPS o aseguradora* vienes? Así te reviso la disponibilidad.\n\n_(Si pagas tú directo, escríbeme *"Particular"*.)_ 💳`,
      `Dime con cuál *EPS* estás afiliado(a) para buscarte el mejor espacio.\n\n_(Si es por tu cuenta, mándame *"Particular"*.)_ 💳`,
    ]),

  epsNoEncontrada: (epsQuery: string) =>
    pick([
      `No logré identificar la EPS *"${epsQuery}"*. ¿Me la confirmas? _(Si pagas tú la consulta, escribe *Particular*.)_`,
      `Esa EPS no me apareció. ¿Me la escribes otra vez? _(Si pagas tú la consulta, escribe *Particular*.)_`,
    ]),

  epsInactiva: (epsName: string) =>
    pick([
      `Qué pena, ahorita no tenemos convenio activo con *${epsName}*. ¿Te animas a continuar como *Particular* o tienes otra EPS? Cuéntame.`,
      `En este momento no estamos atendiendo *${epsName}*. Si gustas te agendo como *Particular*, o si tienes otra EPS, dímelo.`,
    ]),

  // La cédula no está en el padrón de pacientes dados de alta para esa EPS.
  // Mensaje amable + enlace al formulario público de solicitud de revisión.
  epsNoAfiliado: (epsName: string, enlace: string) =>
    pick([
      `Qué pena contigo: revisé el sistema y tu documento aún no aparece *dado de alta* ` +
        `para agendar por *${epsName}* aquí. 🙏\n\n` +
        `Si crees que deberías estar habilitado(a), radica una *solicitud de revisión* en este ` +
        `enlace seguro y el equipo estudiará tu caso:\n${enlace}\n\n` +
        `_Cuando aprueben tu alta podrás agendar por tu EPS. Si prefieres, también puedes ` +
        `escribirme *"Hola"* y agendar como *Particular* (pago directo)._ 💙`,
      `Lo siento: miré el listado de pacientes habilitados y tu documento todavía no está ` +
        `*dado de alta* para *${epsName}*. 🙏\n\n` +
        `Cuéntanos tu caso en este enlace seguro para que lo revisen — ahí explicas por qué ` +
        `deberías estar habilitado(a):\n${enlace}\n\n` +
        `_Apenas aprueben tu alta podrás agendar por tu EPS. Mientras tanto, si quieres, ` +
        `escríbeme *"Hola"* y te agendo como *Particular*._ 💙`,
    ]),

  // ── LÍMITE DE CITAS POR PACIENTE (ver el pool formal) ─────────────────
  limiteCitasDia: (
    maximo: string,
    citas: string,
    dia: string,
    contacto: string,
    revision: string,
  ) =>
    `Qué pena contigo, no puedo agendarte esta cita por aquí. 🙏\n\n` +
    `En el hospital cada paciente puede tener máximo *${maximo}* el mismo día, ` +
    `y ya tienes *${citas}* para el *${dia}*.\n\n` +
    `Si necesitas atención adicional, comunícate con ${contacto}.${revision}\n\n` +
    `_Si prefieres, escríbeme *"Hola"* y elige otro día._ 💙`,

  limiteCitasMes: (
    maximo: string,
    citas: string,
    mes: string,
    contacto: string,
    revision: string,
  ) =>
    `Qué pena contigo, no puedo agendarte esta cita por aquí. 🙏\n\n` +
    `En el hospital cada paciente puede tener máximo *${maximo}* en un mismo mes, ` +
    `y ya tienes *${citas}* en *${mes}*.\n\n` +
    `Si necesitas atención adicional, comunícate con ${contacto}.${revision}\n\n` +
    `_Si prefieres, escríbeme *"Hola"* y elige una fecha de otro mes._ 💙`,

  limiteCitasCambioDia: (
    maximo: string,
    citas: string,
    dia: string,
    contacto: string,
    revision: string,
  ) =>
    `Qué pena contigo, no puedo cambiar tu cita a esa fecha por aquí. 🙏\n\n` +
    `En el hospital cada paciente puede tener máximo *${maximo}* el mismo día, ` +
    `y ya tienes *${citas}* para el *${dia}*.\n\n` +
    `Si necesitas atención adicional, comunícate con ${contacto}.${revision}\n\n` +
    `_Tu cita sigue como estaba. Si prefieres, escríbeme *"cambiar cita"* y elige otro día._ 💙`,

  limiteCitasCambioMes: (
    maximo: string,
    citas: string,
    mes: string,
    contacto: string,
    revision: string,
  ) =>
    `Qué pena contigo, no puedo cambiar tu cita a esa fecha por aquí. 🙏\n\n` +
    `En el hospital cada paciente puede tener máximo *${maximo}* en un mismo mes, ` +
    `y ya tienes *${citas}* en *${mes}*.\n\n` +
    `Si necesitas atención adicional, comunícate con ${contacto}.${revision}\n\n` +
    `_Tu cita sigue como estaba. Si prefieres, escríbeme *"cambiar cita"* y elige una fecha de otro mes._ 💙`,

  limiteCitasRevisionEnlace: (enlace: string) =>
    `\n\nSi crees que necesitas más citas de las permitidas, puedes pedir una *solicitud de revisión* ` +
    `en este enlace seguro y contarnos por qué; el equipo estudiará tu caso:\n${enlace}`,

  limiteCitasRevisionEnCurso: (periodo: string) =>
    `\n\nYa recibimos tu *solicitud de revisión* para ${periodo} y el equipo la está estudiando. ` +
    `Si la aprueban, podrás agendar por aquí.`,

  cuposDisponibles: (nombre: string, epsName: string, lineas: string) =>
    pick([
      `${nombre ? `¡${nombre}, ` : '¡'}qué bien! 🌟 Mira los horarios que te encontré con *${epsName}*:\n\n${lineas}\n` +
        `_Cuéntame con cuál te quedas — me respondes con la letra._ ✍️`,
      `${nombre ? `${nombre}, ` : ''}¡con gusto! Estos son los espacios que tengo para ti con *${epsName}*:\n\n${lineas}\n` +
        `_Dime cuál te sirve mejor, mándame la letra._ 😊`,
      `${nombre ? `Listo, ${nombre}: ` : 'Listo: '}aquí va la agenda para *${epsName}*:\n\n${lineas}\n` +
        `_Elige el horario que más te acomode (mándame la letra)._ ✍️`,
    ]),

  // Frase corta para AUDIO: el listado de horarios va por texto (tuteo).
  cuposDisponiblesAudio: (epsName: string) =>
    pick([
      `A continuación te presento las opciones que encontré con ${epsName}. Míralas en el mensaje de texto y respóndeme con la letra del horario que prefieras.`,
      `Estos son los horarios que tengo con ${epsName}. Te los dejo en el mensaje de texto; respóndeme con la letra de la opción que más te sirva.`,
    ]),

  // Audio que SÍ lee las próximas opciones (las más cercanas), no solo anuncia.
  // `lineasHabladas` ya viene armado por el service en lenguaje natural
  // ("opción A, mañana a las 3 de la tarde con el Doctor Pérez"). El listado
  // completo con todas las letras sigue viajando por texto (tuteo).
  cuposDisponiblesAudioHablado: (epsName: string, lineasHabladas: string) =>
    pick([
      `Con ${epsName} te encontré estas opciones cercanas: ${lineasHabladas} Me puedes responder con la letra, o decirme el día y la hora que prefieras. Te dejo el listado completo en el mensaje de texto.`,
      `Estas son las citas más próximas con ${epsName}: ${lineasHabladas} Respóndeme con la letra de la que quieras, o dime directamente el día y la hora. En el mensaje de texto te dejo todas las opciones.`,
    ]),

  // Cupos filtrados por la fecha que pidió el paciente ("mañana", "el lunes"...).
  cuposParaFecha: (epsName: string, fechaLabel: string, lineas: string) =>
    pick([
      `¡Mira! Para *${fechaLabel}* con *${epsName}* tengo estos horarios:\n\n${lineas}\n` +
        `_Cuéntame con cuál te quedas — me respondes con la letra._ ✍️`,
      `Para *${fechaLabel}* con *${epsName}* encontré esto:\n\n${lineas}\n` +
        `_Dime cuál te sirve mejor, mándame la letra._ 😊`,
    ]),

  // Fallback suave: no hay cupos en la fecha pedida, pero sí los más próximos.
  sinCuposEsaFechaProximos: (
    fechaLabel: string,
    epsName: string,
    lineas: string,
  ) =>
    pick([
      `Para *${fechaLabel}* no me quedaron cupos. 😔 Pero mira, estos son los más próximos con *${epsName}*:\n\n${lineas}\n` +
        `_Si alguno te sirve, mándame la letra._ ✍️`,
      `Uy, para *${fechaLabel}* ya no tengo espacios. 🙏 Te dejo los más cercanos con *${epsName}*:\n\n${lineas}\n` +
        `_Dime con la letra cuál prefieres._ 😊`,
    ]),

  preguntaWaitlist: (servicio: string, eps: string) =>
    pick([
      `Mira, revisé bien la agenda de *${servicio}* con *${eps}* y por ahora no veo espacios. 😔 Pero no te preocupes — si quieres te anoto en la *lista de espera* y te aviso por acá apenas se libere un espacio. ✨\n\n¿Te animas? Responde *SÍ* para anotarte o *NO* si prefieres intentar después.`,
      `${servicio} con *${eps}* está full estos días. 😅 Pero tengo una idea: ¿quieres que te apunte en la *lista de espera*? En cuanto alguien libere un cupo te escribo para reservártelo. ✅\n\n*SÍ* para anotarte, *NO* para dejarlo.`,
      `Acabo de mirar y la agenda de *${servicio}* (${eps}) está llena. 🙏 Te puedo dejar en la *lista de espera* y te aviso apenas se abra algo, sin compromiso. 🤝\n\n¿Te parece? *SÍ* o *NO*.`,
    ]),

  unidoAWaitlist: (nombre: string, servicio: string, position: number) =>
    pick([
      `¡Listo${nombre ? `, ${nombre}` : ''}! 🎟️ Te anoté en la lista de espera para *${servicio}* — quedaste en la posición *#${position}*.\n\nPendiente de tu WhatsApp: apenas se libere un cupo te escribo de una. ✨ ¡Que tengas un día muy bonito! 😊`,
      `${nombre ? `Perfecto, ${nombre}. ` : 'Perfecto. '}Ya quedaste apuntado(a) en la cola de *${servicio}* (posición *#${position}*). 🎟️\n\nApenas se abra un espacio, te aviso por acá. 💚 ¡Cuídate mucho!`,
      `¡Hecho${nombre ? `, ${nombre}` : ''}! 🌟 Te agregué a la lista para *${servicio}*, vas en la posición *#${position}*.\n\nTe escribo en cuanto tenga novedades. 🙏 Mientras tanto, ¡que estés muy bien!`,
    ]),

  noUnidoAWaitlist: () =>
    pick([
      `Listo, sin problema. 😊 Cuando quieras intentarlo otra vez, me escribes *"Hola"* y seguimos. ¡Que estés muy bien! 👋`,
      `Como quieras, no te preocupes. 🌻 Aquí estaré cuando quieras — solo dime *"Hola"*. ¡Hasta pronto!`,
      `Perfecto, lo dejamos así. 😊 Cualquier cosa, escríbeme *"Hola"* y te atiendo. Que tengas un día genial. 🌟`,
    ]),

  sinDisponibilidad: (
    nombre: string,
    epsName: string,
    especialidad: string,
    position: number,
  ) =>
    `${nombre}, revisé la agenda para *${epsName}* en *${especialidad}* y ahorita no hay espacios. 😔 Pero tranquilo(a), ya te agregué a la lista de espera (posición *#${position}*). En cuanto se libere algo, te escribo. ✨\n\n¿Algo más en lo que te pueda ayudar?`,

  pedirCedulaPostSlot: (fechaFormateada: string) =>
    pick([
      `¡Genial! 🌟 Te aparté ese horario:\n📅 *${fechaFormateada}*\n\nPara terminar de agendarte, ¿me regalas tu *número de cédula*?`,
      `¡Perfecto, ya casi! 😊 Te reservé tentativamente:\n📅 *${fechaFormateada}*\n\nMe falta solo un dato: ¿me compartes tu *cédula*?`,
      `¡Listo! 🎯 Tengo ese espacio apartado para ti:\n📅 *${fechaFormateada}*\n\nPara cerrar, ¿me mandas tu *número de cédula*? Solo el número, sin puntos.`,
    ]),

  especialidadConfirmada: (especialidad: string) =>
    `¡Listo, *${especialidad}*! 🩺 Para revisarte la agenda, ¿me pasas tu *cédula*?`,

  pedirCedula: (especialidad: string) =>
    `Anotado, vas por *${especialidad}*. 🩺 ¿Me compartes tu *cédula*? Solo el número.`,

  primeraVez: () =>
    pick([
      `¡Qué bueno tenerte por aquí por primera vez! 🤝 Para registrarte te pido tu nombre en *dos pasos*.\n\n*Paso 1 de 2:* escribe *solo tus NOMBRES*, sin apellidos.\nPor ejemplo: *María Fernanda*\n\n_Los apellidos te los pido en el siguiente mensaje._`,
      `¡Bienvenido(a)! 🌟 Para abrirte tu historia te pido tu nombre en *dos pasos*.\n\n*Paso 1 de 2:* escribe *solo tus NOMBRES*, sin apellidos.\nPor ejemplo: *Juan Carlos*\n\n_Los apellidos van en la siguiente pregunta._`,
    ]),

  // ACK del Primer Turno (Fase 2): confirma lo que el Agente entendió del
  // primer mensaje, en tono cercano, antes de pedir lo que falta.
  ackTurno1: (p: {
    nombre?: string | null;
    cedula?: string | null;
    especialidad?: string | null;
    eps?: string | null;
    fecha?: string | null;
    botName?: string;
    clinicaName?: string;
  }) => {
    const detalles: string[] = [];
    if (p.nombre) detalles.push(`👤 *Paciente:* ${p.nombre}`);
    if (p.cedula) detalles.push(`🪪 *Cédula:* ${p.cedula}`);
    if (p.especialidad) detalles.push(`🏥 *Servicio:* ${p.especialidad}`);
    if (p.eps) detalles.push(`💳 *EPS:* ${p.eps}`);
    if (p.fecha) detalles.push(`📅 *Fecha que pediste:* ${p.fecha}`);
    const saludo = p.nombre ? `¡Hola, ${p.nombre}!` : '¡Hola!';
    // Saludo + presentación como asistente de IA. Es la primera respuesta que
    // recibe el paciente cuando abre dando sus datos (nombre/cédula/EPS), así
    // que aquí debe identificarse como asistente virtual con IA (sentTurn1Ack
    // suprime el saludo del menú posterior → no hay doble saludo).
    const nombreBot = p.botName || BOT_NAME;
    const presentacion = p.clinicaName
      ? `Soy *${nombreBot}*, tu asistente virtual con inteligencia artificial de *${p.clinicaName}*.`
      : `Soy *${nombreBot}*, tu asistente virtual con inteligencia artificial.`;
    const bloque = detalles.length
      ? `\n\nListo, ya anoté:\n${detalles.join('\n')}`
      : '';
    return `${saludo} 👋 ${presentacion} De una te ayudo a agendar tu cita.${bloque}`;
  },

  // Re-presentación cálida cuando el paciente confirma que SÍ quiere agendar
  // estando en el paso de selección de servicio, pero su texto no mapeó.
  repromptAgendarServicio: (lineas: string) =>
    `¡De una, te ayudo a agendar! 🗓️\n\n` +
    `*¿Cuál de estos servicios necesitas?* Puedes responder con la letra o el nombre:\n\n${lineas}`,

  // Igual, pero en el paso de selección de EPS.
  repromptAgendarEps: (lineas: string) =>
    `¡Listo, sigamos! 🗓️\n\n*¿Con cuál EPS quieres tu cita?*\n\n${lineas}`,

  resumenCita: (
    nombre: string,
    cedula: string,
    eps: string,
    especialidad: string,
    fecha: string,
    policyUrl?: string,
  ) =>
    pick([
      `¡Listo${nombre ? `, ${nombre}` : ''}! Revisemos los datos antes de cerrar:\n\n` +
        `👤 *Paciente:* ${nombre}\n🪪 *Cédula:* ${cedula}\n💳 *EPS:* ${eps}\n🏥 *Servicio:* ${especialidad}\n📅 *Fecha y hora:* ${fecha}\n\n` +
        `¿Todo bien? Responde *SÍ* para confirmar tu cita o *NO* si quieres cambiar algo.\n\n${CONSENT_1581_INFORMAL(policyUrl)}`,
      `¡Perfecto${nombre ? `, ${nombre}` : ''}! Mira los datos que tengo:\n\n` +
        `👤 ${nombre}\n🪪 Cédula ${cedula}\n💳 EPS ${eps}\n🏥 ${especialidad}\n📅 ${fecha}\n\n` +
        `Si está bien, responde *SÍ* y te la dejo confirmada; si algo no, dime *NO*.\n\n${CONSENT_1581_INFORMAL(policyUrl)}`,
      `Ya casi terminamos${nombre ? `, ${nombre}` : ''} 🌟. Estos son tus datos:\n\n` +
        `👤 ${nombre}\n🪪 ${cedula}\n💳 ${eps}\n🏥 ${especialidad}\n📅 ${fecha}\n\n` +
        `¿Cerramos? *SÍ* para agendar, *NO* si prefieres cancelar.\n\n${CONSENT_1581_INFORMAL(policyUrl)}`,
    ]),

  // AUDIO del resumen (solo en flujo de voz; ver la versión formal). Tuteo.
  resumenCitaAudio: (
    nombre: string,
    especialidad: string,
    fechaHablada: string,
  ) =>
    pick([
      `${nombre ? `${nombre}, ` : ''}antes de agendarte revisemos los datos: tu cita de ${especialidad} quedaría para ${fechaHablada}. ` +
        `Si todo está bien, respóndeme sí y queda agendada; si quieres cambiar algo, dime no. ` +
        `Al responder sí también autorizas el tratamiento de tus datos personales; te dejo los detalles y la política por escrito.`,
      `${nombre ? `${nombre}, ` : ''}ya casi terminamos: ${especialidad}, ${fechaHablada}. ` +
        `¿Todo bien? Dime sí para confirmarla, o no si algo no cuadra. ` +
        `Con tu sí autorizas además el tratamiento de tus datos personales; en el mensaje de texto te dejo el resumen completo y la política.`,
    ]),

  citaConfirmada: (clinicaName: string, fecha: string) =>
    pick([
      `¡Listo, todo confirmado! 🎉 Tu cita ya quedó en *${clinicaName}*:\n📅 _${fecha}_\n\nLlega, por favor, *15 minutos antes* y trae tu *cédula*. 🪪 Cualquier cosa, acá estoy. ¡Que estés muy bien! 😊`,
      `¡Hecho! 🌟 Tu cita en *${clinicaName}* quedó agendada:\n📅 _${fecha}_\n\nRecuerda llegar *15 min antes* con tu *cédula*. 🪪 ¡Gracias por confiar en nosotros! 💚`,
      `¡Quedó lista! 🎊 Tienes cita confirmada en *${clinicaName}*:\n📅 _${fecha}_\n\nPor favor, sé puntual: llega *15 minutos antes* y trae tu *documento*. 🪪 ¡Hasta pronto! 👋`,
    ]),

  // Resumen de texto que se envía DESPUÉS de confirmar (solo en flujo de voz):
  // el paciente escuchó el audio pero no vio los datos por escrito, así que se
  // los dejamos como respaldo. Sin SÍ/NO ni consentimiento (ya ocurrió). Una
  // sola versión (no `pick`): es un comprobante, no conversación.
  resumenCitaConfirmadaTexto: (
    nombre: string,
    cedula: string,
    eps: string,
    especialidad: string,
    fecha: string,
  ) =>
    `📋 *Resumen de tu cita*\n\n` +
    `👤 *Paciente:* ${nombre}\n🪪 *Cédula:* ${cedula}\n💳 *EPS:* ${eps}\n🏥 *Servicio:* ${especialidad}\n📅 *Fecha y hora:* ${fecha}`,

  citaNoConfirmada: () =>
    pick([
      `Listo, sin problema, cancelé la solicitud. 😊 Cuando quieras intentarlo otra vez, me escribes *"Hola"* y vamos.`,
      `Tranquilo(a), lo dejamos por ahora. 🌻 Cuando quieras retomar, me dices *"Hola"*.`,
      `No te preocupes, no se agendó nada. 😊 Cuando estés listo(a), escríbeme *"Hola"* y arrancamos otra vez.`,
    ]),

  // 🏥 H10: ver la versión formal.
  confirmandoCita: () =>
    pick([
      `Dame unos segundos ⏳, estoy confirmando tu cita con el sistema del hospital.`,
      `Un momentico ⏳: estoy registrando tu cita en el sistema del hospital.`,
    ]),

  citaEnRegistro: (fecha: string) =>
    `El hospital todavía está registrando tu cita del _${fecha}_. ⏳\n\n` +
    `Apenas quede lista te escribo por aquí para confirmártela. No tienes que agendarla otra vez.`,

  citaNoRegistradaEnHospital: (fecha: string, contacto: string) =>
    `Qué pena 😔: el hospital no pudo registrar tu cita del _${fecha}_ porque ese horario ya no estaba disponible.\n\n` +
    `Escríbeme *"Hola"* para elegir otro horario, o comunícate con ${contacto}.`,

  confirmandoCambio: () =>
    pick([
      `Dame unos segundos ⏳, estoy registrando el cambio de tu cita en el sistema del hospital.`,
      `Un momentico ⏳: estoy pasando tu cita al nuevo horario en el sistema del hospital.`,
    ]),

  cambioEnRegistro: (fechaNueva: string) =>
    `El hospital todavía está registrando el cambio de tu cita al _${fechaNueva}_. ⏳\n\n` +
    `Apenas quede listo te escribo por aquí para confirmártelo. No tienes que pedirlo otra vez.`,

  cambioRechazadoPorHospital: (fechaNueva: string, fechaAnterior: string) =>
    `Qué pena 😔: el hospital no pudo registrar el cambio al _${fechaNueva}_ porque ese horario ya no estaba disponible. ` +
    `Tu cita *sigue el ${fechaAnterior}*.\n\nTe muestro otros horarios. 👇`,

  cambioNoRegistradoEnHospital: (
    fechaNueva: string,
    fechaAnterior: string,
    contacto: string,
  ) =>
    `Qué pena 😔: el hospital no pudo registrar el cambio de tu cita al _${fechaNueva}_ porque ese horario ya no estaba disponible. ` +
    `Tu cita *sigue el ${fechaAnterior}*.\n\n` +
    `Si quieres otro horario, escríbeme *"cambiar cita"*, o comunícate con ${contacto}.`,

  slotTomado: () =>
    pick([
      `Qué pena, justo ese horario lo acaba de tomar otro paciente. 😬 ¿Vemos otro? Mándame la letra de nuevo, por favor.`,
      `Ese espacio acaba de reservarse. 🙏 ¿Cuál otro te sirve? Dime la letra.`,
    ]),

  // Ver la nota de la versión formal: el cupo NO está tomado, solo cerrado
  // para este canal.
  medicoNoDisponiblePorWhatsapp: () =>
    pick([
      `Uy, ese horario ya no se puede agendar por acá. 🙏 ¿Vemos otro? Mándame la letra.`,
      `Ese espacio dejó de estar disponible por este medio. ¿Cuál otro te sirve? Dime la letra.`,
    ]),

  // Ver la nota de la versión formal: cambiar de horario no arregla esto,
  // por eso no se ofrece "elegir otro".
  epsRegimenNoFacturable: () =>
    pick([
      `Uy, qué pena: tu EPS no tiene convenio vigente para agendar por acá con tu tipo de afiliación. 🙏\n\nTe recomiendo comunicarte directamente con el hospital.`,
      `No puedo agendarte esta cita por este medio: tu EPS no tiene convenio para tu régimen en este momento.\n\nMejor comunícate directo con el hospital.`,
    ]),

  epsSoloPorTelefono: (nombreEps: string, contacto: string) =>
    `Por aquí todavía no puedo agendar citas con *${nombreEps}*. 🙏\n\n` +
    `Para agendar tu cita con tu EPS, comunícate con ${contacto}.`,

  epsNoDisponibleOfrecerParticular: (nombreEps: string) =>
    pick([
      `La EPS *${nombreEps}* no está disponible en este momento para agendar por acá. 🙏\n\nPuedes pedir tu cita como *particular* (pago directo). ¿Quieres agendarla? Responde *SÍ* o *NO*.`,
      `Por ahora no puedo agendarte con *${nombreEps}*.\n\nSi quieres, la sacamos como *particular* (pago directo). ¿Te la agendo? Responde *SÍ* o *NO*.`,
    ]),

  epsParticularOEps: (lineas: string) =>
    pick([
      `Me mencionas tu EPS y también cita *particular*. Para no equivocarme, ¿con cuál la agendamos? Mándame la letra:\n\n${lineas}`,
      `¿La cita va por tu EPS o como *particular* (pago directo)? Dime la letra:\n\n${lineas}`,
    ]),

  epsNoDisponibleDespedida: () =>
    pick([
      `¡Listo! Si más adelante quieres una cita particular, aquí estoy. 😊`,
      `Entendido. Cuando quieras agendar como particular, me escribes. ¡Que estés muy bien!`,
    ]),

  // ── Alta de paciente nuevo ────────────────────────────────────────────
  pedirNacimiento: () =>
    pick([
      `Gracias. ¿Cuál es tu *fecha de nacimiento*? 📅\n\nPuedes escribirla como *15/03/1980* o "15 de marzo de 1980".`,
      `Listo. ¿Me dices tu *fecha de nacimiento*? Por ejemplo: *15/03/1980*.`,
    ]),

  confirmarNacimiento: (fechaLegible: string) =>
    pick([
      `Entendí *${fechaLegible}*. ¿Está bien? Responde *SÍ*, o escríbela de nuevo.`,
      `Anoté *${fechaLegible}*. ¿Correcto? Dime *SÍ* o mándamela otra vez.`,
    ]),

  nacimientoNoEntendido: () =>
    pick([
      `No entendí esa fecha. 🙏 ¿Me la escribes como *15/03/1980*?`,
      `Uy, no capté la fecha. Escríbela así: *día/mes/año*, por ejemplo *15/03/1980*.`,
    ]),

  nombreParaLista: () =>
    pick([
      `Para anotarte en la lista, ¿me pasas tu *nombre completo*?`,
      `¿Me dices tu *nombre completo* para dejarte en la lista de espera?`,
    ]),
  pedirApellidos: (nombres: string) =>
    pick([
      `¡Gracias! Nombres: *${nombres}* 😊\n\n*Paso 2 de 2:* ahora escribe *solo tus APELLIDOS*.\nPor ejemplo: *Gómez Restrepo*`,
      `Listo. Nombres: *${nombres}*\n\n*Paso 2 de 2:* escribe *solo tus APELLIDOS*.\nPor ejemplo: *Pérez Gil*`,
    ]),
  apellidosNoEntendidos: () =>
    pick([
      `No te entendí los apellidos. ¿Me los escribes otra vez? *Solo tus APELLIDOS*.`,
      `Perdona, ¿me repites tus *APELLIDOS*? Solo los apellidos.`,
    ]),
  apellidosRepetidos: (nombres: string) =>
    `Escribiste lo mismo que en el paso anterior. 🙏\n\nTus nombres ya los tengo: *${nombres}*\n\n*Paso 2 de 2:* escribe *solo tus APELLIDOS*, por favor.`,
  pedirSexo: () =>
    pick([
      `¿Cuál es tu *sexo*?\n\n*A)* Masculino\n*B)* Femenino`,
      `Para el registro: ¿*A)* Masculino o *B)* Femenino?`,
    ]),

  sexoNoEntendido: () =>
    pick([
      `No entendí. Responde *A* (masculino) o *B* (femenino), porfa.`,
      `¿*A)* Masculino o *B)* Femenino?`,
    ]),

  pedirRegimen: (epsName: string) =>
    pick([
      `Última: tu afiliación a *${epsName}*, ¿es *subsidiada* o *contributiva*?\n\n*A)* Subsidiado (SISBÉN)\n*B)* Contributivo`,
      `Para terminar: en *${epsName}*, ¿régimen subsidiado o contributivo?\n\n*A)* Subsidiado\n*B)* Contributivo`,
    ]),

  regimenNoEntendido: () =>
    pick([
      `No entendí. Responde *A* si eres subsidiado (SISBÉN) o *B* si contributivo.`,
      `¿*A)* Subsidiado o *B)* Contributivo?`,
    ]),

  errorSlotInvalido: () =>
    pick([
      `Mmm, esa letra no la veo entre las opciones que te mandé. 🙏 ¿Me la confirmas? Puedes responderme con la letra (A, B, C...) o escribirme *"Salir"* si quieres terminar.`,
      `No encontré esa opción. 😊 Respóndeme con una de las letras (A, B, C...) o escribe *"Salir"* para cancelar.`,
    ]),

  waitlistCupoDisponible: (
    nombre: string,
    especialidad: string,
    fecha: string,
    doctor: string,
  ) =>
    pick([
      `🔔 ¡Hey ${nombre}, tengo súper buenas noticias! Se liberó un cupo para *${especialidad}* y tú eras la siguiente persona en la lista. 🌟\n\n📅 *${fecha}*\n👨‍⚕️ ${doctor}\n\nTe lo aparto por *30 minutos*. ¿Lo tomas? Responde *SÍ* para confirmarte o *NO* si ya no lo necesitas.`,
      `🔔 ¡${nombre}, buena noticia! 🌟 Se abrió un espacio para *${especialidad}* y te toca a ti, eras la primera en espera:\n\n📅 *${fecha}*\n👨‍⚕️ ${doctor}\n\nTienes *30 minutos* para confirmarme. ¿Te lo dejo? *SÍ* o *NO*.`,
    ]),

  waitlistCupoRechazado: () =>
    pick([
      `¡Sin problema! 😊 Libero el cupo entonces. Tranquilo(a), sigues en la lista y te aviso cuando aparezca otro. ✨ ¡Que estés muy bien! 👋`,
      `Listo, como quieras. 🌻 Libero el cupo para otro paciente que también lo está esperando. Sigues en la lista. 💚`,
    ]),

  waitlistExpirado: () =>
    pick([
      `Se nos pasó el tiempo para confirmar ese cupo. ⏰ Si aún quieres una cita, escríbeme *"Hola"* y te anoto de nuevo. 😊`,
      `Venció el tiempo para reservar ese cupo. 🙏 Si quieres volver a intentarlo, mándame *"Hola"* y seguimos. 💚`,
    ]),

  escape: () =>
    pick([
      `¡Listo, arrancamos de cero! 😊 Cuéntame, ¿en qué te puedo ayudar?`,
      `Sin problema, refrescamos. 🌻 ¿Qué necesitas hoy?`,
      `Tranquilo(a), volvemos a empezar. 😊 Dime, ¿qué te ayudo a buscar?`,
    ]),

  recordatoriosBaja: () =>
    pick([
      `¡Listo! No te enviamos más recordatorios. 🔔\n\nTus citas siguen ahí, ¿sí? Esto es solo por los mensajes. Si quieres volver a recibirlos, escríbeme *"activar recordatorios"*. 😊`,
      `Hecho, dejo de recordarte. 🔔 Tus citas NO se cancelan. Si cambias de opinión, mándame *"activar recordatorios"*. 💚`,
    ]),

  recordatoriosActivados: () =>
    pick([
      `¡Listo! Vuelvo a enviarte los recordatorios de tus citas. 🔔😊`,
      `Hecho, los recordatorios quedan activos otra vez. 🔔`,
    ]),

  recordatoriosSinRegistro: () =>
    pick([
      `No tengo ninguna historia registrada con este número, así que no te estamos enviando recordatorios. 🤔 Si de todos modos te llegan, avísale al hospital.`,
      `Con este número no encuentro historia, así que no hay recordatorios que apagar. Si recibes mensajes nuestros, cuéntale al hospital. 🙏`,
    ]),

  lineaDeCita: (servicio: string, fecha: string) =>
    `• *${servicio}* — ${fecha}`,
  lineaDeCitaDe: (servicio: string, fecha: string, nombre: string) =>
    `• *${servicio}* — ${fecha} (${nombre})`,

  recordatorioConfirmadoVarias: (lineas: string) =>
    `¡Gracias por confirmar! 🙌 Te esperamos en tus citas:\n\n${lineas}`,

  quienEscribeConCitas: (
    botName: string,
    clinicaName: string,
    lineas: string,
  ) =>
    `¡Hola! Te escribe *${botName}*, asistente virtual de *${clinicaName}*, por tus citas: 🏥\n\n${lineas}`,

  preguntaSobreCitas: (lineas: string, clinicaName: string, contacto: string) =>
    `Tus citas son en *${clinicaName}*: 🏥\n\n${lineas}\n\n` +
    `Si necesitas indicaciones para llegar o tienes otra pregunta sobre tus citas, comunícate con ${contacto}.`,

  avisoInasistenciaRegistradoVarias: (lineas: string, contacto: string) =>
    `Entendido. Dejé registrado tu aviso de que no podrás ir a estas citas, para que el personal del hospital lo revise: 📝\n\n${lineas}\n\n` +
    `Por aquí no puedo cancelarlas, así que por ahora siguen registradas. Si quieres cancelarlas de una vez, comunícate con ${contacto}.`,

  avisoCambioRegistradoVarias: (lineas: string, contacto: string) =>
    `Entendido. Dejé registrada tu solicitud de cambiar estas citas, para que el personal del hospital la revise: 📝\n\n${lineas}\n\n` +
    `Por aquí no puedo cambiar las fechas, así que por ahora siguen igual. Si quieres cambiarlas de una vez, comunícate con ${contacto}.`,

  cancelarElegirCual: (lineas: string) =>
    `Entiendo que no vas a poder ir. Estas son tus citas próximas:\n\n${lineas}\n\n` +
    `¿Cuál quieres *cancelar*? Responde con la letra. Si son varias, te las cancelo una por una.`,

  cancelarOtraCita: () =>
    `Si también quieres cancelar otra de tus citas, escríbeme *"cancelar cita"*.`,

  citasFueraDelAlcance: (contacto: string) =>
    `Las citas que tienes registradas no se pueden gestionar por aquí: se manejan directamente con el hospital. 🏥\n\n` +
    `Por favor comunícate con ${contacto}.`,

  citaYaPaso: (contacto: string) =>
    `La hora de tu cita ya pasó, así que no puedo cancelarla por aquí. 🕐\n\n` +
    `Si necesitas algo sobre esa cita, comunícate con ${contacto}.`,

  avisoFueraDelAlcanceCancelar: (
    servicio: string,
    fecha: string,
    contacto: string,
  ) =>
    `Dejé tu aviso para el personal del hospital: no podrás asistir a tu cita de *${servicio}* del *${fecha}*. 📋\n\n` +
    `Esa cita no se gestiona por aquí, así que *todavía no está cancelada*: para cancelarla, comunícate con ${contacto}.`,

  avisoFueraDelAlcanceCancelarVarias: (lineas: string, contacto: string) =>
    `Dejé tu aviso para el personal del hospital: no podrás asistir a estas citas:\n\n${lineas}\n\n` +
    `Esas citas no se gestionan por aquí, así que *todavía no están canceladas*: para cancelarlas, comunícate con ${contacto}.`,

  avisoFueraDelAlcanceCambiar: (
    servicio: string,
    fecha: string,
    contacto: string,
  ) =>
    `Dejé tu aviso para el personal del hospital: quieres cambiar la fecha de tu cita de *${servicio}* del *${fecha}*. 📋\n\n` +
    `Esa cita no se gestiona por aquí, así que *sigue igual por ahora*: para cambiarla, comunícate con ${contacto}.`,

  avisoFueraDelAlcanceCambiarVarias: (lineas: string, contacto: string) =>
    `Dejé tu aviso para el personal del hospital: quieres cambiar la fecha de estas citas:\n\n${lineas}\n\n` +
    `Esas citas no se gestionan por aquí, así que *siguen igual por ahora*: para cambiarlas, comunícate con ${contacto}.`,

  recordatorioConfirmado: (fecha: string, servicio: string) =>
    `¡Gracias por confirmar! 🙌 Te esperamos el *${fecha}* para tu cita de *${servicio}*.`,

  quienEscribeConCita: (
    botName: string,
    clinicaName: string,
    servicio: string,
    fecha: string,
  ) =>
    `¡Hola! Te escribe *${botName}*, asistente virtual de *${clinicaName}*, por tu cita de *${servicio}* del *${fecha}*. 🏥`,

  quienEscribe: (botName: string, clinicaName: string) =>
    `¡Hola! Te escribe *${botName}*, asistente virtual de *${clinicaName}*. 🏥\n\n` +
    `Si quieres ver tus citas, escríbeme *"consultar"*.`,

  outOfContextSinAgendar: (
    botName: string,
    disponibles: string,
    contacto: string,
  ) =>
    `Disculpa, soy *${botName}* y por aquí solo puedo ayudarte con tus citas. 🏥\n\n` +
    `Puedo ayudarte a:\n${disponibles}\n\n` +
    `Para cualquier otra gestión, comunícate con ${contacto}.`,

  preguntaSobreCita: (
    servicio: string,
    fecha: string,
    clinicaName: string,
    contacto: string,
  ) =>
    `Tu cita de *${servicio}* es el *${fecha}*, en *${clinicaName}*. 🏥\n\n` +
    `Si necesitas indicaciones para llegar o tienes otra pregunta sobre tu cita, comunícate con ${contacto}.`,

  preguntaTurno: (
    servicio: string,
    fecha: string,
    medico: string,
    contacto: string,
  ) =>
    `Tu cita de *${servicio}* es el *${fecha}* con *${medico}*. 🏥\n\n` +
    `El número de turno y el consultorio no los tengo por aquí: te los indican en la *recepción del hospital*. Acércate, di tu nombre y que tienes cita a esa hora.\n\n` +
    `Si no encuentras a quién preguntar, comunícate con ${contacto}.`,

  preguntaTurnoSinCita: (contacto: string) =>
    `El número de turno y el consultorio no los tengo por aquí: te los indican en la *recepción del hospital*. 🏥\n\n` +
    `Si no encuentras a quién preguntar, comunícate con ${contacto}.`,

  otraHora: (
    servicio: string,
    fecha: string,
    medico: string,
    contacto: string,
  ) =>
    `En el sistema del hospital, tu cita de *${servicio}* está registrada para el *${fecha}* con *${medico}*. 🏥\n\n` +
    `Si en ventanilla te indicaron otra hora —por ejemplo, llegar un poco antes para la admisión—, ten en cuenta esa indicación o confírmala con ${contacto}.`,

  otraHoraSinCita: (contacto: string) =>
    `Por aquí no puedo confirmarte esa hora. 🏥 Para confirmarla, comunícate con ${contacto}.`,

  saludoTrasRecordatorio: (
    botName: string,
    clinicaName: string,
    nombre: string,
    servicio: string,
    fecha: string,
    opciones: string,
  ) =>
    `¡Hola! Te saluda *${botName}*, asistente virtual de *${clinicaName}*. 👋\n\n` +
    `Te escribimos para recordarte la cita${nombre ? ` de *${nombre}*` : ''} de *${servicio}* el *${fecha}*.\n\n` +
    `Por aquí puedo ayudarte a:\n${opciones}\n\n` +
    `Si este número no es ${nombre ? `de *${nombre}*` : 'del paciente'}, por favor avísanos y no te enviaremos más recordatorios.`,

  saludoTrasRecordatorioVarias: (
    botName: string,
    clinicaName: string,
    citas: string,
    opciones: string,
  ) =>
    `¡Hola! Te saluda *${botName}*, asistente virtual de *${clinicaName}*. 👋\n\n` +
    `Te escribimos para recordarte estas citas:\n${citas}\n\n` +
    `Por aquí puedo ayudarte a:\n${opciones}\n\n` +
    `Si este número no es del paciente, por favor avísanos y no te enviaremos más recordatorios.`,

  yaLlego: (servicio: string, fecha: string, medico: string) =>
    `¡Gracias por avisar! 🙌 Tu cita de *${servicio}* es el *${fecha}* con *${medico}*. 🏥\n\n` +
    `El número de turno y el consultorio te los indican en la *recepción del hospital*: acércate y di tu nombre.`,

  yaLlegoSinCita: (contacto: string) =>
    `¡Gracias por avisar! 🙌 El número de turno y el consultorio te los indican en la *recepción del hospital*. 🏥\n\n` +
    `Si no encuentras a quién preguntar, comunícate con ${contacto}.`,

  yaLlegoOtroDia: (servicio: string, fecha: string, contacto: string) =>
    `Gracias por avisar. 📅 Te cuento que tu cita de *${servicio}* está registrada para el *${fecha}*, no para hoy.\n\n` +
    `Si crees que hay un error, pregunta en la recepción del hospital o comunícate con ${contacto}.`,

  avisoInasistenciaRegistrado: (
    servicio: string,
    fecha: string,
    contacto: string,
  ) =>
    `Entendido. Dejé registrado tu aviso de que no podrás ir a tu cita de *${servicio}* del *${fecha}*, para que el personal del hospital lo revise. 📝\n\n` +
    `Por aquí no puedo cancelar la cita, así que por ahora sigue registrada. Si quieres cancelarla de una vez, comunícate con ${contacto}.`,

  avisoCambioRegistrado: (servicio: string, fecha: string, contacto: string) =>
    `Entendido. Dejé registrada tu solicitud de cambiar tu cita de *${servicio}* del *${fecha}*, para que el personal del hospital la revise. 📝\n\n` +
    `Por aquí no puedo cambiar la fecha, así que por ahora tu cita sigue igual. Si quieres cambiarla de una vez, comunícate con ${contacto}.`,

  avisoTambienPuede: (lineas: string) =>
    `Por aquí también puedo ayudarte a:\n${lineas}`,

  numeroYaMarcado: (contacto: string) =>
    `Ya quedó registrado que este número no es del paciente: el hospital lo va a corregir y no te enviaremos más recordatorios. 🙏\n\n` +
    `Si tienes una cita propia, comunícate con ${contacto}.`,

  numeroEquivocado: (clinicaName: string) =>
    `Disculpa la molestia y gracias por avisarnos. 🙏\n\n` +
    `El mensaje era de *${clinicaName}* para otra persona: no le enviaremos más recordatorios a este número.`,

  outOfContext: (botName: string = BOT_NAME) =>
    pick([
      `Perdón, soy *${botName}* y solo te puedo ayudar con el agendamiento de citas médicas. 🏥 ¿Qué especialidad o médico estás buscando?`,
      `Mi trabajo es ayudarte a agendar citas. 😊 Cuéntame, ¿qué servicio o médico necesitas?`,
      `Yo solo te puedo colaborar con citas médicas. 🙏 ¿Qué especialidad necesitas o con cuál doctor te gustaría agendar?`,
    ]),

  guardrailInsulto: (_phone: string, _botName: string) =>
    `Para brindarte la mejor ayuda, necesitamos mantener una conversación respetuosa. 🙏 En este momento, cerraremos este chat. Estamos listos para ayudarte cuando lo desees de forma cordial. Solo escribe *"Hola"* para reiniciar el asistente.`,

  // 🚑 Derivación de EMERGENCIA (mismo contrato que el pool FORMAL:
  // condicional, acción inmediata, sin agendamiento, cierre no punitivo).
  guardrailEmergencia: (phone: string) =>
    `🚨 Lo que me cuentas podría requerir *atención médica inmediata* y no debería esperar una cita.\n\n` +
    `Por favor, actúa ya:\n` +
    `• Llama a la línea de emergencias *123* o ve de inmediato al servicio de *Urgencias* más cercano.\n` +
    (phone
      ? `• Si quieres hablar con nuestro equipo humano: 👉 *${phone}*\n`
      : '') +
    `\nTu salud es lo primero. 💙 Cuando estés bien y quieras agendar tu cita, escríbeme *"Hola"* y te atiendo con gusto.`,

  guardrailOffTopic: (phone: string, botName: string = BOT_NAME) =>
    `Parece que no estoy logrando entenderte dentro del agendamiento. 🙏 Mejor te paso con nuestro equipo humano para que te atiendan: 👉 *${phone}*. Cuando quieras intentarlo conmigo otra vez, solo escríbeme *"Hola"* y *${botName}* te atiende. 😊`,

  ininteligible: () =>
    pick([
      `🎙️ Perdón, no logré escucharte bien. ¿Me lo repites con calma o me lo escribes?`,
      `🎙️ No te capté bien. 😊 ¿Me lo mandas otra vez o me lo escribes?`,
      `🎙️ No me quedó claro. ¿Me lo reenvías o me lo escribes? 🙏`,
    ]),

  iaCaida: (phone: string) =>
    `Qué pena: el sistema está pasando por un mantenimiento breve. 🛠️ Mientras tanto, comunícate al *${phone}* para que te atiendan directamente. 🙏 ¡Gracias por tu paciencia!`,

  maxReintentos: (phone: string) =>
    `Perdón, parece que no estamos logrando entendernos. 😔 Para no hacerte perder tiempo, te paso con nuestro equipo humano: 👉 https://wa.me/${phone}. Te atienden enseguida con gusto.`,

  maxReintentosReset: () =>
    pick([
      `Para no enredarte más, reinicié la conversación. 🔄 Cuando quieras retomar, escríbeme *"Hola"* y arrancamos de nuevo. 😊`,
      `Mejor arrancamos de cero. 🌻 Mándame *"Hola"* cuando estés listo(a) y seguimos con calma.`,
    ]),

  sesionExpirada: () =>
    pick([
      `Qué pena, tu sesión se venció antes de poder confirmar. ⏳ No te preocupes, escríbeme *"Hola"* y empezamos otra vez. 😊`,
      `Se nos pasó el tiempo de la sesión. 🙏 Cuando quieras volver, mándame *"Hola"* y te atiendo. 💚`,
    ]),

  cancelarPedirCedula: () =>
    pick([
      `Claro que sí, te ayudo a cancelar tu cita. 📋 Para buscarla, ¿me pasas la *cédula* del paciente?`,
      `Con gusto te ayudo con eso. 😊 ¿Me compartes la *cédula* del paciente para buscar la cita?`,
    ]),

  cancelarCedulaInvalida: () =>
    pick([
      `Mmm, ese número no me parece una cédula válida. 🙏 ¿Me la confirmas? Solo el número, sin puntos ni espacios. _(Ej: 18531928)_`,
      `Parece que no logré identificar el número. 😊 Mándame solo los dígitos, sin separadores. _(Ej: 1088123456)_`,
    ]),

  cancelarPacienteNoExiste: (cedula: string) =>
    pick([
      `Hmm, busqué y no encuentro a ningún paciente con la cédula *${cedula}*. 🔍 ¿Me la confirmas? O si quieres terminar, escríbeme _*"Salir"*_.`,
      `Esa cédula *${cedula}* no me aparece. 🙏 ¿La revisamos otra vez? Si gustas terminar, mándame _*"Salir"*_.`,
    ]),

  cancelarSinCitas: (cedula: string) =>
    `Revisé y el paciente con cédula *${cedula}* no tiene citas próximas. 📭 ¿Te ayudo a agendar una nueva?`,

  // No se hallaron citas para cancelar: ofrecemos consultar con otra cédula (loop) o cerrar.
  cancelarSinCitasReintentar: (cedula: string) =>
    pick([
      `Revisé y la cédula *${cedula}* no tiene citas próximas agendadas. 📭\n\n` +
        `¿Quieres que busque con *otra cédula*? Mándame *SÍ* para intentar con otro número, o *NO* para terminar. 😊`,
      `Hmm, con la cédula *${cedula}* no me aparecen citas agendadas.\n\n` +
        `Si quieres probamos con *otra cédula*. Responde *SÍ* para intentarlo de nuevo o *NO* para cerrar. 🙏`,
    ]),

  cancelarSeleccionar: (nombre: string, lineas: string) =>
    pick([
      `Listo, encontré estas citas a nombre de *${nombre}*:\n\n${lineas}\n¿Cuál quieres cancelar? Mándame la letra.`,
      `Acá están las citas que tengo para *${nombre}*:\n\n${lineas}\nDime con la letra cuál es la que quieres cancelar. 😊`,
    ]),

  // Frase corta para AUDIO: el listado de citas va por texto (tuteo).
  cancelarSeleccionarAudio: (nombre: string) =>
    pick([
      `${nombre}, encontré varias citas a tu nombre. Te las dejo en el mensaje de texto; respóndeme con la letra de la que quieres cancelar.`,
      `A continuación te presento tus citas en el mensaje de texto. Respóndeme con la letra de la que quieres cancelar. 😊`,
    ]),

  cancelarConfirmar: (servicio: string, doctor: string, fecha: string) =>
    `Para confirmarte, esta es la cita que vamos a cancelar:\n\n🏥 *${servicio}*\n👨‍⚕️ ${doctor}\n📅 ${fecha}\n\n⚠️ ¿Seguro(a)? Responde *SÍ* para cancelarla o *NO* si prefieres dejarla.`,

  cancelarExitosa: () =>
    pick([
      `✅ ¡Listo! Tu cita quedó *cancelada* y el cupo ya está libre para otro paciente. 🗓️`,
      `✅ Hecho, cancelé tu cita y liberé el espacio. 🙏`,
      `✅ Perfecto, cita cancelada y cupo disponible para alguien más. 💚`,
    ]),

  cancelarOfreceAgendar: () =>
    pick([
      `¿Te ayudo a agendar en *otro horario disponible*? Cuéntame. *SÍ* para seguir, *NO* si por ahora no.`,
      `Si quieres te busco *otro horario* que te acomode. ¿Te animas? *SÍ* para seguir, *NO* para terminar.`,
    ]),

  cancelarDespedida: () =>
    pick([
      `¡Listo, que tengas un día muy bonito! 😊 Cuando me necesites, acá estaré. ¡Hasta pronto! 👋`,
      `¡Perfecto, cuídate mucho! 🌻 Cualquier cosa, escríbeme y te atiendo. ¡Que estés muy bien!`,
      `¡Listo, gracias por escribir! 💚 Que pases un día genial. Cualquier cosa, me dices *"Hola"*. 👋`,
    ]),

  despedidaCorta: () =>
    pick([
      `¡Fue un gusto atenderte! 😊 Que tengas un día muy bonito. Cuando me necesites, acá me tienes. 👋`,
      `¡Con gusto! 🌻 Que estés muy bien. Cualquier cosa, me escribes *"Hola"*. 💚`,
      `¡Listo, hasta luego! 😊 Que tengas un día lindo. Acá estaré cuando me necesites. 👋`,
    ]),

  cancelarAbortada: () =>
    pick([
      `✅ ¡Perfecto! Tu cita sigue *activa*, sin cambios. ¿Te ayudo en algo más?`,
      `✅ Tranquilo(a), no toqué nada — tu cita sigue *firme*. 😊 ¿Te colaboro con algo más?`,
    ]),

  cancelarError: () =>
    `Qué pena, tuve un inconveniente cancelando la cita. 😔 Para no dejarte a medias, llama al Call Center y ahí te ayudan enseguida. 🙏`,

  cancelarOfrecer: (servicio: string, doctor: string, fecha: string) =>
    `Entiendo que no vas a poder ir a esta cita:\n\n🏥 *${servicio}*\n👨‍⚕️ ${doctor}\n📅 ${fecha}\n\n` +
    `¿Quieres que la *cancele*? Así el cupo queda libre para otra persona. Responde *SÍ* para cancelarla o *NO* para dejarla.`,

  confirmandoCancelacion: () =>
    pick([
      `Dame unos segundos ⏳, estoy cancelando tu cita en el sistema del hospital.`,
      `Un momentico ⏳: estoy registrando la cancelación en el sistema del hospital.`,
    ]),

  cancelacionEnRegistro: (fecha: string) =>
    `El hospital todavía está registrando la cancelación de tu cita del _${fecha}_. ⏳\n\n` +
    `Apenas quede lista te escribo por aquí. No tienes que pedirlo otra vez.`,

  cancelacionConfirmadaDespues: (fecha: string) =>
    `✅ ¡Listo! El hospital ya registró la cancelación de tu cita del _${fecha}_. El cupo quedó libre para otra persona.`,

  cancelacionNoAplicada: (fecha: string, contacto: string) =>
    `No pude cancelar tu cita del _${fecha}_ en el sistema del hospital: allí esa hora aparece a nombre de otra persona, así que no toqué nada. 🙏\n\n` +
    `El personal del hospital ya tiene el caso para revisarlo. Si prefieres, comunícate con ${contacto}.`,

  citaDeOtroCanal: (hacerla: string, contacto: string) =>
    `Por seguridad, solo puedo ${hacerla} desde el número o el chat registrado del paciente. 🔐\n\n` +
    `Si la cita es tuya y me escribes desde otro número, comunícate con ${contacto}.`,

  // ── CONSULTA DE CITAS ("¿qué citas tengo?") ──────────────────
  consultaPedirCedula: () =>
    pick([
      `¡Claro! Te reviso tus citas. 🔍 ¿Me pasas la *cédula* del paciente?`,
      `Con gusto miro tus citas. 😊 ¿Me compartes la *cédula* del paciente?`,
    ]),

  consultaDetalle: (nombre: string, cuerpo: string) =>
    `📋 Citas de *${nombre}*:\n\n${cuerpo}`,

  consultaDetalleAudio: (nombre: string) =>
    `${nombre}, te dejo tus citas en el mensaje de texto, con las opciones para cancelarlas o cambiarlas.`,

  consultaTituloHoy: () => `*Hoy:*`,
  consultaSinCitasHoy: () => `Hoy no tienes citas agendadas.`,
  consultaTituloProximas: () => `*Próximas:*`,

  // `lineas` sale de `lineasOpcionesConsulta`: solo lo que se puede por el bot.
  consultaOpcionesDe: (lineas: string) =>
    `¿Quieres hacer algo con ellas? Mándame la letra:\n\n` + lineas,

  // `letras` sale de `letrasOpcionesConsulta`; `lineas`, como arriba.
  consultaOpcionInvalidaDe: (letras: string, lineas: string) =>
    `Mándame la letra ${letras}, porfa. 🙏\n\n` + lineas,

  consultaOpciones: () =>
    `¿Quieres hacer algo con ellas? Mándame la letra:\n\n` +
    lineasOpcionesConsulta(OPCIONES_CONSULTA.map((o) => o.opcion)),

  consultaOpcionInvalida: () =>
    `Mándame la letra *A*, *B*, *C* o *D*, porfa. 🙏\n\n` +
    lineasOpcionesConsulta(OPCIONES_CONSULTA.map((o) => o.opcion)),

  consultaSinCitas: (nombre: string) =>
    `Revisé y *${nombre}* no tiene citas próximas. 📭 Si quieres agendar una, escríbeme *"Hola"* y te muestro los servicios. 😊`,

  contactoClinica: (telefono: string) => `el hospital al *${telefono}*`,
  contactoClinicaSinTelefono: () => `el hospital`,

  consultaMinima: (cantidad: string, contacto: string) =>
    `Con ese documento hay citas próximas registradas: *${cantidad}*. 🔒\n\n` +
    `Por seguridad, el detalle solo lo muestro cuando me escriben desde el WhatsApp registrado del paciente. ` +
    `Para más info comunícate con ${contacto}.`,

  consultaMinimaSinCitas: (contacto: string) =>
    `No encuentro citas próximas registradas con ese documento. 🔍\n\nPara más info comunícate con ${contacto}.`,

  consultaAvisoHospital: (contacto: string) =>
    `ℹ️ Si agendaste directamente en el hospital, puede que alguna cita no aparezca aquí; puedes confirmarla con ${contacto}.`,

  consultaConfirmandoHospital: () =>
    `⏳ Estoy confirmando con el hospital; si tienes alguna otra cita, te escribo en un momento.`,

  consultaHisNuevas: (lineas: string, contacto: string) =>
    `🏥 El hospital tiene estas citas a tu nombre:\n\n${lineas}\n\n` +
    `Para cambiarlas o cancelarlas, comunícate con ${contacto}.`,

  consultaHisNoDisponible: (contacto: string) =>
    `No pude confirmar con el hospital ahora. 🙏 Si agendaste directamente allá, puedes confirmar tu cita con ${contacto}.`,

  consultaCitaHospital: () => `Cita en el hospital`,

  soloConsultas: (contacto: string) => SOLO_CONSULTAS_INFORMAL(contacto),

  soloConsultasCorto: (contacto: string) =>
    `Como te conté, por aquí por ahora solo puedo mostrarte tus citas (escríbeme *"consultar"*). 🙏 Para agendar o hacer cambios, comunícate con ${contacto}.`,

  soloConsultasBienvenida: (
    clinicaName: string,
    contacto: string,
    botName: string = BOT_NAME,
  ) =>
    `¡Hola! 😊 Soy *${botName}*, de *${clinicaName}*.\n\n` +
    SOLO_CONSULTAS_INFORMAL(contacto),

  consultaSoloLectura: (contacto: string) =>
    `Para cancelar o cambiar alguna de estas citas, o para agendar una nueva, comunícate con ${contacto}: por ahora la plataforma solo permite consultarlas. 🙏`,

  consultaSinCitasSoloLectura: (nombre: string, contacto: string) =>
    `Revisé y *${nombre}* no tiene citas próximas. 📭 Para agendar una, comunícate con ${contacto}: por ahora la plataforma solo permite consultarlas.`,

  consultaDetalleAudioSoloLectura: (nombre: string) =>
    `${nombre}, te dejo tus citas en el mensaje de texto.`,

  operacionNoDisponible: (
    operacion: string,
    hacerla: string,
    contacto: string,
    disponibles: string,
  ) =>
    `Por ahora no puedo *${operacion}* por aquí. 🙏\n\n` +
    `Para ${hacerla}, comunícate con ${contacto}.\n\n` +
    `Lo que sí puedo hacer por ti:\n${disponibles}`,

  operacionNoDisponibleCorto: (hacerla: string, contacto: string) =>
    `Como te conté, por aquí no se puede ${hacerla}. 🙏 Para eso, comunícate con ${contacto}.`,

  operacionNoDisponibleBienvenida: (
    clinicaName: string,
    operacion: string,
    hacerla: string,
    contacto: string,
    disponibles: string,
    botName: string = BOT_NAME,
  ) =>
    `¡Hola! 😊 Soy *${botName}*, de *${clinicaName}*.\n\n` +
    `Por ahora no puedo *${operacion}* por aquí. 🙏\n\n` +
    `Para ${hacerla}, comunícate con ${contacto}.\n\n` +
    `Lo que sí puedo hacer por ti:\n${disponibles}`,

  lineaDisponible: (etiqueta: string, atajo: string) =>
    `• ${etiqueta}: escríbeme *${atajo}*`,

  lineaDisponibleConsultar: () =>
    `• Consultar tus citas: escríbeme *"consultar"*`,

  consultaNoDisponibles: (acciones: string, contacto: string) =>
    `Para ${acciones}, comunícate con ${contacto}. 🙏`,

  consultaSinCitasSinAgendar: (nombre: string, contacto: string) =>
    `Revisé y *${nombre}* no tiene citas próximas. 📭 Para agendar una, comunícate con ${contacto}.`,

  modificarSinCuposSinCancelar: (servicio: string, contacto: string) =>
    `Revisé la agenda de *${servicio}* y por ahora no hay *otros horarios* para mover tu cita, así que la dejo tal cual. 🙏\n\n` +
    `Si necesitas cancelarla, comunícate con ${contacto}.`,

  respuestaInvalidaSiNo: () =>
    pick([
      `Mmm, no te entendí. 🙏 ¿Me ayudas respondiendo *SÍ* o *NO*?`,
      `Para este paso necesito un *SÍ* o un *NO*, porfa. 😊`,
      `Para no equivocarme, ¿me confirmas con *SÍ* o *NO*?`,
    ]),

  audioPasoEstricto: () =>
    `🎙️ Para este paso, mejor respóndeme por *texto* _(la letra o un SÍ/NO)_ — así evitamos confusiones. 🙏`,

  // Interrupción amable: el paciente pidió cancelar en medio del agendamiento.
  // Pedimos confirmación antes de abandonar el proceso en curso.
  interrupcionAgendamiento: () =>
    `Entiendo, prefieres cancelar una cita. ¿Quieres que detengamos este agendamiento para pasar al proceso de cancelación?`,

  // El paciente decidió NO interrumpir: retomamos el agendamiento donde iba.
  interrupcionRetomar: () =>
    `¡Listo, seguimos con tu agendamiento justo donde íbamos! 😊`,

  // ── MODIFICACIÓN / REPROGRAMACIÓN DE CITA ──────────────────────
  modificarPedirCedula: () =>
    pick([
      `¡Claro que sí! Te ayudo a *cambiar la fecha* de tu cita. 🗓️ Para buscarla, ¿me pasas la *cédula* del paciente?`,
      `De una, te ayudo a *reprogramar* tu cita. 😊 ¿Me compartes la *cédula* del paciente para ubicarla?`,
    ]),

  modificarPacienteNoExiste: (cedula: string) =>
    pick([
      `Hmm, busqué y no encuentro a ningún paciente con la cédula *${cedula}*. 🔍 ¿Me la confirmas? O si quieres terminar, escríbeme _*"Salir"*_.`,
      `Esa cédula *${cedula}* no me aparece. 🙏 ¿La revisamos otra vez? Si gustas terminar, mándame _*"Salir"*_.`,
    ]),

  modificarSinCitas: (cedula: string) =>
    `Revisé y el paciente con cédula *${cedula}* no tiene citas próximas para reprogramar. 📭 ¿Te ayudo a agendar una nueva?`,

  // No se hallaron citas: ofrecemos consultar con otra cédula (loop) o cerrar.
  modificarSinCitasReintentar: (cedula: string) =>
    pick([
      `Revisé y la cédula *${cedula}* no tiene citas próximas para reprogramar. 📭\n\n` +
        `¿Quieres que busque con *otra cédula*? Mándame *SÍ* para intentar con otro número, o *NO* para terminar. 😊`,
      `Hmm, con la cédula *${cedula}* no me aparecen citas para reprogramar.\n\n` +
        `Si quieres probamos con *otra cédula*. Responde *SÍ* para intentarlo de nuevo o *NO* para cerrar. 🙏`,
    ]),

  modificarSeleccionar: (nombre: string, lineas: string) =>
    pick([
      `Listo, encontré estas citas a nombre de *${nombre}*:\n\n${lineas}\n¿Cuál quieres *reprogramar*? Mándame la letra. 😊`,
      `Acá están las citas que tengo para *${nombre}*:\n\n${lineas}\nDime con la letra cuál quieres *cambiar de fecha*.`,
    ]),

  // Frase corta para AUDIO: el listado de citas va por texto (tuteo).
  modificarSeleccionarAudio: (nombre: string) =>
    pick([
      `${nombre}, encontré varias citas a tu nombre. Te las dejo en el mensaje de texto; respóndeme con la letra de la que quieres reprogramar.`,
      `A continuación te presento tus citas en el mensaje de texto. Respóndeme con la letra de la que quieres cambiar de fecha. 😊`,
    ]),

  modificarMostrarCupos: (
    servicio: string,
    fechaActual: string,
    lineas: string,
  ) =>
    pick([
      `Tu cita de *${servicio}* está para:\n📅 ${fechaActual}\n\n` +
        `Estos son los *nuevos horarios* que tengo disponibles:\n\n${lineas}\n` +
        `_Mándame la letra del horario al que quieres moverla._ 😊`,
      `Ahorita tu cita de *${servicio}* es el:\n📅 ${fechaActual}\n\n` +
        `Mira, te puedo reprogramar a estos espacios:\n\n${lineas}\n` +
        `_Elige el nuevo horario con la letra._`,
    ]),

  // Frase corta para AUDIO: los nuevos horarios van por texto (tuteo).
  modificarMostrarCuposAudio: (servicio: string) =>
    pick([
      `A continuación te presento los horarios disponibles para reprogramar tu cita de ${servicio}. Te los dejo en el mensaje de texto; respóndeme con la letra del que prefieras.`,
      `Estos son los nuevos horarios para tu cita de ${servicio}. Te los dejo en el mensaje de texto; respóndeme con la letra de la opción que más te sirva.`,
    ]),

  // No hay cupos para reprogramar → ofrecemos cancelar la cita.
  modificarSinCupos: (servicio: string) =>
    pick([
      `Revisé la agenda de *${servicio}* y por ahora no hay *otros horarios* para mover tu cita. 🙏\n\n` +
        `¿Quieres que *cancele la cita actual*? Responde *SÍ* para cancelarla o *NO* si prefieres dejarla tal cual.`,
      `Por el momento no tengo *cupos alternativos* en *${servicio}* para reprogramarte.\n\n` +
        `Si quieres puedo *cancelar la cita que tienes*. Mándame *SÍ* para cancelar o *NO* para dejarla sin cambios.`,
    ]),

  modificarConfirmar: (
    servicio: string,
    doctor: string,
    fechaActual: string,
    fechaNueva: string,
  ) =>
    `Para confirmarte, vamos a *reprogramar* esta cita:\n\n🏥 *${servicio}*\n👨‍⚕️ ${doctor}\n` +
    `📅 Actual: ${fechaActual}\n🆕 Nueva: ${fechaNueva}\n\n` +
    `¿Confirmas el cambio? Responde *SÍ* para reprogramarla o *NO* para dejar la fecha actual.`,

  modificarExitosa: (fechaNueva: string) =>
    pick([
      `✅ ¡Listo! Tu cita quedó *reprogramada* para:\n📅 ${fechaNueva}\n\nLiberé el horario anterior para otro paciente. 🗓️`,
      `✅ ¡Hecho! Moví tu cita al nuevo horario:\n📅 ${fechaNueva}\n\n¡Te esperamos! 💚`,
    ]),

  // El paciente NO confirmó el cambio: dejamos la cita como estaba.
  modificarAbortada: () =>
    pick([
      `✅ ¡Tranquilo(a)! No cambié nada — tu cita sigue *firme* en la fecha original. ¿Te ayudo en algo más?`,
      `✅ Perfecto, dejé tu cita tal como estaba. 😊 ¿Te colaboro con algo más?`,
    ]),

  // No había cupos y el paciente decidió NO cancelar: todo queda intacto.
  modificarSinCambios: () =>
    pick([
      `¡Listo! Dejo tu cita *tal como está*, sin tocar nada. 😊 ¿Te ayudo en algo más?`,
      `De una, no modifico nada — tu cita sigue *activa* como estaba. ¿Te colaboro con algo más?`,
    ]),

  modificarError: () =>
    `Qué pena, tuve un inconveniente reprogramando la cita. 😔 Para no dejarte a medias, llama al Call Center y ahí te ayudan enseguida. 🙏`,

  inactividad: () =>
    `Hola, ¿cómo estás? Cerré la conversación por inactividad para cuidar tus datos. 🔒 Cuando quieras retomar, escríbeme *"Hola"* y te atiendo. 😊`,
};

// ─────────────────────────────────────────────────────────────
// Factory: devuelve el pool de mensajes según el estilo activo.
// Ambos pools comparten exactamente la misma shape, por lo que
// el código consumidor puede usar el resultado como reemplazo
// drop-in de MSGS.
// ─────────────────────────────────────────────────────────────
export type Messages = typeof FORMAL;

/** Por dónde conversa el paciente (docs/PLAN_TELEGRAM.md). */
export type CanalDelBot = 'WHATSAPP' | 'TELEGRAM';

/**
 * Los mensajes que NOMBRAN el canal («no puedo agendar esa EPS por
 * WhatsApp», «esté pendiente de su WhatsApp»). Por Telegram tienen que decir
 * «Telegram». Si se agrega otro texto que nombre el canal, va en esta lista:
 * `chatbot.messages.canal.spec.ts` falla mientras algún mensaje del pool de
 * Telegram diga «WhatsApp».
 */
export const MENSAJES_QUE_NOMBRAN_EL_CANAL = [
  'epsInvalida',
  'unidoAWaitlist',
  'consultaMinima',
] as const satisfies ReadonlyArray<keyof Messages>;

const nombrarTelegram = (texto: string): string =>
  texto.replace(/\bWhatsApp\b/g, 'Telegram');

/** El mismo pool, pero los mensajes que nombran el canal dicen «Telegram». */
function paraTelegram(pool: Messages): Messages {
  const copia: Record<string, unknown> = { ...pool };
  for (const clave of MENSAJES_QUE_NOMBRAN_EL_CANAL) {
    const original = pool[clave] as (...args: never[]) => string;
    copia[clave] = (...args: never[]) => nombrarTelegram(original(...args));
  }
  return copia as Messages;
}

const FORMAL_TELEGRAM = paraTelegram(FORMAL);
const INFORMAL_TELEGRAM = paraTelegram(INFORMAL);

/**
 * El pool de mensajes del estilo de la clínica y del canal del paciente.
 *
 * Para WhatsApp devuelve EL MISMO objeto de siempre (`FORMAL` / `INFORMAL`):
 * lo que lee un paciente de WhatsApp no cambia ni en un carácter. Para
 * Telegram, una copia en la que solo cambian los mensajes que nombran el canal.
 */
export function buildMessages(
  style: CommStyle = 'FORMAL',
  canal: CanalDelBot = 'WHATSAPP',
): Messages {
  if (canal === 'TELEGRAM') {
    return style === 'INFORMAL' ? INFORMAL_TELEGRAM : FORMAL_TELEGRAM;
  }
  return style === 'INFORMAL' ? INFORMAL : FORMAL;
}

// Export default (compat hacia atrás): pool FORMAL.
export const MSGS: Messages = FORMAL;
