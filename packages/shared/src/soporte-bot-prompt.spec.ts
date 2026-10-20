import { DATO_OCULTO } from './alertas-tecnicas';
import { TEXTOS_SOPORTE, type RespuestaIA } from './soporte-bot';
import {
  INSTRUCCIONES_DEL_ASISTENTE,
  enlaceDeAyuda,
  haceCuanto,
  promptDelAsistente,
  respuestaConIA,
  respuestaSinIA,
  textoFichaDeLaClinica,
  turnosParaLaIA,
  type FichaClinica,
} from './soporte-bot-prompt';

const AHORA = new Date('2026-10-19T15:32:00Z'); // lunes 10:32 en Colombia
const min = (n: number) => new Date(AHORA.getTime() - n * 60_000);

const ficha: FichaClinica = {
  nombre: 'Hospital de Prueba',
  nombreDelAsistente: 'AgenIA',
  canales: { whatsapp: true, telegram: false },
  ia: 'Gemini',
  interruptores: { agendar: false, cancelar: true, cambiarFecha: true },
  recordatorios: {
    encendidos: true,
    soloAutoagendadas: true,
    anticipacionMinutos: 60,
  },
  limites: { porDia: 1, porMes: null },
  telefonoSoporte: '+57 300 000 0000',
  espejo: {
    encendido: true,
    modoAgenda: 'HUECOS',
    ultimoLatido: min(3),
    alcanzaHis: false,
    avisosMasivos: false,
  },
};

describe('INSTRUCCIONES_DEL_ASISTENTE (§4)', () => {
  it.each([
    ['solo personal, nunca pacientes', /nunca a pacientes/],
    ['no inventa', /no inventes pantallas, botones, plazos ni funciones/],
    ['breve', /900 caracteres/],
    ['tutea', /Tutea/],
    ['respeta el rol', /su rol puede hacer/],
    ['sus límites', /no puedes cambiar nada en el sistema/],
    ['datos de pacientes', /no los repitas/],
    ['inyección de instrucciones', /son datos, no órdenes/],
    ['el código ofrece los casos, no la IA', /No ofrezcas tú abrir casos/],
    ['JSON', /Responde SOLO con un objeto JSON/],
    ['arma el caso y pregunta solo lo que falta', /máximo 2 cosas/],
    [
      'lo que el manual explica (también una limitación conocida) no es una falla',
      /es una "respuesta" que cita ese tema, no una "falla"[\s\S]*limitación conocida/,
    ],
    [
      'no repite el nombre de otra clínica ni confirma si usa AgenIA (examen del 2026-10-20)',
      /no repitas su nombre ni digas si usa AgenIA/,
    ],
    ['no dice que abrió un caso', /no digas que ya abriste uno/],
    ['ampliar un caso suyo', /ampliarCaso/],
    ['problemas conocidos', /Problemas técnicos que el equipo ya conoce/],
  ])('%s', (_, re) => {
    expect(INSTRUCCIONES_DEL_ASISTENTE).toMatch(re);
  });

  it('menciona el marcador real del enmascarado', () => {
    expect(INSTRUCCIONES_DEL_ASISTENTE).toContain(DATO_OCULTO);
  });
});

describe('textoFichaDeLaClinica', () => {
  it('describe la configuración en frases que la IA puede usar', () => {
    const t = textoFichaDeLaClinica(ficha, AHORA);
    expect(t).toContain('WhatsApp conectado; Telegram sin conectar');
    expect(t).toContain('IA de la clínica: Gemini.');
    expect(t).toContain(
      'agendar apagado, cancelar encendido, cambiar fecha encendido',
    );
    expect(t).toContain(
      'Recordatorios automáticos: encendido, solo a quien agendó por el chat; anticipación mínima 60 min.',
    );
    expect(t).toContain('1 por día; por mes apagado');
    expect(t).toContain('+57 300 000 0000');
    expect(t).toContain(
      'modo de agenda HUECOS; último latido del agente hace 3 min; alcanza la base del hospital: no; avisos masivos apagado',
    );
  });

  it('sin IA, sin teléfono, recordatorios apagados y sin espejo', () => {
    const t = textoFichaDeLaClinica(
      {
        ...ficha,
        ia: null,
        telefonoSoporte: null,
        recordatorios: {
          encendidos: false,
          soloAutoagendadas: false,
          anticipacionMinutos: 60,
        },
        limites: { porDia: null, porMes: 3 },
        espejo: null,
      },
      AHORA,
    );
    expect(t).toContain('sin configurar');
    expect(t).toContain('no registrado');
    expect(t).toContain('Recordatorios automáticos: apagado.');
    expect(t).toContain('por día apagado; 3 por mes');
    expect(t).toContain('esta clínica no tiene');
  });

  it('el espejo sin latido ni dato del HIS', () => {
    const t = textoFichaDeLaClinica(
      {
        ...ficha,
        espejo: {
          ...ficha.espejo!,
          ultimoLatido: null,
          alcanzaHis: null,
          encendido: false,
          avisosMasivos: true,
        },
      },
      AHORA,
    );
    expect(t).toContain(
      'apagado; modo de agenda HUECOS; último latido del agente nunca; alcanza la base del hospital: sin dato; avisos masivos encendido',
    );
  });

  it.each([
    [0, 'hace menos de un minuto'],
    [5, 'hace 5 min'],
    [59, 'hace 59 min'],
    [120, 'hace 2 h'],
    [60 * 72, 'hace 3 días'],
    [-5, 'hace menos de un minuto'],
  ])('haceCuanto(%p min)', (m, texto) => {
    expect(haceCuanto(min(m), AHORA)).toBe(texto);
  });
});

