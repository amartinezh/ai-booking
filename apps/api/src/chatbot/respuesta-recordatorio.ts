import { textoParaCoincidencia } from './texto-para-coincidencia.util';

/**
 * Qué está diciendo un paciente que le contesta al bot, en las respuestas que el
 * bot atiende sin la IA (2026-10-13, primer lote de recordatorios; ampliado el
 * 2026-10-15 con lo que escribieron los dos primeros días):
 *
 *   CONFIRMA           → «Sí voy», «Si Dios quiere mañana voy», «Ok muchas gracias»,
 *                        «👍», «Dios le bendiga». Solo cuenta si acaba de recibir un
 *                        recordatorio: eso lo decide quien llama.
 *   QUIEN_ESCRIBE      → «¿De dónde me hablan?», «¿Quién es?», «¿Quién me escribe?».
 *   PREGUNTA_CITA      → «esa cita es en q lugar», «¿a qué hora es?», «¿dónde queda?»:
 *                        pregunta por la cita, aunque no lleve «?».
 *   PREGUNTA_TURNO     → (2026-10-16) «¿qué número me toca con el doctor, para yo
 *                        esperar acá?», «¿en qué consultorio?»: ya está en el
 *                        hospital y pregunta su turno o dónde esperar. Antes «qué
 *                        número es» se tomaba por «¿de qué número me escriben?».
 *   YA_LLEGO           → (2026-10-17) «Acá estamos esperando», «ya llegué», «ya estoy
 *                        en el hospital»: avisa que está allá. Antes recibía «por
 *                        aquí solo puedo ayudarle con sus citas».
 *   OTRA_HORA          → (2026-10-20) «en ventanilla me dijeron que a las 5:50», «me
 *                        dieron la cita para el jueves»: le dieron otra hora o día.
 *                        Antes la IA lo tomaba por querer agendar y recibía «no es
 *                        posible agendar».
 *   NUMERO_EQUIVOCADO  → «Vicentico está equivocado de número», «no conozco a esa
 *                        persona»: el teléfono que el hospital tiene del paciente es
 *                        de otra persona.
 *   NO_ASISTIRA        → «Buen día, no puedo asistir», «Perdón cancelar cita».
 *   CAMBIAR            → «necesito reagendar una cita», «¿la puedo mover para otro día?».
 *   RESPUESTA_AUTOMATICA → «Gracias por comunicarte al restaurante Donde jacky.
 *                        ¿Cómo podemos ayudarte?»: no escribió una persona sino la
 *                        contestadora de un negocio. No se le responde.
 *
 * Determinista y conservador: ante la duda no clasifica (null) y el mensaje sigue
 * el camino de siempre. Nunca toma por confirmación algo que diga que NO irá, que
 * quiere cambiar la cita o que pregunte algo: eso es otra conversación.
 */
export type RespuestaAlBot =
  | 'CONFIRMA'
  | 'QUIEN_ESCRIBE'
  | 'PREGUNTA_CITA'
  | 'PREGUNTA_TURNO'
  | 'YA_LLEGO'
  | 'OTRA_HORA'
  | 'NUMERO_EQUIVOCADO'
  | 'NO_ASISTIRA'
  | 'CAMBIAR'
  | 'RESPUESTA_AUTOMATICA';

/**
 * Lo que, dicho en el MENÚ DE SERVICIOS por quien acaba de recibir un recordatorio,
 * es su respuesta al recordatorio y no una opción del menú (2026-10-22: un saludo
 * abrió el menú y «la cita ya la tengo para mañana» recibió «esa opción no se logró
 * identificar»). No están «no puedo ir» ni «cambiarla»: en el menú ya tienen su
 * camino (se le pregunta si deja el agendamiento para cancelar o cambiar).
 */
export const RESPUESTAS_AL_RECORDATORIO_EN_MENU: ReadonlySet<RespuestaAlBot> =
  new Set<RespuestaAlBot>([
    'CONFIRMA',
    'QUIEN_ESCRIBE',
    'PREGUNTA_CITA',
    'PREGUNTA_TURNO',
    'YA_LLEGO',
    'OTRA_HORA',
  ]);

