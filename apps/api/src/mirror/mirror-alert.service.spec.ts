import { TIPOS_CON_AVISO } from '@agenia/shared';
import { MirrorAlertService } from './mirror-alert.service';

/**
 * El aviso proactivo al agendador. Lo que se fija:
 *
 *  · si el aviso NO puede salir (apagado, sin número, sin plantilla) no se reclama ni
 *    se toca ninguna fila: reclamar y devolver en cada vuelta sería ruido de escritura;
 *  · se reclama ANTES de enviar (dos réplicas no mandan el mismo aviso);
 *  · un solo mensaje por vuelta, hacia el número de ESA clínica, sin datos del paciente;
 *  · si el envío no le llega a nadie, se devuelve la reclamación para que la próxima
 *    vuelta reintente;
 *  · §12 #14: si nadie la toma, se RECUERDA (también a «Solo recordatorios»), pocas veces;
 *  · 2026-11-02 (docs/PLAN_AVISOS_AGENDADORES.md): va a una LISTA de personas, cada una
 *    con su modo, sus avisos y su alcance, y un mensaje por persona.
 */
describe('MirrorAlertService', () => {
  const ORG = 'org-1';
  const AHORA = new Date('2026-09-22T15:00:00.000Z');
  const inicio = (horas: number) =>
    new Date(AHORA.getTime() + horas * 3_600_000);

  const excepcion = (over: Record<string, unknown> = {}) => ({
    id: 'ex-1',
    organizationId: ORG,
    kind: 'CITA_NO_ENTREGADA',
    severity: 'MEDIA',
    status: 'ABIERTA',
    notifiedSeverity: null as string | null,
    notifiedAt: null as Date | null,
    reminderCount: 0,
    appointmentStartAt: inicio(48),
    doctorId: 'doc-1',
    ...over,
  });

  const CONFIG = {
    enabled: true,
    conflictAlertsEnabled: true,
    lastHeartbeatAt: new Date(AHORA.getTime() - 60_000),
    lastHisReachable: true as boolean | null,
  };

  /** Una fila de `SyncAlertRecipient` como la lee el servicio. */
  const persona = (over: Record<string, unknown> = {}) => ({
    id: 'r-1',
    label: null as string | null,
    phone: '573001112233',
    mode: 'AVISOS',
    syncAlerts: true,
    patientRequestAlerts: true,
    isActive: true,
    createdAt: AHORA,
    user: {
      email: 'karen@hsvp.co',
      role: 'BOOKING_AGENT',
      agentProfile: { fullName: 'Karen Muñoz', epsId: null, doctorId: null },
    } as unknown,
    ...over,
  });
  const RESPALDO = persona({
    id: 'r-2',
    label: 'Coordinación',
    phone: '573009998877',
    mode: 'SOLO_RECORDATORIOS',
    user: null,
  });

  const build = (
    opts: {
      excepciones?: unknown[];
      config?: unknown;
      plantilla?: unknown;
      envio?: { success: boolean; error?: string };
      /** Un resultado por envío, en orden (para distinguir a cada persona). */
      envios?: { success: boolean; error?: string; wamid?: string }[];
      reclamos?: boolean[];
      timezone?: string | null;
      destinatarios?: ReturnType<typeof persona>[];
      /** «Probar»: cuántas filas gana el compare-and-set sobre `lastTestAt`. */
      pruebaGanada?: number;
    } = {},
  ) => {
    const orden: string[] = [];
    let reclamo = 0;
    let envio = 0;
    const prisma = {
      syncException: {
        findMany: jest.fn(
          async (..._a: unknown[]) => opts.excepciones ?? [excepcion()],
        ),
      },
      hospitalMirrorConfig: {
        findUnique: jest.fn(async (..._a: unknown[]) =>
          'config' in opts ? opts.config : CONFIG,
        ),
      },
      doctorProfile: {
        findMany: jest.fn(async (..._a: unknown[]) => [
          { id: 'doc-1', fullName: 'Ana Ruiz', isFunctionalAgenda: false },
        ]),
      },
      organization: {
        findUnique: jest.fn(async (..._a: unknown[]) => ({
          timezone: opts.timezone ?? null,
        })),
      },
      syncAlertRecipient: {
        findMany: jest.fn(
          async (arg: {
            where: { organizationId: string; isActive: boolean };
          }) =>
            (opts.destinatarios ?? [persona()]).filter(
              (d) => d.isActive === arg.where.isActive,
            ),
        ),
        findFirst: jest.fn(
          async (arg: { where: { id: string } }) =>
            (opts.destinatarios ?? [persona()]).find(
              (d) => d.id === arg.where.id,
            ) ?? null,
        ),
        updateMany: jest.fn(async (arg: { data: Record<string, unknown> }) => ({
          count: 'lastTestAt' in arg.data ? (opts.pruebaGanada ?? 1) : 1,
        })),
      },
      syncAudit: { create: jest.fn(async (..._a: unknown[]) => ({})) },
    };
    const exceptions = {
      reclamarAviso: jest.fn(async (..._a: unknown[]) => {
        orden.push('reclamar');
        const r = opts.reclamos ? opts.reclamos[reclamo] : true;
        reclamo++;
        return r ?? true;
      }),
      devolverAviso: jest.fn(async (..._a: unknown[]) => undefined),
      anotar: jest.fn(async (..._a: unknown[]) => undefined),
    };
    const templates = {
      findTemplate: jest.fn(async (..._a: unknown[]) =>
        'plantilla' in opts
          ? opts.plantilla
          : { name: 'aviso_sync', language: 'es' },
      ),
      sendTemplate: jest.fn(async (..._a: unknown[]) => {
        orden.push('enviar');
        const r = opts.envios?.[envio];
        envio++;
        return (
          r ??
          opts.envio ?? {
            success: true,
            templateName: 'aviso_sync',
            wamid: `wamid.${envio}`,
          }
        );
      }),
    };
    const service = new MirrorAlertService(
      prisma as never,
      exceptions as never,
      templates as never,
    );
    return { service, prisma, exceptions, templates, orden };
  };

  describe('cuándo NO se avisa', () => {
    it('sin excepciones: no hace nada (ni lee la configuración)', async () => {
      const { service, prisma } = build({ excepciones: [] });

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: false,
        motivo: 'NADA_QUE_AVISAR',
      });
      expect(prisma.hospitalMirrorConfig.findUnique).not.toHaveBeenCalled();
    });

    it('ya avisada con esa gravedad: no repite', async () => {
      const { service, exceptions } = build({
        excepciones: [excepcion({ notifiedSeverity: 'MEDIA' })],
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        motivo: 'NADA_QUE_AVISAR',
      });
      expect(exceptions.reclamarAviso).not.toHaveBeenCalled();
    });

    it('🕐 una cita que ya empezó no se avisa: el aviso es para ANTES de la hora', async () => {
      const { service } = build({
        excepciones: [excepcion({ appointmentStartAt: inicio(-1) })],
      });
      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        motivo: 'NADA_QUE_AVISAR',
      });
    });

    it('pide SOLO las abiertas de esa clínica y de los tipos que le importan al agendador', async () => {
      const { service, prisma } = build({ excepciones: [] });

      await service.avisar(ORG, AHORA);

      expect(prisma.syncException.findMany.mock.calls[0][0]).toMatchObject({
        where: {
          organizationId: ORG,
          status: 'ABIERTA',
          kind: { in: [...TIPOS_CON_AVISO] },
        },
      });
      // Los tipos técnicos no van al teléfono de nadie.
      const tipos = (
        prisma.syncException.findMany.mock.calls[0][0] as {
          where: { kind: { in: string[] } };
        }
      ).where.kind.in;
      expect(tipos).not.toContain('EVENTO_RENDIDO');
      expect(tipos).not.toContain('ERROR_SYNC');
    });

    it.each([
      ['el espejo está apagado', { ...CONFIG, enabled: false }, 'APAGADO'],
      [
        'los avisos están apagados',
        { ...CONFIG, conflictAlertsEnabled: false },
        'APAGADO',
      ],
      ['no hay configuración de espejo', null, 'APAGADO'],
    ])('%s → %s, sin reclamar ni enviar nada', async (_n, config, motivo) => {
      const { service, exceptions, templates } = build({ config });

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: false,
        motivo,
      });
      expect(exceptions.reclamarAviso).not.toHaveBeenCalled();
      expect(templates.sendTemplate).not.toHaveBeenCalled();
    });

    it.each([
      ['no hay nadie en la lista', []],
      ['la única persona está en pausa', [persona({ isActive: false })]],
      [
        'solo hay «Solo recordatorios» (es un escalamiento, no un sustituto)',
        [RESPALDO],
      ],
      ['nadie marcó este aviso', [persona({ syncAlerts: false })]],
    ])(
      '%s → SIN_DESTINO, sin reclamar ni enviar nada',
      async (_n, destinatarios) => {
        const { service, exceptions, templates } = build({ destinatarios });

        await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
          enviado: false,
          motivo: 'SIN_DESTINO',
        });
        expect(exceptions.reclamarAviso).not.toHaveBeenCalled();
        expect(templates.sendTemplate).not.toHaveBeenCalled();
      },
    );

    it('🏢 la lista se lee SOLO de esa clínica, y solo las activas', async () => {
      const { service, prisma } = build();
      await service.avisar(ORG, AHORA);
      expect(prisma.syncAlertRecipient.findMany.mock.calls[0][0]).toMatchObject(
        { where: { organizationId: ORG, isActive: true } },
      );
    });

    it('sin la plantilla aprobada: SIN_PLANTILLA, y tampoco se toca ninguna fila', async () => {
      const { service, exceptions, templates } = build({ plantilla: null });

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: false,
        motivo: 'SIN_PLANTILLA',
      });
      expect(templates.findTemplate).toHaveBeenCalledWith(
        ORG,
        'SYNC_EXCEPTION_ALERT',
      );
      expect(exceptions.reclamarAviso).not.toHaveBeenCalled();
    });
  });

  describe('el aviso', () => {
    it('reclama ANTES de enviar, y manda UN solo mensaje aunque haya varias excepciones', async () => {
      const { service, templates, orden } = build({
        excepciones: [
          excepcion({ id: 'a' }),
          excepcion({ id: 'b', kind: 'DERIVA_EN_HIS', severity: 'ALTA' }),
          excepcion({ id: 'c' }),
        ],
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        enviado: true,
        citas: 3,
        recordatorios: 0,
      });

      expect(orden).toEqual(['reclamar', 'reclamar', 'reclamar', 'enviar']);
      expect(templates.sendTemplate).toHaveBeenCalledTimes(1);
    });

    it('🔒 sale por la clínica y hacia el número de la persona de la lista, con la plantilla del aviso', async () => {
      const { service, templates } = build();

      await service.avisar(ORG, AHORA);

      expect(templates.sendTemplate.mock.calls[0][0]).toMatchObject({
        organizationId: ORG,
        recipientId: '573001112233',
        kind: 'SYNC_EXCEPTION_ALERT',
      });
    });

    it('lleva TRES variables: cuántas, la más próxima (médico y hora local) y la causa', async () => {
      const { service, templates } = build({
        excepciones: [
          excepcion({
            appointmentStartAt: new Date('2026-09-23T15:00:00.000Z'),
          }),
        ],
      });

      await service.avisar(ORG, AHORA);

      const { bodyParams } = templates.sendTemplate.mock.calls[0][0] as {
        bodyParams: string[];
      };
      expect(bodyParams).toHaveLength(3);
      // Solo el número: la plantilla aprobada dice «{{1}} cita(s)».
      expect(bodyParams[0]).toBe('1');
      expect(bodyParams[1]).toMatch(/Dr\(a\)\. Ana Ruiz/);
      // 15:00 UTC = 10:00 en Bogotá (la zona por defecto).
      expect(bodyParams[1]).toMatch(/10:00/);
    });

    it('la hora sale en la zona de la clínica, no en UTC', async () => {
      const { service, templates } = build({
        excepciones: [
          excepcion({
            appointmentStartAt: new Date('2026-09-23T15:00:00.000Z'),
          }),
        ],
        timezone: 'America/Mexico_City',
      });

      await service.avisar(ORG, AHORA);

      const { bodyParams } = templates.sendTemplate.mock.calls[0][0] as {
        bodyParams: string[];
      };
      expect(bodyParams[1]).toMatch(/9:00|09:00/);
    });

    it('🔒 nada del paciente en el mensaje: ni su id, ni nada parecido a un documento o un teléfono', async () => {
      const { service, templates } = build({
        excepciones: [
          excepcion({
            patientId: 'pac-9',
            appointmentId: 'apt-9',
            detail: 'Failed to connect to 192.168.1.16:1433',
          }),
        ],
      });

      await service.avisar(ORG, AHORA);

      const texto = (
        templates.sendTemplate.mock.calls[0][0] as { bodyParams: string[] }
      ).bodyParams.join(' ');
      expect(texto).not.toMatch(/pac-9|apt-9|192\.168|\d{6,}/);
    });

    it('un médico desconocido no rompe el aviso', async () => {
      const { service, templates } = build({
        excepciones: [excepcion({ doctorId: null })],
      });

      await service.avisar(ORG, AHORA);

      expect(
        (templates.sendTemplate.mock.calls[0][0] as { bodyParams: string[] })
          .bodyParams[1],
      ).toMatch(/Agenda del hospital/);
    });

    it('los médicos se leen SOLO de esa clínica', async () => {
      const { service, prisma } = build();
      await service.avisar(ORG, AHORA);
      expect(prisma.doctorProfile.findMany.mock.calls[0][0]).toMatchObject({
        where: { organizationId: ORG },
      });
    });

    it.each([
      [
        'el agente no da señales hace 20 min',
        { lastHeartbeatAt: new Date(AHORA.getTime() - 20 * 60_000) },
        /no da señales/,
      ],
      ['el agente nunca latió', { lastHeartbeatAt: null }, /no da señales/],
      [
        'el agente vive pero no alcanza el HIS',
        { lastHisReachable: false },
        /no puede comunicarse/,
      ],
      ['el agente vive y el HIS responde', {}, /fallando|rechaz|revise/],
    ])('la causa probable cuando %s', async (_n, extra, patron) => {
      const { service, templates } = build({ config: { ...CONFIG, ...extra } });

      await service.avisar(ORG, AHORA);

      expect(
        (templates.sendTemplate.mock.calls[0][0] as { bodyParams: string[] })
          .bodyParams[2],
      ).toMatch(patron);
    });
  });

  describe('dos réplicas a la vez', () => {
    it('🏁 si otra réplica ya reclamó TODAS, esta no envía nada', async () => {
      const { service, templates } = build({
        excepciones: [excepcion({ id: 'a' }), excepcion({ id: 'b' })],
        reclamos: [false, false],
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: false,
        motivo: 'YA_RECLAMADO',
      });
      expect(templates.sendTemplate).not.toHaveBeenCalled();
    });

    it('si reclamó solo algunas, avisa SOLO de esas', async () => {
      const { service, templates } = build({
        excepciones: [
          excepcion({ id: 'a' }),
          excepcion({ id: 'b' }),
          excepcion({ id: 'c' }),
        ],
        reclamos: [true, false, true],
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        enviado: true,
        citas: 2,
        recordatorios: 0,
      });
      expect(
        (templates.sendTemplate.mock.calls[0][0] as { bodyParams: string[] })
          .bodyParams[0],
      ).toBe('2');
    });
  });

  describe('resultado del envío', () => {
    it('✅ salió: deja constancia de que se avisó, en cada excepción y con el NOMBRE (nunca el número)', async () => {
      const { service, exceptions } = build({
        excepciones: [excepcion({ id: 'a' }), excepcion({ id: 'b' })],
      });

      await service.avisar(ORG, AHORA);

      expect(exceptions.anotar.mock.calls.map((c) => [c[0], c[1]])).toEqual([
        ['a', 'AVISADA'],
        ['b', 'AVISADA'],
      ]);
      expect(exceptions.anotar.mock.calls[0][4]).toBe(
        'Aviso por WhatsApp a Karen Muñoz.',
      );
      expect(JSON.stringify(exceptions.anotar.mock.calls)).not.toMatch(
        /3001112233/,
      );
    });

    it('🩺 anota en la fila de la persona el último envío (con su wamid, para leer si se entregó)', async () => {
      const { service, prisma } = build();
      await service.avisar(ORG, AHORA);
      expect(prisma.syncAlertRecipient.updateMany).toHaveBeenCalledWith({
        where: { id: 'r-1' },
        data: { lastSentAt: AHORA, lastWamid: 'wamid.1' },
      });
    });

    it('devuelve cómo le fue a cada persona, para la alerta técnica', async () => {
      const { service } = build();
      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        destinatarios: [
          { id: 'r-1', nombre: 'Karen Muñoz', phone: '573001112233', ok: true },
        ],
      });
    });

    it('❌ no salió: se DEVUELVE la reclamación (con lo que tenía antes) y no se dice que se avisó', async () => {
      const previo = new Date('2026-09-22T10:00:00.000Z');
      const { service, exceptions } = build({
        excepciones: [
          excepcion({ id: 'a', notifiedSeverity: null, notifiedAt: null }),
          excepcion({
            id: 'b',
            severity: 'ALTA',
            notifiedSeverity: 'MEDIA',
            notifiedAt: previo,
          }),
        ],
        envio: { success: false, error: 'template-not-configured' },
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        enviado: false,
        motivo: 'ENVIO_FALLIDO',
        detalle: 'falta registrar la plantilla en Configuración',
      });

      expect(exceptions.devolverAviso.mock.calls).toEqual([
        [
          {
            id: 'a',
            notifiedAt: null,
            notifiedSeverity: null,
            reminderCount: 0,
          },
          AHORA,
        ],
        [
          {
            id: 'b',
            notifiedAt: previo,
            notifiedSeverity: 'MEDIA',
            reminderCount: 0,
          },
          AHORA,
        ],
      ]);
      expect(exceptions.anotar).not.toHaveBeenCalled();
    });

    it('una excepción que ya se avisó como MEDIA y ahora es ALTA se vuelve a avisar', async () => {
      const { service, templates } = build({
        excepciones: [
          excepcion({ severity: 'ALTA', notifiedSeverity: 'MEDIA' }),
        ],
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        enviado: true,
        citas: 1,
        recordatorios: 0,
      });
      expect(templates.sendTemplate).toHaveBeenCalledTimes(1);
    });
  });
  describe('recordatorios: nadie tomó la excepción (§12 #14)', () => {
    const olvidada = (over: Record<string, unknown> = {}) =>
      excepcion({
        notifiedSeverity: 'MEDIA',
        notifiedAt: new Date(AHORA.getTime() - 31 * 60_000),
        ...over,
      });
    const conRespaldo = [persona(), RESPALDO];
    const destinatarios = (t: ReturnType<typeof build>['templates']) =>
      t.sendTemplate.mock.calls.map(
        (c) => (c[0] as { recipientId: string }).recipientId,
      );

    it('avisada hace 31 min y nadie la tomó: recordatorio a quien recibe avisos Y a «Solo recordatorios», con la MISMA plantilla', async () => {
      const { service, templates, exceptions } = build({
        excepciones: [olvidada()],
        destinatarios: conRespaldo,
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        enviado: true,
        citas: 0,
        recordatorios: 1,
      });

      expect(destinatarios(templates)).toEqual([
        '573001112233',
        '573009998877',
      ]);
      for (const c of templates.sendTemplate.mock.calls) {
        const arg = c[0] as { kind: string; bodyParams: string[] };
        expect(arg.kind).toBe('SYNC_EXCEPTION_ALERT');
        expect(arg.bodyParams[2]).toMatch(
          /^RECORDATORIO 1 de 2: nadie la ha tomado/,
        );
      }
      // Se reclama como RECORDATORIO (compare-and-set sobre hora y cuenta).
      expect(exceptions.reclamarAviso.mock.calls[0][2]).toBe('RECORDATORIO');
      expect(exceptions.anotar.mock.calls[0]).toEqual([
        'ex-1',
        'RECORDADA',
        null,
        null,
        'Recordatorio 1 de 2 por WhatsApp a Karen Muñoz y Coordinación: nadie la había tomado.',
      ]);
    });

    it('sin nadie en «Solo recordatorios»: el recordatorio va a quien recibió el aviso', async () => {
      const { service, templates, exceptions } = build({
        excepciones: [olvidada()],
      });

      await service.avisar(ORG, AHORA);

      expect(destinatarios(templates)).toEqual(['573001112233']);
      expect(exceptions.anotar.mock.calls[0][4]).toMatch(/a Karen Muñoz:/);
    });

    it('el segundo recordatorio dice «2 de 2»', async () => {
      const { service, templates } = build({
        excepciones: [olvidada({ reminderCount: 1 })],
      });
      await service.avisar(ORG, AHORA);
      expect(
        (templates.sendTemplate.mock.calls[0][0] as { bodyParams: string[] })
          .bodyParams[2],
      ).toMatch(/^RECORDATORIO 2 de 2/);
    });

    it('tras el último recordatorio no se insiste: queda la bandeja', async () => {
      const { service, templates } = build({
        excepciones: [olvidada({ reminderCount: 2 })],
        destinatarios: conRespaldo,
      });
      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        motivo: 'NADA_QUE_AVISAR',
      });
      expect(templates.sendTemplate).not.toHaveBeenCalled();
    });

    it('👤 si alguien la tomó, no se recuerda (ni siquiera se consulta)', async () => {
      // La consulta pide SOLO las ABIERTAS: una tomada (EN_REVISION) no llega aquí.
      const { service, prisma } = build({ excepciones: [] });
      await service.avisar(ORG, AHORA);
      expect(prisma.syncException.findMany.mock.calls[0][0]).toMatchObject({
        where: { status: 'ABIERTA' },
      });
    });

    it('si falla SOLO una persona: los demás lo recibieron, no se devuelve nada y el historial dice a quién no le salió', async () => {
      const { service, exceptions, prisma } = build({
        excepciones: [olvidada()],
        destinatarios: conRespaldo,
        envios: [
          { success: true, wamid: 'wamid.k' },
          {
            success: false,
            error: JSON.stringify({
              error: { message: 'Invalid parameter', code: 100 },
            }),
          },
        ],
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        enviado: true,
        recordatorios: 1,
        destinatarios: [
          { id: 'r-1', ok: true },
          { id: 'r-2', ok: false, error: 'Invalid parameter (código 100)' },
        ],
      });
      expect(exceptions.devolverAviso).not.toHaveBeenCalled();
      expect(exceptions.anotar.mock.calls[0][4]).toBe(
        'Recordatorio 1 de 2 por WhatsApp a Karen Muñoz: nadie la había tomado. No le salió a Coordinación.',
      );
      expect(prisma.syncAlertRecipient.updateMany).toHaveBeenCalledWith({
        where: { id: 'r-2' },
        data: {
          lastError: 'Invalid parameter (código 100)',
          lastErrorAt: AHORA,
        },
      });
    });

    it('si no le sale a NADIE: se devuelve (con su cuenta) y no se anota como recordada', async () => {
      const previo = new Date(AHORA.getTime() - 31 * 60_000);
      const { service, exceptions, templates } = build({
        excepciones: [olvidada({ notifiedAt: previo, reminderCount: 1 })],
        destinatarios: conRespaldo,
        envio: { success: false, error: 'whatsapp-inactive' },
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        enviado: false,
        motivo: 'ENVIO_FALLIDO',
        detalle: 'el WhatsApp de la clínica está apagado',
      });
      expect(templates.sendTemplate).toHaveBeenCalledTimes(2);
      expect(exceptions.devolverAviso.mock.calls[0][0]).toEqual({
        id: 'ex-1',
        notifiedAt: previo,
        notifiedSeverity: 'MEDIA',
        reminderCount: 1,
      });
      expect(exceptions.anotar).not.toHaveBeenCalled();
    });

    it('avisos nuevos y recordatorios en la misma vuelta van en mensajes APARTE: el nuevo, solo a «Avisos y recordatorios» y sin la marca', async () => {
      const { service, templates, exceptions } = build({
        excepciones: [excepcion({ id: 'nueva' }), olvidada({ id: 'vieja' })],
        destinatarios: conRespaldo,
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        enviado: true,
        citas: 1,
        recordatorios: 1,
      });

      const envios = templates.sendTemplate.mock.calls.map(
        (c) => c[0] as { recipientId: string; bodyParams: string[] },
      );
      expect(envios.map((e) => e.recipientId)).toEqual([
        '573001112233',
        '573001112233',
        '573009998877',
      ]);
      expect(envios[0].bodyParams[2]).not.toMatch(/RECORDATORIO/);
      expect(envios[1].bodyParams[2]).toMatch(/^RECORDATORIO/);
      expect(exceptions.anotar.mock.calls.map((c) => [c[0], c[1]])).toEqual([
        ['nueva', 'AVISADA'],
        ['vieja', 'RECORDADA'],
      ]);
    });
  });

  describe('📣 varias personas (docs/PLAN_AVISOS_AGENDADORES.md)', () => {
    const karen = persona();
    const ana = persona({
      id: 'r-3',
      phone: '573005550103',
      user: {
        email: 'ana@hsvp.co',
        role: 'BOOKING_AGENT',
        agentProfile: { fullName: 'Ana García', epsId: null, doctorId: null },
      },
    });
    const sura = persona({
      id: 'r-4',
      phone: '573005550104',
      user: {
        email: 'sura@hsvp.co',
        role: 'BOOKING_AGENT',
        agentProfile: {
          fullName: 'Jeisson Rojas',
          epsId: 'eps-sura',
          doctorId: null,
        },
      },
    });
    const envios = (t: ReturnType<typeof build>['templates']) =>
      t.sendTemplate.mock.calls.map(
        (c) => c[0] as { recipientId: string; bodyParams: string[] },
      );

    it('cada persona recibe UN mensaje con el resumen, y el historial las nombra a todas', async () => {
      const { service, templates, exceptions } = build({
        excepciones: [excepcion({ id: 'a' }), excepcion({ id: 'b' })],
        destinatarios: [karen, ana],
      });

      await service.avisar(ORG, AHORA);

      expect(
        envios(templates).map((e) => [e.recipientId, e.bodyParams[0]]),
      ).toEqual([
        ['573001112233', '2'],
        ['573005550103', '2'],
      ]);
      expect(exceptions.anotar.mock.calls[0][4]).toBe(
        'Aviso por WhatsApp a Karen Muñoz y Ana García.',
      );
    });

    it('🎯 un agendador acotado a una EPS recibe SOLO lo suyo, y su cuenta es la suya (N3)', async () => {
      const { service, templates } = build({
        excepciones: [
          excepcion({ id: 'a', epsId: 'eps-sura' }),
          excepcion({ id: 'b', epsId: 'eps-salud' }),
          excepcion({ id: 'c', epsId: 'eps-salud' }),
        ],
        destinatarios: [karen, sura],
      });

      await service.avisar(ORG, AHORA);

      expect(
        envios(templates).map((e) => [e.recipientId, e.bodyParams[0]]),
      ).toEqual([
        ['573001112233', '3'],
        ['573005550104', '1'],
      ]);
    });

    it('N4: lo que por alcance no le cabe a nadie les llega a todos (mejor un mensaje de más que un caso perdido)', async () => {
      const { service, templates, exceptions } = build({
        excepciones: [excepcion({ id: 'a', epsId: null })],
        destinatarios: [sura],
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        enviado: true,
        citas: 1,
      });
      expect(envios(templates).map((e) => e.recipientId)).toEqual([
        '573005550104',
      ]);
      expect(exceptions.anotar.mock.calls[0][4]).toMatch(/Jeisson Rojas/);
    });

    it('una persona en pausa no recibe nada (la consulta trae solo las activas)', async () => {
      const { service, templates } = build({
        destinatarios: [
          karen,
          persona({ id: 'r-9', phone: '573000000009', isActive: false }),
        ],
      });
      await service.avisar(ORG, AHORA);
      expect(envios(templates).map((e) => e.recipientId)).toEqual([
        '573001112233',
      ]);
    });

    it('si a quien le tocaba un caso no le sale, ese caso se devuelve aunque otros sí hayan salido', async () => {
      const { service, exceptions } = build({
        excepciones: [
          excepcion({ id: 'a', epsId: 'eps-sura' }),
          excepcion({ id: 'b', epsId: 'eps-salud' }),
        ],
        // Solo Jeisson (acotado a Sura) recibe el aviso de la sincronización.
        destinatarios: [
          sura,
          persona({ id: 'r-5', phone: '573000000005', syncAlerts: false }),
        ],
        envio: { success: false, error: 'meta-400' },
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        motivo: 'ENVIO_FALLIDO',
      });
      expect(
        exceptions.devolverAviso.mock.calls.map(
          (c) => (c[0] as { id: string }).id,
        ),
      ).toEqual(['a', 'b']);
    });
  });

  describe('«Probar» (N9)', () => {
    it('manda la plantilla del aviso con el texto de PRUEBA, anota la salud y deja constancia con el número enmascarado', async () => {
      const { service, templates, prisma } = build();

      await expect(
        service.probar(ORG, 'r-1', 'admin@hsvp.co', AHORA),
      ).resolves.toEqual({ success: true });

      const envio = templates.sendTemplate.mock.calls[0][0] as {
        kind: string;
        recipientId: string;
        bodyParams: string[];
      };
      expect(envio.kind).toBe('SYNC_EXCEPTION_ALERT');
      expect(envio.recipientId).toBe('573001112233');
      expect(envio.bodyParams[0]).toBe('0');
      expect(envio.bodyParams.join(' ')).toMatch(/PRUEBA/);
      expect(prisma.syncAlertRecipient.updateMany).toHaveBeenCalledWith({
        where: { id: 'r-1' },
        data: { lastSentAt: AHORA, lastWamid: 'wamid.1' },
      });
      const auditoria = (
        prisma.syncAudit.create.mock.calls[0][0] as {
          data: Record<string, string>;
        }
      ).data;
      expect(auditoria).toMatchObject({
        organizationId: ORG,
        direction: 'CONFIG',
        entityType: 'SyncAlertRecipient',
        op: 'ALERT_TEST',
        outcome: 'OK',
      });
      expect(auditoria.detail).toMatch(/Karen Muñoz \(•••2233\)/);
      expect(auditoria.detail).toMatch(/admin@hsvp\.co/);
      expect(auditoria.detail).not.toMatch(/3001112233/);
    });

    it('🏢 busca a la persona DENTRO de la clínica', async () => {
      const { service, prisma } = build();
      await service.probar(ORG, 'r-1', 'x', AHORA);
      expect(
        prisma.syncAlertRecipient.findFirst.mock.calls[0][0],
      ).toMatchObject({
        where: { id: 'r-1', organizationId: ORG },
      });
    });

    it('si ya no está en la lista, lo dice y no envía', async () => {
      const { service, templates } = build();
      await expect(service.probar(ORG, 'r-otra', 'x', AHORA)).resolves.toEqual({
        success: false,
        error: expect.stringMatching(/ya no está en la lista/),
      });
      expect(templates.sendTemplate).not.toHaveBeenCalled();
    });

    it('⏱️ una prueba cada 5 minutos por persona: el compare-and-set sobre lastTestAt decide', async () => {
      const { service, templates, prisma } = build({ pruebaGanada: 0 });
      await expect(service.probar(ORG, 'r-1', 'x', AHORA)).resolves.toEqual({
        success: false,
        error: expect.stringMatching(/espera 5 minutos/),
      });
      expect(templates.sendTemplate).not.toHaveBeenCalled();
      expect(
        prisma.syncAlertRecipient.updateMany.mock.calls[0][0],
      ).toMatchObject({
        where: {
          id: 'r-1',
          organizationId: ORG,
          OR: [
            { lastTestAt: null },
            { lastTestAt: { lt: new Date(AHORA.getTime() - 5 * 60_000) } },
          ],
        },
        data: { lastTestAt: AHORA },
      });
    });

    it('si Meta la rechaza: dice por qué, lo anota en la fila y la constancia queda como ERROR', async () => {
      const { service, prisma } = build({
        envio: { success: false, error: 'template-not-configured' },
      });
      await expect(service.probar(ORG, 'r-1', 'x', AHORA)).resolves.toEqual({
        success: false,
        error: 'No salió: falta registrar la plantilla en Configuración.',
      });
      expect(prisma.syncAlertRecipient.updateMany).toHaveBeenCalledWith({
        where: { id: 'r-1' },
        data: {
          lastError: 'falta registrar la plantilla en Configuración',
          lastErrorAt: AHORA,
        },
      });
      expect(
        (
          prisma.syncAudit.create.mock.calls[0][0] as {
            data: { outcome: string };
          }
        ).data.outcome,
      ).toBe('ERROR');
    });
  });
});

