import { Logger } from '@nestjs/common';
import { RetentionService } from '../retention/retention.service';
import { MassNoticeService } from '../mass-notice/mass-notice.service';
import { MirrorLookupService } from '../mirror/mirror-lookup.service';
import { ChatbotService } from '../chatbot/chatbot.service';

/**
 * 🚨 Alertas técnicas (docs/PLAN_ALERTAS_TECNICAS.md, Fase 2): los crones que
 * antes solo escribían en el log ahora le avisan al grupo técnico si revientan, y
 * lo resuelven cuando vuelven a salir bien. Nunca relanzan.
 */
describe('enganches de los crones', () => {
  let alertas: { cronFallo: jest.Mock; cronBien: jest.Mock };

  beforeEach(() => {
    alertas = {
      cronFallo: jest.fn(async () => undefined),
      cronBien: jest.fn(async () => undefined),
    };
    for (const nivel of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation();
    }
  });

  afterEach(() => jest.restoreAllMocks());

  it('retención: avisa si falla, resuelve si sale bien', async () => {
    const service = new RetentionService(
      {} as never,
      {} as never,
      {} as never,
      alertas as never,
    );
    const purgar = jest
      .spyOn(service, 'purgar')
      .mockRejectedValueOnce(new Error('timeout'));
    await expect(service.purgarCron()).resolves.toBeUndefined();
    expect(alertas.cronFallo).toHaveBeenCalledWith(
      'retencion',
      'Retención de datos personales',
      expect.any(Error),
    );
    purgar.mockResolvedValueOnce({} as never);
    await service.purgarCron();
    expect(alertas.cronBien).toHaveBeenCalledWith('retencion');
  });

  it('purga de avisos masivos: igual', async () => {
    const service = new MassNoticeService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      alertas as never,
    );
    const purga = jest
      .spyOn(service, 'purgeExpiredRecipients')
      .mockRejectedValueOnce(new Error('timeout'));
    await expect(service.purgeExpiredRecipientsCron()).resolves.toBeUndefined();
    expect(alertas.cronFallo).toHaveBeenCalledWith(
      'purga-avisos-masivos',
      'Purga de avisos masivos',
      expect.any(Error),
    );
    purga.mockResolvedValueOnce({ purgedBatches: 0 } as never);
    await service.purgeExpiredRecipientsCron();
    expect(alertas.cronBien).toHaveBeenCalledWith('purga-avisos-masivos');
  });

  it('mantenimiento de las consultas al HIS: igual', async () => {
    const prisma = {
      hisLookupRequest: {
        updateMany: jest.fn().mockRejectedValueOnce(new Error('base caída')),
      },
    };
    const service = new MirrorLookupService(prisma as never, alertas as never);
    await expect(service.mantenimiento()).resolves.toBeUndefined();
    expect(alertas.cronFallo).toHaveBeenCalledWith(
      'consultas-his',
      'Mantenimiento de consultas al HIS',
      expect.any(Error),
    );
    prisma.hisLookupRequest.updateMany.mockResolvedValue({ count: 0 });
    await service.mantenimiento();
    expect(alertas.cronBien).toHaveBeenCalledWith('consultas-his');
  });

  describe('los barridos del HIS del bot (cada 5 y 10 s)', () => {
    const bot = (extra: Record<string, unknown>) =>
      ({
        logger: new Logger('ChatbotService'),
        alertasTecnicas: alertas,
        prisma: {},
        ...extra,
      }) as unknown as ChatbotService;

    it('confirmaciones pendientes del HIS', async () => {
      const pendientes = jest
        .fn()
        .mockRejectedValueOnce(new Error('base caída'))
        .mockResolvedValueOnce([]);
      const yo = bot({ confirmacionHis: { pendientes } });
      await ChatbotService.prototype.atenderConfirmacionesHisPendientes.call(
        yo,
      );
      expect(alertas.cronFallo).toHaveBeenCalledWith(
        'confirmaciones-his',
        'Confirmaciones del HIS al paciente',
        expect.any(Error),
      );
      await ChatbotService.prototype.atenderConfirmacionesHisPendientes.call(
        yo,
      );
      expect(alertas.cronBien).toHaveBeenCalledWith('confirmaciones-his');
    });

    it('seguimientos de las consultas al HIS', async () => {
      const reclamarSeguimientos = jest
        .fn()
        .mockRejectedValueOnce(new Error('base caída'))
        .mockResolvedValueOnce([]);
      const yo = bot({ consultaHis: { reclamarSeguimientos } });
      await ChatbotService.prototype.atenderSeguimientosHis.call(yo);
      expect(alertas.cronFallo).toHaveBeenCalledWith(
        'seguimientos-his',
        'Consultas del bot al HIS',
        expect.any(Error),
      );
      await ChatbotService.prototype.atenderSeguimientosHis.call(yo);
      expect(alertas.cronBien).toHaveBeenCalledWith('seguimientos-his');
    });

    it('sin el servicio de alertas (tests de siempre) funcionan igual', async () => {
      const yo = bot({
        alertasTecnicas: undefined,
        confirmacionHis: {
          pendientes: jest.fn().mockRejectedValue(new Error('x')),
        },
      });
      await expect(
        ChatbotService.prototype.atenderConfirmacionesHisPendientes.call(yo),
      ).resolves.toBeUndefined();
    });
  });
});