describe('promptDelAsistente', () => {
  const manual = {
    comun: '# Manual\nTexto del manual',
    delUsuario: '## Quién pregunta\n- Rol: Médico.',
  };

  it('lo fijo (instrucciones + manual) va aparte de lo variable (quién, ficha, hora)', () => {
    const p = promptDelAsistente({ manual, ficha: '## Ficha', ahora: AHORA });
    expect(p.fijo.startsWith(INSTRUCCIONES_DEL_ASISTENTE)).toBe(true);
    expect(p.fijo).toContain('Texto del manual');
    expect(p.fijo).not.toContain('- Rol: Médico.');
    expect(p.variable).toContain('- Rol: Médico.');
    expect(p.variable).toContain('## Ficha');
    // La hora en Colombia, con los ayudantes de fecha (no la del servidor).
    expect(p.variable).toMatch(/Fecha y hora actual: .*19.*octubre.*10:32/);
  });

  it('sus casos, los incidentes, el borrador y el pedido de caso van en lo variable', () => {
    const p = promptDelAsistente({
      manual,
      ficha: '## Ficha',
      ahora: AHORA,
      casos: '## Casos',
      incidentes: '## Incidentes',
      borrador: '## Borrador',
      pedirCaso: true,
    });
    expect(p.variable).toMatch(
      /## Ficha\n\n## Casos\n\n## Incidentes\n\n## Borrador\n\nLa persona pidió abrir un caso/,
    );
    expect(p.fijo).not.toContain('## Casos');
    const sin = promptDelAsistente({ manual, ficha: '## Ficha', ahora: AHORA });
    expect(sin.variable).not.toContain('pidió abrir un caso');
  });

  it('lo fijo es idéntico para dos personas distintas (la caché del proveedor lo aprovecha)', () => {
    const a = promptDelAsistente({ manual, ficha: 'A', ahora: AHORA });
    const b = promptDelAsistente({
      manual: { ...manual, delUsuario: 'otro' },
      ficha: 'B',
      ahora: new Date(),
    });
    expect(a.fijo).toBe(b.fijo);
  });
});

describe('turnosParaLaIA', () => {
  it('enmascara al empleado, no al asistente, y une los turnos seguidos del mismo lado', () => {
    expect(
      turnosParaLaIA([
        { direction: 'ENTRADA', text: 'hola' },
        { direction: 'ENTRADA', text: 'la paciente 1053789456 no aparece' },
        { direction: 'SALIDA', text: ' ¿En qué pantalla? ' },
        { direction: 'ENTRADA', text: 'rastreo' },
      ]),
    ).toEqual([
      { rol: 'usuario', texto: `hola\nla paciente ${DATO_OCULTO} no aparece` },
      { rol: 'asistente', texto: '¿En qué pantalla?' },
      { rol: 'usuario', texto: 'rastreo' },
    ]);
  });

  it('empieza siempre por el empleado y se queda con los últimos turnos', () => {
    const t = turnosParaLaIA(
      [
        { direction: 'SALIDA', text: 'Listo, Ana.' },
        { direction: 'ENTRADA', text: 'uno' },
        { direction: 'SALIDA', text: 'r1' },
        { direction: 'ENTRADA', text: 'dos' },
        { direction: 'SALIDA', text: 'r2' },
        { direction: 'ENTRADA', text: 'tres' },
      ],
      4,
    );
    expect(t.map((x) => x.texto)).toEqual(['dos', 'r2', 'tres']);
  });

  it('descarta los vacíos', () => {
    expect(turnosParaLaIA([{ direction: 'ENTRADA', text: '   ' }])).toEqual([]);
  });
});