const sinTildes = (texto: string): string =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Solo con «número», «persona» o «nombre» de por medio: «están equivocados, mi cita
// es el jueves» habla de la cita, no del teléfono.
const NUMERO_EQUIVOCADO =
  /\b(equivoc\w* de (numero|persona|celular|telefono|whatsapp)|(numero|celular|telefono) (esta |es )?equivocad\w*|no conozco a (esa |ese |esta |este |la |el |dicha |dicho )?(persona|senora|senor|senorita|paciente)|no conozco a nadie (con ese nombre|que se llame)|(este|ese) (numero|celular|telefono) no es de|(este|ese) no es el (numero|celular|telefono) de)\b/;

// La contestadora automática de un negocio (2026-10-15: «Gracias por comunicarte al
// restaurante Donde jacky. ¿Cómo podemos ayudarte?🥰»). Frases que un paciente no
// le escribe a su hospital: hablan de «nosotros» y tratan al otro como cliente.
// «Gracias por comunicarse» a secas NO: un paciente educado lo dice.
// 2026-10-17: «Hola! Soy Theo Tattoo, gracias por tu mensaje. Te daré respuesta tan
// pronto como sea posible. Gracias por tu paciencia.»: «te daré respuesta», «te
// responderé en breve / tan pronto…» y «gracias por TU paciencia» son del negocio.
// «Le contesto mañana» a secas NO: lo puede escribir un paciente, y tomarlo por
// contestadora lo dejaría sin respuesta y con el teléfono marcado.
const RESPUESTA_AUTOMATICA =
  /\b((te|le|les) (dare|daremos) (una )?respuesta|(te|le|les) (respondere|contestare|atendere|escribire|responderemos|contestaremos|escribiremos) (tan pronto|en breve|lo antes posible|lo mas pronto|en cuanto)|gracias por tu paciencia|mensaje automatico|respuesta automatica|(como|en que) (te |le |les )?(podemos|puedo) (ayudar|servir|colaborar)\w*|bienvenid[oa]s? a\b|gracias por (contactarnos|escribirnos|preferirnos|elegirnos|comunicarte (con|a|al))|nuestro horario( de atencion)? es|(te|le|les) (responderemos|contestaremos|atenderemos|escribiremos)\b|en (este|estos) momentos? no (podemos|estamos|nos encontramos)|estamos fuera (de|del) horario)/;

// Con faltas de ortografía reales: «de donde me ablan».
// «¿Con quién es la cita?» pregunta por el médico, no por quién escribe.
// 2026-10-15: «este mensaje que me mandaron es para una cita, ¿para quién o qué?»
// también pregunta quién escribe y por qué.
const QUIEN_ESCRIBE = new RegExp(
  [
    '\\b(?<!con )(de donde|quien|quienes)\\s+(me |nos |le )?(h?abl\\w*|escrib\\w*|llam\\w*|mand\\w*|envi\\w*|es|son|eres)\\b',
    '\\bque (entidad|empresa|hospital|numero) es\\b',
    // «¿de qué número me escriben?»
    '\\bde (que|q|cual) numero (me |nos |le )?(h?abl\\w*|escrib\\w*|llam\\w*|mand\\w*|envi\\w*)',
    '\\bpara quien\\b',
    '\\b(este|ese|el|su) (mensaje|whatsapp|recordatorio)( que me (mandaron|enviaron|llego|escribieron))? (es )?(para|de) (que|quien)\\b',
    '\\b(este|ese|el) mensaje que me (mandaron|enviaron|llego|escribieron)\\b',
    '\\bde que (se trata|es (esto|este mensaje|el mensaje|la cita)|cita (me hablan|es|se trata))\\b',
    '\\b(que es esto|a que se refiere\\w*|no entiendo (este|el|su|ese) mensaje)\\b',
    '\\bpor que me (escrib|mand|envi|llam)\\w*',
  ].join('|'),
);

// Su turno, su consultorio o dónde esperar, ya en el hospital: «¿qué número me toca
// con el doctor?», «¿qué número es para yo esperar acá?», «¿en qué consultorio?».
// «¿qué número es este?» (el teléfono) NO: el «es» solo cuenta seguido de «para».
const PREGUNTA_TURNO =
  /\b((que|q|cual) (numero|turno|ficha|consultorio) (me |nos |le |te )?(toca|tengo|tenemos|tiene|dan|corresponde)|(numero|turno|ficha) (es )?para (yo |uno |nosotros )?(esperar|ser atendid\w*|entrar|pasar)|(en )?(que|q|cual) consultorio|donde (espero|me siento|hago la fila|hay que esperar|debo esperar|tengo que esperar)|a quien (le )?pregunt\w*)\b/;

