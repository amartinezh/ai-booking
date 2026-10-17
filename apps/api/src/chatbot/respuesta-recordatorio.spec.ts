import { clasificarRespuestaAlBot } from './respuesta-recordatorio';

/**
 * Las frases son las que escribieron los pacientes tras los primeros lotes de
 * recordatorios (2026-10-13 a 2026-10-15), tal cual, con su ortografía.
 */
describe('clasificarRespuestaAlBot', () => {
  it.each([
    'Si dios quiere mañana boy ala cita',
    'Si yo voy a asistir mañana',
    'Ok muchas gracias',
    'Muchas gracias',
    'Hola, muchas gracias',
    'Bueno',
    'Sí',
    'Listo, allá estaré',
    'Confirmo',
    'Está bien gracias',
    // 2026-10-15
    '👍',
    '👍🏻',
    '🙏🙏',
    'Dios le bendiga',
    'Dios lebendiga',
    'Claro que sí, si Dios quiere, sí, claro, cuente con la asistencia de mi mamá a la cita del jueves, muchas gracias por avisarnos',
  ])('«%s» → CONFIRMA', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('CONFIRMA');
  });

  it.each([
    'De donde me ablan',
    '¿De dónde me hablan?',
    'Quién es?',
    'quien me escribe',
    '¿De dónde me escriben?',
    // 2026-10-15
    'Buenas tardes, este mensaje que me mandaron es para una cita, para quién o qué, o cómo, cómo es',
    '¿Para quién es la cita?',
    'De qué se trata',
    'No entiendo este mensaje',
    '¿Quién me mandó esto?',
    '¿Por qué me escriben?',
    'Este mensaje es para quién?',
    'de que cita me hablan',
  ])('«%s» → QUIEN_ESCRIBE', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('QUIEN_ESCRIBE');
  });

  it.each([
    'Buenas tardes,esa cita es en q lugar Muchas gracias',
    'Gracias, a qué hora es',
    'Sí voy, ¿dónde queda?',
    'con quién es la cita',
    '¿A qué hora es la consulta? ¿en el laboratorio?',
  ])('«%s» → PREGUNTA_CITA (aunque no lleve «?»)', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('PREGUNTA_CITA');
  });

  it.each([
    // Caso real 2026-10-16 17:16, ya en el hospital (nota de voz transcrita).
    'Hola, buenas tardes. Eh, señorita, era preguntar a mí qué, qué número me toca, no pues con el doctor, qué qué número es para yo esperar acá, porque es que yo no veo a quién preguntar.',
    'Ok, en qué consultorio',
    'qué turno me toca',
    'cuál es el número para pasar',
    'ya estoy aquí, dónde espero',
    'a quién le pregunto por la cita',
  ])('«%s» → PREGUNTA_TURNO (su turno o dónde esperar)', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('PREGUNTA_TURNO');
  });

  it.each(['¿Qué número es este?', '¿De qué número me escriben?'])(
    '«%s» sigue siendo QUIEN_ESCRIBE (pregunta por el teléfono, no por su turno)',
    (texto) => {
      expect(clasificarRespuestaAlBot(texto)).toBe('QUIEN_ESCRIBE');
    },
  );

  it.each([
    'Vicentico está equivocado de número',
    'Número equivocado',
    'No conozco a esa persona',
    'Este número no es de ella',
  ])('«%s» → NUMERO_EQUIVOCADO', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('NUMERO_EQUIVOCADO');
  });

  it.each([
    'Buen día ,no puedo asistir',
    'Perdón cancelar cita',
    'Esque no voy a poder ir ala cita mañana',
    'Como hago para canselarla',
    'Necesito cancelar esa cita',
    'Y yo no puedo ir mañana',
    'Gracias, pero no puedo asistir',
    'No alcanzo a llegar, estoy trabajando',
    // 2026-10-15: todas las formas de decir que no irá o que quiere cancelar.
    'Mi hija no puede ir a la cita',
    'no la puedo llevar mañana',
    'No podemos ir',
    'no podré asistir',
    'Ya no la necesito',
    'no necesito la cita',
    'me es imposible',
    'Estoy de viaje',
    'estamos fuera de la ciudad',
    'Mi mamá está hospitalizada',
    'Se me presentó un imprevisto',
    'quiero cancelar mi cita',
    'Cancelenla por favor',
    'cancela la cita',
    'Necesito anular la cita',
    'por favor quiten la cita',
    'pueden eliminar mi cita',
    'liberen el cupo',
    'pueden ceder mi turno a otra persona',
    'no puedo el jueves',
    'no puedo mañana',
  ])('«%s» → NO_ASISTIRA', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('NO_ASISTIRA');
  });

  it.each([
    'necesito reagendar una cita',
    'Sí, pero quiero cambiar la hora',
    'Ok, ¿la puedo mover para otro día?',
    'No puedo ir el jueves, ¿me la pasan para otro día?',
  ])('«%s» → CAMBIAR', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('CAMBIAR');
  });

  it.each([
    'No es que mañana tengo una cita de control',
    'No contestan',
    'Soy Paco',
    'Sí voy, ¿tengo que llevar la orden?',
    'Gracias, que debo llevar',
    'No voy a faltar',
    '¿Por qué me cancelaron la cita?',
    'Ya cambié de EPS',
    'Están equivocados, mi cita es el jueves',
    'Gracias, a qué hora abre la farmacia',
  ])('🛡️ «%s» NUNCA es una confirmación', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).not.toBe('CONFIRMA');
  });

  it.each([
    '¿Por qué me cancelaron la cita?',
    'Ya cambié de EPS',
    'No voy a faltar',
    'Están equivocados, mi cita es el jueves',
    'No sé si pueda ir',
    'No quiero cancelar, solo confirmar',
    'no la cancelen, sí voy',
    'No va a haber problema',
    '¿La cita está cancelada?',
    '¿Me cancelaron la cita?',
  ])(
    '🛡️ «%s» no se toma por aviso de inasistencia, cambio ni número equivocado',
    (texto) => {
      expect(['NO_ASISTIRA', 'CAMBIAR', 'NUMERO_EQUIVOCADO']).not.toContain(
        clasificarRespuestaAlBot(texto),
      );
    },
  );

  it.each([
    'Gracias por comunicarte al restaurante Donde jacky. ¿Cómo podemos ayudarte?🥰',
    '¡Hola! Bienvenido a Droguería La Salud. En un momento te atendemos.',
    'Gracias por escribirnos, te responderemos lo más pronto posible.',
    'En este momento no podemos atenderte. Nuestro horario de atención es de 8 a 6.',
    'Este es un mensaje automático',
    '¿En qué te podemos ayudar?',
  ])('«%s» → RESPUESTA_AUTOMATICA (no se le contesta)', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('RESPUESTA_AUTOMATICA');
  });

  it.each([
    'Gracias por comunicarse, allá estaré',
    'Muchas gracias por el recordatorio',
    'Gracias por avisar, no puedo asistir',
    '¿Cuál es el horario de atención?',
  ])('🛡️ «%s» es de una persona, no de una contestadora', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).not.toBe('RESPUESTA_AUTOMATICA');
  });

  it.each([
    'Hola',
    'Buenas noches',
    'Sí voy, ¿tengo que llevar la orden?',
    'consultar',
    '¿a qué hora abre la farmacia?',
    'dónde queda el laboratorio',
    '😀',
    '',
    null,
  ])('«%s» no se clasifica: sigue el camino de siempre', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBeNull();
  });

  it('un párrafo largo no se toma por confirmación aunque diga «gracias»', () => {
    expect(
      clasificarRespuestaAlBot(
        'Buenas noches muchas gracias quería saber si la doctora atiende también por la tarde porque trabajo hasta las cinco',
      ),
    ).toBeNull();
    expect(
      clasificarRespuestaAlBot(
        'Buenas noches muchas gracias ayer estuve hablando con mi hija sobre los exámenes y ella dice que mejor esperamos los resultados',
      ),
    ).toBeNull();
  });
});
