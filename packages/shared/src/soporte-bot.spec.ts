import { DATO_OCULTO } from './alertas-tecnicas';
import {
  AJUSTES_SOPORTE_POR_DEFECTO,
  COMANDOS_SOPORTE,
  LIMITES_SOPORTE,
  TEXTOS_SOPORTE,
  accesoAlAsistente,
  conversacionVigente,
  datosDeBoton,
  enmascararCorreo,
  enmascararParaIA,
  esCodigoDeEnlace,
  esSoloSaludo,
  extraerCodigoCorto,
  flowStateDe,
  haySenalDeUrgencia,
  intentosRestantes,
  interpretarRespuestaCorta,
  leerBorrador,
  leerBoton,
  leerComando,
  leerRespuestaIA,
  prioridadDelCaso,
  siguienteBorrador,
  type BorradorCaso,
  type BotonSoporte,
  type CasoPropuesto,
} from './soporte-bot';

const AHORA = new Date('2026-10-19T15:00:00Z');
const enMin = (min: number) => new Date(AHORA.getTime() + min * 60_000);

describe('accesoAlAsistente (S2)', () => {
  it.each([
    ['ORG_ADMIN', 'PERSONAL'],
    ['BOOKING_AGENT', 'PERSONAL'],
    ['DOCTOR', 'PERSONAL'],
    ['GENERAL_OBSERVER', 'PERSONAL'],
    ['SUPER_ADMIN', 'PRUEBA'],
    ['PATIENT', 'NINGUNO'],
  ] as const)('%s → %s', (rol, acceso) => {
    expect(accesoAlAsistente(rol)).toBe(acceso);
  });
});

describe('valores por defecto', () => {
  it('coinciden con el plan y con SupportBotConfig', () => {
    expect(AJUSTES_SOPORTE_POR_DEFECTO).toEqual({
      conversationIdleMinutes: 30,
      maxMessagesPerHour: 40,
      maxMessageChars: 2000,
      maxAiTurnsPerOrgPerDay: 300,
    });
    expect(LIMITES_SOPORTE.codigoMinutos).toBe(10);
    expect(LIMITES_SOPORTE.maxIntentosCodigo).toBe(5);
    expect(LIMITES_SOPORTE.bloqueoMinutos).toBe(60);
  });
});

describe('extraerCodigoCorto', () => {
  it.each([
    ['482913', '482913'],
    ['  482913  ', '482913'],
    ['482 913', '482913'],
    ['482-913', '482913'],
    ['mi código es 482913', '482913'],
    ['Hola, mi código es el 482 913, gracias', '482913'],
  ])('«%s» → %s', (texto, codigo) => {
    expect(extraerCodigoCorto(texto)).toBe(codigo);
  });

  it.each([
    ['', 'vacío'],
    ['48291', 'cinco dígitos'],
    ['4829130', 'siete dígitos'],
    ['1053789456', 'una cédula'],
    ['4 8 2 9 1 3', 'dígitos sueltos'],
    ['tengo 2 citas a las 3:00 y 4:15', 'seis cifras que no son un código'],
    ['48 2913', 'grupos que no son de tres'],
    [
      'no me deja agendar a la paciente desde ayer 482913',
      'una pregunta larga con cifras',
    ],
  ])('«%s» no es un código (%s)', (texto) => {
    expect(extraerCodigoCorto(texto)).toBeNull();
  });
});

describe('esCodigoDeEnlace', () => {
  it('acepta base64url de 24 a 64', () => {
    expect(esCodigoDeEnlace('a'.repeat(24))).toBe(true);
    expect(esCodigoDeEnlace('Ab9_-'.repeat(12) + 'abcd')).toBe(true);
  });

  it.each([null, undefined, '', 'corto', 'a'.repeat(65), `${'a'.repeat(23)}!`])(
    'rechaza %p',
    (v) => {
      expect(esCodigoDeEnlace(v)).toBe(false);
    },
  );
});