// Ya está en el hospital: «acá estamos esperando», «ya llegué», «ya estoy en la
// clínica». «No llegué» (no fue) NO; «allá estaré» (futuro) es una confirmación.
const YA_LLEGO =
  /((?<!no )\b(ya )?(llegue|llegamos|estoy llegando|estamos llegando)\b|\b(ya )?(estoy|estamos|me encuentro|nos encontramos) (aca|aqui|en el hospital|en la clinica|en el centro de salud|en (la )?sala de espera|en (la )?recepcion|en la fila)\b|\b(aca|aqui) (estoy|estamos|me encuentro|nos encontramos)\b|\b(aca|aqui) (esperando|en espera)\b|\b(estoy|estamos) (aca |aqui )?esperando (turno|el turno|que me llamen|a que me llamen|al (doctor|medico|la doctora)|la atencion|que me atiendan)\b)/;

// Le dieron otra hora o día: «en ventanilla me dijeron que a las 5:50», «me la
// dieron para el jueves», «tengo entendido que era por la tarde». Las dos cosas a
// la vez: quién se lo dijo («me dijeron», «tengo entendido»…) y una hora o un día;
// «me dijeron que llamara» no es esto. «Otro día» u «otra hora» NO cuentan: eso es
// pedir un cambio (CAMBIAR, que va antes).
const LE_DIJERON =
  /\b((me|nos|le) (la |lo )?(dijeron|dijo|informaron|informo|indicaron|indico|dieron|dio|asignaron|asigno|programaron|programo|agendaron|agendo|anotaron|anoto)|(tengo|tenia) entendido|(pense|crei|creia) que (era|es|seria)|no (era|es) (a|para) las)\b/;
// Dónde se lo dijeron no es otro tema: «en ventanilla / en caja me dijeron…».
const DONDE_SE_LO_DIJERON = /\b(ventanilla|caja|facturacion)\b/g;
const UNA_HORA_O_DIA =
  /\b((a|para) las \d|\d{1,2} \d{2}\b|\d{1,2} ?(am|pm|a m|p m)\b|(el|para el|este|el proximo) (lunes|martes|miercoles|jueves|viernes|sabado|domingo)|pasado manana|(por|en) la (manana|tarde|noche)|manana)/;

// «¿la puedo mover para otro día?». «cambi…» solo con la cita, la fecha o la hora
// de por medio: «cambié de EPS» no es pedir otra fecha.
const CAMBIAR =
  /\b(re ?agend\w*|reprogram\w*|cambi\w* (de |la |mi |esa |esta |el )*(cita|fecha|hora|horario|dia)|cambiarla|cambiarmela|moverla|mover (la |mi |esa )?cita|correrla|aplaz\w*|posterg\w*|otro dia|otra (fecha|hora))\b/;

// «no puedo asistir», «no voy a poder ir», «no alcanzo a llegar», «no voy», y en
// tercera persona, de quien escribe por un hijo o un papá: «mi hija no puede ir»,
// «no la puedo llevar».
const AUXILIAR =
  '(voy a poder|vamos a poder|va a poder|van a poder|puedo|podemos|puede|pueden|podre|podremos|podra|podran|podria|podriamos|pude|alcanzo|alcanzamos|alcanza|alcanzare|alcance|me queda posible|nos queda posible|le queda posible|me queda facil|me es posible|nos es posible|le es posible|tengo como|tenemos como|tiene como|logro|voy a|vamos a|va a|van a)';
const VERBO_IR =
  '(ir|asistir|llegar|venir|acudir|cumplir|cumplirla|presentarme|presentarse|estar|llevarla|llevarlo|llevar)';
