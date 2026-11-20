import {
  AUTORIZACION_DATOS,
  ERROR_CASILLA_AUTORIZACION,
  autorizacionAceptada,
  autorizacionRechazada,
  autorizacionRetirada,
  autorizacionSinRespuesta,
  avisoAutorizacionDatos,
  avisoAutorizacionDatosHablado,
  cifrasDeAutorizaciones,
  normalizarVersionPolitica,
  pideRetirarAutorizacion,
  recordatorioAutorizacionDatos,
  respuestaAutorizacion,
  textoCasillaAutorizacion,
  validarUrlPolitica,
  validarVersionPolitica,
  type FilaAutorizacion,
} from './autorizacion-datos';

describe('respuestaAutorizacion — el SÍ/NO de la autorización es estricto', () => {
  it.each([
    'Sí',
    'si',
    'SI ACEPTO',
    'Acepto.',
    'Autorizo',
    'sí, autorizo',
    'ok',
    'Ok listo',
    'Bueno',
    'Claro que sí',
    'De acuerdo',
    'estoy de acuerdo',
    'Doy mi autorización',
    'Sí señorita, acepto',
    'siii',
    'Dale',
    'Vale',
    'Perfecto',
    'Está bien',
    'Sí, no hay problema',
    '👍',
    ' ✅ ',
    '👌',
  ])('«%s» es SÍ', (t) => {
    expect(respuestaAutorizacion(t)).toBe('SI');
  });

  it.each([
    'No',
    'no.',
    'NO ACEPTO',
    'No autorizo',
    'no estoy de acuerdo',
    'No gracias',
    'nunca',
    'Negativo',
    'no quiero',
    'Para nada',
    'Sí... bueno no, no acepto',
  ])('«%s» es NO', (t) => {
    expect(respuestaAutorizacion(t)).toBe('NO');
  });

  it.each([
    'quiero una cita',
    'Hola',
    'Buenas tardes, necesito cita para medicina general',
    'no entiendo',
    'No sé qué es eso',
    '¿qué datos?',
    '',
    '   ',
    '🙂',
  ])('«%s» no es una respuesta: se atiende como un mensaje más', (t) => {
    expect(respuestaAutorizacion(t)).toBeNull();
  });

  it('sin texto, nada', () => {
    expect(respuestaAutorizacion(null)).toBeNull();
    expect(respuestaAutorizacion(undefined)).toBeNull();
  });
});

describe('pideRetirarAutorizacion — frases fijas', () => {
  it.each([
    'Retiro mi autorización',
    'quiero retirar mi autorización de datos',
    'Revoco la autorización para el tratamiento de mis datos',
    'revocar consentimiento',
    'cancelar mi autorización',
    'Quiero que borren mis datos',
    'eliminen mis datos personales por favor',
    'No autorizo el tratamiento de mis datos',
    'ya no autorizo el uso de mis datos personales',
    'Solicito suprimir mis datos',
  ])('«%s» pide retirarla', (t) => {
    expect(pideRetirarAutorizacion(t)).toBe(true);
  });

  it.each([
    'cancelar cita',
    'no quiero recordatorios',
    'no más comunicados',
    'quiero borrar mi cita',
    'No',
    'autorizo',
    'retirar la cita',
    '',
  ])('«%s» no', (t) => {
    expect(pideRetirarAutorizacion(t)).toBe(false);
  });

  it('sin texto, no', () => {
    expect(pideRetirarAutorizacion(null)).toBe(false);
  });
});