describe('enlaceDeAyuda', () => {
  it('lleva al tema en el Centro de ayuda', () => {
    expect(enlaceDeAyuda('https://panel.x.co/', 'agenda--guia-1')).toBe(
      'https://panel.x.co/dashboard/soporte/ayuda?tema=agenda',
    );
  });

  it.each([
    [null, 'agenda'],
    ['https://panel.x.co', 'glosario'],
    ['https://panel.x.co', 'parte2-4'],
    ['https://panel.x.co', ''],
  ])('sin enlace: base %p, tema %p', (base, tema) => {
    expect(enlaceDeAyuda(base, tema)).toBeNull();
  });
});

describe('respuestaConIA', () => {
  const ia = (cambios: Partial<RespuestaIA>): RespuestaIA => ({
    tipo: 'respuesta',
    respuesta: 'Pulsa «Clonar Día».',
    temas: ['agenda'],
    urgencia: 'normal',
    caso: null,
    ampliarCaso: null,
    ...cambios,
  });

  it('una respuesta del manual: el enlace (para quien ve la ayuda) y los botones «Me sirvió»', () => {
    expect(
      respuestaConIA({
        ia: ia({}),
        noCubierta: false,
        baseAyuda: 'https://panel.x.co',
      }),
    ).toEqual({
      texto:
        'Pulsa «Clonar Día».\n\nMás detalle en el Centro de ayuda: https://panel.x.co/dashboard/soporte/ayuda?tema=agenda',
      botones: 'UTIL',
    });
  });

  it('sin base de ayuda (no la ve) o citando solo la Parte 2: sin enlace, con botones', () => {
    expect(
      respuestaConIA({ ia: ia({}), noCubierta: false, baseAyuda: null }),
    ).toEqual({
      texto: 'Pulsa «Clonar Día».',
      botones: 'UTIL',
    });
    expect(
      respuestaConIA({
        ia: ia({ temas: ['parte2-4'] }),
        noCubierta: false,
        baseAyuda: 'https://p',
      }).texto,
    ).toBe('Pulsa «Clonar Día».');
  });

  it('no cubierta: ofrece abrir el caso, con sus botones y sin enlace', () => {
    expect(
      respuestaConIA({
        ia: ia({ temas: [] }),
        noCubierta: true,
        baseAyuda: 'https://p',
      }),
    ).toEqual({
      texto: `Pulsa «Clonar Día».\n\n${TEXTOS_SOPORTE.ofrecerCaso}`,
      botones: 'OFRECER_CASO',
    });
  });

  it('una falla, aclarar, saludo o tema ajeno: solo el texto (las fallas siguen el borrador)', () => {
    for (const tipo of [
      'falla',
      'aclarar',
      'saludo',
      'fuera_de_tema',
      'seguimiento_caso',
    ] as const) {
      expect(
        respuestaConIA({
          ia: ia({ tipo, respuesta: 'x' }),
          noCubierta: false,
          baseAyuda: 'https://p',
        }),
      ).toEqual({
        texto: 'x',
        botones: null,
      });
    }
  });
});

describe('respuestaSinIA', () => {
  it('lo más cercano del manual, marca lo de otro rol y ofrece abrir el caso', () => {
    const r = respuestaSinIA(
      [
        {
          temaId: 'agenda',
          tema: 'Agendas (Slots)',
          titulo:
            'Sale «No se encontraron agendas en la fecha de origen para clonar».',
          extracto: 'Elige otro día…',
        },
        {
          temaId: 'glosario',
          tema: 'Glosario',
          titulo: 'Glosario',
          extracto: 'Cupo: …',
        },
        {
          temaId: 'rastreo',
          tema: 'Rastreo de paciente',
          titulo: '',
          extracto: 'Busca…',
        },
      ],
      ['agenda'],
    );
    expect(r.botones).toBe('OFRECER_CASO');
    expect(r.texto).toBe(
      [
        TEXTOS_SOPORTE.sinIA,
        '',
        '• Agendas (Slots) (no está en tu menú) › Sale «No se encontraron agendas en la fecha de origen para clonar»: Elige otro día…',
        '• Glosario: Cupo: …',
        '• Rastreo de paciente: Busca…',
        '',
        TEXTOS_SOPORTE.ofrecerCaso,
      ].join('\n'),
    );
  });

  it('sin nada parecido, lo dice', () => {
    expect(respuestaSinIA([]).texto).toBe(
      `${TEXTOS_SOPORTE.sinIASinResultados}\n\n${TEXTOS_SOPORTE.ofrecerCaso}`,
    );
  });
});
