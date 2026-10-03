import {
  citasHisNuevas,
  LIMITES_CONSULTA_BOT,
  ventanaConsultaBot,
  diaLocal,
  estadoConexionHis,
  inicioDelDiaLocal,
  remitenteEsDelPaciente,
  type ConfigConexionHis,
} from './consulta-citas';
import {
  LIMITES_CONSULTA_HIS,
  documentosDelPaciente,
  type CitaHisVista,
} from './his-lookup';

const AHORA = new Date('2026-10-02T15:00:00Z');
const haceMin = (min: number) => new Date(AHORA.getTime() - min * 60_000);

const viva: ConfigConexionHis = {
  enabled: true,
  lookupEnabled: true,
  lastLookupCapable: true,
  lastHeartbeatAt: haceMin(1),
  lastHisReachable: true,
};

describe('estadoConexionHis', () => {
  it('sin configuración de espejo → SIN_HOSPITAL', () => {
    expect(estadoConexionHis(null, AHORA)).toEqual({
      estado: 'SIN_HOSPITAL',
      motivo: 'SIN_ESPEJO',
      minutosSinLatido: null,
    });
    expect(estadoConexionHis(undefined, AHORA).estado).toBe('SIN_HOSPITAL');
  });

  it('todo en orden → VIVA', () => {
    expect(estadoConexionHis(viva, AHORA)).toEqual({
      estado: 'VIVA',
      motivo: null,
      minutosSinLatido: 1,
    });
  });

  it.each<[string, Partial<ConfigConexionHis>, string, string]>([
    ['espejo apagado', { enabled: false }, 'APAGADA', 'ESPEJO_DESHABILITADO'],
    ['consulta apagada', { lookupEnabled: false }, 'APAGADA', 'CONSULTA_DESHABILITADA'],
    ['nunca latió', { lastHeartbeatAt: null }, 'CAIDA', 'SIN_LATIDO'],
    ['latido viejo', { lastHeartbeatAt: haceMin(4) }, 'CAIDA', 'LATIDO_VIEJO'],
    ['HIS inalcanzable', { lastHisReachable: false }, 'CAIDA', 'HIS_INALCANZABLE'],
    ['agente sin la función', { lastLookupCapable: false }, 'CAIDA', 'AGENTE_SIN_CONSULTA'],
    ['agente que no lo reporta', { lastLookupCapable: null }, 'CAIDA', 'AGENTE_SIN_CONSULTA'],
  ])('%s', (_caso, cambio, estado, motivo) => {
    const r = estadoConexionHis({ ...viva, ...cambio }, AHORA);
    expect(r.estado).toBe(estado);
    expect(r.motivo).toBe(motivo);
  });

  it('el umbral del latido es el de la consulta en vivo (justo en el borde sigue VIVA)', () => {
    const borde = haceMin(LIMITES_CONSULTA_HIS.latidoMaxMin);
    expect(estadoConexionHis({ ...viva, lastHeartbeatAt: borde }, AHORA).estado).toBe('VIVA');
  });

  it('el espejo apagado gana aunque el agente también esté caído', () => {
    const r = estadoConexionHis(
      { ...viva, enabled: false, lastHeartbeatAt: null },
      AHORA,
    );
    expect(r.motivo).toBe('ESPEJO_DESHABILITADO');
  });

  it('un HIS con estado desconocido (null) no tumba la conexión', () => {
    expect(estadoConexionHis({ ...viva, lastHisReachable: null }, AHORA).estado).toBe('VIVA');
  });
});

describe('remitenteEsDelPaciente', () => {
  const ficha = { whatsappId: null, bsuid: null, telegramChatId: null };

  it('WhatsApp: mismo teléfono, con o sin el 57 en cualquiera de los dos lados', () => {
    expect(
      remitenteEsDelPaciente(
        { ...ficha, whatsappId: '573001112233' },
        { phone: '573001112233', bsuid: null },
      ),
    ).toBe(true);
    expect(
      remitenteEsDelPaciente(
        { ...ficha, whatsappId: '3001112233' },
        { phone: '573001112233', bsuid: null },
      ),
    ).toBe(true);
    expect(
      remitenteEsDelPaciente(
        { ...ficha, whatsappId: '+57 300 111 2233' },
        { phone: '3001112233', bsuid: null },
      ),
    ).toBe(true);
  });

  it('WhatsApp: otro teléfono → no', () => {
    expect(
      remitenteEsDelPaciente(
        { ...ficha, whatsappId: '573009998877' },
        { phone: '573001112233', bsuid: null },
      ),
    ).toBe(false);
  });

  it('WhatsApp con número oculto: mismo BSUID', () => {
    expect(
      remitenteEsDelPaciente(
        { ...ficha, bsuid: 'CO.123' },
        { phone: null, bsuid: 'CO.123' },
      ),
    ).toBe(true);
    expect(
      remitenteEsDelPaciente(
        { ...ficha, bsuid: 'CO.999' },
        { phone: null, bsuid: 'CO.123' },
      ),
    ).toBe(false);
  });

  it('el BSUID sirve aunque el teléfono no coincida (la ficha se guardó con el número oculto)', () => {
    expect(
      remitenteEsDelPaciente(
        { ...ficha, bsuid: 'CO.123', whatsappId: null },
        { phone: '573001112233', bsuid: 'CO.123' },
      ),
    ).toBe(true);
  });

  it('Telegram: solo el mismo chat; nunca se compara con el teléfono', () => {
    expect(
      remitenteEsDelPaciente(
        { ...ficha, telegramChatId: '555' },
        { phone: null, bsuid: null, telegramChatId: '555' },
      ),
    ).toBe(true);
    expect(
      remitenteEsDelPaciente(
        { ...ficha, whatsappId: '3001112233', telegramChatId: null },
        { phone: null, bsuid: null, telegramChatId: '3001112233' },
      ),
    ).toBe(false);
  });

  it('falla cerrado: sin nada con qué comparar → no', () => {
    expect(remitenteEsDelPaciente(ficha, { phone: null, bsuid: null })).toBe(false);
    expect(
      remitenteEsDelPaciente(ficha, { phone: '573001112233', bsuid: null }),
    ).toBe(false);
    // Un identificador que no es teléfono (PSID de 5 dígitos) no cuenta como tal.
    expect(
      remitenteEsDelPaciente(
        { ...ficha, whatsappId: '12345' },
        { phone: '12345', bsuid: null },
      ),
    ).toBe(false);
  });
});

