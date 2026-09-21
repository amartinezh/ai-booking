import {
  analizarConversacion,
  coincideConCaptura,
  derivarCancelacion,
  elegirConfirmacion,
  etiquetaActorPersonal,
  etiquetaMedico,
  filasDeConversacion,
  hayCaptura,
  mapearEspera,
  normalizarTexto,
  saludDelEspejo,
  type FilaLog,
  type FilaMensaje,
} from './evidencia';

const T = (min: number) => new Date(Date.UTC(2026, 8, 21, 15, 0) + min * 60_000);

describe('elegirConfirmacion', () => {
  const m = (status: FilaMensaje['status'], min = 0, extra: Partial<FilaMensaje> = {}): FilaMensaje => ({
    status,
    createdAt: T(min),
    statusAt: T(min + 1),
    errorCode: null,
    errorDetail: null,
    ...extra,
  });

  it('sin mensajes → null', () => {
    expect(elegirConfirmacion([])).toBeNull();
  });

  it('elige la de mejor estado: READ > DELIVERED > SENT > ACCEPTED > FAILED', () => {
    for (const [lista, esperado] of [
      [['FAILED', 'ACCEPTED', 'SENT'], 'SENT'],
      [['SENT', 'DELIVERED', 'ACCEPTED'], 'DELIVERED'],
      [['DELIVERED', 'READ'], 'READ'],
      [['FAILED', 'ACCEPTED'], 'ACCEPTED'],
    ] as const) {
      expect(elegirConfirmacion(lista.map((s, i) => m(s, i)))?.status).toBe(esperado);
    }
  });

  it('🎤 un audio fallido NO tapa el texto que sí llegó (modo voz)', () => {
    const r = elegirConfirmacion([m('FAILED', 0, { errorDetail: 'audio caído' }), m('DELIVERED', 1)]);
    expect(r?.status).toBe('DELIVERED');
    expect(r?.errorDetalle).toBeNull();
  });

  it('a igual estado, la más reciente', () => {
    const r = elegirConfirmacion([m('DELIVERED', 0), m('DELIVERED', 9)]);
    expect(r?.enviadoIso).toBe(T(9).toISOString());
  });

  it('si todas fallaron, FAILED con el detalle de Meta; sin detalle, el código', () => {
    expect(elegirConfirmacion([m('FAILED', 0, { errorDetail: 'sin ventana' })])?.errorDetalle).toBe('sin ventana');
    expect(elegirConfirmacion([m('FAILED', 0, { errorCode: '131047' })])?.errorDetalle).toBe('código 131047');
  });
});

