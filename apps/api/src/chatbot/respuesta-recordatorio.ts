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
  | 'NUMERO_EQUIVOCADO'
  | 'NO_ASISTIRA'
  | 'CAMBIAR'
  | 'RESPUESTA_AUTOMATICA';

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
const RESPUESTA_AUTOMATICA =
  /\b(mensaje automatico|respuesta automatica|(como|en que) (te |le |les )?(podemos|puedo) (ayudar|servir|colaborar)\w*|bienvenid[oa]s? a\b|gracias por (contactarnos|escribirnos|preferirnos|elegirnos|comunicarte (con|a|al))|nuestro horario( de atencion)? es|(te|le|les) (responderemos|contestaremos|atenderemos|escribiremos)\b|en (este|estos) momentos? no (podemos|estamos|nos encontramos)|estamos fuera (de|del) horario)/;

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
const PREGUNTA =
  /\b(q(ue)? (debo|tengo que|necesito|hay que|llevo)|como (hago|es|se)|cual|cuanto|cuanta|quisiera saber|queria saber|necesito saber|me (podria|puede|pueden|podrian) (decir|informar|indicar|confirmar))\b/;

// Lo que queda de «no» tras descartar lo de arriba sigue sin ser una confirmación.
const NO_CONFIRMA =
  /\b(no|nunca|tampoco|cancel\w*|cansel\w*|anul\w*|cambi\w*|reprogram\w*|reagend\w*|mover|mueva|aplaz\w*|posterg\w*|otro dia|otra (fecha|hora|cita))\b/;

const CONFIRMA =
  /\b(si+|claro|listo|ok|okey|okay|oki|vale|bueno|perfecto|de acuerdo|esta bien|confirm\w*|gracias|agradezco|voy|vamos|asistire|ire|alla estare|ahi estare|alli estare|cuenten conmigo|cuente con|dios quiere|amen|entendido|recibido|enterad\w*)\b/;
// «Dios le bendiga», «Dios lebendiga» (pegado), «bendiciones».
const BENDICE = /bendi[gc]/;

// Solo emojis de asentir: 👍 (con su tono de piel), 👌, 🙏, ✅, 🙌, 🤝, ✔️, ☑️.
const EMOJI_CONFIRMA =
  /^(?:\u{1F44D}|\u{1F44C}|\u{1F64F}|\u{2705}|\u{1F64C}|\u{1F91D}|\u{2714}|\u{2611}|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{200D}|\s)+$/u;

/** Una confirmación es corta; un párrafo trae algo más que merece la IA… */
const MAX_PALABRAS_CONFIRMACION = 14;
/** …salvo que lo diga sin dudas: «Claro que sí, si Dios quiere, sí, claro, cuente con…». */
const MAX_PALABRAS_CONFIRMACION_FIRME = 30;
const CONFIRMA_FIRME =
  /\b(asistire|asistiremos|ire|iremos|alli estare|alla estare|ahi estare|alli estaremos|alla estaremos|ahi estaremos|cuente con|cuenten con|si dios quiere|dios mediante|claro que si|confirmo|confirmada|con gusto)\b/;

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
  // Después de «no puedo ir» (lo que diga de no ir manda) y antes de la pregunta
  // por la cita y de la confirmación: «gracias, ya llegué» avisa que está allá.
  if (YA_LLEGO.test(t)) return 'YA_LLEGO';
  if (LUGAR_U_HORA.test(t)) {
    return MENCIONA_CITA.test(t) || !OTRO_TEMA.test(t) ? 'PREGUNTA_CITA' : null;
  }

  // Una pregunta merece respuesta, no un «gracias por confirmar».
  if (texto.includes('?') || PREGUNTA.test(t)) return null;
  if (NO_CONFIRMA.test(t)) return null;
  const palabras = t.split(' ').length;
  const limite = CONFIRMA_FIRME.test(t)
    ? MAX_PALABRAS_CONFIRMACION_FIRME
    : MAX_PALABRAS_CONFIRMACION;
  if (palabras > limite) return null;
  return CONFIRMA.test(t) || BENDICE.test(t) ? 'CONFIRMA' : null;
}