describe('leerComando', () => {
  it.each([
    ['/start', { comando: 'start', argumento: null }],
    [
      '/start AbCdEf0123456789AbCdEf01',
      { comando: 'start', argumento: 'AbCdEf0123456789AbCdEf01' },
    ],
    ['/start@AgenIASoporteBot abc', { comando: 'start', argumento: 'abc' }],
    ['/Salir', { comando: 'salir', argumento: null }],
    ['  /casos  ', { comando: 'casos', argumento: null }],
    [
      '/nuevo no carga la agenda',
      { comando: 'nuevo', argumento: 'no carga la agenda' },
    ],
    ['/ayuda', { comando: 'ayuda', argumento: null }],
  ])('«%s»', (texto, esperado) => {
    expect(leerComando(texto)).toEqual(esperado);
  });

  it.each(['hola', '/borrar', 'start', '/ start'])(
    '«%s» no es un comando del asistente',
    (texto) => {
      expect(leerComando(texto)).toBeNull();
    },
  );

  it('publica casos, nuevo, ayuda y salir en el menú del bot', () => {
    expect(COMANDOS_SOPORTE.map((c) => c.comando)).toEqual([
      'casos',
      'nuevo',
      'ayuda',
      'salir',
    ]);
  });
});

describe('esSoloSaludo', () => {
  it.each(['hola', 'Hola!', 'buenos días', 'Buenas tardes 👋', 'HOLA BUENAS'])(
    '«%s» es solo un saludo',
    (t) => {
      expect(esSoloSaludo(t)).toBe(true);
    },
  );

  it.each([
    'hola, no me deja agendar',
    '¿cómo abro cupos?',
    'buenas, una pregunta',
  ])('«%s» trae algo más', (t) => {
    expect(esSoloSaludo(t)).toBe(false);
  });
});

describe('intentosRestantes', () => {
  it.each([
    [0, 5],
    [4, 1],
    [5, 0],
    [9, 0],
    [-3, 5],
  ])('%p fallos → %p', (fallos, quedan) => {
    expect(intentosRestantes(fallos)).toBe(quedan);
  });
});

describe('conversacionVigente', () => {
  it('abierta y con un mensaje hace menos de 30 minutos', () => {
    expect(
      conversacionVigente({ closedAt: null, lastMessageAt: AHORA }, enMin(29)),
    ).toBe(true);
  });

  it('se cierra sola a los 30 minutos sin mensajes', () => {
    expect(
      conversacionVigente({ closedAt: null, lastMessageAt: AHORA }, enMin(30)),
    ).toBe(false);
  });

  it('respeta los minutos configurados', () => {
    expect(
      conversacionVigente(
        { closedAt: null, lastMessageAt: AHORA },
        enMin(10),
        10,
      ),
    ).toBe(false);
    expect(
      conversacionVigente(
        { closedAt: null, lastMessageAt: AHORA },
        enMin(10),
        60,
      ),
    ).toBe(true);
  });

  it('cerrada es cerrada, aunque sea reciente', () => {
    expect(
      conversacionVigente({ closedAt: AHORA, lastMessageAt: AHORA }, AHORA),
    ).toBe(false);
  });
});

describe('enmascarar', () => {
  it('🔒 tapa cédulas, teléfonos y correos antes de la IA', () => {
    const t = enmascararParaIA(
      'La paciente 1.053.789.456 (tel 300 123 4567, ana@x.co) no aparece',
    );
    expect(t).not.toMatch(/1\.053|300 123|ana@x/);
    expect(t.split(DATO_OCULTO)).toHaveLength(4);
    expect(t).toContain('no aparece');
  });

  it('deja las horas, los números cortos y el número de un caso', () => {
    expect(enmascararParaIA('El caso #58 de las 10:30, 3 citas')).toBe(
      'El caso #58 de las 10:30, 3 citas',
    );
  });

  it('recorta al máximo', () => {
    expect(enmascararParaIA('x'.repeat(50), 10)).toHaveLength(10);
  });

  it('el correo de quien conversa se muestra a medias', () => {
    expect(enmascararCorreo('ana.perez@clinica.co')).toBe('a***@clinica.co');
    expect(enmascararCorreo('  b@x.co ')).toBe('b***@x.co');
    expect(enmascararCorreo('sin-arroba')).toBe('***');
    expect(enmascararCorreo('@x.co')).toBe('***');
  });
});

