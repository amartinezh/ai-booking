import {
  MirrorWatchdogService,
  type DerivaItem,
} from './mirror-watchdog.service';

/**
 * El vigilante de la sincronización. Lo que se fija:
 *
 *  · abre excepciones con la MISMA clasificación que ve el rastreo (`@agenia/shared`);
 *  · las de citas llevan EPS y médico (un agente acotado ve solo lo suyo);
 *  · solo se cierra sola una excepción cuando lo que la abrió DEJÓ de cumplirse de
 *    verdad —llegó, se canceló, se reprocesó— y NUNCA por falta de datos;
 *  · una cita cuya hora ya pasó sin llegar NO se cierra sola;
 *  · un fallo con una clínica no impide vigilar las demás.
 */
describe('MirrorWatchdogService', () => {
  const ORG = 'org-1';
  const AHORA = new Date('2026-09-22T15:00:00.000Z');
  const MIN = 60_000;
  const HORA = 60 * MIN;
  const haceMin = (m: number) => new Date(AHORA.getTime() - m * MIN);
  const enHoras = (h: number) => new Date(AHORA.getTime() + h * HORA);

  const evento = (over: Record<string, unknown> = {}) => ({
    seq: BigInt(7),
    entityType: 'APPOINTMENT',
    entityId: 'apt-1',
    op: 'INSERT',
    createdAt: haceMin(25),
    deliveredAt: null as Date | null,
    attempts: 0,
    deadLettered: false,
    nextAttemptAt: null as Date | null,
    lastError: null as string | null,
    ...over,
  });

  const cita = (over: Record<string, unknown> = {}) => ({
    id: 'apt-1',
    status: 'SCHEDULED',
    origin: 'WHATSAPP',
    patientId: 'pac-1',
    epsId: 'eps-1',
    scheduleSlot: { startTime: enHoras(72), doctorId: 'doc-1' },
    ...over,
  });

  const activa = (over: Record<string, unknown> = {}) => ({
    id: 'ex-1',
    kind: 'CITA_NO_ENTREGADA',
    dedupeKey: 'cita:apt-1:7',
    outboxSeq: BigInt(7) as bigint | null,
    appointmentId: 'apt-1' as string | null,
    dedupe: undefined,
    ...over,
  });

  interface Escenario {
    config?: unknown;
    eventos?: unknown[];
    citas?: unknown[];
    auditoria?: unknown[];
    /** Excepciones activas, para lo que se cierra solo. */
    activas?: Record<string, unknown>[];
    /** Estado actual de eventos por seq (la comprobación del cierre). */
    eventosPorSeq?: Record<string, unknown>[];
  }

  const build = (e: Escenario = {}) => {
    const prisma = {
      hospitalMirrorConfig: {
        findUnique: jest.fn(async (..._a: unknown[]) =>
          'config' in e ? e.config : { enabled: true, pushEnabled: true },
        ),
        findMany: jest.fn(async (..._a: unknown[]) => [
          { organizationId: ORG },
        ]),
      },
      syncOutbox: {
        // La consulta del escaneo trae `deliveredAt: null`; la del cierre pide por `seq`.
        findMany: jest.fn(async (arg: { where: { seq?: unknown } }) =>
          arg.where.seq ? (e.eventosPorSeq ?? []) : (e.eventos ?? []),
        ),
      },
      appointment: {
        findMany: jest.fn(async (arg: { where: { id: { in: string[] } } }) =>
          ((e.citas ?? []) as { id: string }[]).filter((c) =>
            arg.where.id.in.includes(c.id),
          ),
        ),
      },
      syncAudit: {
        findMany: jest.fn(async (..._a: unknown[]) => e.auditoria ?? []),
      },
      syncException: {
        findMany: jest.fn(
          async (arg: { where: { kind?: unknown; lastSeenAt?: unknown } }) => {
            const kinds =
              (arg.where.kind as { in?: string[] } | string | undefined) ??
              undefined;
            const lista = typeof kinds === 'string' ? [kinds] : kinds?.in;
            // Auditoría vieja (`lastSeenAt: { lt }`) y envío/deriva se distinguen por su filtro.
            if (arg.where.lastSeenAt)
              return (e.activas ?? []).filter((a) =>
                ['CONFLICTO_SYNC', 'ERROR_SYNC'].includes(a.kind as string),
              );
            return (e.activas ?? []).filter(
              (a) => !lista || lista.includes(a.kind as string),
            );
          },
        ),
      },
    };
    const exceptions = {
      registrar: jest.fn(async (..._a: unknown[]) => 'CREADA'),
      autoResolver: jest.fn(async (..._a: unknown[]) => true),
    };
    const alert = {
      avisar: jest.fn(async (..._a: unknown[]) => ({
        enviado: false,
        motivo: 'NADA_QUE_AVISAR',
      })),
    };
    const service = new MirrorWatchdogService(
      prisma as never,
      exceptions as never,
      alert as never,
    );
    return { service, prisma, exceptions, alert };
  };

  const registradas = (x: ReturnType<typeof build>['exceptions']) =>
    x.registrar.mock.calls.map((c) => c[1] as Record<string, any>);
  const cerradas = (x: ReturnType<typeof build>['exceptions']) =>
    x.autoResolver.mock.calls.map((c) => [c[1], c[2]]);

  // ═══════════════════════════════════════════════════════════════════════
  describe('una cita retenida ANTES de su hora', () => {
    it('una cita de WhatsApp en cola hace 25 min abre una excepción CON el alcance de la cita', async () => {
      const { service, exceptions } = build({
        eventos: [evento()],
        citas: [cita()],
      });

      const r = await service.vigilarOrganizacion(ORG, AHORA);

      expect(r.abiertas).toBe(1);
      expect(registradas(exceptions)).toEqual([
        expect.objectContaining({
          kind: 'CITA_NO_ENTREGADA',
          dedupeKey: 'cita:apt-1:7',
          severity: 'MEDIA',
          title: 'Cita que el hospital aún no tiene',
          appointmentId: 'apt-1',
          patientId: 'pac-1',
          entityType: 'APPOINTMENT',
          outboxSeq: BigInt(7),
          // El alcance: con esto un agente acotado a una EPS o a un médico ve SOLO lo suyo.
          epsId: 'eps-1',
          doctorId: 'doc-1',
          appointmentStartAt: enHoras(72),
          meta: expect.objectContaining({
            motivo: 'EN_COLA',
            minutosRetenida: 25,
            op: 'INSERT',
            desdeIso: haceMin(25).toISOString(),
          }),
        }),
      ]);
    });

    it('☠️ un dead-letter abre la excepción de inmediato, con el último error solo en el detalle técnico', async () => {
      const { service, exceptions } = build({
        eventos: [
          evento({
            createdAt: haceMin(2),
            attempts: 10,
            deadLettered: true,
            lastError: 'violación de PK: cupo ya vendido',
          }),
        ],
        citas: [cita()],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      const [e] = registradas(exceptions);
      expect(e).toMatchObject({
        severity: 'ALTA',
        meta: expect.objectContaining({ motivo: 'RENDIDA' }),
      });
      expect(e.detail).toContain('violación de PK: cupo ya vendido');
      // El título (lo que ve cualquiera que abra la bandeja) NO lleva el error.
      expect(e.title).not.toContain('violación');
    });

    it('🕐 la gravedad sube cuando la cita se acerca (a menos de 4 h es crítica)', async () => {
      const { service, exceptions } = build({
        eventos: [evento()],
        citas: [
          cita({ scheduleSlot: { startTime: enHoras(3), doctorId: 'doc-1' } }),
        ],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      expect(registradas(exceptions)[0].severity).toBe('CRITICA');
    });

    it('unos minutos en cola son normales: no se abre nada bajo el umbral', async () => {
      const { service, exceptions } = build({
        eventos: [evento({ createdAt: haceMin(5) })],
        citas: [cita()],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      expect(exceptions.registrar).not.toHaveBeenCalled();
    });

    it.each([
      ['cancelada', { status: 'CANCELLED' }],
      ['ya atendida', { status: 'COMPLETED' }],
      ['nacida en el HIS', { origin: 'MIRROR' }],
      [
        'con la hora ya pasada',
        { scheduleSlot: { startTime: haceMin(10), doctorId: 'doc-1' } },
      ],
    ])('una cita %s no es una cita retenida', async (_n, over) => {
      const { service, exceptions } = build({
        eventos: [evento()],
        citas: [cita(over)],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      expect(
        registradas(exceptions).filter((r) => r.kind === 'CITA_NO_ENTREGADA'),
      ).toEqual([]);
    });

    it('una cita que ya no existe se ignora sin romper la vuelta', async () => {
      const { service, exceptions } = build({ eventos: [evento()], citas: [] });
      await expect(
        service.vigilarOrganizacion(ORG, AHORA),
      ).resolves.toBeDefined();
      expect(exceptions.registrar).not.toHaveBeenCalled();
    });
  });

  describe('lo rendido que no es una cita retenida', () => {
    it('un cambio de un CUPO que se rindió es un EVENTO_RENDIDO sin alcance (solo lo ve quien no está acotado)', async () => {
      const { service, exceptions } = build({
        eventos: [
          evento({
            seq: BigInt(9),
            entityType: 'SLOT',
            entityId: 'slot-1',
            op: 'UPDATE',
            attempts: 10,
            deadLettered: true,
            lastError: 'x',
          }),
        ],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      expect(registradas(exceptions)).toEqual([
        expect.objectContaining({
          kind: 'EVENTO_RENDIDO',
          dedupeKey: 'evento:9',
          severity: 'MEDIA',
          entityType: 'SLOT',
          entityId: 'slot-1',
          appointmentId: null,
          epsId: null,
          doctorId: null,
        }),
      ]);
    });

    it('la cancelación de una cita que se rindió sigue a la vista, con el alcance de la cita', async () => {
      const { service, exceptions } = build({
        eventos: [
          evento({
            seq: BigInt(11),
            op: 'UPDATE',
            attempts: 10,
            deadLettered: true,
          }),
        ],
        citas: [cita({ status: 'CANCELLED' })],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      expect(registradas(exceptions)).toEqual([
        expect.objectContaining({
          kind: 'EVENTO_RENDIDO',
          appointmentId: 'apt-1',
          epsId: 'eps-1',
          doctorId: 'doc-1',
        }),
      ]);
    });

    it('un dead-letter que YA explica una excepción de cita NO se repite como evento rendido', async () => {
      const { service, exceptions } = build({
        eventos: [evento({ attempts: 10, deadLettered: true })],
        citas: [cita()],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      expect(registradas(exceptions).map((r) => r.kind)).toEqual([
        'CITA_NO_ENTREGADA',
      ]);
    });
  });

  describe('qué se lee', () => {
    it('solo el outbox de ESA clínica, de origen local, sin entregar, de los últimos 14 días, con tope', async () => {
      const { service, prisma } = build();

      await service.vigilarOrganizacion(ORG, AHORA);

      const arg = prisma.syncOutbox.findMany.mock.calls[0][0] as {
        where: Record<string, any>;
        take: number;
      };
      expect(arg.where).toMatchObject({
        organizationId: ORG,
        origin: 'LOCAL',
        deliveredAt: null,
      });
      expect(arg.where.createdAt.gte).toEqual(
        new Date(AHORA.getTime() - 14 * 86_400_000),
      );
      expect(arg.take).toBe(1001);
    });

    it('las citas se buscan DENTRO de la clínica', async () => {
      const { service, prisma } = build({
        eventos: [evento()],
        citas: [cita()],
      });
      await service.vigilarOrganizacion(ORG, AHORA);
      expect(prisma.appointment.findMany.mock.calls[0][0]).toMatchObject({
        where: { organizationId: ORG },
      });
    });

    it('con el espejo apagado (o sin configuración) no hace nada', async () => {
      for (const config of [null, { enabled: false, pushEnabled: true }]) {
        const { service, prisma, alert } = build({ config });
        await service.vigilarOrganizacion(ORG, AHORA);
        expect(prisma.syncOutbox.findMany).not.toHaveBeenCalled();
        expect(alert.avisar).not.toHaveBeenCalled();
      }
    });

    it('⏸️ con el envío hacia el hospital PAUSADO a propósito, no se vigila el outbox ni se cierra nada solo', async () => {
      const { service, prisma, exceptions } = build({
        config: { enabled: true, pushEnabled: false },
        activas: [activa()],
        eventosPorSeq: [],
      });

      const r = await service.vigilarOrganizacion(ORG, AHORA);

      expect(prisma.syncOutbox.findMany).not.toHaveBeenCalled();
      expect(exceptions.autoResolver).not.toHaveBeenCalledWith(
        ORG,
        'ex-1',
        expect.anything(),
        expect.anything(),
      );
      expect(r.outboxIncompleto).toBe(true);
    });
  });

  describe('cerrar solas las que ya no se cumplen', () => {
    it('✅ el envío llegó → se cierra con ese motivo', async () => {
      const { service, exceptions } = build({
        activas: [activa()],
        eventosPorSeq: [
          { seq: BigInt(7), deliveredAt: haceMin(1), deadLettered: false },
        ],
      });

      const r = await service.vigilarOrganizacion(ORG, AHORA);

      expect(cerradas(exceptions)).toEqual([
        ['ex-1', 'El envío ya llegó al hospital.'],
      ]);
      expect(r.autoResueltas).toBe(1);
    });

    it('el evento ya no existe (se purgó) → se cierra', async () => {
      const { service, exceptions } = build({
        activas: [activa()],
        eventosPorSeq: [],
      });
      await service.vigilarOrganizacion(ORG, AHORA);
      expect(cerradas(exceptions)).toEqual([
        ['ex-1', 'El envío ya llegó al hospital.'],
      ]);
    });

    it('la cita se canceló → se cierra', async () => {
      const { service, exceptions } = build({
        activas: [activa()],
        eventosPorSeq: [
          { seq: BigInt(7), deliveredAt: null, deadLettered: true },
        ],
        citas: [cita({ status: 'CANCELLED' })],
      });
      await service.vigilarOrganizacion(ORG, AHORA);
      expect(cerradas(exceptions)).toEqual([
        ['ex-1', 'La cita se canceló o ya se atendió.'],
      ]);
    });

    it('el envío volvió a la normalidad (se reprocesó) y la cita aún es futura → se cierra', async () => {
      const { service, exceptions } = build({
        activas: [activa()],
        eventosPorSeq: [
          { seq: BigInt(7), deliveredAt: null, deadLettered: false },
        ],
        citas: [cita()],
      });
      await service.vigilarOrganizacion(ORG, AHORA);
      expect(cerradas(exceptions)).toEqual([
        ['ex-1', 'El envío volvió a la normalidad.'],
      ]);
    });

    it('🕐 la hora de la cita YA pasó y el evento sigue sin entregarse → NO se cierra sola', async () => {
      const { service, exceptions } = build({
        activas: [activa()],
        eventosPorSeq: [
          { seq: BigInt(7), deliveredAt: null, deadLettered: true },
        ],
        citas: [
          cita({ scheduleSlot: { startTime: haceMin(30), doctorId: 'doc-1' } }),
        ],
      });

      const r = await service.vigilarOrganizacion(ORG, AHORA);

      expect(exceptions.autoResolver).not.toHaveBeenCalled();
      expect(r.autoResueltas).toBe(0);
    });

    it('una excepción que SIGUE vigente no se toca', async () => {
      const { service, exceptions } = build({
        eventos: [evento()],
        citas: [cita()],
        activas: [activa()],
        eventosPorSeq: [
          { seq: BigInt(7), deliveredAt: null, deadLettered: false },
        ],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      expect(exceptions.autoResolver).not.toHaveBeenCalled();
    });

    it('un evento rendido que se reprocesó (ya no es dead-letter) se cierra; uno que SIGUE rendido no', async () => {
      const { service, exceptions } = build({
        activas: [
          activa({
            id: 'ex-a',
            kind: 'EVENTO_RENDIDO',
            dedupeKey: 'evento:9',
            outboxSeq: BigInt(9),
            appointmentId: null,
          }),
          activa({
            id: 'ex-b',
            kind: 'EVENTO_RENDIDO',
            dedupeKey: 'evento:10',
            outboxSeq: BigInt(10),
            appointmentId: null,
          }),
        ],
        eventosPorSeq: [
          { seq: BigInt(9), deliveredAt: null, deadLettered: false },
          { seq: BigInt(10), deliveredAt: null, deadLettered: true },
        ],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      expect(cerradas(exceptions)).toEqual([
        ['ex-a', 'El cambio ya se entregó al hospital o se reprocesó.'],
      ]);
    });

    it('🚨 un escaneo TRUNCADO no cierra nada solo: que falten datos no prueba que algo llegó', async () => {
      const muchos = Array.from({ length: 1001 }, (_, i) =>
        evento({
          seq: BigInt(100 + i),
          entityId: `apt-${i}`,
          createdAt: haceMin(5),
        }),
      );
      const { service, exceptions } = build({
        eventos: muchos,
        activas: [activa()],
        eventosPorSeq: [
          { seq: BigInt(7), deliveredAt: haceMin(1), deadLettered: false },
        ],
      });

      const r = await service.vigilarOrganizacion(ORG, AHORA);

      expect(exceptions.autoResolver).not.toHaveBeenCalled();
      expect(r.outboxIncompleto).toBe(true);
    });

    it('la comprobación del cierre lee el evento DENTRO de la clínica', async () => {
      const { service, prisma } = build({
        activas: [activa()],
        eventosPorSeq: [],
      });
      await service.vigilarOrganizacion(ORG, AHORA);
      const consulta = prisma.syncOutbox.findMany.mock.calls.find(
        (c) => (c[0] as { where: { seq?: unknown } }).where.seq,
      )![0] as { where: Record<string, unknown> };
      expect(consulta.where).toMatchObject({ organizationId: ORG });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('la auditoría', () => {
    const fila = (over: Record<string, unknown> = {}) => ({
      direction: 'INBOUND',
      entityType: 'APPOINTMENT',
      entityId: null as string | null,
      op: 'INSERT',
      outcome: 'CONFLICT',
      detail: 'cupo=76|2026-09-24T12:00:00.000Z; el cupo ya estaba vendido',
      createdAt: haceMin(30),
      ...over,
    });

    it('lo mismo repetido es UNA excepción, con cuántas veces pasó y cuándo fue la última', async () => {
      const { service, exceptions } = build({
        auditoria: [
          fila({ createdAt: haceMin(10) }),
          fila({ createdAt: haceMin(50) }),
          fila({ createdAt: haceMin(90) }),
        ],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      expect(registradas(exceptions)).toEqual([
        expect.objectContaining({
          kind: 'CONFLICTO_SYNC',
          dedupeKey:
            'auditoria:INBOUND:APPOINTMENT:76|2026-09-24T12:00:00.000Z:CONFLICT',
          occurrences: 3,
          lastSeenAt: haceMin(10),
        }),
      ]);
    });

    it('un ERROR es ERROR_SYNC, y el detalle técnico dice de dónde vino', async () => {
      const { service, exceptions } = build({
        auditoria: [fila({ outcome: 'ERROR', detail: 'timeout al aplicar' })],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      const [e] = registradas(exceptions);
      expect(e.kind).toBe('ERROR_SYNC');
      expect(e.detail).toContain('INBOUND');
      expect(e.detail).toContain('timeout al aplicar');
    });

    it('problemas distintos son excepciones distintas', async () => {
      const { service, exceptions } = build({
        auditoria: [
          fila(),
          fila({ outcome: 'ERROR' }),
          fila({ detail: 'cupo=91|2026-09-24T12:00:00.000Z' }),
        ],
      });
      await service.vigilarOrganizacion(ORG, AHORA);
      expect(exceptions.registrar).toHaveBeenCalledTimes(3);
    });

    it('un problema sobre una cita concreta lleva el alcance de la cita', async () => {
      const { service, exceptions } = build({
        auditoria: [fila({ entityId: 'apt-1' })],
        citas: [cita()],
      });

      await service.vigilarOrganizacion(ORG, AHORA);

      expect(registradas(exceptions)[0]).toMatchObject({
        appointmentId: 'apt-1',
        epsId: 'eps-1',
        doctorId: 'doc-1',
        entityId: 'apt-1',
      });
    });

    it('🔎 solo lo que la auditoría de los últimos días marcó como ERROR o CONFLICT, y solo de lo que llega del hospital', async () => {
      const { service, prisma } = build();

      await service.vigilarOrganizacion(ORG, AHORA);

      const where = (
        prisma.syncAudit.findMany.mock.calls[0][0] as {
          where: Record<string, any>;
        }
      ).where;
      expect(where).toMatchObject({
        organizationId: ORG,
        outcome: { in: ['ERROR', 'CONFLICT'] },
      });
      // AGENIA_TO_HIS (los cubre el outbox), RECONCILE (la deriva va por cita) y CONFIG no.
      expect(where.direction.in.sort()).toEqual(['HIS_TO_AGENIA', 'INBOUND']);
      expect(where.createdAt.gte).toEqual(
        new Date(AHORA.getTime() - 24 * HORA),
      );
    });

    it('sin nuevas ocurrencias en 3 días se da por superada', async () => {
      const { service, exceptions, prisma } = build({
        activas: [
          activa({
            id: 'ex-x',
            kind: 'CONFLICTO_SYNC',
            dedupeKey: 'auditoria:x',
          }),
        ],
      });

      const r = await service.vigilarOrganizacion(ORG, AHORA);

      expect(cerradas(exceptions)).toEqual([
        ['ex-x', 'Sin nuevas ocurrencias en 3 días.'],
      ]);
      expect(r.autoResueltas).toBe(1);
      const viejas = prisma.syncException.findMany.mock.calls.find(
        (c) => (c[0] as { where: { lastSeenAt?: unknown } }).where.lastSeenAt,
      )![0] as { where: Record<string, any> };
      expect(viejas.where.lastSeenAt.lt).toEqual(
        new Date(AHORA.getTime() - 3 * 86_400_000),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('la deriva de la reconciliación', () => {
    const ventana = { from: AHORA, to: enHoras(90 * 24) };
    const item = (over: Partial<DerivaItem> = {}): DerivaItem => ({
      appointmentId: 'apt-1',
      patientId: 'pac-1',
      epsId: 'eps-1',
      doctorId: 'doc-1',
      startTime: enHoras(72),
      clave: '76|2026-09-25T15:00:00.000Z',
      ...over,
    });

    it('cada cita que el hospital no tiene abre una excepción, con su alcance y sin afirmar por qué falta', async () => {
      const { service, exceptions } = build();

      await service.registrarDeriva(ORG, ventana, [item()], 120, AHORA);

      expect(registradas(exceptions)).toEqual([
        expect.objectContaining({
          kind: 'DERIVA_EN_HIS',
          dedupeKey: 'deriva:apt-1',
          severity: 'ALTA',
          appointmentId: 'apt-1',
          epsId: 'eps-1',
          doctorId: 'doc-1',
          meta: { clave: '76|2026-09-25T15:00:00.000Z' },
        }),
      ]);
      // Lenguaje neutro: dice que la comparación no dice cuál es la causa.
      expect(registradas(exceptions)[0].detail).toMatch(/no dice cuál/);
    });

    it('la gravedad sube si la cita está cerca', async () => {
      const { service, exceptions } = build();
      await service.registrarDeriva(
        ORG,
        ventana,
        [item({ startTime: enHoras(3) })],
        120,
        AHORA,
      );
      expect(registradas(exceptions)[0].severity).toBe('CRITICA');
    });

    it('🚨 una foto VACÍA del hospital no se persiste: no es un dato, es una lectura fallida', async () => {
      const { service, exceptions, prisma } = build();

      await service.registrarDeriva(
        ORG,
        ventana,
        [item(), item({ appointmentId: 'apt-2' })],
        0,
        AHORA,
      );

      expect(exceptions.registrar).not.toHaveBeenCalled();
      expect(prisma.syncException.findMany).not.toHaveBeenCalled();
      expect(exceptions.autoResolver).not.toHaveBeenCalled();
    });

    it('las que ya NO faltan (dentro de la ventana) se cierran solas; las que siguen faltando, no', async () => {
      const { service, exceptions } = build({
        activas: [
          activa({
            id: 'ex-sigue',
            kind: 'DERIVA_EN_HIS',
            dedupeKey: 'deriva:apt-1',
          }),
          activa({
            id: 'ex-llego',
            kind: 'DERIVA_EN_HIS',
            dedupeKey: 'deriva:apt-9',
          }),
        ],
      });

      await service.registrarDeriva(ORG, ventana, [item()], 120, AHORA);

      expect(cerradas(exceptions)).toEqual([
        [
          'ex-llego',
          'La última reconciliación ya no la echa en falta en el hospital.',
        ],
      ]);
    });

    it('solo se cierran las de la ventana que se comparó', async () => {
      const { service, prisma } = build();

      await service.registrarDeriva(ORG, ventana, [], 120, AHORA);

      expect(prisma.syncException.findMany.mock.calls[0][0]).toMatchObject({
        where: {
          organizationId: ORG,
          kind: 'DERIVA_EN_HIS',
          appointmentStartAt: { gte: ventana.from, lt: ventana.to },
        },
      });
    });

    it('sin ninguna diferencia (todo coincide), se cierran todas las de la ventana', async () => {
      const { service, exceptions } = build({
        activas: [
          activa({
            id: 'ex-1',
            kind: 'DERIVA_EN_HIS',
            dedupeKey: 'deriva:apt-1',
          }),
        ],
      });
      await service.registrarDeriva(ORG, ventana, [], 120, AHORA);
      expect(cerradas(exceptions)).toHaveLength(1);
    });

    it('🌊 una falla sistémica no inunda la bandeja: se abren 200 y no se cierra nada solo', async () => {
      const muchas = Array.from({ length: 350 }, (_, i) =>
        item({ appointmentId: `apt-${i}` }),
      );
      const { service, exceptions } = build({
        activas: [
          activa({
            id: 'ex-1',
            kind: 'DERIVA_EN_HIS',
            dedupeKey: 'deriva:apt-999',
          }),
        ],
      });

      await service.registrarDeriva(ORG, ventana, muchas, 500, AHORA);

      expect(exceptions.registrar).toHaveBeenCalledTimes(200);
      expect(exceptions.autoResolver).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  describe('el ciclo completo', () => {
    it('después de vigilar, avisa al agendador de esa clínica, una vez', async () => {
      const { service, alert } = build({
        eventos: [evento()],
        citas: [cita()],
      });

      const r = await service.vigilarOrganizacion(ORG, AHORA);

      expect(alert.avisar).toHaveBeenCalledTimes(1);
      expect(alert.avisar).toHaveBeenCalledWith(ORG, AHORA);
      expect(r.aviso).toEqual({ enviado: false, motivo: 'NADA_QUE_AVISAR' });
    });

    it('si el aviso falla, las excepciones YA están abiertas y la vuelta no revienta', async () => {
      const { service, alert, exceptions } = build({
        eventos: [evento()],
        citas: [cita()],
      });
      alert.avisar.mockRejectedValueOnce(new Error('meta caído'));

      const r = await service.vigilarOrganizacion(ORG, AHORA);

      expect(exceptions.registrar).toHaveBeenCalledTimes(1);
      expect(r.aviso).toBeNull();
    });

    it('un fallo con UNA clínica no impide vigilar las demás', async () => {
      const { service, prisma } = build();
      prisma.hospitalMirrorConfig.findMany.mockResolvedValueOnce([
        { organizationId: 'org-mala' },
        { organizationId: 'org-buena' },
      ]);
      const espia = jest
        .spyOn(service, 'vigilarOrganizacion')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({} as never);
      jest
        .spyOn(
          (service as unknown as { logger: { error: () => void } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await service.vigilarTodas();

      expect(espia.mock.calls.map((c) => c[0])).toEqual([
        'org-mala',
        'org-buena',
      ]);
    });

    it('solo vigila las clínicas con el espejo encendido', async () => {
      const { service, prisma } = build();
      jest.spyOn(service, 'vigilarOrganizacion').mockResolvedValue({} as never);

      await service.vigilarTodas();

      expect(
        prisma.hospitalMirrorConfig.findMany.mock.calls[0][0],
      ).toMatchObject({ where: { enabled: true } });
    });

    it('🔁 una vuelta lenta no se monta sobre la siguiente', async () => {
      const { service } = build();
      let liberar: () => void = () => undefined;
      const espia = jest
        .spyOn(service, 'vigilarOrganizacion')
        .mockImplementation(
          () => new Promise((r) => (liberar = () => r({} as never))),
        );

      const primera = service.vigilarTodas();
      await new Promise((r) => setTimeout(r, 5));
      await service.vigilarTodas(); // la segunda vuelta ve `enCurso` y sale
      liberar();
      await primera;

      expect(espia).toHaveBeenCalledTimes(1);
    });

    it('un fallo al listar las clínicas no tumba el proceso y libera la guarda', async () => {
      const { service, prisma } = build();
      prisma.hospitalMirrorConfig.findMany.mockRejectedValueOnce(
        new Error('db caída'),
      );
      jest
        .spyOn(
          (service as unknown as { logger: { error: () => void } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await expect(service.vigilarTodas()).resolves.toBeUndefined();
      await expect(service.vigilarTodas()).resolves.toBeUndefined(); // la guarda se liberó
    });
  });
});
