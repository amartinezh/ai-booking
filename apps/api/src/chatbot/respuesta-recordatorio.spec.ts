import {
  clasificarRespuestaAlBot,
  esAgradecimiento,
  esMensajeAjeno,
  esSoloSaludo,
  mismoNombre,
  nombreQueNiega,
} from './respuesta-recordatorio';

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

  it.each([
    // Caso real 2026-10-17 10:06, tras confirmar su cita de las 11:35.
    'Acá estamos esperando',
    'Ya llegué',
    'ya estoy aquí',
    'Gracias, ya estamos en el hospital',
    'aquí estoy esperando turno',
    'estamos llegando',
  ])('«%s» → YA_LLEGO (avisa que está en el hospital)', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('YA_LLEGO');
  });

  it('«No llegué a la cita» (no fue) no es un aviso de llegada', () => {
    expect(clasificarRespuestaAlBot('No llegué a la cita')).not.toBe(
      'YA_LLEGO',
    );
  });

  it.each([
    ['Allá estaré', 'CONFIRMA'],
    ['ya llegué, ¿qué número me toca?', 'PREGUNTA_TURNO'],
  ])('«%s» → %s (no es un aviso de llegada)', (texto, tipo) => {
    expect(clasificarRespuestaAlBot(texto)).toBe(tipo);
  });

  it.each(['¿Qué número es este?', '¿De qué número me escriben?'])(
    '«%s» sigue siendo QUIEN_ESCRIBE (pregunta por el teléfono, no por su turno)',
    (texto) => {
      expect(clasificarRespuestaAlBot(texto)).toBe('QUIEN_ESCRIBE');
    },
  );

  it.each([
    // Caso real 2026-10-20 09:36, tras su recordatorio (19 palabras).
    'con la ayuda de Dios, muchísimas gracias por avisarme, yo estoy atenta, estoy atenta a eso, con la ayuda de Dios.',
    'Primero Dios allá estaré, gracias',
    'Muchas gracias por el recordatorio, quedo pendiente de la cita del miércoles y llego temprano señorita',
  ])('«%s» → CONFIRMA (sin dudas, aunque sea largo)', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('CONFIRMA');
  });

  it.each([
    ['Gracias por avisarme pero no puedo ir', 'NO_ASISTIRA'],
    ['Estoy atenta, ¿a qué hora es?', 'PREGUNTA_CITA'],
    ['Gracias por recordarme, no sabía', null],
  ])('«%s» → %s (lo demás manda)', (texto, tipo) => {
    expect(clasificarRespuestaAlBot(texto)).toBe(tipo);
  });

  it.each([
    // Caso real 2026-10-20 07:19, con la cita a las 6:10 p. m.
    'Hola, es que en ventanilla me dijeron que a las 5:50 pl',
    'Me dieron la cita para las 3 de la tarde',
    'Tengo entendido que era el jueves',
    'pero me dijeron que era por la mañana',
    'Señorita, no era a las 7?',
    'me la dieron para el viernes a las 8 am',
  ])('«%s» → OTRA_HORA', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('OTRA_HORA');
  });

  it.each([
    ['me dijeron que llamara', null],
    // Lo que diga de no ir, de cambiarla o de que ya llegó manda.
    ['me dijeron que a las 5 pero no puedo ir', 'NO_ASISTIRA'],
    ['me dijeron que la puedo pasar para otro día', 'CAMBIAR'],
    ['ya llegué, me dijeron que a las 5:50', 'YA_LLEGO'],
    // De otro tema.
    ['me dijeron que la farmacia abre a las 7', null],
    ['Sí voy a las 6:10', 'CONFIRMA'],
  ])('«%s» → %s (no OTRA_HORA)', (texto, tipo) => {
    expect(clasificarRespuestaAlBot(texto)).toBe(tipo);
  });

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
    // Caso real 2026-10-17, contestadora de un estudio de tatuajes.
    'Hola! Soy Theo Tattoo, gracias por tu mensaje. Te daré respuesta tan pronto como sea posible. Gracias por tu paciencia.',
    'Te responderé en breve',
  ])('«%s» → RESPUESTA_AUTOMATICA (no se le contesta)', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('RESPUESTA_AUTOMATICA');
  });

  it.each([
    'Gracias por comunicarse, allá estaré',
    'Muchas gracias por el recordatorio',
    'Gracias por avisar, no puedo asistir',
    '¿Cuál es el horario de atención?',
    // Un paciente sí puede escribirlo: tomarlo por contestadora lo dejaría sin
    // respuesta y con el teléfono marcado.
    'le contesto mañana',
    'le contestaré mañana',
    'Gracias por su paciencia, allá estaré',
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

describe('clasificarRespuestaAlBot — 2026-10-22, primer día con agendar encendido', () => {
  it.each([
    'grasias', // …7954, tal cual
    'Grasias señorita',
    'la sita ya latengo para mañana', // …7954
    'una sita pero ya meladoeron', // …7954 («ya me la dieron»)
    'Ya tengo la cita',
    'ya me la dieron',
    'ya la tenemos',
  ])('«%s» → CONFIRMA', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).toBe('CONFIRMA');
  });

  it.each([
    'ya la tengo pero necesito otra cita', // pide otra: no es confirmar
    'ya no la tengo',
    '¿ya la tengo?',
  ])('«%s» → no es una confirmación', (texto) => {
    expect(clasificarRespuestaAlBot(texto)).not.toBe('CONFIRMA');
  });
});