describe('analizarConversacion', () => {
  const log = (min: number, status: string, over: Partial<FilaLog> = {}): FilaLog => ({
    createdAt: T(min),
    status,
    failureReason: null,
    userMessage: null,
    botReply: null,
    metadata: null,
    ...over,
  });

  it('cuenta, fecha y resume el último resultado', () => {
    const a = analizarConversacion([log(0, 'SUCCESS'), log(5, 'SUCCESS'), log(9, 'BOOKING_CONFIRMED', { metadata: { appointmentId: 'apt-1' } })]);
    expect(a.resumen).toMatchObject({
      mensajes: 3,
      primerMensajeIso: T(0).toISOString(),
      ultimoMensajeIso: T(9).toISOString(),
      ultimoResultado: 'CONFIRMADA',
    });
  });

  it('recoge las citas que el bot confirmó', () => {
    const a = analizarConversacion([log(1, 'BOOKING_CONFIRMED', { metadata: { appointmentId: 'apt-1' } }), log(2, 'BOOKING_CONFIRMED', { metadata: { appointmentId: 'apt-2' } })]);
    expect([...a.confirmadas].sort()).toEqual(['apt-1', 'apt-2']);
  });

  it('un BOOKING_CONFIRMED sin appointmentId no rompe ni cuenta', () => {
    const a = analizarConversacion([log(1, 'BOOKING_CONFIRMED', { metadata: { otra: 1 } }), log(2, 'BOOKING_CONFIRMED', { metadata: null })]);
    expect(a.confirmadas.size).toBe(0);
  });

  it('fallos y abandonos, el más reciente primero, con su motivo', () => {
    const a = analizarConversacion([
      log(1, 'FAILED', { failureReason: 'SLOT_TAKEN' }),
      log(9, 'ABANDONED'),
      log(5, 'SUCCESS'),
    ]);
    expect(a.resumen.fallos).toEqual([
      { motivo: 'ABANDONED', atIso: T(9).toISOString() },
      { motivo: 'SLOT_TAKEN', atIso: T(1).toISOString() },
    ]);
    expect(a.resumen.ultimoResultado).toBe('ABANDONADA');
  });

  it('las cancelaciones que hizo el paciente por WhatsApp, con su hora', () => {
    const a = analizarConversacion([log(4, 'SUCCESS', { metadata: { event: 'APPOINTMENT_CANCELLED', appointmentId: 'apt-9' } })]);
    expect(a.canceladasPorPaciente.get('apt-9')).toEqual(T(4));
  });

  it('un estado no mapeado es OTRO; sin logs no hay resultado', () => {
    expect(analizarConversacion([log(1, 'REMINDER_SENT')]).resumen.ultimoResultado).toBe('OTRO');
    expect(analizarConversacion([]).resumen).toMatchObject({ mensajes: 0, ultimoResultado: null, primerMensajeIso: null });
  });

  it('metadata que no es un objeto se ignora', () => {
    const a = analizarConversacion([log(1, 'SUCCESS', { metadata: 'texto' }), log(2, 'SUCCESS', { metadata: [1, 2] })]);
    expect(a.confirmadas.size).toBe(0);
    expect(a.canceladasPorPaciente.size).toBe(0);
  });
});

describe('filasDeConversacion', () => {
  it('más nuevo primero, con el texto de las dos partes, y con tope', () => {
    const logs: FilaLog[] = Array.from({ length: 5 }, (_, i) => ({
      createdAt: T(i),
      status: 'SUCCESS',
      failureReason: null,
      userMessage: `p${i}`,
      botReply: `b${i}`,
      metadata: null,
    }));
    const filas = filasDeConversacion(logs, 3);
    expect(filas).toHaveLength(3);
    expect(filas[0]).toMatchObject({ paciente: 'p4', bot: 'b4' });
    expect(filas[2].paciente).toBe('p2');
  });
});