const NO_IRA = new RegExp(
  `\\bno (la |lo |le |me |nos )?(${AUXILIAR} (a )?${VERBO_IR}|voy(?! a faltar)|vamos(?! a faltar)|ire|iremos|ira|iran|asistire|asistiremos|asistira|asisto|llegare)\\b|` +
    // «no puedo mañana», «no podemos ese día»
    `\\bno (puedo|podemos|puede|podre|podra|podria) (ese dia|manana|hoy|a esa hora|el (lunes|martes|miercoles|jueves|viernes|sabado|domingo))\\b|` +
    // «me es imposible ir», «nos queda imposible»
    `\\b(me|nos|le) (es|queda|sera) imposible\\b|` +
    // «ya no la necesito», «no necesito la cita»
    `\\bya no (la |lo )?necesit\\w*|\\bno (la |lo )?necesit\\w* (la |esa |mi )?(cita|consulta)\\b|` +
    // «estoy de viaje», «estamos fuera de la ciudad», «está hospitalizada»
    `\\b(estoy|estamos|esta|estara|estare) (de viaje|fuera de (la ciudad|el pueblo|anserma|el municipio|el pais)|hospitalizad\\w*)\\b|` +
    `\\b(imprevisto|calamidad)\\b`,
);
// El paciente pide cancelar o quitar su cita. «¿por qué me cancelaron?» o «¿la
// cita está cancelada?» preguntan por algo que hizo otro: no son su aviso.
const CANCELA = new RegExp(
  '\\b(cancel|cansel|kancel)(ar|arla|arlo|ala|arme|armela|o|e|en|enla|enlo|emos|acion|aciones)\\b|' +
    '\\bcancela (la |mi |esa |esta )?cita\\b|' +
    '\\b(anul(ar|arla|en|enla|e|ela|o)|desist\\w*|dejar sin efecto)\\b|' +
    '\\b(suspend|quit|borr|elimin)\\w* (la |mi |esa |esta |el )?(cita|cupo|turno)\\b|' +
    '\\b(liber|ced)\\w* (el |mi |ese |este )?(cupo|turno|espacio)\\b',
);
// «Cancelada», «Canselada», «cita cancelada por favor» como TODA la respuesta
// (2026-10-31, …3242: «Canselada» a las 9:45 tras su recordatorio recibió «¿me
// indica la cédula?», no respondió y la cita siguió en pie). El recordatorio dice
// «si no puede asistir, responda cancelar cita»: dicho a secas, es su respuesta.
// Con algo más («¿está cancelada?», «me la cancelaron», «ya fue cancelada») pregunta
// o cuenta algo que hizo otro, y sigue por la IA.
const CANCELADA_A_SECAS =
  /^((la|mi|esa) )?(cita )?(cancel|cansel|kancel)ad[ao]s?( (por favor|porfa|porfavor|gracias|muchas gracias))?$/;
// «no quiero cancelar», «no la cancelen»: lo contrario.
const NO_CANCELA =
  /\bno (quiero |deseo |voy a |necesito |la |lo |me la )?(cancel|cansel|anul)\w*/;

// Pregunta por dónde, a qué hora, qué día o con quién. «q» es «qué».
const LUGAR_U_HORA =
  /\b(donde|en q(ue)? (lugar|parte|sitio|sede|consultorio|piso)|q(ue)? (lugar|sitio|sede|consultorio|direccion)|a q(ue)? hora|q(ue)? hora es|q(ue)? dia es|para cuando|cuando es|cuando seria|direccion|ubicad\w*|como (llego|llegar|hago para llegar)|con q(ue)? (medico|doctor\w*|especialista)|con quien)\b/;
// …de OTRA cosa del hospital: «¿a qué hora abre la farmacia?» no pregunta por su
// cita y sigue el camino de siempre (las preguntas frecuentes).
const OTRO_TEMA =
  /\b(farmacia|droguer\w*|laboratorio|urgencia\w*|parqueadero|parqueo|caja|factura\w*|ventanilla|rayos|radiolog\w*|ecograf\w*|vacun\w*|abre|abren|cierra|cierran|atienden|horario)\b/;
const MENCIONA_CITA = /\b(cita|consulta|control)\b/;

// Cualquier otra pregunta, aunque no lleve «?»: «Gracias, que debo llevar».
// «Me indicas por favor si sí es para las ecografías» (2026-10-23) también:
// recibió «¡Gracias por confirmar!» porque decía «si».
const PREGUNTA =
  /\b(q(ue)? (debo|tengo que|necesito|hay que|llevo)|como (hago|es|se)|cual|cuanto|cuanta|quisiera saber|queria saber|necesito saber|me (podria|puede|pueden|podrian) (decir|informar|indicar|confirmar)|me (indica|indicas|indique|dice|dices|aclara|aclaras|explica|explicas) (si|por favor|porfa|porfavor|que|cual|como|donde|a que)|(esto|eso) (si |no )?es para)\b/;

