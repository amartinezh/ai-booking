import {
  CUERPO_SUGERIDO_COMUNICADO,
  claveDeBaja,
  codigoDeErrorMeta,
  estimarDuracion,
  explicarErrorDeEnvio,
  intencionDeComunicados,
  proximaVentanaDeComunicados,
  puedeEnviarComunicadoAhora,
  variablesDelCuerpo,
} from './mensajes-masivos-envio';

/** Una hora de Bogotá (UTC-5) como instante. */
const bogota = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00-05:00`);

describe('horario de la Ley 2300 de 2023', () => {
  it('de lunes a viernes de 7:00 a 19:00', () => {
    // 2026-11-05 es jueves.
    expect(puedeEnviarComunicadoAhora(bogota('2026-11-05', '06:59'))).toBe(false);
    expect(puedeEnviarComunicadoAhora(bogota('2026-11-05', '07:00'))).toBe(true);
    expect(puedeEnviarComunicadoAhora(bogota('2026-11-05', '18:59'))).toBe(true);
    expect(puedeEnviarComunicadoAhora(bogota('2026-11-05', '19:00'))).toBe(false);
  });

  it('el sábado de 8:00 a 15:00; el domingo nunca', () => {
    expect(puedeEnviarComunicadoAhora(bogota('2026-11-07', '07:30'))).toBe(false);
    expect(puedeEnviarComunicadoAhora(bogota('2026-11-07', '08:00'))).toBe(true);
    expect(puedeEnviarComunicadoAhora(bogota('2026-11-07', '15:00'))).toBe(false);
    expect(puedeEnviarComunicadoAhora(bogota('2026-11-08', '10:00'))).toBe(false);
  });

  it('los festivos tampoco (16 de noviembre de 2026: Independencia de Cartagena)', () => {
    expect(puedeEnviarComunicadoAhora(bogota('2026-11-16', '10:00'))).toBe(false);
  });

  it('fuera del horario espera a la próxima apertura', () => {
    // Sábado a las 16:00 → domingo no, lunes 9 a las 7:00.
    expect(proximaVentanaDeComunicados(bogota('2026-11-07', '16:00')).toISOString()).toBe(bogota('2026-11-09', '07:00').toISOString());
    // Domingo 15 → lunes 16 festivo → martes 17.
    expect(proximaVentanaDeComunicados(bogota('2026-11-15', '10:00')).toISOString()).toBe(bogota('2026-11-17', '07:00').toISOString());
    const ahora = bogota('2026-11-05', '10:00');
    expect(proximaVentanaDeComunicados(ahora)).toBe(ahora);
  });

  it('estimarDuracion cuenta solo el horario permitido', () => {
    // 600 a 60 por minuto = 10 minutos, empezando a las 18:55 de un jueves: 5 hoy y 5 el viernes desde las 7.
    const e = estimarDuracion(600, 60, bogota('2026-11-05', '18:55'));
    expect(e.minutos).toBe(10);
    expect(e.terminaria.toISOString()).toBe(bogota('2026-11-06', '07:05').toISOString());
  });
});

describe('intencionDeComunicados', () => {
  it.each([
    'No más comunicados',
    'NO MÁS COMUNICADOS',
    'stop',
    'Stop promotions',
    'No quiero más mensajes',
    'ya no quiero recibir más comunicados de la clínica',
    'Dejen de enviarme mensajes',
    'no me envíen más mensajes',
    'darme de baja de los comunicados',
  ])('«%s» es una baja', (t) => {
    expect(intencionDeComunicados(t)).toBe('BAJA');
  });

  it.each(['activar comunicados', 'Quiero volver a recibir los comunicados'])('«%s» es un alta', (t) => {
    expect(intencionDeComunicados(t)).toBe('ALTA');
  });

  it.each(['no quiero más recordatorios', 'baja', 'salir', 'no', 'quiero una cita', 'no quiero la cita', ''])('«%s» no es de comunicados', (t) => {
    expect(intencionDeComunicados(t)).toBeNull();
  });

  it('la frase del cuerpo sugerido de la plantilla funciona', () => {
    expect(CUERPO_SUGERIDO_COMUNICADO).toContain('NO MÁS COMUNICADOS');
    expect(intencionDeComunicados('NO MÁS COMUNICADOS')).toBe('BAJA');
  });
});

describe('claveDeBaja', () => {
  it('un teléfono con «+», un BSUID tal cual', () => {
    expect(claveDeBaja('573001234567')).toBe('+573001234567');
    expect(claveDeBaja('+573001234567')).toBe('+573001234567');
    expect(claveDeBaja('CO.13491208655302741918')).toBe('CO.13491208655302741918');
  });
});

describe('errores de Meta', () => {
  it('saca el código del JSON que devuelve Meta', () => {
    const json = JSON.stringify({ error: { message: '(#131026) Message undeliverable', type: 'OAuthException', code: 131026, fbtrace_id: 'x' } });
    expect(codigoDeErrorMeta(json)).toBe('131026');
    expect(codigoDeErrorMeta('{"error":{"code":100,"error_subcode":2494010}}')).toBe('100');
    expect(codigoDeErrorMeta('131049')).toBe('131049');
  });

  it('explica cada error y dice si detiene el envío', () => {
    expect(explicarErrorDeEnvio('{"error":{"code":131026}}')).toMatchObject({ reintentable: false, detieneElEnvio: false });
    expect(explicarErrorDeEnvio('{"error":{"code":132001}}')).toMatchObject({ detieneElEnvio: true });
    expect(explicarErrorDeEnvio('{"error":{"code":190}}').motivo).toContain('token');
    expect(explicarErrorDeEnvio('template-not-configured')).toMatchObject({ detieneElEnvio: true });
    expect(explicarErrorDeEnvio('timeout of 30000ms exceeded')).toMatchObject({ reintentable: true });
    expect(explicarErrorDeEnvio('{"error":{"code":999999}}').motivo).toContain('999999');
  });
});

describe('variablesDelCuerpo', () => {
  it('cuenta las variables distintas', () => {
    expect(variablesDelCuerpo(CUERPO_SUGERIDO_COMUNICADO)).toBe(2);
    expect(variablesDelCuerpo('{{1}} y {{1}}')).toBe(1);
  });
});