describe('derivarCancelacion', () => {
  it('el hospital: metaLog.cancelledBy=MIRROR, con motivo y hora de la auditoría', () => {
    expect(derivarCancelacion({ metaLog: { cancelledBy: 'MIRROR', reason: 'PACIENTE LLAMA A CANCELAR' }, auditoriaHisEn: T(3) })).toEqual({
      por: 'HIS',
      atIso: T(3).toISOString(),
      motivo: 'PACIENTE LLAMA A CANCELAR',
    });
  });

  it('el hospital sin motivo cae a las observaciones, y sin nada a null', () => {
    expect(derivarCancelacion({ metaLog: { cancelledBy: 'MIRROR', reason: '  ', observations: 'obs' } }).motivo).toBe('obs');
    expect(derivarCancelacion({ metaLog: { cancelledBy: 'MIRROR' } })).toMatchObject({ por: 'HIS', atIso: null, motivo: null });
  });

  it('el paciente por WhatsApp: hay un log de cancelación', () => {
    expect(derivarCancelacion({ metaLog: null, canceladaPorPacienteEn: T(7) })).toEqual({
      por: 'PACIENTE_WHATSAPP',
      atIso: T(7).toISOString(),
      motivo: null,
    });
  });

  it('el hospital gana sobre un log de paciente (metaLog es la fuente más fuerte)', () => {
    expect(derivarCancelacion({ metaLog: { cancelledBy: 'MIRROR' }, canceladaPorPacienteEn: T(7) }).por).toBe('HIS');
  });

  it('sin rastro (una cancelación del panel ANTERIOR a que se guardara la constancia) → DESCONOCIDO', () => {
    expect(derivarCancelacion({ metaLog: null })).toEqual({ por: 'DESCONOCIDO', atIso: null, motivo: null });
  });

  describe('el personal desde el panel (metaLog.cancelledBy = STAFF)', () => {
    const constancia = { cancelledBy: 'STAFF', cancelledByUserId: 'u-1', cancelledByRole: 'BOOKING_AGENT', cancelledAt: T(12).toISOString() };

    it('quién y cuándo salen de la constancia', () => {
      expect(derivarCancelacion({ metaLog: constancia, actorPersonal: 'agente de reservas · agente@a.co' })).toEqual({
        por: 'PERSONAL',
        atIso: T(12).toISOString(),
        motivo: null,
        actor: 'agente de reservas · agente@a.co',
      });
    });

    it('sin actor redactado, cae al ROL (nunca queda vacío ni expone una identidad)', () => {
      expect(derivarCancelacion({ metaLog: constancia }).actor).toBe('agente de reservas');
    });

    it('🚨 la constancia gana sobre el log de WhatsApp: metaLog es la fuente más fuerte', () => {
      expect(derivarCancelacion({ metaLog: constancia, canceladaPorPacienteEn: T(3) }).por).toBe('PERSONAL');
    });

    it('el hospital gana sobre el personal si por algún motivo trajera ambas marcas (MIRROR se evalúa primero)', () => {
      expect(derivarCancelacion({ metaLog: { ...constancia, cancelledBy: 'MIRROR' } }).por).toBe('HIS');
    });

    it('una constancia con la fecha ilegible sigue siendo del personal, sin inventar la hora', () => {
      const r = derivarCancelacion({ metaLog: { ...constancia, cancelledAt: 'basura' } });
      expect(r).toMatchObject({ por: 'PERSONAL', atIso: null });
    });
  });
});

describe('la captura', () => {
  // 2026-09-22 10:00 en Bogotá = 15:00 UTC
  const cita = { startIso: '2026-09-22T15:00:00.000Z', doctor: 'Dr(a). María Núñez', service: 'Medicina General' };

  it('sin datos → null (no se indicó captura)', () => {
    expect(coincideConCaptura(cita, undefined, 'America/Bogota')).toBeNull();
    expect(coincideConCaptura(cita, {}, 'America/Bogota')).toBeNull();
    expect(coincideConCaptura(cita, { fecha: ' ', hora: '', medico: '  ' }, 'America/Bogota')).toBeNull();
    expect(hayCaptura({ medico: 'x' })).toBe(true);
    expect(hayCaptura(null)).toBe(false);
  });

  it.each([
    ['fecha y hora exactas', { fecha: '2026-09-22', hora: '10:00' }, true],
    ['solo la fecha', { fecha: '2026-09-22' }, true],
    ['solo la hora', { hora: '10:00' }, true],
    ['otra hora', { fecha: '2026-09-22', hora: '11:00' }, false],
    ['otra fecha', { fecha: '2026-09-23', hora: '10:00' }, false],
    ['el médico sin tildes ni mayúsculas', { medico: 'maria nunez' }, true],
    ['el servicio también cuenta', { medico: 'medicina general' }, true],
    ['otro médico', { medico: 'pedro' }, false],
    ['todo junto y correcto', { fecha: '2026-09-22', hora: '10:00', medico: 'NÚÑEZ' }, true],
    ['todo junto con UN dato malo', { fecha: '2026-09-22', hora: '10:00', medico: 'pedro' }, false],
  ])('%s → %s', (_n, captura, esperado) => {
    expect(coincideConCaptura(cita, captura, 'America/Bogota')).toBe(esperado);
  });

  it('la fecha se compara en la zona de la CLÍNICA, no en UTC', () => {
    // 03:00 UTC del 23 es aún las 22:00 del 22 en Bogotá.
    const tarde = { ...cita, startIso: '2026-09-23T03:00:00.000Z' };
    expect(coincideConCaptura(tarde, { fecha: '2026-09-22' }, 'America/Bogota')).toBe(true);
    expect(coincideConCaptura(tarde, { fecha: '2026-09-23' }, 'America/Bogota')).toBe(false);
  });

  it('una fecha de cita inválida no coincide', () => {
    expect(coincideConCaptura({ ...cita, startIso: 'basura' }, { hora: '10:00' }, 'America/Bogota')).toBe(false);
  });

  it('normalizarTexto quita tildes y pasa a minúsculas', () => {
    expect(normalizarTexto('  ÁNGELA Núñez ')).toBe('angela nunez');
  });
});