// Lo que queda de «no» tras descartar lo de arriba sigue sin ser una confirmación.
const NO_CONFIRMA =
  /\b(no|nunca|tampoco|cancel\w*|cansel\w*|anul\w*|cambi\w*|reprogram\w*|reagend\w*|mover|mueva|aplaz\w*|posterg\w*|otro dia|otra (fecha|hora|cita))\b/;

// «grasias», «gracia»: con la ortografía de verdad (2026-10-22, …7954).
const CONFIRMA =
  /\b(si+|claro|listo|ok|okey|okay|oki|vale|bueno|perfecto|de acuerdo|esta bien|confirm\w*|gra[cs]ias?|agradezco|voy|vamos|asistire|ire|alla estare|ahi estare|alli estare|cuenten conmigo|cuente con|dios quiere|amen|entendido|recibido|enterad\w*)\b/;
// «Dios le bendiga», «Dios lebendiga» (pegado), «bendiciones».
const BENDICE = /bendi[gc]/;

// Solo emojis de asentir: 👍 (con su tono de piel), 👌, 🙏, ✅, 🙌, 🤝, ✔️, ☑️.
const EMOJI_CONFIRMA =
  /^(?:\u{1F44D}|\u{1F44C}|\u{1F64F}|\u{2705}|\u{1F64C}|\u{1F91D}|\u{2714}|\u{2611}|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{200D}|\s)+$/u;

/** Una confirmación es corta; un párrafo trae algo más que merece la IA… */
const MAX_PALABRAS_CONFIRMACION = 14;
/** …salvo que lo diga sin dudas: «Claro que sí, si Dios quiere, sí, claro, cuente con…». */
const MAX_PALABRAS_CONFIRMACION_FIRME = 30;
// 2026-10-20: «con la ayuda de Dios, muchísimas gracias por avisarme, yo estoy
// atenta, estoy atenta a eso, con la ayuda de Dios» (19 palabras) recibió «no es
// posible agendar»: «con la ayuda de Dios», «estoy atenta» y «gracias por
// avisarme» también lo dicen sin dudas.
// Ya tiene la cita: «la cita ya la tengo para mañana», «una cita pero ya me la
// dieron» (2026-10-22, …7954, tal cual: «la sita ya latengo», «ya meladoeron»).
// Contestado al recordatorio, es confirmarla; con «no» u «otra cita» de por medio,
// no (NO_CONFIRMA va antes).
const YA_LA_TIENE =
  /\bya (la ?|lo ?)?tengo\b|\bya (la |lo )?tenemos\b|\bya tengo (la |mi |una |esa )?(cita|sita|consulta)\b|\bya (me|nos) ?(la|lo) ?d[io]\w*ron\b|\bya (me|nos) ?(la|lo) ?(asignaron|agendaron|programaron)\b/;

const CONFIRMA_FIRME =
  /\b(asistire|asistiremos|ire|iremos|alli estare|alla estare|ahi estare|alli estaremos|alla estaremos|ahi estaremos|cuente con|cuenten con|si dios quiere|dios mediante|primero dios|con (la ayuda|el favor) de dios|(estoy|estare|quedo|estamos|quedamos) (atent[oa]s?|pendientes?)|gracias por (avisar\w*|recordar\w*|el recordatorio|el aviso)|claro que si|confirmo|confirmada|con gusto)\b/;