describe('esAgradecimiento', () => {
  it.each([
    // Caso real 2026-10-17, después de cancelar: el «buen día» lo hacía pasar por un saludo.
    'Muchas gracias por su ayuda buen día 🙏',
    'Muchas gracias',
    'gracias señorita Dios le bendiga',
    'Les agradezco mucho, feliz tarde',
    'mil gracias por la atención, bendiciones',
  ])('«%s» → es solo un agradecimiento', (texto) => {
    expect(esAgradecimiento(texto)).toBe(true);
  });

  it.each([
    'gracias, ya llegué',
    'Gracias, pero quiero cancelar',
    'gracias?',
    'gracias doctora nos vemos el lunes',
    'buen día',
    'hola',
  ])('«%s» → no (pide, pregunta o no agradece)', (texto) => {
    expect(esAgradecimiento(texto)).toBe(false);
  });
});

describe('nombreQueNiega', () => {
  it.each([
    // Caso real 2026-10-17 16:06, tras el recordatorio a DARIO.
    ['hola yo no soy dario', 'dario'],
    ['No soy Darío', 'dario'],
    ['no soy la señora María', 'maria'],
    ['Disculpe, no soy don Jesús', 'jesus'],
  ])('«%s» → «%s»', (texto, nombre) => {
    expect(nombreQueNiega(texto)).toBe(nombre);
  });

  it.each([
    // Familia que comparte el teléfono: el número sí es del paciente.
    'no soy Darío, soy la hija',
    'No soy Dario, le escribe su esposa',
    'no soy ella, de parte de su mamá',
    // No es un nombre.
    'no soy de aquí',
    'yo no soy capaz de ir',
    'no soy el paciente',
    'Muchas gracias',
  ])('«%s» → null', (texto) => {
    expect(nombreQueNiega(texto)).toBeNull();
  });
});

describe('esMensajeAjeno', () => {
  it.each([
    // Caso real 2026-10-19, tras el recordatorio a otra paciente: dos mensajes.
    'Que pena esta equivocada',
    'Este mensaje no era para mi',
    'Buenas tardes, creo que se equivocaron',
    'Disculpe señora, está usted equivocada',
    'Equivocado',
    'Ese mensaje no es para mí, es para otra persona',
    'Esto no es conmigo',
    'Me llegó por error',
    // Caso real 2026-10-21 (la paciente es DEICY).
    'Yo no soy Deysi está equivocada',
  ])('«%s» → sí', (texto) => {
    expect(esMensajeAjeno(texto)).toBe(true);
  });

  it.each([
    // Familia que comparte el teléfono.
    'Este mensaje no es para mí, es para mi mamá',
    'No es para mí, es de mi abuela',
    'no era para mí, soy la hija',
    'No soy Deicy, soy la hija, está equivocada',
    'no soy de aquí, está equivocada',
    // Habla de su cita o de un dato de ella.
    'Están equivocados, mi cita es el jueves',
    'Está equivocada la hora',
    'El día está equivocado',
    'Está equivocado, ya me atendieron',
    'Ese horario no es para mí',
    'Este mensaje no es para mí, tengo cita el 20',
    // Lo contrario, o el error es suyo.
    'No, no está equivocada',
    'Ah perdón, estaba equivocada',
    'Estoy equivocada',
    'Muchas gracias',
  ])('«%s» → no', (texto) => {
    expect(esMensajeAjeno(texto)).toBe(false);
  });

  it('«grasias» (mal escrito) también es un agradecimiento', () => {
    expect(esAgradecimiento('grasias')).toBe(true);
    expect(esAgradecimiento('muchas grasias señorita')).toBe(true);
  });

  it('el clasificador solo no lo toma por número equivocado: falta el recordatorio', () => {
    expect(clasificarRespuestaAlBot('Que pena esta equivocada')).toBeNull();
    expect(clasificarRespuestaAlBot('Este mensaje no era para mi')).toBeNull();
  });
});

describe('esSoloSaludo', () => {
  it.each([
    // Caso real 2026-10-18, de quien tenía el teléfono de otra paciente.
    'Hola buenos dias',
    'Buenas tardes señorita, ¿cómo está?',
    'hola',
    'Buen día',
    'Holi, feliz día',
  ])('«%s» → sí', (texto) => {
    expect(esSoloSaludo(texto)).toBe(true);
  });

  it.each([
    'Hola, es que en ventanilla me dijeron que a las 5:50',
    'Hola feliz y bendecido 20 de octubre te apetece deleitar la carne en salsa criolla',
    'Hola buenos días, no puedo asistir',
    'Que pena esta equivocada',
    'Muchas gracias',
    'Señorita',
  ])('«%s» → no', (texto) => {
    expect(esSoloSaludo(texto)).toBe(false);
  });
});

describe('mismoNombre', () => {
  it.each([
    ['Deysi', 'DEICY'],
    ['Jhoana', 'Johana'],
    ['Darío', 'dario'],
    ['Valentina', 'Balentina'],
    ['Yuliana', 'Lluliana'],
  ])('«%s» y «%s» → sí', (a, b) => {
    expect(mismoNombre(a, b)).toBe(true);
  });

  it.each([
    ['Dario', 'Mario'],
    ['Ana', 'Ena'],
    ['Juan', 'Juana'],
    ['Al', 'Al'],
  ])('«%s» y «%s» → no', (a, b) => {
    expect(mismoNombre(a, b)).toBe(false);
  });
});