describe('textos', () => {
  const base = {
    asistente: 'Vicente',
    clinica: 'Hospital San Vicente',
    urlPolitica: 'https://hospital.gov.co/datos',
  };

  it('el aviso formal: saludo, finalidad, datos sensibles facultativos, derechos, ley, enlace y pregunta', () => {
    const t = avisoAutorizacionDatos({ ...base, estilo: 'FORMAL' });
    expect(t).toContain('Le saluda *Vicente*');
    expect(t).toContain('Hospital San Vicente');
    expect(t).toMatch(/hijos menores/);
    expect(t).toMatch(/no está obligado\(a\)/);
    expect(t).toMatch(/retirar esta autorización/);
    expect(t).toContain('Ley 1581 de 2012');
    expect(t).toContain('https://hospital.gov.co/datos');
    expect(t).toMatch(/Responda \*SÍ\* o \*NO\*/);
  });

  it('el aviso informal tutea y sin enlace no deja la línea', () => {
    const t = avisoAutorizacionDatos({ ...base, estilo: 'INFORMAL', urlPolitica: null });
    expect(t).toContain('Soy *Vicente*');
    expect(t).toMatch(/no estás obligado/);
    expect(t).not.toContain('📄');
    expect(t).toMatch(/Responde \*SÍ\* o \*NO\*/);
  });

  it('el audio es corto y remite al texto', () => {
    for (const estilo of ['FORMAL', 'INFORMAL'] as const) {
      const t = avisoAutorizacionDatosHablado({ ...base, estilo });
      expect(t).toMatch(/por escrito/);
      expect(t).not.toContain('https://');
    }
  });

  it('el recordatorio repite la pregunta y ofrece las otras gestiones', () => {
    for (const estilo of ['FORMAL', 'INFORMAL'] as const) {
      const t = recordatorioAutorizacionDatos(estilo, base.urlPolitica);
      expect(t).toMatch(/\*SÍ\* o \*NO\*/);
      expect(t).toMatch(/cancelar, cambiar o consultar/);
      expect(t).toContain(base.urlPolitica);
    }
    expect(recordatorioAutorizacionDatos('FORMAL', null)).not.toContain('📄');
  });

  it('aceptada, rechazada, sin respuesta y retirada, en los dos tonos', () => {
    const contacto = 'el hospital al *606 853 8860*';
    expect(autorizacionAceptada('FORMAL')).toContain('su autorización');
    expect(autorizacionAceptada('INFORMAL')).toContain('tu autorización');
    for (const estilo of ['FORMAL', 'INFORMAL'] as const) {
      expect(autorizacionRechazada(estilo, contacto)).toContain(contacto);
      expect(autorizacionRechazada(estilo, contacto)).toMatch(/ventanilla/);
      expect(autorizacionSinRespuesta(estilo, contacto)).toContain(contacto);
      expect(autorizacionRetirada(estilo, contacto)).toContain(contacto);
      expect(autorizacionRetirada(estilo, contacto)).toMatch(/cancelar cita/);
    }
  });

  it('la casilla de los formularios', () => {
    expect(textoCasillaAutorizacion('Hospital X')).toMatch(/^Autorizo a Hospital X/);
    expect(ERROR_CASILLA_AUTORIZACION).toMatch(/casilla/);
  });
});

describe('configuración', () => {
  it('normalizarVersionPolitica', () => {
    expect(normalizarVersionPolitica('2')).toBe('2');
    expect(normalizarVersionPolitica('  2026-11  ')).toBe('2026-11');
    expect(normalizarVersionPolitica('')).toBe(AUTORIZACION_DATOS.VERSION_POR_DEFECTO);
    expect(normalizarVersionPolitica(null)).toBe('1');
    expect(normalizarVersionPolitica(3)).toBe('1');
    expect(normalizarVersionPolitica('x'.repeat(21))).toBe('1');
  });

  it('validarVersionPolitica', () => {
    expect(validarVersionPolitica(' 2 ')).toEqual({ ok: true, version: '2' });
    expect(validarVersionPolitica('v1.2 nov-2026')).toEqual({ ok: true, version: 'v1.2 nov-2026' });
    expect(validarVersionPolitica('')).toMatchObject({ ok: false });
    expect(validarVersionPolitica(null)).toMatchObject({ ok: false });
    expect(validarVersionPolitica('x'.repeat(21))).toMatchObject({ ok: false, error: expect.stringMatching(/20/) });
    expect(validarVersionPolitica('<v1>')).toMatchObject({ ok: false });
  });

  it('validarUrlPolitica', () => {
    expect(validarUrlPolitica('')).toEqual({ ok: true, url: null });
    expect(validarUrlPolitica(undefined)).toEqual({ ok: true, url: null });
    expect(validarUrlPolitica(' https://h.gov.co/datos ')).toEqual({ ok: true, url: 'https://h.gov.co/datos' });
    expect(validarUrlPolitica('http://h.co')).toEqual({ ok: true, url: 'http://h.co' });
    expect(validarUrlPolitica('h.gov.co/datos')).toMatchObject({ ok: false });
    expect(validarUrlPolitica('javascript:alert(1)')).toMatchObject({ ok: false });
    expect(validarUrlPolitica('https://h.co/a b')).toMatchObject({ ok: false });
    expect(validarUrlPolitica(`https://h.co/${'a'.repeat(300)}`)).toMatchObject({ ok: false });
  });
});