export function clasificarRespuestaAlBot(
  texto: string | null | undefined,
): RespuestaAlBot | null {
  if (!texto) return null;
  const t = sinTildes(textoParaCoincidencia(texto));
  if (!t) return EMOJI_CONFIRMA.test(texto) ? 'CONFIRMA' : null;

  // Primero: a una contestadora no se le contesta, diga lo que diga («Donde jacky»
  // no es una pregunta por el lugar de la cita).
  if (RESPUESTA_AUTOMATICA.test(t)) return 'RESPUESTA_AUTOMATICA';
  if (NUMERO_EQUIVOCADO.test(t)) return 'NUMERO_EQUIVOCADO';
  // Antes que «quién escribe»: «qué número es para yo esperar» pregunta su turno.
  if (PREGUNTA_TURNO.test(t)) return 'PREGUNTA_TURNO';
  if (QUIEN_ESCRIBE.test(t)) return 'QUIEN_ESCRIBE';
  // Pedir otra fecha gana a «no puedo ir»: «no puedo el martes, ¿me la pasan para
  // otro día?» quiere la cita, solo que otro día.
  if (CAMBIAR.test(t)) return 'CAMBIAR';
  if ((NO_IRA.test(t) || CANCELA.test(t)) && !NO_CANCELA.test(t)) {
    return 'NO_ASISTIRA';
  }
  if (CANCELADA_A_SECAS.test(t) && !texto.includes('?')) return 'NO_ASISTIRA';
  // Después de «no puedo ir» (lo que diga de no ir manda) y antes de la pregunta
  // por la cita y de la confirmación: «gracias, ya llegué» avisa que está allá.
  if (YA_LLEGO.test(t)) return 'YA_LLEGO';
  // «me dijeron que la farmacia abre a las 7» es de otro tema.
  if (
    LE_DIJERON.test(t) &&
    UNA_HORA_O_DIA.test(t) &&
    (MENCIONA_CITA.test(t) ||
      !OTRO_TEMA.test(t.replace(DONDE_SE_LO_DIJERON, ' ')))
  ) {
    return 'OTRA_HORA';
  }
  if (LUGAR_U_HORA.test(t)) {
    return MENCIONA_CITA.test(t) || !OTRO_TEMA.test(t) ? 'PREGUNTA_CITA' : null;
  }

  // Una pregunta merece respuesta, no un «gracias por confirmar».
  if (texto.includes('?') || PREGUNTA.test(t)) return null;
  if (NO_CONFIRMA.test(t)) return null;
  const palabras = t.split(' ').length;
  if (YA_LA_TIENE.test(t) && palabras <= MAX_PALABRAS_CONFIRMACION_FIRME) {
    return 'CONFIRMA';
  }
  const limite = CONFIRMA_FIRME.test(t)
    ? MAX_PALABRAS_CONFIRMACION_FIRME
    : MAX_PALABRAS_CONFIRMACION;
  if (palabras > limite) return null;
  return CONFIRMA.test(t) || BENDICE.test(t) ? 'CONFIRMA' : null;
}

/**
 * 🙏 Lo que puede acompañar a un «gracias» sin pedir nada: «Muchas gracias por su
 * ayuda, buen día 🙏», «gracias señorita, Dios le bendiga». (Los emojis y signos ya
 * los quita `textoParaCoincidencia`.)
 */
const CORTESIA = new Set(
  (
    'muchas muchisimas mil gracias por su sus tu la el los las ayuda atencion ' +
    'colaboracion informacion info todo todos amable muy mucho muchisimo buen buenos ' +
    'buena buenas dia dias tarde tardes noche noches feliz que tenga tengan tengas un ' +
    'una excelente hola ok okey listo perfecto dios le les lo te bendiga bendiciones ' +
    'saludos y igualmente senorita senor senora doctor doctora a usted ustedes de ' +
    'quedo atento atenta se amigo amiga gran igual nuevamente servicio'
  ).split(' '),
);

/**
 * ¿Es solo un agradecimiento (con cortesías), sin pedir ni preguntar nada?
 * (2026-10-17: «Muchas gracias por su ayuda buen día 🙏» después de cancelar recibió
 * «no es posible agendar citas»: el «buen día» lo hacía pasar por un saludo, y la
 * despedida solo reconocía frases exactas.) Conservador: una sola palabra que no sea
 * de cortesía, o un «?», y no lo es.
 */
export function esAgradecimiento(texto: string | null | undefined): boolean {
  if (!texto || texto.includes('?')) return false;
  const t = sinTildes(textoParaCoincidencia(texto));
  if (!/\b(gra[cs]ias?|agrade[cz]\w*)\b/.test(t)) return false;
  const palabras = t.split(' ').filter(Boolean);
  if (palabras.length > 20) return false;
  return palabras.every(
    (p) =>
      CORTESIA.has(p) ||
      /^(agrade[cz]|bendic|bendig|bendecid|gra[cs]ia)\w*$/.test(p),
  );
}