describe('leerRespuestaIA', () => {
  const temas = new Set(['agenda', 'soporte', 'glosario']);

  it('lee la respuesta completa', () => {
    const crudo = JSON.stringify({
      tipo: 'falla',
      respuesta: 'Entiendo, eso frena la atención.',
      temas: ['soporte'],
      urgencia: 'alta',
      caso: {
        titulo: 'No salen los recordatorios',
        descripcion: 'Desde las 7 no sale ningún recordatorio automático.',
        pantalla: '/dashboard/configuracion',
        falta: ['a cuántos pacientes afecta'],
      },
    });
    expect(leerRespuestaIA(crudo, temas)).toEqual({
      noCubierta: false,
      respuesta: {
        tipo: 'falla',
        respuesta: 'Entiendo, eso frena la atención.',
        temas: ['soporte'],
        urgencia: 'alta',
        caso: {
          titulo: 'No salen los recordatorios',
          descripcion: 'Desde las 7 no sale ningún recordatorio automático.',
          pantalla: '/dashboard/configuracion',
          falta: ['a cuántos pacientes afecta'],
        },
      },
    });
  });

  it('tolera ```json y texto alrededor', () => {
    const crudo =
      'Claro:\n```json\n{"tipo":"respuesta","respuesta":"Pulsa «Clonar Día».","temas":["agenda--guia-1"]}\n```';
    const r = leerRespuestaIA(crudo, temas);
    expect(r?.respuesta.temas).toEqual(['agenda--guia-1']);
    expect(r?.respuesta.urgencia).toBe('normal');
    expect(r?.respuesta.caso).toBeNull();
  });

  it('descarta temas inventados, repetidos o que no son texto, y se queda con 5', () => {
    const crudo = JSON.stringify({
      tipo: 'respuesta',
      respuesta: 'x',
      temas: [
        'agenda',
        'agenda',
        'inventado',
        7,
        'soporte',
        'glosario',
        'agenda--a',
        'agenda--b',
        'agenda--c',
      ],
    });
    expect(leerRespuestaIA(crudo, temas)?.respuesta.temas).toEqual([
      'agenda',
      'soporte',
      'glosario',
      'agenda--a',
      'agenda--b',
    ]);
  });

  it('una «respuesta» sin ningún tema válido del manual queda como no cubierta', () => {
    const r = leerRespuestaIA(
      '{"tipo":"respuesta","respuesta":"Creo que sí.","temas":["inventado"]}',
      temas,
    );
    expect(r?.noCubierta).toBe(true);
    expect(r?.respuesta.temas).toEqual([]);
  });

  it('un saludo o un tema ajeno sin citas no es «no cubierta»', () => {
    expect(
      leerRespuestaIA('{"tipo":"saludo","respuesta":"¡Hola!"}', temas)
        ?.noCubierta,
    ).toBe(false);
    expect(
      leerRespuestaIA(
        '{"tipo":"fuera_de_tema","respuesta":"No sé de fútbol."}',
        temas,
      )?.noCubierta,
    ).toBe(false);
  });

  it('un tipo desconocido se lee como respuesta (y sin citas, no cubierta)', () => {
    const r = leerRespuestaIA('{"tipo":"chiste","respuesta":"x"}', temas);
    expect(r?.respuesta.tipo).toBe('respuesta');
    expect(r?.noCubierta).toBe(true);
    expect(
      leerRespuestaIA('{"respuesta":"x","temas":["agenda"]}', temas)?.respuesta
        .tipo,
    ).toBe('respuesta');
    expect(
      leerRespuestaIA('{"tipo":" FALLA ","respuesta":"x"}', temas)?.respuesta
        .tipo,
    ).toBe('falla');
  });

  it.each([
    ['sin JSON', 'Lo siento, no puedo.'],
    ['JSON roto', '{"tipo": "respuesta", "respuesta": '],
    ['llaves al revés', '} {'],
    ['dos objetos seguidos', '{"respuesta":"a"} y {"respuesta":"b"}'],
    ['sin respuesta', '{"tipo":"respuesta","temas":["agenda"]}'],
    ['respuesta vacía', '{"tipo":"respuesta","respuesta":"   "}'],
    ['respuesta que no es texto', '{"respuesta": 42}'],
    ['null', 'null'],
  ])('%s → null (modo sin IA)', (_, crudo) => {
    expect(leerRespuestaIA(crudo, temas)).toBeNull();
  });

  it('si la IA envuelve el objeto en un arreglo, lee el objeto', () => {
    expect(
      leerRespuestaIA('[{"respuesta":"x","temas":["agenda"]}]', temas)
        ?.respuesta.respuesta,
    ).toBe('x');
  });

  it('recorta una respuesta desmedida', () => {
    const r = leerRespuestaIA(
      JSON.stringify({ respuesta: 'a'.repeat(5000), temas: ['agenda'] }),
      temas,
    );
    expect(r?.respuesta.respuesta).toHaveLength(
      LIMITES_SOPORTE.maxCaracteresRespuesta,
    );
    expect(r?.respuesta.respuesta.endsWith('…')).toBe(true);
  });

  it('limpia el caso propuesto: título corto, pantalla sin ruta, lo que falta', () => {
    const crudo = JSON.stringify({
      tipo: 'falla',
      respuesta: 'x',
      caso: {
        titulo: 'Mal',
        descripcion: '  ',
        pantalla: 'agenda',
        falta: ['uno', '', 2, 'dos', 'tres', 'cuatro', 'x'.repeat(200)],
      },
    });
    expect(leerRespuestaIA(crudo, temas)?.respuesta.caso).toEqual({
      titulo: null,
      descripcion: null,
      pantalla: null,
      falta: ['uno', 'dos', 'tres'],
    });
  });

  it('un título largo o con saltos se deja en una línea de 140', () => {
    const crudo = JSON.stringify({
      respuesta: 'x',
      caso: { titulo: `Uno\n\n${'y'.repeat(300)}`, falta: 'no es lista' },
    });
    const caso = leerRespuestaIA(crudo, temas)?.respuesta.caso;
    expect(caso?.titulo).toHaveLength(140);
    expect(caso?.titulo?.startsWith('Uno y')).toBe(true);
    expect(caso?.falta).toEqual([]);
  });

  it('un caso que no es objeto se ignora', () => {
    expect(
      leerRespuestaIA('{"respuesta":"x","caso":"abrir"}', temas)?.respuesta
        .caso,
    ).toBeNull();
    expect(
      leerRespuestaIA('{"respuesta":"x","caso":[1]}', temas)?.respuesta.caso,
    ).toBeNull();
  });
});