describe('mapearEspera y saludDelEspejo', () => {
  it('mapea la lista de espera con el nombre del servicio', () => {
    expect(mapearEspera([{ status: 'NOTIFIED', createdAt: T(0), notifiedAt: T(5), service: { name: 'Cardiología' } }])).toEqual([
      { status: 'NOTIFIED', servicio: 'Cardiología', desdeIso: T(0).toISOString(), avisadoIso: T(5).toISOString() },
    ]);
    expect(mapearEspera([{ status: 'WAITING', createdAt: T(0), notifiedAt: null, service: null }])[0].servicio).toBe('un servicio');
  });

  it('sin configuración de espejo → null (la clínica no lo tiene)', () => {
    expect(saludDelEspejo(null)).toBeNull();
  });

  it('mapea la configuración', () => {
    expect(
      saludDelEspejo({ enabled: true, pushEnabled: false, pullEnabled: true, lastHeartbeatAt: T(0), lastHisReachable: false, lastHisDetail: 'x' }),
    ).toEqual({ enabled: true, pushEnabled: false, pullEnabled: true, lastHeartbeatIso: T(0).toISOString(), hisReachable: false, hisDetail: 'x' });
    expect(saludDelEspejo({ enabled: true, pushEnabled: true, pullEnabled: true, lastHeartbeatAt: null, lastHisReachable: null, lastHisDetail: null })?.lastHeartbeatIso).toBeNull();
  });
});

describe('etiquetaMedico', () => {
  it('una persona lleva honorífico; una agenda funcional no', () => {
    expect(etiquetaMedico('Juan Pérez')).toBe('Dr(a). Juan Pérez');
    expect(etiquetaMedico('MEDICO ATENCIÓN HTA 2', true)).toBe('MEDICO ATENCIÓN HTA 2');
  });
  it('un nombre vacío no deja un honorífico suelto', () => {
    expect(etiquetaMedico('  ')).toBe('');
    expect(etiquetaMedico(null)).toBe('');
  });
});

describe('etiquetaActorPersonal', () => {
  it.each([
    ['ORG_ADMIN', 'administrador'],
    ['BOOKING_AGENT', 'agente de reservas'],
    ['DOCTOR', 'médico'],
    ['SUPER_ADMIN', 'súper administrador'],
  ])('%s se dice "%s"', (rol, texto) => {
    expect(etiquetaActorPersonal(rol, null)).toBe(texto);
  });

  it('con identidad la agrega después del rol', () => {
    expect(etiquetaActorPersonal('BOOKING_AGENT', 'agente@a.co')).toBe('agente de reservas · agente@a.co');
  });

  it('un rol desconocido o ausente es "personal": no inventa uno', () => {
    expect(etiquetaActorPersonal('ROL_FUTURO', null)).toBe('personal');
    expect(etiquetaActorPersonal(null, null)).toBe('personal');
    expect(etiquetaActorPersonal(undefined, 'x@y.co')).toBe('personal · x@y.co');
  });
});