/** Quien puede compartir el teléfono del paciente. */
const FAMILIAR =
  '(hij[oa]s?|espos[oa]|mama|papa|madre|padre|herman[oa]|niet[oa]|sobrin[oa]|ti[oa]|prim[oa]|abuel[oa]|familiar|acudiente|cuidador[a]?|novi[oa]|companer[oa]|vecin[oa]|amig[oa]|nuera|yerno|suegr[oa])';

/** Lo que cabe en un saludo: «Hola buenos días», «buenas tardes señorita, ¿cómo está?». */
const SALUDO_PALABRAS = new Set(
  (
    'hola ola holi holis buenas buenos buen buena dia dias tarde tardes noche noches ' +
    'que q tal mas como esta estas usted saludos saludo alo hey hello hi quiubo y ' +
    'senorita senor senora don dona doctor doctora joven muy feliz dios lo la le ' +
    'bendiga bendecido bendecida'
  ).split(' '),
);
const SALUDO_NUCLEO =
  /\b(hola|ola|holi|holis|buenas|buenos|buen|saludos|alo|hey|hello|hi|quiubo)\b/;

/**
 * 👋 ¿Es solo un saludo? (2026-10-20: «Hola buenos dias» tras el recordatorio a otra
 * persona recibió «no es posible agendar»: el diccionario de saludos del bot es de
 * frases exactas y esa no estaba.) Conservador: con una sola palabra que no sea de
 * saludo, no lo es.
 */
export function esSoloSaludo(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = sinTildes(textoParaCoincidencia(texto));
  if (!SALUDO_NUCLEO.test(t)) return false;
  const palabras = t.split(' ').filter(Boolean);
  return palabras.length <= 10 && palabras.every((p) => SALUDO_PALABRAS.has(p));
}

/**
 * Quien escribe dice de quién es familia o de parte de quién habla: «no soy Darío,
 * soy la hija». Ese número sí es del paciente (lo comparte la familia).
 */
const PARENTESCO = new RegExp(
  `\\b((soy|habla|le escribe) (su|la|el) ${FAMILIAR}|de parte de)\\b`,
);
/** «…es para mi mamá», «…es de mi abuela»: el mensaje es de alguien de la casa. */
const PARA_LA_FAMILIA = new RegExp(
  `\\b(para|de) (mi|mis|su|sus|la|el|nuestra|nuestro) ${FAMILIAR}\\b`,
);

/** Palabras que pueden seguir a «no soy» sin ser un nombre: «no soy de aquí». */
const NO_ES_NOMBRE = new Set(
  (
    'de del el la los las un una yo ese esa este esta quien capaz paciente persona ' +
    'yo tan muy nada ninguno ninguna ella el usted familiar familia dueno duena ' +
    'cliente de aqui aca de alla'
  ).split(' '),
);

/**
 * ☎️ «hola yo no soy dario» (2026-10-17): el nombre que niega, normalizado (sin
 * tildes, en minúscula), o null. Solo devuelve el nombre; decidir si es el del
 * paciente al que se le escribió es de quien llama (con la cita del recordatorio).
 * Si en el mismo mensaje dice su parentesco («…soy la hija»), null: el número es
 * de la familia, no está equivocado.
 */
export function nombreQueNiega(
  texto: string | null | undefined,
): string | null {
  if (!texto) return null;
  const t = sinTildes(textoParaCoincidencia(texto));
  if (PARENTESCO.test(t)) return null;
  const m =
    /\bno soy (el |la )?(senor |senora |senorita |don |dona )?([a-z]+)\b/.exec(
      t,
    );
  if (!m) return null;
  const nombre = m[3];
  if (nombre.length < 3 || NO_ES_NOMBRE.has(nombre)) return null;
  return nombre;
}

/**
 * Un nombre escrito como suena (2026-10-21: escribieron «Deysi» y la paciente es
 * DEICY): sin tildes ni h muda, y con las letras que en español suenan igual
 * juntas (y/i, ll/y, c/s/z, qu/c/k, v/b). Dos nombres distintos casi nunca quedan
 * iguales: «Darío» y «Mario» siguen siendo distintos.
 */