describe('cifrasDeAutorizaciones', () => {
  const ahora = new Date('2026-11-20T20:00:00Z');
  const hace = (min: number) => new Date(ahora.getTime() - min * 60_000);
  const fila = (o: Partial<FilaAutorizacion>): FilaAutorizacion => ({
    estado: 'ACCEPTED',
    remitente: '573001',
    canal: 'WHATSAPP',
    preguntadaEn: hace(300),
    respondidaEn: hace(299),
    ...o,
  });

  it('sin filas, todo en cero', () => {
    const c = cifrasDeAutorizaciones([], ahora);
    expect(c).toMatchObject({ preguntadas: 0, aceptaron: 0, porcentajeAceptacion: null, porDia: [] });
  });

  it('cada persona cuenta una vez por lo último que respondió', () => {
    const c = cifrasDeAutorizaciones(
      [
        // Dijo NO y después SÍ: aceptó, y volvió.
        fila({ remitente: 'a', estado: 'REJECTED', preguntadaEn: hace(3000), respondidaEn: hace(2999) }),
        fila({ remitente: 'a', estado: 'ACCEPTED', preguntadaEn: hace(100), respondidaEn: hace(99) }),
        fila({ remitente: 'b', estado: 'REJECTED' }),
        // Sin respuesta y la conversación ya cerró.
        fila({ remitente: 'c', estado: 'PENDING', respondidaEn: null, preguntadaEn: hace(120) }),
        // Se le acaba de preguntar.
        fila({ remitente: 'd', estado: 'PENDING', respondidaEn: null, preguntadaEn: hace(5), canal: 'TELEGRAM' }),
        fila({ remitente: 'e', canal: 'TELEGRAM' }),
        // El retiro va aparte.
        fila({ remitente: 'e', canal: 'TELEGRAM', estado: 'REVOKED', preguntadaEn: hace(10), respondidaEn: hace(10) }),
      ],
      ahora,
      'America/Bogota',
    );
    expect(c).toMatchObject({
      preguntadas: 5,
      aceptaron: 2,
      noAceptaron: 1,
      sinRespuesta: 1,
      esperando: 1,
      retiraron: 1,
      volvieronYAceptaron: 1,
      porcentajeAceptacion: 66.7,
    });
    expect(c.porCanal.WHATSAPP).toEqual({ preguntadas: 3, aceptaron: 1, noAceptaron: 1, sinRespuesta: 1, esperando: 0 });
    expect(c.porCanal.TELEGRAM).toEqual({ preguntadas: 2, aceptaron: 1, noAceptaron: 0, sinRespuesta: 0, esperando: 1 });
  });

  it('por día, en la zona de la clínica', () => {
    const c = cifrasDeAutorizaciones(
      [
        // 3:30 UTC del 20 = 22:30 del 19 en Bogotá.
        fila({ preguntadaEn: new Date('2026-11-20T03:30:00Z'), respondidaEn: new Date('2026-11-20T03:31:00Z') }),
        fila({ remitente: 'x', estado: 'REJECTED', preguntadaEn: new Date('2026-11-20T15:00:00Z'), respondidaEn: new Date('2026-11-20T15:01:00Z') }),
      ],
      ahora,
      'America/Bogota',
    );
    expect(c.porDia).toEqual([
      { dia: '2026-11-19', preguntas: 1, aceptaron: 1, noAceptaron: 0 },
      { dia: '2026-11-20', preguntas: 1, aceptaron: 0, noAceptaron: 1 },
    ]);
  });

  it('sin zona usa la de Colombia', () => {
    const c = cifrasDeAutorizaciones([fila({ preguntadaEn: new Date('2026-11-20T03:30:00Z'), respondidaEn: new Date('2026-11-20T03:31:00Z') })], ahora);
    expect(c.porDia[0].dia).toBe('2026-11-19');
  });
});
