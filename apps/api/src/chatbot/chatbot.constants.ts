export enum ChatState {
  IDLE = 'IDLE',
  AWAITING_SPECIALTY = 'AWAITING_SPECIALTY',
  AWAITING_EPS = 'AWAITING_EPS',
  AWAITING_DATE = 'AWAITING_DATE',
  AWAITING_NAME = 'AWAITING_NAME',
  AWAITING_CEDULA = 'AWAITING_CEDULA',
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  AWAITING_CANCEL_CEDULA = 'AWAITING_CANCEL_CEDULA',
  AWAITING_CANCEL_SELECTION = 'AWAITING_CANCEL_SELECTION',
  AWAITING_CANCEL_CONFIRM = 'AWAITING_CANCEL_CONFIRM',
  AWAITING_WAITLIST_CONFIRM = 'AWAITING_WAITLIST_CONFIRM',
  // NUEVO — el usuario consulta cita y no hay slots: ¿se une a la cola?
  AWAITING_WAITLIST_OPTIN = 'AWAITING_WAITLIST_OPTIN',
  AWAITING_POST_CANCEL_CHOICE = 'AWAITING_POST_CANCEL_CHOICE', // tras cancelación exitosa: ¿desea agendar?
}

// Nombre canónico del registro EPS para pago directo (debe existir en BD por org).
// El seeder en ChatbotService lo asegura idempotentemente al iniciar el módulo.
export const PARTICULAR_EPS_NAME = 'Particular';

// Valor por defecto de reintentos. La cifra efectiva se lee de OrganizationSettings.
export const DEFAULT_MAX_RETRIES = 3;

// Tiempo de expiración de la sesión conversacional en Redis (1 hora)
export const SESSION_TTL = 3600;

// Longitud mínima de dígitos para considerar una cédula válida.
// Aplica en flujo de agendamiento Y cancelación (consistencia).
export const MIN_CEDULA_LENGTH = 4;

// Tiempo máximo para confirmar un cupo de waitlist (30 minutos)
export const WAITLIST_CONFIRM_TTL = 1800;

// Nombre del asistente (usado en todos los mensajes)
export const BOT_NAME = 'Vicente';

