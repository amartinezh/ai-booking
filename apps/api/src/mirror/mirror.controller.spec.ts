import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MirrorController } from './mirror.controller';
import { MirrorDispatchService } from './mirror-dispatch.service';
import { MirrorReconciliationService } from './mirror-reconciliation.service';
import { MirrorApplyService } from './mirror-apply.service';
import { MirrorAvailabilityService } from './mirror-availability.service';
import { MirrorCatalogService } from './mirror-catalog.service';
import { MirrorNoticeService } from './mirror-notice.service';
import { MirrorLookupService } from './mirror-lookup.service';
import { MirrorAgentGuard } from './mirror-agent.guard';

// ══════════════════════════════════════════════════════════════════════════
// El controlador no tenía pruebas, y por ahí se coló un defecto que ninguna
// prueba unitaria podía ver: la validación de /mirror/ack no conocía
// `skippedSeqs`, así que un lote compuesto SOLO por eventos que el driver no
// espeja recibía un 400. El evento nunca se cerraba, el agente lo reintentaba
// cada cinco segundos y a los cinco fallos entraba en modo seguro y dejaba de
// escribir en el HIS. Lo encontró el agente corriendo de verdad en la VM
// simulada; los tests del motor tenían el cliente HTTP mockeado.
//
// La validación de un endpoint es lógica de negocio: aquí se prueba.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorController — validación de /mirror/ack', () => {
  let controller: MirrorController;
  let dispatch: { ack: jest.Mock };
  let availability: { apply: jest.Mock };
  let catalog: { upload: jest.Mock };

  const req = { mirrorConfig: { organizationId: 'org1' } } as never;
  const ack = (body: unknown) => controller.ack(req, body as never);

  beforeEach(async () => {
    dispatch = { ack: jest.fn(() => ({ acknowledged: 1 })) };
    availability = { apply: jest.fn(() => ({ mode: 'ON' })) };
    catalog = {
      upload: jest.fn(() => ({
        kind: 'DOCTOR',
        created: 0,
        updated: 0,
        vanished: 0,
        homologated: 0,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MirrorController],
      providers: [
        { provide: MirrorDispatchService, useValue: dispatch },
        { provide: MirrorReconciliationService, useValue: {} },
        { provide: MirrorApplyService, useValue: {} },
        { provide: MirrorAvailabilityService, useValue: availability },
        { provide: MirrorCatalogService, useValue: catalog },
        { provide: MirrorNoticeService, useValue: {} },
        { provide: MirrorLookupService, useValue: {} },
      ],
    })
      // El guard tiene su propia batería de pruebas (mirror-agent.guard.spec).
      // Aquí solo se prueba la validación del cuerpo del ack.
      .overrideGuard(MirrorAgentGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(MirrorController);
  });

  it('un lote solo de omitidos es válido: llega al servicio', async () => {
    await ack({ seqs: [], skippedSeqs: ['7'] });

    expect(dispatch.ack).toHaveBeenCalledWith('org1', {
      seqs: [],
      skippedSeqs: ['7'],
    });
  });

  it('un lote solo de fallidos sigue siendo válido', async () => {
    await ack({ seqs: [], failedSeqs: ['9'] });

    expect(dispatch.ack).toHaveBeenCalled();
  });

  it('un lote solo de exitosos sigue siendo válido', async () => {
    await ack({ seqs: ['3'] });

    expect(dispatch.ack).toHaveBeenCalled();
  });

  // El handler valida ANTES de devolver la promesa, así que estos lanzan de
  // forma síncrona: `rejects` no los vería.
  it('un ack sin nada que reportar se rechaza', () => {
    // No es pedantería: un ack vacío significa que el agente perdió la cuenta
    // de lo que hizo, y dejarlo pasar borraría el rastro de ese lote.
    expect(() => ack({ seqs: [] })).toThrow(BadRequestException);
    expect(dispatch.ack).not.toHaveBeenCalled();
  });

  it('skippedSeqs con un tipo que no es arreglo se rechaza', () => {
    expect(() => ack({ seqs: [], skippedSeqs: '7' })).toThrow(
      BadRequestException,
    );
  });

  it('failedSeqs con un tipo que no es arreglo se rechaza', () => {
    expect(() => ack({ seqs: [], failedSeqs: 'oops' })).toThrow(
      BadRequestException,
    );
  });

  it('failures (el motivo del fallo) llega intacto al servicio', async () => {
    await ack({
      seqs: [],
      failedSeqs: ['9'],
      failures: [{ seq: '9', error: 'HIS rechazó' }],
    });

    expect(dispatch.ack).toHaveBeenCalledWith('org1', {
      seqs: [],
      failedSeqs: ['9'],
      failures: [{ seq: '9', error: 'HIS rechazó' }],
    });
  });

  it('un ack cuyo único contenido es failures es válido: cuenta como fallido', async () => {
    await ack({ seqs: [], failures: [{ seq: '9', error: 'x' }] });

    expect(dispatch.ack).toHaveBeenCalled();
  });

  it('failures que no es un arreglo se rechaza', () => {
    expect(() => ack({ seqs: [], failures: 'oops' })).toThrow(
      BadRequestException,
    );
    expect(dispatch.ack).not.toHaveBeenCalled();
  });

  it('sin seqs no hay ack posible', () => {
    expect(() => ack({ failedSeqs: ['1'] })).toThrow(BadRequestException);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// /mirror/availability borra, dentro de la ventana que declara, todo cupo que
// no venga en el envío. Una ventana mal formada no es un detalle: es la
// diferencia entre sincronizar un día y borrar la agenda de un médico.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorController — validación de /mirror/availability', () => {
  let controller: MirrorController;
  let availability: { apply: jest.Mock };

  const req = { mirrorConfig: { organizationId: 'org1' } } as never;
  const subir = (body: unknown) =>
    controller.availabilityUpload(req, body as never);
  const VENTANA = {
    fromIso: '2026-09-03T05:00:00.000Z',
    toIso: '2026-09-04T05:00:00.000Z',
  };

  beforeEach(async () => {
    availability = { apply: jest.fn(() => ({ mode: 'ON' })) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MirrorController],
      providers: [
        { provide: MirrorDispatchService, useValue: {} },
        { provide: MirrorReconciliationService, useValue: {} },
        { provide: MirrorApplyService, useValue: {} },
        { provide: MirrorAvailabilityService, useValue: availability },
        { provide: MirrorCatalogService, useValue: {} },
        { provide: MirrorNoticeService, useValue: {} },
        { provide: MirrorLookupService, useValue: {} },
      ],
    })
      .overrideGuard(MirrorAgentGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(MirrorController);
  });

  it('una ventana con cupos llega al servicio', async () => {
    await subir({ ...VENTANA, slots: [{ doctorExternalKey: '76' }] });

    expect(availability.apply).toHaveBeenCalledWith('org1', expect.anything());
  });

  it('una ventana VACÍA es válida: "ese día no hay turnos" es información', async () => {
    // Si no se aceptara, no habría forma de borrar los cupos de un día que el
    // hospital dejó sin agenda.
    await subir({ ...VENTANA, slots: [] });

    expect(availability.apply).toHaveBeenCalled();
  });

  it('sin `slots` se rechaza', () => {
    expect(() => subir({ ...VENTANA })).toThrow(BadRequestException);
  });

  it('una ventana invertida se rechaza', () => {
    // `from >= to` no acota nada y el servicio borraría con un criterio vacío.
    expect(() =>
      subir({ fromIso: VENTANA.toIso, toIso: VENTANA.fromIso, slots: [] }),
    ).toThrow(BadRequestException);
  });

  it('una fecha ilegible se rechaza', () => {
    expect(() =>
      subir({ fromIso: 'el jueves', toIso: VENTANA.toIso, slots: [] }),
    ).toThrow(BadRequestException);
  });

  it('sin ventana se rechaza: el borrado necesita límites', () => {
    expect(() => subir({ slots: [] })).toThrow(BadRequestException);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// /mirror/catalog — la vía por la que el catálogo del hospital llega a AgenIA.
//
// Existe porque `MirrorEntityMap` no tenía quien la escribiera, y sin esas
// equivalencias el chatbot deja de ofrecer citas a todo el mundo en silencio.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorController — validación de /mirror/catalog', () => {
  let controller: MirrorController;
  let catalog: { upload: jest.Mock };

  const req = { mirrorConfig: { organizationId: 'org1' } } as never;
  const subir = (body: unknown) => controller.catalogUpload(req, body as never);

  beforeEach(async () => {
    catalog = {
      upload: jest.fn(() => ({
        kind: 'DOCTOR',
        created: 2,
        updated: 0,
        vanished: 0,
        homologated: 0,
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MirrorController],
      providers: [
        { provide: MirrorDispatchService, useValue: {} },
        { provide: MirrorReconciliationService, useValue: {} },
        { provide: MirrorApplyService, useValue: {} },
        { provide: MirrorAvailabilityService, useValue: {} },
        { provide: MirrorCatalogService, useValue: catalog },
        { provide: MirrorNoticeService, useValue: {} },
        { provide: MirrorLookupService, useValue: {} },
      ],
    })
      .overrideGuard(MirrorAgentGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(MirrorController);
  });

  it('un catálogo de médicos válido llega al servicio', async () => {
    await subir({
      kind: 'DOCTOR',
      entries: [{ externalKey: '76', label: 'MEDICO ATENCION HTA' }],
    });

    expect(catalog.upload).toHaveBeenCalledWith(
      'org1',
      expect.objectContaining({ kind: 'DOCTOR' }),
    );
  });

  it('un catálogo VACÍO es válido: significa que el hospital no reporta nada', async () => {
    // Rechazarlo dejaría el catálogo del día anterior como si siguiera vigente.
    await subir({ kind: 'SERVICE', entries: [] });

    expect(catalog.upload).toHaveBeenCalled();
  });

  it('un kind desconocido se rechaza en vez de guardarse como basura', () => {
    expect(() => subir({ kind: 'PACIENTE', entries: [] })).toThrow(
      BadRequestException,
    );
    expect(catalog.upload).not.toHaveBeenCalled();
  });

  it('sin entries se rechaza', () => {
    expect(() => subir({ kind: 'DOCTOR' })).toThrow(BadRequestException);
    expect(catalog.upload).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Los cuatro endpoints restantes del protocolo. Ninguno tenía prueba, y todos
// deciden algo que el agente no puede corregir por su cuenta: con qué
// configuración arranca, qué eventos recibe, y qué se acepta como foto del
// HIS. El `organizationId` SIEMPRE sale del guard (req.mirrorConfig), nunca
// del cuerpo — un agente no puede hablar en nombre de otra clínica.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorController — handshake, events, reconcile, changes, heartbeat', () => {
  let controller: MirrorController;
  let dispatch: {
    handshake: jest.Mock;
    getPendingEvents: jest.Mock;
    heartbeat: jest.Mock;
  };
  let reconciliation: { reconcile: jest.Mock };
  let apply: { applyBatch: jest.Mock };
  let notice: { getPendingRequests: jest.Mock; applyRoster: jest.Mock };
  let lookup: { getPendingRequests: jest.Mock; applyResult: jest.Mock };

  const req = {
    mirrorConfig: {
      organizationId: 'org1',
      driverKey: 'cnt-sanvicente-anserma',
      driverConfig: { server: '192.168.1.16' },
    },
  } as never;

  beforeEach(async () => {
    dispatch = {
      handshake: jest.fn(async () => ({ ok: true })),
      getPendingEvents: jest.fn(async () => []),
      heartbeat: jest.fn(async () => undefined),
    };
    reconciliation = { reconcile: jest.fn(async () => ({ inSync: true })) };
    apply = {
      applyBatch: jest.fn(async () => ({
        applied: 1,
        skipped: 0,
        conflicts: 0,
        errors: 0,
      })),
    };
    notice = {
      getPendingRequests: jest.fn(async () => []),
      applyRoster: jest.fn(async () => ({
        requestId: 'req-1',
        applied: 1,
        truncated: false,
      })),
    };

    lookup = {
      getPendingRequests: jest.fn(async () => []),
      applyResult: jest.fn(async () => ({ requestId: 'req-1', stored: true })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MirrorController],
      providers: [
        { provide: MirrorDispatchService, useValue: dispatch },
        { provide: MirrorReconciliationService, useValue: reconciliation },
        { provide: MirrorApplyService, useValue: apply },
        { provide: MirrorAvailabilityService, useValue: {} },
        { provide: MirrorCatalogService, useValue: {} },
        { provide: MirrorNoticeService, useValue: notice },
        { provide: MirrorLookupService, useValue: lookup },
      ],
    })
      .overrideGuard(MirrorAgentGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(MirrorController);
  });

  describe('POST /mirror/handshake', () => {
    it('pasa al servicio la org, el driver y la config que resolvió el guard', async () => {
      const body = {
        driverVersion: '1.2.3',
        agentClockIso: '2026-09-02T10:00:00.000Z',
      };

      await controller.handshake(req, body);

      expect(dispatch.handshake).toHaveBeenCalledWith(
        'org1',
        'cnt-sanvicente-anserma',
        { server: '192.168.1.16' },
        body,
      );
    });

    it('sin el reloj del agente se rechaza: sin él no se puede medir el desfase', () => {
      expect(() => controller.handshake(req, {} as never)).toThrow(
        BadRequestException,
      );
      expect(() => controller.handshake(req, null as never)).toThrow(
        BadRequestException,
      );
      expect(dispatch.handshake).not.toHaveBeenCalled();
    });
  });

  describe('GET /mirror/events', () => {
    it('sin cursor arranca en 0 y sin límite explícito', async () => {
      await controller.getEvents(req);

      expect(dispatch.getPendingEvents).toHaveBeenCalledWith(
        'org1',
        0n,
        undefined,
      );
    });

    it('el cursor viaja como BigInt: un seq de int64 no cabe en un Number', async () => {
      await controller.getEvents(req, '9007199254740993', '50');

      expect(dispatch.getPendingEvents).toHaveBeenCalledWith(
        'org1',
        9007199254740993n,
        50,
      );
    });

    it('un cursor vacío se trata como 0, no como NaN', async () => {
      await controller.getEvents(req, '');
      expect(dispatch.getPendingEvents).toHaveBeenCalledWith(
        'org1',
        0n,
        undefined,
      );
    });

    it('un cursor que no es un número revienta en vez de servir basura', () => {
      expect(() => controller.getEvents(req, 'abc')).toThrow();
    });
  });

  describe('POST /mirror/reconcile', () => {
    const foto = [
      { doctorExternalKey: '76', startTimeIso: '2026-09-03T12:00:00.000Z' },
    ];

    it('la foto del HIS llega al reconciliador con su ventana', async () => {
      await controller.reconcile(req, {
        fromIso: '2026-09-01T00:00:00.000Z',
        toIso: '2026-09-30T00:00:00.000Z',
        appointments: foto,
      });

      expect(reconciliation.reconcile).toHaveBeenCalledWith('org1', foto, {
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-09-30T00:00:00.000Z'),
      });
    });

    it('una foto VACÍA es legítima: "el hospital no tiene ninguna cita ahí"', async () => {
      await controller.reconcile(req, { appointments: [] });
      expect(reconciliation.reconcile).toHaveBeenCalled();
    });

    it('sin ventana usa ahora → +90 días', async () => {
      const antes = Date.now();
      await controller.reconcile(req, { appointments: [] });

      const ventana = reconciliation.reconcile.mock.calls[0][2];
      const dias = (ventana.to.getTime() - ventana.from.getTime()) / 86_400_000;
      expect(dias).toBeCloseTo(90, 3);
      expect(ventana.from.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    });

    it('sin `appointments` como arreglo se rechaza', async () => {
      await expect(controller.reconcile(req, {})).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        controller.reconcile(req, { appointments: 'nope' as never }),
      ).rejects.toThrow(BadRequestException);
      expect(reconciliation.reconcile).not.toHaveBeenCalled();
    });

    it('una fecha ilegible se rechaza en vez de comparar contra un Invalid Date', async () => {
      await expect(
        controller.reconcile(req, { fromIso: 'ayer', appointments: [] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.reconcile(req, { toIso: '32 de mayo', appointments: [] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /mirror/changes', () => {
    it('el lote llega al aplicador con la org del guard', async () => {
      const events = [{ eventId: 'e1', entityType: 'APPOINTMENT' }];
      await controller.applyChanges(req, { events } as never);

      expect(apply.applyBatch).toHaveBeenCalledWith('org1', events);
    });

    it('un lote vacío es válido: "no pasó nada en el HIS" es una respuesta', async () => {
      await controller.applyChanges(req, { events: [] });
      expect(apply.applyBatch).toHaveBeenCalledWith('org1', []);
    });

    it('sin `events` como arreglo se rechaza', () => {
      expect(() => controller.applyChanges(req, {} as never)).toThrow(
        BadRequestException,
      );
      expect(() =>
        controller.applyChanges(req, { events: 'nope' } as never),
      ).toThrow(BadRequestException);
      expect(apply.applyBatch).not.toHaveBeenCalled();
    });
  });

  describe('POST /mirror/heartbeat', () => {
    it('el latido llega con la org y el driver, y responde ok', async () => {
      const body = { lagMs: 120, hisReachable: true };
      await expect(controller.heartbeat(req, body)).resolves.toEqual({
        ok: true,
      });

      expect(dispatch.heartbeat).toHaveBeenCalledWith(
        'org1',
        'cnt-sanvicente-anserma',
        body,
      );
    });

    it('un latido sin cuerpo se acepta: un agente viejo no reporta métricas', async () => {
      await expect(
        controller.heartbeat(req, undefined as never),
      ).resolves.toEqual({ ok: true });
      expect(dispatch.heartbeat).toHaveBeenCalledWith(
        'org1',
        'cnt-sanvicente-anserma',
        {},
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Avisos masivos, Fase 2 (fuente espejo) — PLAN_AVISOS_MASIVOS.md §5.
  // EXCLUSIVO del driver cnt-sanvicente-anserma; la exclusividad la aplica
  // MirrorNoticeService (ya probado en mirror-notice.service.spec.ts). Aquí
  // solo se prueba lo que le toca al controlador: pasar organizationId Y
  // driverKey del guard (nunca del cuerpo), y validar la forma del roster.
  // ══════════════════════════════════════════════════════════════════════
  describe('GET /mirror/notice-requests', () => {
    it('pasa organizationId y driverKey del guard al servicio', async () => {
      await controller.getNoticeRequests(req);

      expect(notice.getPendingRequests).toHaveBeenCalledWith(
        'org1',
        'cnt-sanvicente-anserma',
      );
    });
  });

  describe('POST /mirror/notice-roster', () => {
    const CANDIDATOS = [
      {
        doctorExternalKey: '76',
        startTimeIso: '2026-09-24T12:00:00.000Z',
        patientDocument: '111',
      },
    ];

    it('un roster válido llega al servicio con la org del guard', async () => {
      await controller.applyNoticeRoster(req, {
        requestId: 'req-1',
        candidates: CANDIDATOS,
      });

      expect(notice.applyRoster).toHaveBeenCalledWith(
        'org1',
        'cnt-sanvicente-anserma',
        {
          requestId: 'req-1',
          candidates: CANDIDATOS,
        },
      );
    });

    it('candidates vacío es válido: "no encontré a nadie" es una respuesta', async () => {
      await controller.applyNoticeRoster(req, {
        requestId: 'req-1',
        candidates: [],
      });
      expect(notice.applyRoster).toHaveBeenCalled();
    });

    it('sin requestId se rechaza', () => {
      expect(() =>
        controller.applyNoticeRoster(req, { candidates: CANDIDATOS } as never),
      ).toThrow(BadRequestException);
      expect(notice.applyRoster).not.toHaveBeenCalled();
    });

    it('candidates que no es arreglo se rechaza', () => {
      expect(() =>
        controller.applyNoticeRoster(req, {
          requestId: 'req-1',
          candidates: 'nope',
        } as never),
      ).toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Consulta en vivo al HIS (rastreo de paciente, Fase 2). Lo que le toca al
  // controlador: la organización sale del guard —un agente no puede responder
  // ni leer peticiones de otra clínica— y una respuesta sin requestId no llega
  // al servicio.
  // ══════════════════════════════════════════════════════════════════════
  describe('GET /mirror/lookup-requests', () => {
    it('pasa SOLO la organización del guard al servicio', async () => {
      await controller.getLookupRequests(req);

      expect(lookup.getPendingRequests).toHaveBeenCalledWith('org1');
    });

    it('devuelve lo que el servicio entrega', async () => {
      const pendiente = { requestId: 'r-1', kind: 'BY_SLOT', slots: [] };
      lookup.getPendingRequests.mockResolvedValueOnce([pendiente]);

      await expect(controller.getLookupRequests(req)).resolves.toEqual([
        pendiente,
      ]);
    });
  });

  describe('POST /mirror/lookup-result', () => {
    it('una respuesta válida llega al servicio con la org del guard', async () => {
      const body = { requestId: 'req-1', appointments: [] };

      await expect(controller.applyLookupResult(req, body)).resolves.toEqual({
        requestId: 'req-1',
        stored: true,
      });
      expect(lookup.applyResult).toHaveBeenCalledWith('org1', body);
    });

    it('una respuesta con error o unsupported (sin citas) se acepta', async () => {
      await controller.applyLookupResult(req, {
        requestId: 'req-1',
        error: 'timeout',
      } as never);
      await controller.applyLookupResult(req, {
        requestId: 'req-1',
        unsupported: true,
      } as never);

      expect(lookup.applyResult).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['sin requestId', { appointments: [] }],
      ['requestId vacío', { requestId: '', appointments: [] }],
      ['requestId que no es texto', { requestId: 5, appointments: [] }],
      ['sin cuerpo', undefined],
    ])('%s se rechaza', (_n, body) => {
      expect(() => controller.applyLookupResult(req, body as never)).toThrow(
        BadRequestException,
      );
      expect(lookup.applyResult).not.toHaveBeenCalled();
    });
  });
});