describe('prioridad del caso (S11)', () => {
  it.each([
    'Nadie puede agendar desde esta mañana',
    'no podemos agendar',
    'El bot no responde a los pacientes',
    'el asistente no está contestando',
    'No están saliendo los recordatorios',
    'las citas no llegan al hospital',
    'Se cayó el sistema',
    'el panel no carga',
  ])('«%s» es una señal de urgencia', (t) => {
    expect(haySenalDeUrgencia([t])).toBe(true);
  });

  it.each([
    '¿Cómo copio la agenda del lunes?',
    'No encuentro el botón de clonar',
    'no puedo cambiar mi contraseña',
    'el reporte de analíticas sale en cero',
  ])('«%s» no lo es', (t) => {
    expect(haySenalDeUrgencia([t])).toBe(false);
  });

  it('la IA propone y la señal fija confirma', () => {
    expect(
      prioridadDelCaso({ urgenciaIA: 'alta', textos: ['nadie puede agendar'] }),
    ).toBe('HIGH');
    expect(
      prioridadDelCaso({
        urgenciaIA: 'alta',
        textos: ['no encuentro un botón'],
      }),
    ).toBe('NORMAL');
    expect(
      prioridadDelCaso({
        urgenciaIA: 'normal',
        textos: ['nadie puede agendar'],
      }),
    ).toBe('NORMAL');
  });

  it('sin IA, basta la señal fija', () => {
    expect(
      prioridadDelCaso({
        urgenciaIA: null,
        textos: ['hola', 'el bot no responde'],
      }),
    ).toBe('HIGH');
    expect(prioridadDelCaso({ urgenciaIA: null, textos: ['hola'] })).toBe(
      'NORMAL',
    );
  });
});