describe('diaLocal / inicioDelDiaLocal', () => {
  it('a las 8 p. m. de Bogotá ya es el día siguiente en UTC, pero sigue siendo hoy', () => {
    const noche = new Date('2026-10-03T01:00:00Z'); // 2 oct, 8 p. m. en Bogotá
    expect(diaLocal(noche)).toBe('2026-10-02');
    expect(inicioDelDiaLocal(noche).toISOString()).toBe('2026-10-02T05:00:00.000Z');
  });

  it('acepta otra zona (multi-tenant)', () => {
    const t = new Date('2026-10-02T23:30:00Z');
    expect(diaLocal(t, 'Europe/Madrid')).toBe('2026-10-03');
    expect(inicioDelDiaLocal(t, 'Europe/Madrid').toISOString()).toBe(
      '2026-10-02T22:00:00.000Z',
    );
  });
});

describe('documentosDelPaciente', () => {
  it('el documento y, si difiere, sin ceros a la izquierda', () => {
    expect(documentosDelPaciente('1088123456')).toEqual(['1088123456']);
    expect(documentosDelPaciente('0012345')).toEqual(['0012345', '12345']);
    expect(documentosDelPaciente('  ')).toEqual([]);
  });
});

describe('ventanaConsultaBot', () => {
  it('de hoy a medianoche (Bogotá) a 60 días', () => {
    const { desde, hasta } = ventanaConsultaBot(AHORA);
    expect(desde.toISOString()).toBe('2026-10-02T05:00:00.000Z');
    expect((hasta.getTime() - desde.getTime()) / 86_400_000).toBe(
      LIMITES_CONSULTA_BOT.diasAdelante,
    );
  });
});

describe('citasHisNuevas', () => {
  const DESDE = new Date('2026-10-02T05:00:00Z');
  // Horas NO redondas: el HIS guarda minutos, AgenIA segundos y milisegundos.
  const cita = (over: Partial<CitaHisVista> = {}): CitaHisVista => ({
    doctorExternalKey: 'MED-1',
    startIso: '2026-10-05T14:30:00.000Z',
    serviceExternalKey: 'SRV-1',
    status: 'SCHEDULED',
    titular: 'PACIENTE',
    documentoTercero: null,
    ...over,
  });

  it('una cita del HIS que AgenIA no tiene → nueva', () => {
    expect(citasHisNuevas([cita()], [], DESDE)).toHaveLength(1);
  });

  it('la misma cita (mismo médico, misma hora al minuto) no se repite', () => {
    const conocida = {
      startIso: '2026-10-05T14:30:27.412Z',
      doctorExternalKey: 'MED-1',
    };
    expect(citasHisNuevas([cita()], [conocida], DESDE)).toEqual([]);
  });

  it('misma hora con OTRO médico sí es otra cita', () => {
    const conocida = {
      startIso: '2026-10-05T14:30:00.000Z',
      doctorExternalKey: 'MED-2',
    };
    expect(citasHisNuevas([cita()], [conocida], DESDE)).toHaveLength(1);
  });

  it('si el médico de AgenIA no está homologado, basta la hora (mejor callar que duplicar)', () => {
    const conocida = {
      startIso: '2026-10-05T14:30:00.000Z',
      doctorExternalKey: null,
    };
    expect(citasHisNuevas([cita()], [conocida], DESDE)).toEqual([]);
  });

  it('🔒 nunca filas de un tercero; sí el mismo documento con ceros distintos', () => {
    const r = citasHisNuevas(
      [
        cita({ titular: 'OTRO', documentoTercero: '•••9999' }),
        cita({ titular: 'SIN_DOCUMENTO', startIso: '2026-10-06T14:30:00.000Z' }),
        cita({ titular: 'MISMO_CON_CEROS', startIso: '2026-10-07T14:30:00.000Z' }),
      ],
      [],
      DESDE,
    );
    expect(r.map((c) => c.titular)).toEqual(['MISMO_CON_CEROS']);
  });

  it('solo vigentes y desde el inicio de la ventana', () => {
    const r = citasHisNuevas(
      [
        cita({ status: 'ATTENDED' }),
        cita({ status: 'NO_SHOW', startIso: '2026-10-06T14:30:00.000Z' }),
        cita({ startIso: '2026-10-01T14:30:00.000Z' }),
      ],
      [],
      DESDE,
    );
    expect(r).toEqual([]);
  });

  it('la misma cita devuelta dos veces por el HIS sale una vez, y en orden', () => {
    const tarde = cita({ startIso: '2026-10-09T20:00:00.000Z' });
    const r = citasHisNuevas(
      [tarde, cita(), cita({ titular: 'MISMO_CON_CEROS' })],
      [],
      DESDE,
    );
    expect(r.map((c) => c.startIso)).toEqual([
      '2026-10-05T14:30:00.000Z',
      '2026-10-09T20:00:00.000Z',
    ]);
  });
});
