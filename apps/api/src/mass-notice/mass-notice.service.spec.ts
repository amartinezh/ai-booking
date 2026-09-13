import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MassNoticeService } from './mass-notice.service';

/**
 * Cubre las tres cosas que este servicio garantiza (ver PLAN_AVISOS_MASIVOS.md
 * §7 y §8): la Llave 2+3 se revisa del lado del servidor aunque la pantalla ya
 * haya filtrado; sin plantilla aprobada NO se toca un solo destinatario; y un
 * envío exitoso suprime el recordatorio duplicado cuando el paciente ya
 * existe en AgenIA (§8.1).
 */
describe('MassNoticeService', () => {
  const ORG = 'org-1';

  const build = (overrides?: {
    hospitalMirrorConfig?: any;
    batch?: any;
    recipients?: any[];
    template?: any;
    sendResult?: { success: boolean; error?: string; templateName?: string };
    patientProfile?: any;
    matchingAppointment?: any;
  }) => {
    const recipients = overrides?.recipients ?? [
      {
        id: 'rec-1',
        patientDocument: '111',
        patientName: 'Ana Pérez',
        phoneE164: '+573001112233',
        appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
        agenIAPatientId: null,
      },
    ];

    const prisma = {
      hospitalMirrorConfig: {
        findUnique: jest.fn(async () =>
          overrides?.hospitalMirrorConfig !== undefined
            ? overrides.hospitalMirrorConfig
            : {
                driverKey: 'cnt-sanvicente-anserma',
                enabled: true,
                avisosMasivos: { enabled: true, ritmoMensajesPorMinuto: 6000 }, // rápido en tests
              },
        ),
      },
      massNoticeBatch: {
        findFirst: jest.fn(async () =>
          overrides?.batch !== undefined
            ? overrides.batch
            : {
                id: 'batch-1',
                organizationId: ORG,
                status: 'BORRADOR',
                doctorLabel: 'Dr. Serna',
                serviceLabel: 'Medicina Interna',
                notaAdicional: null,
                sent: 0,
                failed: 0,
                skipped: 0,
                sentAt: null,
              },
        ),
        update: jest.fn(async () => ({})),
      },
      massNoticeRecipient: {
        findMany: jest.fn(async () => recipients),
        update: jest.fn(async () => ({})),
        count: jest.fn(async ({ where }: any) => {
          if (where.outcome === 'ENVIADO')
            return overrides?.sendResult?.success === false
              ? 0
              : recipients.length;
          if (where.outcome === 'FALLIDO')
            return overrides?.sendResult?.success === false
              ? recipients.length
              : 0;
          return recipients.length; // selected: true
        }),
      },
      patientProfile: {
        findUnique: jest.fn(async () => overrides?.patientProfile ?? null),
      },
      appointment: {
        findFirst: jest.fn(async () => overrides?.matchingAppointment ?? null),
        update: jest.fn(async () => ({})),
      },
    };

    const templates = {
      findTemplate: jest.fn(async () =>
        overrides?.template !== undefined
          ? overrides.template
          : { id: 'tpl-1' },
      ),
      sendTemplate: jest.fn(
        async () =>
          overrides?.sendResult ?? { success: true, templateName: 'x' },
      ),
    };

    const interactionLog = { logMassNoticeSent: jest.fn(async () => {}) };
    const systemLog = { event: jest.fn(async () => {}) };

    const service = new MassNoticeService(
      prisma as any,
      templates as any,
      interactionLog as any,
      systemLog as any,
    );

    return {
      service,
      prisma,
      templates,
      interactionLog,
      systemLog,
      recipients,
    };
  };

  it('Llave 2/3: rechaza si el driver no es cnt-sanvicente-anserma', async () => {
    const ctx = build({
      hospitalMirrorConfig: {
        driverKey: 'otro-driver',
        enabled: true,
        avisosMasivos: { enabled: true },
      },
    });

    await expect(ctx.service.sendBatch('batch-1', ORG)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ctx.prisma.massNoticeBatch.findFirst).not.toHaveBeenCalled();
  });

  it('Llave 2/3: rechaza si avisosMasivos.enabled es false', async () => {
    const ctx = build({
      hospitalMirrorConfig: {
        driverKey: 'cnt-sanvicente-anserma',
        enabled: true,
        avisosMasivos: { enabled: false },
      },
    });

    await expect(ctx.service.sendBatch('batch-1', ORG)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('Llave 2/3: rechaza si el espejo mismo está apagado (enabled=false)', async () => {
    const ctx = build({
      hospitalMirrorConfig: {
        driverKey: 'cnt-sanvicente-anserma',
        enabled: false,
        avisosMasivos: { enabled: true },
      },
    });

    await expect(ctx.service.sendBatch('batch-1', ORG)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 si el lote no existe (o no es de esta organización)', async () => {
    const ctx = build({ batch: null });

    await expect(ctx.service.sendBatch('batch-1', ORG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('un lote ya ENVIADO no se reintenta', async () => {
    const ctx = build({
      batch: {
        id: 'batch-1',
        organizationId: ORG,
        status: 'ENVIADO',
        sent: 3,
        failed: 0,
        skipped: 0,
        sentAt: new Date(),
      },
    });

    const result = await ctx.service.sendBatch('batch-1', ORG);

    expect(result.error).toContain('ENVIADO');
    expect(ctx.templates.findTemplate).not.toHaveBeenCalled();
  });

  it('sin plantilla aprobada, el envío NO se intenta — ningún destinatario se toca', async () => {
    const ctx = build({ template: null });

    const result = await ctx.service.sendBatch('batch-1', ORG);

    expect(result.error).toContain('plantilla');
    expect(ctx.templates.sendTemplate).not.toHaveBeenCalled();
    expect(ctx.prisma.massNoticeRecipient.update).not.toHaveBeenCalled();
  });

  it('envía la plantilla con las 5 variables del contrato, nota por defecto si el lote no trae una', async () => {
    const ctx = build();

    await ctx.service.sendBatch('batch-1', ORG);

    expect(ctx.templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        kind: 'APPOINTMENT_CANCELLED_MASS',
        bodyParams: [
          'Ana',
          'Medicina Interna',
          'Dr. Serna',
          expect.any(String),
          'Le ofrecemos disculpas por el inconveniente.',
        ],
      }),
    );
  });

  it('usa la nota adicional del lote en vez de la frase por defecto', async () => {
    const ctx = build({
      batch: {
        id: 'batch-1',
        organizationId: ORG,
        status: 'BORRADOR',
        doctorLabel: 'Dr. Serna',
        serviceLabel: 'Medicina Interna',
        notaAdicional: '  El Dr. Serna vuelve el jueves.  ',
        sent: 0,
        failed: 0,
        skipped: 0,
        sentAt: null,
      },
    });

    await ctx.service.sendBatch('batch-1', ORG);

    expect(ctx.templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyParams: expect.arrayContaining(['El Dr. Serna vuelve el jueves.']),
      }),
    );
  });

  it('destinatario: prefiere el BSUID de AgenIA sobre el teléfono cuando el paciente existe', async () => {
    const ctx = build({
      recipients: [
        {
          id: 'rec-1',
          patientDocument: '111',
          patientName: 'Ana Pérez',
          phoneE164: '+573001112233',
          appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
          agenIAPatientId: 'patient-agenia-1',
        },
      ],
      patientProfile: { bsuid: 'CO.999888777' },
    });

    await ctx.service.sendBatch('batch-1', ORG);

    expect(ctx.templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'CO.999888777' }),
    );
  });

  it('destinatario: cae al teléfono (sin "+") cuando no hay BSUID', async () => {
    const ctx = build();

    await ctx.service.sendBatch('batch-1', ORG);

    expect(ctx.templates.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: '573001112233' }),
    );
  });

  it('§8: envío exitoso a un paciente YA en AgenIA suprime el recordatorio duplicado', async () => {
    const ctx = build({
      recipients: [
        {
          id: 'rec-1',
          patientDocument: '111',
          patientName: 'Ana Pérez',
          phoneE164: '+573001112233',
          appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
          agenIAPatientId: 'patient-agenia-1',
        },
      ],
      matchingAppointment: { id: 'apt-1' },
    });

    await ctx.service.sendBatch('batch-1', ORG);

    expect(ctx.prisma.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patientId: 'patient-agenia-1',
          organizationId: ORG,
        }),
      }),
    );
    expect(ctx.prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'apt-1' },
      data: { reminderSentAt: expect.any(Date) },
    });
  });

  it('§8: NO busca cita de AgenIA cuando el paciente no está homologado', async () => {
    const ctx = build(); // agenIAPatientId: null en el destinatario por defecto

    await ctx.service.sendBatch('batch-1', ORG);

    expect(ctx.prisma.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('un fallo de Meta marca FALLIDO con el error, y no suprime ningún recordatorio', async () => {
    const ctx = build({
      recipients: [
        {
          id: 'rec-1',
          patientDocument: '111',
          patientName: 'Ana',
          phoneE164: '+573001112233',
          appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
          agenIAPatientId: 'patient-agenia-1',
        },
      ],
      sendResult: { success: false, error: 'meta-api-error' },
    });

    await ctx.service.sendBatch('batch-1', ORG);

    expect(ctx.prisma.massNoticeRecipient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rec-1' },
        data: expect.objectContaining({
          outcome: 'FALLIDO',
          error: 'meta-api-error',
        }),
      }),
    );
    expect(ctx.prisma.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('solo procesa destinatarios seleccionados con outcome PENDIENTE o FALLIDO', async () => {
    const ctx = build();

    await ctx.service.sendBatch('batch-1', ORG);

    expect(ctx.prisma.massNoticeRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          batchId: 'batch-1',
          selected: true,
          outcome: { in: ['PENDIENTE', 'FALLIDO'] },
        }),
      }),
    );
  });
});