describe('interpretarRespuestaCorta', () => {
  it.each([
    ['Sí', 'SI'],
    ['si, por favor', 'SI'],
    ['Dale!', 'SI'],
    ['ábrelo', 'SI'],
    ['ok gracias', 'SI'],
    ['👍', 'SI'],
    ['No', 'NO'],
    ['no, gracias', 'NO'],
    ['mejor no', 'NO'],
    ['👎', 'NO'],
    ['corregir algo', 'CORREGIR'],
    ['Quiero cambiar algo', 'CORREGIR'],
  ])('«%s» → %s', (t, r) => {
    expect(interpretarRespuestaCorta(t)).toBe(r);
  });

  it.each([
    'no puedo agendar',
    'sí, pero también falla la agenda',
    'no sé',
    '',
    '🙂',
  ])('«%s» no es una respuesta corta', (t) => {
    expect(interpretarRespuestaCorta(t)).toBeNull();
  });
});

describe('el borrador del caso: nunca se abre sin el «Sí» (S9)', () => {
  const completo: CasoPropuesto = {
    titulo: 'No salen los recordatorios',
    descripcion: 'Desde las 7 no sale ningún recordatorio automático.',
    pantalla: null,
    falta: [],
  };
  const propuesta = (caso: CasoPropuesto = completo, ahora = AHORA) =>
    siguienteBorrador(null, {
      tipo: 'PROPUESTA',
      caso,
      prioridad: 'HIGH',
      ahora,
    });

  it('un caso completo se muestra y espera la confirmación', () => {
    const r = propuesta();
    expect(r.accion).toBe('PEDIR_CONFIRMACION');
    expect(r.borrador).toEqual({
      ...completo,
      fase: 'CONFIRMANDO',
      prioridad: 'HIGH',
      creadoEn: AHORA.toISOString(),
      venceEn: null,
    });
  });

  it.each([
    ['falta un dato', { falta: ['desde cuándo pasa'] }],
    ['sin título', { titulo: null }],
    ['título corto', { titulo: 'Mal' }],
    ['sin descripción', { descripcion: null }],
    ['descripción corta', { descripcion: 'No sirve' }],
  ])('si %s, pregunta lo que falta', (_, cambio) => {
    const r = propuesta({ ...completo, ...cambio });
    expect(r.accion).toBe('PEDIR_DATOS');
    expect(r.borrador?.fase).toBe('RECOPILANDO');
  });

  it('«Sí» sobre el borrador mostrado: abrir el caso, una sola vez', () => {
    const { borrador } = propuesta();
    const si = siguienteBorrador(borrador, { tipo: 'SI', ahora: AHORA });
    expect(si).toEqual({ borrador: null, accion: 'ABRIR_CASO' });
    // Un segundo toque del botón ya no encuentra borrador.
    expect(
      siguienteBorrador(si.borrador, { tipo: 'SI', ahora: AHORA }),
    ).toEqual({ borrador: null, accion: 'NINGUNA' });
  });

  it('«Sí» cuando todavía falta algo: no abre, sigue preguntando', () => {
    const { borrador } = propuesta({
      ...completo,
      falta: ['a cuántos afecta'],
    });
    const r = siguienteBorrador(borrador, { tipo: 'SI', ahora: AHORA });
    expect(r.accion).toBe('PEDIR_DATOS');
    expect(r.borrador?.fase).toBe('RECOPILANDO');
  });

  it('«Sí» sobre un borrador que se dice CONFIRMANDO pero está incompleto: no abre', () => {
    const roto: BorradorCaso = { ...propuesta().borrador!, descripcion: null };
    expect(siguienteBorrador(roto, { tipo: 'SI', ahora: AHORA }).accion).toBe(
      'PEDIR_DATOS',
    );
  });

  it('«No» lo descarta; sin borrador, no hace nada', () => {
    expect(
      siguienteBorrador(propuesta().borrador, { tipo: 'NO', ahora: AHORA }),
    ).toEqual({
      borrador: null,
      accion: 'DESCARTAR',
    });
    expect(siguienteBorrador(null, { tipo: 'NO', ahora: AHORA }).accion).toBe(
      'NINGUNA',
    );
  });

  it('«Corregir» vuelve a recopilar', () => {
    const r = siguienteBorrador(propuesta().borrador, {
      tipo: 'CORREGIR',
      ahora: AHORA,
    });
    expect(r.accion).toBe('PEDIR_CORRECCION');
    expect(r.borrador?.fase).toBe('RECOPILANDO');
    expect(
      siguienteBorrador(null, { tipo: 'CORREGIR', ahora: AHORA }).accion,
    ).toBe('NINGUNA');
  });

  it('una nueva propuesta conserva cuándo empezó el borrador', () => {
    const primero = propuesta({ ...completo, falta: ['x'] });
    const despues = siguienteBorrador(primero.borrador, {
      tipo: 'PROPUESTA',
      caso: completo,
      prioridad: 'NORMAL',
      ahora: enMin(5),
    });
    expect(despues.borrador?.creadoEn).toBe(AHORA.toISOString());
    expect(despues.borrador?.prioridad).toBe('NORMAL');
  });

  it('al cerrarse la conversación sobrevive 24 h y se retoma con el siguiente código', () => {
    const cerrada = siguienteBorrador(propuesta().borrador, {
      tipo: 'CONVERSACION_CERRADA',
      ahora: AHORA,
    });
    expect(cerrada.accion).toBe('NINGUNA');
    expect(cerrada.borrador?.venceEn).toBe(enMin(24 * 60).toISOString());

    const retomada = siguienteBorrador(cerrada.borrador, {
      tipo: 'RETOMAR',
      ahora: enMin(60),
    });
    expect(retomada.accion).toBe('OFRECER_RETOMAR');
    expect(retomada.borrador?.venceEn).toBeNull();
    expect(
      siguienteBorrador(retomada.borrador, { tipo: 'SI', ahora: enMin(61) })
        .accion,
    ).toBe('ABRIR_CASO');
  });

  it('pasadas las 24 h ya no se retoma ni se abre', () => {
    const cerrada = siguienteBorrador(propuesta().borrador, {
      tipo: 'CONVERSACION_CERRADA',
      ahora: AHORA,
    });
    const tarde = enMin(24 * 60);
    expect(
      siguienteBorrador(cerrada.borrador, { tipo: 'RETOMAR', ahora: tarde }),
    ).toEqual({
      borrador: null,
      accion: 'NINGUNA',
    });
    expect(
      siguienteBorrador(cerrada.borrador, { tipo: 'SI', ahora: tarde }).accion,
    ).toBe('NINGUNA');
  });

  it('cerrar o retomar sin borrador no hace nada', () => {
    expect(
      siguienteBorrador(null, { tipo: 'CONVERSACION_CERRADA', ahora: AHORA }),
    ).toEqual({
      borrador: null,
      accion: 'NINGUNA',
    });
    expect(
      siguienteBorrador(null, { tipo: 'RETOMAR', ahora: AHORA }).accion,
    ).toBe('NINGUNA');
  });
});