/**
 * 🙋 El aviso de pedidos de pacientes (2026-10-27): un paciente pidió cancelar y no
 * confirmó, o avisó que no irá, y su cita es en 24 h o menos. Va con su propia
 * plantilla, al mismo número del agendador y con las mismas reglas.
 */
describe('MirrorAlertService — pedidos de pacientes', () => {
  const ORG = 'org-1';
  const AHORA = new Date('2026-10-26T15:24:00.000Z'); // lun 10:24 en Bogotá
  const inicio = (horas: number) =>
    new Date(AHORA.getTime() + horas * 3_600_000);

  const pedido = (over: Record<string, unknown> = {}) => ({
    id: 'ex-p',
    organizationId: ORG,
    kind: 'CANCELACION_SIN_CONFIRMAR',
    severity: 'CRITICA',
    status: 'ABIERTA',
    notifiedSeverity: null as string | null,
    notifiedAt: null as Date | null,
    reminderCount: 0,
    appointmentStartAt: inicio(1.6), // la cita de las 12:00
    doctorId: 'doc-1',
    ...over,
  });

  const AGENDADORA = {
    id: 'r-1',
    label: null,
    phone: '573001113575',
    mode: 'AVISOS',
    syncAlerts: true,
    patientRequestAlerts: true,
    isActive: true,
    user: {
      email: 'karen@hsvp.co',
      role: 'BOOKING_AGENT',
      agentProfile: { fullName: 'Karen Muñoz', epsId: null, doctorId: null },
    },
  };

  const build = (
    opts: {
      excepciones?: unknown[];
      plantilla?: unknown;
      destinatarios?: unknown[];
    } = {},
  ) => {
    const prisma = {
      syncException: {
        findMany: jest.fn(async (arg: { where: { kind: { in: string[] } } }) =>
          ((opts.excepciones ?? [pedido()]) as { kind: string }[]).filter((e) =>
            arg.where.kind.in.includes(e.kind),
          ),
        ),
      },
      hospitalMirrorConfig: {
        findUnique: jest.fn(async () => ({
          enabled: true,
          conflictAlertsEnabled: true,
          lastHeartbeatAt: AHORA,
          lastHisReachable: true,
        })),
      },
      syncAlertRecipient: {
        findMany: jest.fn(async () => opts.destinatarios ?? [AGENDADORA]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      doctorProfile: {
        findMany: jest.fn(async () => [
          { id: 'doc-1', fullName: 'Ana Ruiz', isFunctionalAgenda: false },
        ]),
      },
      organization: { findUnique: jest.fn(async () => ({ timezone: null })) },
    };
    const exceptions = {
      reclamarAviso: jest.fn(async () => true),
      devolverAviso: jest.fn(async () => undefined),
      anotar: jest.fn(async () => undefined),
    };
    const templates = {
      findTemplate: jest.fn(async (_org: string, kind: string) =>
        'plantilla' in opts
          ? opts.plantilla
          : {
              name:
                kind === 'PATIENT_REQUEST_ALERT'
                  ? 'aviso_pacientes'
                  : 'aviso_sync',
            },
      ),
      sendTemplate: jest.fn(async () => ({ success: true })),
    };
    const service = new MirrorAlertService(
      prisma as never,
      exceptions as never,
      templates as never,
    );
    return { service, prisma, exceptions, templates };
  };

  it('la cita en 1 h y media: sale con PATIENT_REQUEST_ALERT, a la lista y sin datos del paciente', async () => {
    const { service, templates, exceptions } = build();

    await expect(
      service.avisarPedidosDePacientes(ORG, AHORA),
    ).resolves.toMatchObject({ enviado: true, citas: 1, recordatorios: 0 });
    expect(exceptions.reclamarAviso).toHaveBeenCalledTimes(1);
    const envio = (templates.sendTemplate.mock.calls as unknown[][])[0][0] as {
      kind: string;
      recipientId: string;
      bodyParams: string[];
    };
    expect(envio.kind).toBe('PATIENT_REQUEST_ALERT');
    expect(envio.recipientId).toBe('573001113575');
    expect(envio.bodyParams).toHaveLength(3);
    expect(envio.bodyParams[0]).toBe('1 caso');
    expect(envio.bodyParams[1]).toMatch(/Ana Ruiz/);
    expect(envio.bodyParams[2]).toMatch(/pidió cancelar/);
  });

  it('la cita en 3 días: todavía no, solo la bandeja', async () => {
    const { service, templates } = build({
      excepciones: [
        pedido({ severity: 'MEDIA', appointmentStartAt: inicio(72) }),
      ],
    });
    await expect(
      service.avisarPedidosDePacientes(ORG, AHORA),
    ).resolves.toMatchObject({ enviado: false, motivo: 'NADA_QUE_AVISAR' });
    expect(templates.sendTemplate).not.toHaveBeenCalled();
  });

  it('quien no marcó «Pedidos de pacientes» no los recibe', async () => {
    const { service, templates } = build({
      destinatarios: [
        { ...AGENDADORA, patientRequestAlerts: false },
        {
          ...AGENDADORA,
          id: 'r-2',
          phone: '573005550102',
          syncAlerts: false,
        },
      ],
    });
    await service.avisarPedidosDePacientes(ORG, AHORA);
    expect(
      (templates.sendTemplate.mock.calls as unknown[][]).map(
        (c) => (c[0] as { recipientId: string }).recipientId,
      ),
    ).toEqual(['573005550102']);
  });

  it('sin la plantilla registrada no sale y lo dice (no usa la del otro aviso)', async () => {
    const { service, templates } = build({ plantilla: null });
    await expect(
      service.avisarPedidosDePacientes(ORG, AHORA),
    ).resolves.toMatchObject({ enviado: false, motivo: 'SIN_PLANTILLA' });
    expect(templates.findTemplate).toHaveBeenCalledWith(
      ORG,
      'PATIENT_REQUEST_ALERT',
    );
    expect(templates.sendTemplate).not.toHaveBeenCalled();
  });

  it('el aviso de la sincronización no los toma, ni este toma los de la sincronización', async () => {
    const sync = {
      ...pedido(),
      id: 'ex-sync',
      kind: 'CITA_NO_ENTREGADA',
    };
    const { service, templates } = build({ excepciones: [pedido(), sync] });

    await service.avisar(ORG, AHORA);
    await service.avisarPedidosDePacientes(ORG, AHORA);

    const kinds = (templates.sendTemplate.mock.calls as unknown[][]).map(
      (c) => (c[0] as { kind: string; bodyParams: string[] }).kind,
    );
    expect(kinds).toEqual(['SYNC_EXCEPTION_ALERT', 'PATIENT_REQUEST_ALERT']);
    const pacientes = (
      templates.sendTemplate.mock.calls as unknown[][]
    )[1][0] as {
      bodyParams: string[];
    };
    expect(pacientes.bodyParams[0]).toBe('1 caso');
  });
});
