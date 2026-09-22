import { TIPOS_CON_AVISO } from '@agenia/shared';
import { MirrorAlertService } from './mirror-alert.service';

/**
 * El aviso proactivo al agendador. Lo que se fija:
 *
 *  · si el aviso NO puede salir (apagado, sin número, sin plantilla) no se reclama ni
 *    se toca ninguna fila: reclamar y devolver en cada vuelta sería ruido de escritura;
 *  · se reclama ANTES de enviar (dos réplicas no mandan el mismo aviso);
 *  · un solo mensaje por vuelta, hacia el número de ESA clínica, sin datos del paciente;
 *  · si el envío falla, se devuelve la reclamación para que la próxima vuelta reintente;
 *  · §12 #14: si nadie la toma, se RECUERDA al agendador y al respaldo, pocas veces.
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
    agendadorWhatsapp: '573001112233',
    agendadorRespaldoWhatsapp: null as string | null,
    lastHeartbeatAt: new Date(AHORA.getTime() - 60_000),
    lastHisReachable: true as boolean | null,
  };

  const build = (
    opts: {
      excepciones?: unknown[];
      config?: unknown;
      plantilla?: unknown;
      envio?: { success: boolean; error?: string };
      /** Un resultado por envío, en orden (para distinguir agendador y respaldo). */
      envios?: { success: boolean; error?: string }[];
      reclamos?: boolean[];
      timezone?: string | null;
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
        return r ?? opts.envio ?? { success: true, templateName: 'aviso_sync' };
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
      [
        'no hay número del agendador',
        { ...CONFIG, agendadorWhatsapp: null },
        'SIN_DESTINO',
      ],
    ])('%s → %s, sin reclamar ni enviar nada', async (_n, config, motivo) => {
      const { service, exceptions, templates } = build({ config });

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: false,
        motivo,
      });
      expect(exceptions.reclamarAviso).not.toHaveBeenCalled();
      expect(templates.sendTemplate).not.toHaveBeenCalled();
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

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: true,
        citas: 3,
        recordatorios: 0,
      });

      expect(orden).toEqual(['reclamar', 'reclamar', 'reclamar', 'enviar']);
      expect(templates.sendTemplate).toHaveBeenCalledTimes(1);
    });

    it('🔒 sale por la clínica y hacia el número de ESA clínica, con la plantilla del aviso', async () => {
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
      expect(bodyParams[0]).toBe('1 cita');
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

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: true,
        citas: 2,
        recordatorios: 0,
      });
      expect(
        (templates.sendTemplate.mock.calls[0][0] as { bodyParams: string[] })
          .bodyParams[0],
      ).toBe('2 citas');
    });
  });

  describe('resultado del envío', () => {
    it('✅ salió: deja constancia de que se avisó, en cada excepción', async () => {
      const { service, exceptions } = build({
        excepciones: [excepcion({ id: 'a' }), excepcion({ id: 'b' })],
      });

      await service.avisar(ORG, AHORA);

      expect(exceptions.anotar.mock.calls.map((c) => [c[0], c[1]])).toEqual([
        ['a', 'AVISADA'],
        ['b', 'AVISADA'],
      ]);
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

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: false,
        motivo: 'ENVIO_FALLIDO',
        detalle: 'template-not-configured',
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

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: true,
        citas: 1,
        recordatorios: 0,
      });
      expect(templates.sendTemplate).toHaveBeenCalledTimes(1);
    });
  });
  describe('recordatorios: nadie tomó la excepción (§12 #14)', () => {
    const RESPALDO = '573009998877';
    const olvidada = (over: Record<string, unknown> = {}) =>
      excepcion({
        notifiedSeverity: 'MEDIA',
        notifiedAt: new Date(AHORA.getTime() - 31 * 60_000),
        ...over,
      });
    const conRespaldo = { ...CONFIG, agendadorRespaldoWhatsapp: RESPALDO };
    const destinatarios = (t: ReturnType<typeof build>['templates']) =>
      t.sendTemplate.mock.calls.map(
        (c) => (c[0] as { recipientId: string }).recipientId,
      );

    it('avisada hace 31 min y nadie la tomó: recordatorio al agendador Y al respaldo, con la MISMA plantilla', async () => {
      const { service, templates, exceptions } = build({
        excepciones: [olvidada()],
        config: conRespaldo,
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: true,
        citas: 0,
        recordatorios: 1,
      });

      expect(destinatarios(templates)).toEqual(['573001112233', RESPALDO]);
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
        expect.stringMatching(
          /Recordatorio 1 de 2 .*al agendador y al respaldo/,
        ),
      ]);
    });

    it('sin número de respaldo: el recordatorio va solo al agendador', async () => {
      const { service, templates, exceptions } = build({
        excepciones: [olvidada()],
      });

      await service.avisar(ORG, AHORA);

      expect(destinatarios(templates)).toEqual(['573001112233']);
      expect(exceptions.anotar.mock.calls[0][4]).toMatch(/al agendador:/);
    });

    it('un respaldo igual al agendador no duplica el mensaje', async () => {
      const { service, templates } = build({
        excepciones: [olvidada()],
        config: {
          ...CONFIG,
          agendadorRespaldoWhatsapp: CONFIG.agendadorWhatsapp,
        },
      });
      await service.avisar(ORG, AHORA);
      expect(templates.sendTemplate).toHaveBeenCalledTimes(1);
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
        config: conRespaldo,
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

    it('si falla SOLO el respaldo: el agendador ya lo recibió, no se devuelve nada y se dice en el historial', async () => {
      const { service, exceptions } = build({
        excepciones: [olvidada()],
        config: conRespaldo,
        envios: [{ success: true }, { success: false, error: 'meta-400' }],
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toMatchObject({
        enviado: true,
        recordatorios: 1,
      });
      expect(exceptions.devolverAviso).not.toHaveBeenCalled();
      expect(exceptions.anotar.mock.calls[0][4]).toMatch(
        /al respaldo no salió/,
      );
    });

    it('si falla el envío al agendador: se devuelve (con su cuenta) y NO se intenta el respaldo', async () => {
      const previo = new Date(AHORA.getTime() - 31 * 60_000);
      const { service, exceptions, templates } = build({
        excepciones: [olvidada({ notifiedAt: previo, reminderCount: 1 })],
        config: conRespaldo,
        envio: { success: false, error: 'whatsapp-inactive' },
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: false,
        motivo: 'ENVIO_FALLIDO',
        detalle: 'whatsapp-inactive',
      });
      expect(templates.sendTemplate).toHaveBeenCalledTimes(1);
      expect(exceptions.devolverAviso.mock.calls[0][0]).toEqual({
        id: 'ex-1',
        notifiedAt: previo,
        notifiedSeverity: 'MEDIA',
        reminderCount: 1,
      });
      expect(exceptions.anotar).not.toHaveBeenCalled();
    });

    it('avisos nuevos y recordatorios en la misma vuelta van en mensajes APARTE: el nuevo, solo al agendador y sin la marca', async () => {
      const { service, templates, exceptions } = build({
        excepciones: [excepcion({ id: 'nueva' }), olvidada({ id: 'vieja' })],
        config: conRespaldo,
      });

      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
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
        RESPALDO,
      ]);
      expect(envios[0].bodyParams[2]).not.toMatch(/RECORDATORIO/);
      expect(envios[1].bodyParams[2]).toMatch(/^RECORDATORIO/);
      expect(exceptions.anotar.mock.calls.map((c) => [c[0], c[1]])).toEqual([
        ['nueva', 'AVISADA'],
        ['vieja', 'RECORDADA'],
      ]);
    });

    it('el respaldo solo no basta: sin agendador no hay aviso (es un segundo destinatario, no un sustituto)', async () => {
      const { service, templates } = build({
        excepciones: [olvidada()],
        config: { ...conRespaldo, agendadorWhatsapp: null },
      });
      await expect(service.avisar(ORG, AHORA)).resolves.toEqual({
        enviado: false,
        motivo: 'SIN_DESTINO',
      });
      expect(templates.sendTemplate).not.toHaveBeenCalled();
    });
  });
});