describe('leerBorrador y flowStateDe', () => {
  const b: BorradorCaso = {
    fase: 'CONFIRMANDO',
    titulo: 'No salen los recordatorios',
    descripcion: 'Desde las 7 no sale ningún recordatorio automático.',
    pantalla: '/dashboard',
    falta: [],
    prioridad: 'NORMAL',
    creadoEn: AHORA.toISOString(),
    venceEn: enMin(60).toISOString(),
  };

  it('ida y vuelta por el JSON de la base', () => {
    expect(leerBorrador(JSON.parse(JSON.stringify(flowStateDe(b))))).toEqual(b);
    expect(flowStateDe(null)).toBeNull();
  });

  it('un vencimiento ilegible queda como sin vencimiento', () => {
    expect(
      leerBorrador({ borrador: { ...b, venceEn: 'mañana' } })?.venceEn,
    ).toBeNull();
  });

  it.each([
    ['nada', null],
    ['un arreglo', []],
    ['sin borrador', {}],
    ['borrador que no es objeto', { borrador: 'x' }],
    ['fase desconocida', { borrador: { ...b, fase: 'ABIERTO' } }],
    ['prioridad desconocida', { borrador: { ...b, prioridad: 'URGENTE' } }],
    ['sin fecha de creación', { borrador: { ...b, creadoEn: undefined } }],
    ['fecha de creación ilegible', { borrador: { ...b, creadoEn: 'ayer' } }],
  ])('%s → null (mejor volver a preguntar)', (_, json) => {
    expect(leerBorrador(json)).toBeNull();
  });
});