// ─────────────────────────────────────────────────────────────
// Helper: selección pseudo-aleatoria de variantes.
// Permite que el bot no repita exactamente la misma frase cada vez,
// aumentando la sensación de humanidad. Determinista no — el callsite
// no necesita cambiar (sigue siendo una función → string).
// ─────────────────────────────────────────────────────────────
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ─────────────────────────────────────────────────────────────
// PLAYBOOK CONVERSACIONAL — Voz: recepcionista clínica colombiana
//   • Trato de "usted" cálido, sin formalismos acartonados.
//   • Modismos suaves de amabilidad ("Claro que sí", "Con mucho
//     gusto", "Regáleme un segundito", "No se preocupe").
//   • Reconocer al paciente, explicar el "por qué" antes del "qué".
//   • Errores: nunca culpar al usuario, siempre invitar a reintentar.
//   • Pool de variantes en saludos / despedidas / reintentos.
// ─────────────────────────────────────────────────────────────
export const MSGS = {
  // ════════════════════════════════════════════════════════════
  // BIENVENIDA Y MENÚ DE SERVICIOS (Paso 1)
  // ════════════════════════════════════════════════════════════
  bienvenida: (clinicaName: string, servicios: string, botName: string = BOT_NAME) =>
    pick([
      `¡Hola! 👋 Mucho gusto, soy *${botName}*, le acompaño desde *${clinicaName}*.\n\n` +
        `Con mucho gusto le ayudo a agendar su cita sin filas ni complicaciones. 🏥\n\n` +
        `Cuénteme, ¿para qué especialidad necesita su cita hoy?\n` +
        `_${servicios}_`,
      `¡Hola, qué gusto saludarle! 🌻 Soy *${botName}*, su asistente de *${clinicaName}*.\n\n` +
        `Estoy aquí para agendarle su cita de forma rapidita y sencilla. 🏥\n\n` +
        `¿En qué servicio le puedo colaborar el día de hoy?\n` +
        `_${servicios}_`,
      `¡Bienvenido(a) a *${clinicaName}*! 🌟 Soy *${botName}*, su asistente virtual.\n\n` +
        `Será un placer ayudarle con su agendamiento. 🏥\n\n` +
        `Para empezar, ¿me cuenta qué especialidad está buscando?\n` +
        `_${servicios}_`,
    ]),

  menuServicios: (clinicaName: string, lineas: string, botName: string = BOT_NAME) =>
    pick([
      `¡Hola! 👋 Soy *${botName}*, su asistente en *${clinicaName}*. Mucho gusto.\n\n` +
        `Con mucho gusto le ayudo a agendar su cita el día de hoy. 🏥\n\n` +
        `*¿En qué servicio le puedo colaborar?* Puede responderme con la letra:\n\n` +
        `${lineas}\n` +
        `_También puede escribirme el nombre del servicio o, si prefiere, enviarme un audito de voz._ 🎙️`,
      `¡Qué gusto saludarle! 🌻 Le habla *${botName}*, de *${clinicaName}*.\n\n` +
        `Permítame ayudarle a reservar su cita médica de forma muy rápida. 🏥\n\n` +
        `*Cuénteme, ¿qué servicio necesita?* Estas son las opciones disponibles:\n\n` +
        `${lineas}\n` +
        `_Puede contestarme con la letra, el nombre del servicio o un audio._ 🎙️`,
      `¡Hola, bienvenido(a)! 🌟 Soy *${botName}*, su acompañante virtual de *${clinicaName}*.\n\n` +
        `Estoy aquí para que su agendamiento sea facilito. 🏥\n\n` +
        `*¿Cuál de estos servicios necesita hoy?*\n\n` +
        `${lineas}\n` +
        `_Respóndame con la letra, escriba el nombre o envíeme un audio — como le quede más cómodo._ 🎙️`,
    ]),

  servicioInvalido: (lineas: string) =>
    pick([
      `Ay, discúlpeme, no logré entender bien su respuesta. 🙏\n\n` +
        `¿Me podría confirmar el servicio? Puede contestarme con la letra ` +
        `_(ej: A, B, C...)_ o escribirme el nombre directamente.\n\n` +
        `${lineas}`,
      `Mil disculpas, esa opción no la logré identificar. 😊\n\n` +
        `Regáleme un momentico y volvamos a intentarlo: respóndame con la letra ` +
        `_(A, B, C...)_ o escríbame el nombre del servicio.\n\n` +
        `${lineas}`,
      `Perdóneme, no le entendí del todo. 🙏 ¿Lo intentamos otra vez?\n\n` +
        `Puede elegirme una letra _(A, B, C...)_ o escribirme el nombre del servicio.\n\n` +
        `${lineas}`,
    ]),

  // ════════════════════════════════════════════════════════════
  // MENÚ DE EPS (Paso 2)
  // ════════════════════════════════════════════════════════════
  menuEps: (servicio: string, lineas: string) =>
    pick([
      `¡Perfecto, *${servicio}*! 🩺 Excelente elección.\n\n` +
        `Ahora, para buscarle el mejor espacio disponible, ¿me cuenta por favor a qué *EPS o aseguradora* está afiliado(a)?\n\n` +
        `Puede contestarme con la letra o escribirme el nombre:\n\n` +
        `${lineas}\n` +
        `_Si paga directamente la consulta, elija *Particular*._ 💳`,
      `¡Listo, anotado: *${servicio}*! 🩺\n\n` +
        `Para revisar la agenda disponible, regáleme un segundito y cuénteme con cuál *EPS* viene hoy:\n\n` +
        `${lineas}\n` +
        `_Si paga por su cuenta, no se preocupe — seleccione *Particular*._ 💳`,
      `Genial, vamos por *${servicio}*. 🩺 Siguiente pasito:\n\n` +
        `¿Me regala el nombre de su *EPS* para verificarle la disponibilidad? Puede elegir una opción o escribírmela:\n\n` +
        `${lineas}\n` +
        `_Si su consulta es particular, marque *Particular*, con confianza._ 💳`,
    ]),

  epsInvalida: (lineas: string) =>
    pick([
      `Ay, discúlpeme, no logré identificar esa EPS. 🙏\n\n` +
        `¿Me la confirma otra vez, por favor? Puede elegirme la letra _(A, B, C...)_ o escribir el nombre:\n\n` +
        `${lineas}`,
      `Mil disculpas, no le entendí bien la EPS. 😊 Volvamos a intentarlo:\n\n` +
        `Respóndame con la letra o escríbame el nombre completo, lo que prefiera:\n\n` +
        `${lineas}`,
      `Perdóneme, no logré ubicar esa opción dentro de nuestros convenios. 🙏\n\n` +
        `¿Me la repite, por favor? Aquí le dejo las opciones nuevamente:\n\n` +
        `${lineas}`,
    ]),

  pedirEps: () =>
    pick([
      `Para revisarle la disponibilidad, ¿me regala el nombre de su *EPS o aseguradora*, por favor?\n\n` +
        `_(Si paga directamente la consulta, escríbame *"Particular"*.)_ 💳`,
      `Cuénteme por favor, ¿con cuál *EPS* viene hoy? Así le busco el mejor espacio.\n\n` +
        `_(Si es por cuenta propia, escríbame *"Particular"*, sin pena.)_ 💳`,
    ]),

  epsNoEncontrada: (epsQuery: string) =>
    pick([
      `Ay, qué pena, no logré encontrar la EPS *"${epsQuery}"* en nuestros convenios. 🙏\n\n` +
        `¿Me la confirma otra vez, por favor? _(Ej: Sura, Sanitas, Nueva EPS, Compensar, Particular...)_`,
      `Discúlpeme, no me apareció la EPS *"${epsQuery}"* registrada. 😊\n\n` +
        `¿Me la escribe nuevamente? _(Ej: Sura, Sanitas, Nueva EPS, Compensar, Particular...)_`,
    ]),

  epsInactiva: (epsName: string) =>
    pick([
      `Ay, qué pena con usted, en este momento no tenemos convenio activo con *${epsName}*. 🙏\n\n` +
        `¿Desea continuar como *Particular* o cuenta con otra EPS? Cuénteme.`,
      `Discúlpeme, justo ahora no estamos atendiendo el convenio con *${epsName}*. 😔\n\n` +
        `Si gusta, podemos agendarle como *Particular*, o si tiene otra EPS, dígame con confianza.`,
    ]),

  // ════════════════════════════════════════════════════════════
  // DISPONIBILIDAD DE CUPOS (Paso 3)
  // ════════════════════════════════════════════════════════════
  cuposDisponibles: (nombre: string, epsName: string, lineas: string) =>
    pick([
      `${nombre ? `¡${nombre}, ` : '¡'}qué alegría! 🌟 Mire los horarios que le encontré con *${epsName}*:\n\n` +
        `${lineas}\n` +
        `_Respóndame con la letra del horario que más le acomode, por favor._ ✍️`,
      `${nombre ? `${nombre}, ` : ''}¡con mucho gusto! Estos son los espacios disponibles para *${epsName}*:\n\n` +
        `${lineas}\n` +
        `_Cuénteme cuál le sirve mejor: respóndame con la letra._ 😊`,
      `${nombre ? `Listo, ${nombre}: ` : 'Listo: '}aquí le traigo la agenda disponible para *${epsName}*:\n\n` +
        `${lineas}\n` +
        `_Elija el horario que más le convenga (respóndame con la letra)._ ✍️`,
    ]),

  // ── Opt-in a lista de espera (sin disponibilidad) ──────────
  preguntaWaitlist: (servicio: string, eps: string) =>
    pick([
      `Revisé con cuidado la agenda para *${servicio}* con *${eps}* y por el momento no veo cupos disponibles. 😔\n\n` +
        `Pero no se preocupe: si gusta, le anoto en nuestra *lista de espera* y le aviso por aquí mismito en cuanto se libere un espacio. ✨\n\n` +
        `¿Le parece bien? Respóndame *SÍ* para anotarle o *NO* si prefiere intentarlo más adelante.`,
      `Mire, ${servicio.toLowerCase()} con *${eps}* está justo full por estos días. 😅\n\n` +
        `Pero tengo una idea: ¿quiere que le anote en la *lista de espera*? En cuanto alguien libere un cupo, le escribo de una vez para reservárselo. ✅\n\n` +
        `¿Le gustaría? Respóndame *SÍ* o *NO*, con toda confianza.`,
      `Acabo de revisar y por ahora la agenda de *${servicio}* (${eps}) está llenita. 🙏\n\n` +
        `Si gusta, puedo dejarle apuntado(a) en la *lista de espera* y le aviso apenas se abra un espacio — sin compromiso, claro. 🤝\n\n` +
        `¿Le parece? *SÍ* para anotarle, *NO* para dejarlo así.`,
    ]),

  unidoAWaitlist: (nombre: string, servicio: string, position: number) =>
    pick([
      `¡Listo${nombre ? `, ${nombre}` : ''}! 🎟️ Le anoté en la lista de espera para *${servicio}* — quedó en la posición *#${position}*.\n\n` +
        `Esté pendiente de su WhatsApp: apenas se libere un cupo, le escribo de una. ✨\n\n` +
        `Que tenga un día muy bonito. 😊`,
      `${nombre ? `Perfecto, ${nombre}. ` : 'Perfecto. '}Ya quedó apuntado(a) en la lista de espera de *${servicio}* (posición *#${position}*). 🎟️\n\n` +
        `En cuanto se libere un espacio, le aviso por acá mismo, no se preocupe. 💚\n\n` +
        `¡Cuídese mucho!`,
      `¡Hecho${nombre ? `, ${nombre}` : ''}! 🌟 Le agregué a la cola para *${servicio}*, va en la posición *#${position}*.\n\n` +
        `Yo le escribo apenas tenga noticias para usted. 🙏\n\n` +
        `Mientras tanto, ¡que esté muy bien!`,
    ]),

  noUnidoAWaitlist: () =>
    pick([
      `Listo, sin problema, no le anoto en la lista. 😊\n\n` +
        `Cuando quiera intentarlo nuevamente, solo escríbame *"Hola"* y con mucho gusto le atiendo. ¡Que esté muy bien! 👋`,
      `Como prefiera, no se preocupe. 🌻\n\n` +
        `Aquí estaré cuando quiera retomar — escríbame *"Hola"* y seguimos. ¡Hasta pronto! 👋`,
      `Perfecto, lo dejamos así por ahora. 😊\n\n` +
        `Cuando lo necesite, me escribe *"Hola"* y le ayudo de una vez. Que tenga un día excelente. 🌟`,
    ]),

  sinDisponibilidad: (nombre: string, epsName: string, especialidad: string, position: number) =>
    `${nombre}, revisé con cuidado la agenda para *${epsName}* en *${especialidad}* ` +
    `y por el momento no veo cupos abiertos. 😔\n\n` +
    `Pero tranquilo(a), ya le agregué a la lista de espera (posición *#${position}*). ` +
    `En cuanto se libere un espacio, le aviso por aquí mismito. ✨\n\n` +
    `¿Hay algo más en lo que le pueda colaborar?`,

  // ════════════════════════════════════════════════════════════
  // CAPTURA DE DATOS DEL PACIENTE (Paso 4)
  // ════════════════════════════════════════════════════════════
  pedirCedulaPostSlot: (fechaFormateada: string) =>
    pick([
      `¡Excelente elección! 🌟 Le aparté ese horario un momentito:\n` +
        `📅 *${fechaFormateada}*\n\n` +
        `Para terminar de agendarle, ¿me regala su *número de cédula*, por favor?`,
      `¡Perfecto, ya casi terminamos! 😊 Le reservé tentativamente:\n` +
        `📅 *${fechaFormateada}*\n\n` +
        `Solo me falta confirmarle un datico: ¿me comparte por favor su *cédula*?`,
      `¡Listo! 🎯 Tengo ese cupo reservado para usted:\n` +
        `📅 *${fechaFormateada}*\n\n` +
        `Para finalizar, ¿me dice por favor su *número de cédula*? Solo el número, sin puntos.`,
    ]),

  especialidadConfirmada: (especialidad: string) =>
    `Perfecto, anotado: *${especialidad}*. 🩺\n\n` +
    `Para revisarle la agenda, ¿me regala por favor su *número de cédula*?`,

  pedirCedula: (especialidad: string) =>
    `Anotado, busca cita para *${especialidad}*. 🩺\n\n` +
    `¿Me comparte por favor su *número de cédula*? Solo el número, sin puntos ni guiones.`,

  primeraVez: () =>
    pick([
      `¡Qué gusto recibirle por primera vez! 🤝\n\n` +
        `Para registrarle en el sistema, ¿me regala su *nombre completo*, por favor?`,
      `¡Bienvenido(a)! Es un placer atenderle por primera vez. 🌟\n\n` +
        `Cuénteme su *nombre completo*, así le abrimos su historia con nosotros.`,
      `¡Mucho gusto! Es la primera vez que le veo por aquí. 😊\n\n` +
        `¿Me dice su *nombre completo* para registrarle como nuevo paciente?`,
    ]),

  resumenCita: (nombre: string, cedula: string, eps: string, especialidad: string, fecha: string) =>
    pick([
      `¡Listo${nombre ? `, ${nombre}` : ''}! Confirmemos los datos de su cita antes de agendarle:\n\n` +
        `👤 *Paciente:* ${nombre}\n` +
        `🪪 *Cédula:* ${cedula}\n` +
        `💳 *EPS:* ${eps}\n` +
        `🏥 *Servicio:* ${especialidad}\n` +
        `📅 *Fecha y hora:* ${fecha}\n\n` +
        `¿Le parece todo correcto? Respóndame *SÍ* para agendarle definitivamente o *NO* si necesita cambiar algo.`,
      `¡Perfecto${nombre ? `, ${nombre}` : ''}! Reviso con usted la información antes de cerrar:\n\n` +
        `👤 ${nombre}\n` +
        `🪪 Cédula ${cedula}\n` +
        `💳 EPS: ${eps}\n` +
        `🏥 ${especialidad}\n` +
        `📅 ${fecha}\n\n` +
        `Si todo está bien, respóndame *SÍ* y lo dejo confirmado. Si algo no le cuadra, escríbame *NO*.`,
      `Ya casi terminamos${nombre ? `, ${nombre}` : ''} 🌟. Estos son los datos de su cita:\n\n` +
        `👤 ${nombre}\n` +
        `🪪 ${cedula}\n` +
        `💳 ${eps}\n` +
        `🏥 ${especialidad}\n` +
        `📅 ${fecha}\n\n` +
        `¿Lo dejamos así? Respóndame *SÍ* para agendarle o *NO* si prefiere cancelar.`,
    ]),

  citaConfirmada: (clinicaName: string, fecha: string) =>
    pick([
      `¡Listo, todo quedó confirmado! 🎉 Su cita está reservada en *${clinicaName}*.\n\n` +
        `📅 _${fecha}_\n\n` +
        `Le pido por favor llegar *15 minutos antes* y traer su *documento de identidad*. 🪪\n\n` +
        `¡Que esté muy bien y cualquier cosa, aquí me tiene! 😊`,
      `¡Hecho! 🌟 Su cita en *${clinicaName}* quedó agendada con éxito.\n\n` +
        `📅 _${fecha}_\n\n` +
        `Recuerde llegar *15 minutos antes* con su *cédula* en mano. 🪪\n\n` +
        `Mil gracias por confiar en nosotros. ¡Cuídese mucho! 💚`,
      `¡Quedó listo! 🎊 Tiene su cita confirmada en *${clinicaName}*.\n\n` +
        `📅 _${fecha}_\n\n` +
        `Por favor sea puntual: llegue unos *15 minutos antes* y traiga su *documento*. 🪪\n\n` +
        `Que tenga un día excelente. ¡Hasta pronto! 👋`,
    ]),

  citaNoConfirmada: () =>
    pick([
      `Listo, no hay problema, cancelé la solicitud. 😊\n\n` +
        `Cuando quiera intentarlo de nuevo, solo escríbame *"Hola"* y con mucho gusto le ayudo.`,
      `Sin problema, lo dejamos por ahora. 🌻\n\n` +
        `Aquí estaré cuando quiera retomar — solo me dice *"Hola"* y seguimos.`,
      `Tranquilo(a), no se agendó nada todavía. 😊\n\n` +
        `Cuando esté listo(a), me escribe *"Hola"* y vamos otra vez. ¡Que esté muy bien!`,
    ]),

  slotTomado: () =>
    pick([
      `Uy, qué pena, justo ese horario lo acaba de tomar otro paciente. 😬\n\n` +
        `¿Le parece si elegimos otro de los disponibles? Escríbame la letra nuevamente, por favor.`,
      `Ay, mil disculpas, ese cupito acaba de reservarse. 🙏\n\n` +
        `¿Vemos otra opción? Cuénteme con qué letra prefiere quedarse.`,
    ]),

  errorSlotInvalido: () =>
    pick([
      `Mmm, esa letra no la veo entre las opciones que le envié. 🙏\n\n` +
        `¿Me la confirma, por favor? Recuerde que puede contestarme con la letra _(A, B, C...)_ ` +
        `o escribirme *"Salir"* si prefiere cancelar.`,
      `Discúlpeme, no logré ubicar esa opción. 😊\n\n` +
        `Respóndame con una de las letras disponibles _(A, B, C...)_ ` +
        `o escriba *"Salir"* si quiere terminar el proceso.`,
    ]),

  // ════════════════════════════════════════════════════════════
  // WAITLIST → CRON LE AVISÓ AL PACIENTE
  // ════════════════════════════════════════════════════════════
  waitlistCupoDisponible: (nombre: string, especialidad: string, fecha: string, doctor: string) =>
    pick([
      `🔔 ¡${nombre}, tengo excelentes noticias para usted!\n\n` +
        `Se acaba de liberar un cupo en *${especialidad}* y usted era la siguiente persona en la lista. 🌟\n\n` +
        `📅 *${fecha}*\n` +
        `👨‍⚕️ Dr(a). ${doctor}\n\n` +
        `Le reservé este cupo por *30 minutos* — ¿le interesa tomarlo?\n\n` +
        `Respóndame *SÍ* para confirmárselo o *NO* si ya no lo necesita.`,
      `🔔 ¡Hola ${nombre}! Le tengo una buena noticia. 🌟\n\n` +
        `Se liberó un espacio para *${especialidad}* y le toca a usted, que era la primera en espera.\n\n` +
        `📅 *${fecha}*\n` +
        `👨‍⚕️ Dr(a). ${doctor}\n\n` +
        `Le aparté el cupo por *30 minutos*. ¿Lo quiere tomar?\n\n` +
        `Confírmeme con *SÍ* o, si ya no le sirve, escríbame *NO* con confianza.`,
    ]),

  waitlistCupoRechazado: () =>
    pick([
      `¡Sin problema! 😊 Libero ese cupo para otro paciente entonces.\n\n` +
        `Tranquilo(a), usted sigue en nuestra lista y le aviso apenas haya otra disponibilidad. ✨\n\n` +
        `¡Que tenga un día excelente! 👋`,
      `Listo, como prefiera. 🌻 Libero el cupo para otra persona que también lo está esperando.\n\n` +
        `Usted permanece en la lista, así que en cuanto aparezca otro espacio le aviso de una. 💚\n\n` +
        `¡Cuídese mucho!`,
    ]),

  waitlistExpirado: () =>
    pick([
      `Ay, qué pena, el tiempo para confirmar ese cupo se nos pasó. ⏰\n\n` +
        `Si todavía le interesa la cita, escríbame *"Hola"* y con mucho gusto le anoto nuevamente. 😊`,
      `Mil disculpas, se venció el tiempo para reservar ese cupo. 🙏\n\n` +
        `Si quiere intentarlo otra vez, escríbame *"Hola"* y seguimos. ¡Aquí estoy! 💚`,
    ]),

  // ════════════════════════════════════════════════════════════
  // ESCAPE / RESET / DESPEDIDAS
  // ════════════════════════════════════════════════════════════
  escape: () =>
    pick([
      `¡Listo, empezamos de nuevo! 😊 Cuénteme, ¿en qué le puedo colaborar?`,
      `Sin problema, refrescamos. 🌻 ¿En qué le ayudo el día de hoy?`,
      `Tranquilo(a), volvemos a empezar. 😊 Dígame, ¿qué necesita?`,
    ]),

  outOfContext: (botName: string = BOT_NAME) =>
    pick([
      `Discúlpeme, soy *${botName}* y le acompaño solo con el agendamiento de citas médicas. 🏥\n\n` +
        `¿Me cuenta qué especialidad necesita o el nombre del médico que está buscando?`,
      `Mil disculpas, mi trabajito es ayudarle a agendar citas médicas aquí en la clínica. 😊\n\n` +
        `Cuénteme, ¿qué servicio o médico está buscando?`,
      `Permítame contarle: yo solo le puedo colaborar con citas médicas. 🙏\n\n` +
        `¿Me dice qué especialidad necesita o con cuál doctor desea su cita?`,
    ]),

  // 🛡️ Guardrail: insulto / lenguaje ofensivo → derivar de inmediato.
  guardrailInsulto: (phone: string, botName: string = BOT_NAME) =>
    `Disculpe, le entiendo que pueda estar molesto(a), pero por aquí solo le puedo ayudar con su agendamiento médico ` +
    `y necesito que conservemos un trato respetuoso. 🙏\n\n` +
    `Si requiere atención adicional, con mucho gusto le pasamos con un asesor humano: ` +
    `👉 *${phone}*\n\n` +
    `Por seguridad, cierro esta conversación. Cuando guste retomar el agendamiento, aquí estaré. 💚`,

  // 🛡️ Guardrail: off-topic persistente → derivar tras agotar reintentos.
  guardrailOffTopic: (phone: string, botName: string = BOT_NAME) =>
    `Ay, qué pena, parece que no estoy logrando entenderle bien dentro del agendamiento de citas. 🙏\n\n` +
    `Para que reciba una mejor atención, le recomiendo comunicarse con nuestro equipo humano: ` +
    `👉 *${phone}*\n\n` +
    `Cuando quiera intentarlo nuevamente conmigo, solo escríbame *"Hola"* y *${botName}* le atiende de una. 😊`,

  ininteligible: () =>
    pick([
      `🎙️ Ay, discúlpeme, no logré escuchar/entender bien su mensaje. ¿Me lo repite por favor, despacito, o me lo escribe?`,
      `🎙️ Mil disculpas, no le capté bien el audio. ¿Me ayuda mandándomelo otra vez o escribiéndomelo, por favor?`,
      `🎙️ Perdóneme, no me quedó muy claro lo que dijo. ¿Me lo reenvía pausadito o me lo escribe?`,
    ]),

  iaCaida: (phone: string) =>
    `Ay, qué pena con usted: nuestro sistema está pasando por un mantenimiento breve. 🛠️\n\n` +
    `Mientras tanto, le invito a comunicarse al *${phone}* para que le atiendan directamente. 🙏\n\n` +
    `Apenas estemos de vuelta, podremos seguir por aquí. ¡Gracias por su paciencia!`,

  maxReintentos: (phone: string) =>
    `Discúlpeme, parece que estamos teniendo dificultades para entendernos. 😔\n\n` +
    `Para no hacerle perder más tiempo, le paso con nuestro equipo humano: ` +
    `👉 https://wa.me/${phone}\n\n` +
    `Ellos le atenderán enseguida con mucho gusto.`,

  maxReintentosReset: () =>
    pick([
      `Para no enredarle más, reinicié la conversación. 🔄\n\n` +
        `Cuando quiera retomar, solo escríbame *"Hola"* y comenzamos limpio. 😊`,
      `Discúlpeme, mejor empecemos de cero para no confundirle. 🌻\n\n` +
        `Escríbame *"Hola"* cuando esté listo(a) y le atiendo con calma.`,
    ]),

  sesionExpirada: () =>
    pick([
      `Ay, qué pena, su sesión expiró antes de poderle confirmar la cita. ⏳\n\n` +
        `No se preocupe, escríbame *"Hola"* y empezamos otra vez con muchísimo gusto. 😊`,
      `Mil disculpas, se nos pasó el tiempo de la sesión. 🙏\n\n` +
        `Cuando guste volver a empezar, escríbame *"Hola"* y le atiendo de una. 💚`,
    ]),

  // ════════════════════════════════════════════════════════════
  // CANCELACIÓN DE CITA
  // ════════════════════════════════════════════════════════════
  cancelarPedirCedula: () =>
    pick([
      `Claro que sí, le ayudo con la cancelación de su cita. 📋\n\n` +
        `Para ubicarla en el sistema, ¿me regala el *número de cédula* del paciente, por favor?`,
      `Con mucho gusto le colaboro con eso. 😊\n\n` +
        `Para buscar la cita, ¿me comparte la *cédula* del paciente?`,
    ]),

  cancelarCedulaInvalida: () =>
    pick([
      `Mmm, ese número no me parece una cédula válida. 🙏\n\n` +
        `¿Me la confirma, por favor? Solo el número, sin puntos ni espacios.\n_(Ej: 18531928)_`,
      `Discúlpeme, no logré identificar el número correctamente. 😊\n\n` +
        `Escríbame por favor solo los dígitos, sin separadores. _(Ej: 1088123456)_`,
    ]),

  cancelarPacienteNoExiste: (cedula: string) =>
    pick([
      `Hmm, busqué en el sistema y no encuentro a ningún paciente con la cédula *${cedula}*. 🔍\n\n` +
        `¿Me la confirma por favor? O si prefiere terminar el proceso, escríbame _*"Salir"*_.`,
      `Discúlpeme, esa cédula *${cedula}* no me aparece registrada. 🙏\n\n` +
        `¿La revisamos otra vez? Si gusta terminar, escríbame _*"Salir"*_ con confianza.`,
    ]),

  cancelarSinCitas: (cedula: string) =>
    `Revisé y el paciente con cédula *${cedula}* no tiene citas próximas activas. 📭\n\n` +
    `¿Le gustaría agendarle una nueva? Cuénteme.`,

  cancelarSeleccionar: (nombre: string, lineas: string) =>
    pick([
      `Listo, encontré estas citas a nombre de *${nombre}*:\n\n` +
        `${lineas}\n` +
        `¿Cuál de ellas le gustaría cancelar? Respóndame con la letra, por favor.`,
      `Aquí están las citas que tengo para *${nombre}*:\n\n` +
        `${lineas}\n` +
        `Dígame con la letra cuál es la que desea cancelar. 😊`,
    ]),

  cancelarConfirmar: (servicio: string, doctor: string, fecha: string) =>
    `Para confirmarle, esta es la cita que vamos a cancelar:\n\n` +
    `🏥 *${servicio}*\n` +
    `👨‍⚕️ Dr(a). ${doctor}\n` +
    `📅 ${fecha}\n\n` +
    `⚠️ ¿Está completamente seguro(a)? Respóndame *SÍ* para cancelarla o *NO* si prefiere mantenerla.`,

  cancelarExitosa: () =>
    pick([
      `✅ ¡Listo! Su cita quedó *cancelada con éxito* y el cupo ya está liberado para otro paciente. 🗓️`,
      `✅ Hecho, cancelé su cita y dejé el espacio disponible para alguien más. 🙏`,
      `✅ Perfecto, ya cancelé la cita y el cupo queda liberado. 💚`,
    ]),

  cancelarOfreceAgendar: () =>
    pick([
      `¿Le gustaría agendarle ahora una cita en *otro horario disponible*? Cuénteme.\n\n` +
        `Respóndame *SÍ* para continuar o *NO* si por ahora prefiere dejarlo así.`,
      `Si gusta, ya mismo le busco *otro horarito* que le acomode. ¿Le parece?\n\n` +
        `*SÍ* para seguir, *NO* para terminar — con toda confianza.`,
    ]),

  cancelarDespedida: () =>
    pick([
      `¡Listo, que tenga un día muy bonito! 😊\n\n` +
        `Cuando me necesite, aquí estaré con mucho gusto. ¡Hasta pronto! 👋`,
      `¡Perfecto, cuídese mucho! 🌻\n\n` +
        `Recuerde que cuando lo necesite, aquí estoy para atenderle. ¡Que esté muy bien!`,
      `¡Listo, mil gracias por escribir! 💚 Que pase un excelente día.\n\n` +
        `Cualquier cosita, me escribe *"Hola"* y le atiendo. 👋`,
    ]),

  despedidaCorta: () =>
    pick([
      `¡Fue un gusto atenderle! 😊 Que tenga un día muy bonito.\n\n` +
        `Cuando necesite algo más, aquí me tiene. ¡Hasta pronto! 👋`,
      `¡Con mucho gusto! 🌻 Que esté muy bien.\n\n` +
        `Cualquier cosita, me escribe *"Hola"* y le atiendo de una. 💚`,
      `¡Listo, hasta luego! 😊 Que tenga una tarde linda.\n\n` +
        `Aquí estaré cuando me necesite. 👋`,
    ]),

  cancelarAbortada: () =>
    pick([
      `✅ ¡Perfecto! Su cita sigue *activa y agendada*, sin cambios.\n\n` +
        `¿Le puedo ayudar con algo más?`,
      `✅ Tranquilo(a), no toqué nada — su cita sigue *firme*. 😊\n\n` +
        `¿Le colaboro con otra cosita?`,
    ]),

  cancelarError: () =>
    `Ay, qué pena, tuve un inconveniente intentando cancelar la cita. 😔\n\n` +
    `Para no dejarle a medias, por favor comuníquese con nuestro Call Center y allí le ayudan enseguida. 🙏`,

  respuestaInvalidaSiNo: () =>
    pick([
      `Mmm, no le entendí muy bien. 🙏 ¿Me ayuda respondiendo *SÍ* para confirmar o *NO* para cancelar?`,
      `Discúlpeme, para este paso necesito un *SÍ* o un *NO*, por favor. 😊`,
      `Para asegurarme de no equivocarme, ¿me confirma con *SÍ* o *NO*?`,
    ]),

  audioPasoEstricto: () =>
    `🎙️ Para este pasito en particular, por favor respóndame por *texto* _(la letra o un SÍ/NO)_ — así evitamos cualquier confusión. 🙏`,

  inactividad: () =>
    `Hola, ¿cómo está? Por inactividad cerré nuestra conversación para cuidar sus datos. 🔒\n\n` +
    `Cuando quiera retomar, escríbame *"Hola"* y con mucho gusto le atiendo. 😊`,
};