function nombreFonetico(nombre: string): string {
  return sinTildes(nombre.toLowerCase())
    .replace(/[^a-zñ]/g, '')
    .replace(/ch/g, '§')
    .replace(/h/g, '')
    .replace(/ll/g, 'y')
    .replace(/y/g, 'i')
    .replace(/qu/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/(.)\1+/g, '$1')
    .replace(/§/g, 'ch');
}

/** ¿Es el mismo nombre, aunque esté escrito distinto? («Deysi» y «Deicy»: sí.) */
export function mismoNombre(a: string, b: string): boolean {
  const x = nombreFonetico(a);
  return x.length >= 3 && x === nombreFonetico(b);
}

// «Este mensaje no era para mí», «esto no es conmigo», «me llegó por error».
const NO_ERA_PARA_MI =
  /\bno (es|era|iba|va) (para|dirigido a) mi\b|\b(esto|eso|este mensaje|ese mensaje) no (es|era) conmigo\b|\b(me|nos) (llego|llegaron|escribieron|mandaron|enviaron) por (error|equivocacion)\b/;

// «Está equivocada», «se equivocaron»: solo a secas (ver `esMensajeAjeno`).
const SE_EQUIVOCARON =
  /\b((esta|estan|estas) (usted |ustedes )?equivocad[oa]s?|se (equivoco|equivocaron)|equivocad[oa]s?)\b/;
const SALUDO =
  /\b(buen dia|buenos dias|buenas tardes|buenas noches|buenas|buen)\b/g;
/** Lo que puede rodear a «está equivocada» sin decir nada más. */
const RELLENO = new Set(
  (
    'hola que q pena qpena disculpe disculpa disculpen perdon perdone perdona pero ' +
    'creo me parece al pienso usted ustedes ud uds senor senora senorita joven lo yo ' +
    'siento mucho con todo respeto ok okey gracias muchas mil y ya eh ah oh mire vea ' +
    'amigo amiga'
  ).split(' '),
);

// Habla de su propia cita o de un dato de ella: «…mi cita es el jueves», «ese
// horario no es para mí». Entonces el número es del paciente.
const HABLA_DE_SU_CITA =
  /\b(mi|mis|nuestra) (cita|citas|consulta|control)\b|\btengo (una |la |mi )?(cita|consulta|control)\b|\b(fecha|hora|horario|jornada|lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|semana|medic[oa]|doctor\w*)\b|\bya (me atendieron|fui|asisti)\b|\d/;

/**
 * 📭 «Que pena está equivocada», «Este mensaje no era para mí» (2026-10-19: el
 * recordatorio de una paciente le llegó a otra persona, que contestó eso dos veces y
 * recibió las respuestas de siempre). Dice que el mensaje no es suyo, pero sin
 * «número» ni «persona» de por medio: por eso no es NUMERO_EQUIVOCADO, y quien llama
 * solo lo toma así si a ese número se le acaba de enviar un recordatorio. Además:
 *  - «está equivocada» cuenta solo a secas, con saludos y disculpas alrededor: con
 *    algo más («…ya me atendieron», «la hora está equivocada») habla de la cita;
 *  - si dice para quién de la familia es («…es para mi mamá») o habla de su propia
 *    cita, el número es de la familia o del paciente: no.
 */
export function esMensajeAjeno(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = sinTildes(textoParaCoincidencia(texto));
  if (!NO_ERA_PARA_MI.test(t) && !soloDiceQueSeEquivocaron(t)) return false;
  return !(
    PARENTESCO.test(t) ||
    PARA_LA_FAMILIA.test(t) ||
    HABLA_DE_SU_CITA.test(t)
  );
}

function soloDiceQueSeEquivocaron(t: string): boolean {
  if (!SE_EQUIVOCARON.test(t)) return false;
  // «Yo no soy Deysi, está equivocada» (2026-10-21): decir qué nombre no es
  // también es decir que no es suyo. Solo un nombre: «no soy de aquí» no se quita.
  const negado = nombreQueNiega(t);
  const sinElNombre = negado
    ? t.replace(
        new RegExp(
          `\\bno soy (el |la )?(senor |senora |senorita |don |dona )?${negado}\\b`,
        ),
        ' ',
      )
    : t;
  return sinElNombre
    .replace(new RegExp(SE_EQUIVOCARON.source, 'g'), ' ')
    .replace(SALUDO, ' ')
    .split(' ')
    .filter(Boolean)
    .every((p) => RELLENO.has(p));
}