describe('botones', () => {
  const todos: BotonSoporte[] = [
    { accion: 'CASO_SI' },
    { accion: 'CASO_NO' },
    { accion: 'CASO_CORREGIR' },
    { accion: 'CASO_IGUAL' },
    { accion: 'UTIL_SI' },
    { accion: 'UTIL_NO' },
    { accion: 'AVISO_BIEN', caso: 58 },
    { accion: 'AVISO_SIGUE', caso: 58 },
    { accion: 'AVISO_VER', caso: 123456789 },
    {
      accion: 'INCIDENTE_AVISAR',
      alerta: '6f1c2a9e-1d2b-4c3d-9e8f-0a1b2c3d4e5f',
    },
  ];

  it.each(todos)('ida y vuelta: %p, en menos de 64 bytes', (b) => {
    const datos = datosDeBoton(b);
    expect(Buffer.byteLength(datos)).toBeLessThanOrEqual(64);
    expect(leerBoton(datos)).toEqual(b);
  });

  it.each([
    'otro:CASO_SI',
    's1',
    's1:',
    's1:BORRAR_TODO',
    's1:CASO_SI:58',
    's1:AVISO_BIEN',
    's1:AVISO_BIEN:0',
    's1:AVISO_BIEN:-3',
    's1:AVISO_BIEN:5.5',
    's1:AVISO_BIEN:1234567890',
    's1:INCIDENTE_AVISAR',
    's1:INCIDENTE_AVISAR:<script>',
    's1:AVISO_BIEN:58:extra',
  ])('«%s» no es un botón válido', (datos) => {
    expect(leerBoton(datos)).toBeNull();
  });
});

describe('textos fijos', () => {
  it('pide el código y explica dónde está', () => {
    expect(TEXTOS_SOPORTE.pedirCodigo).toContain('código de 6 dígitos');
    expect(TEXTOS_SOPORTE.pedirCodigo).toContain('Soporte');
  });

  it('cuenta los intentos que quedan', () => {
    expect(TEXTOS_SOPORTE.codigoIncorrecto(1)).toContain('Te queda 1 intento;');
    expect(TEXTOS_SOPORTE.codigoIncorrecto(3)).toContain(
      'Te quedan 3 intentos;',
    );
    expect(TEXTOS_SOPORTE.bloqueado(60)).toContain('60 minutos');
  });

  it('confirma con qué cuenta quedó la conversación, con el correo a medias', () => {
    expect(
      TEXTOS_SOPORTE.conversacionAbierta({
        nombre: 'Ana',
        rol: 'Agente de Reservas',
        clinica: 'Hospital de Prueba',
        correo: 'ana.perez@clinica.co',
        prueba: false,
      }),
    ).toBe(
      'Listo, Ana. Hablas como Agente de Reservas de Hospital de Prueba (a***@clinica.co). Si no fuiste tú, escribe /salir.',
    );
    expect(
      TEXTOS_SOPORTE.conversacionAbierta({
        nombre: null,
        rol: 'Equipo de AgenIA',
        clinica: 'Hospital de Prueba',
        correo: 'yo@agenia.co',
        prueba: true,
      }),
    ).toBe(
      'Listo. Hablas como Equipo de AgenIA de Hospital de Prueba (y***@agenia.co). Si no fuiste tú, escribe /salir. Modo prueba: los casos se simulan.',
    );
  });

  it('los textos con datos los incluyen', () => {
    expect(TEXTOS_SOPORTE.mensajeLargo(2000)).toContain('2000 caracteres');
    expect(TEXTOS_SOPORTE.casoSimulado('Falla X')).toContain('«Falla X»');
  });
});
