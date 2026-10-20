import { Logger } from '@nestjs/common';
import { TEXTO_SIN_AVISO_CASO, leerCategorias } from '@agenia/shared';
import { SupportTicketGroupNotifier } from './support-ticket-group.notifier';
import type { TechAlertConfigService } from './tech-alert-config.service';
import type { TechAlertChannel } from './tech-alerts.types';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * El aviso al grupo de cada caso de Soporte (docs/PLAN_BOT_SOPORTE.md §3.5). Lo que
 * no puede fallar:
 *  🔒 nunca la descripción: solo número, prioridad, clínica, rol, correo, canal,
 *     título y enlace;
 *  · un caso, un aviso, aunque corran dos réplicas;
 *  · el caso existe aunque el aviso no salga, y la Mesa de Ayuda dice por qué.
 */

// Lunes 19 de octubre de 2026, hora de Colombia.
const co = (hora: string, dia = '2026-10-19') =>
  new Date(`${dia}T${hora}:00-05:00`);

type Fila = Record<string, unknown> & { id: string };

/** Lo justo de Prisma, con el compare-and-set de `updateMany` de verdad. */
class BaseFalsa {
  casos: Fila[] = [];
  configAsistente: Record<string, unknown> | null = null;
  escrituras = 0;

  private coincide(f: Fila, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, v]) => {
      const actual = f[k];
      if (v instanceof Date) {
        return actual instanceof Date && actual.getTime() === v.getTime();
      }
      if (v && typeof v === 'object' && 'lte' in v) {
        return (
          actual instanceof Date &&
          actual.getTime() <= (v as { lte: Date }).lte.getTime()
        );
      }
      return (actual ?? null) === v;
    });
  }

  supportTicket = {
    findMany: jest.fn(
      async ({
        where,
        take,
      }: {
        where: Record<string, unknown>;
        take: number;
      }) =>
        this.casos
          .filter((f) => this.coincide(f, where))
          .slice(0, take)
          .map((f) => ({ ...f })),
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const filas = this.casos.filter((f) => this.coincide(f, where));
        for (const f of filas) {
          for (const [k, v] of Object.entries(data)) {
            f[k] =
              v && typeof v === 'object' && 'increment' in v
                ? (f[k] as number) + (v as { increment: number }).increment
                : v;
          }
          f.updatedAt = this.ahora;
        }
        this.escrituras++;
        return { count: filas.length };
      },
    ),
  };

  supportBotConfig = {
    findUnique: jest.fn(async () => this.configAsistente),
  };

  ahora = co('10:00');
}

const caso = (cambios: Record<string, unknown> = {}): Fila => ({
  id: 'c-58',
  number: 58,
  title: 'No salen los recordatorios de la paciente 1053789456',
  description: 'DESCRIPCIÓN CON DATOS DEL PACIENTE',
  status: 'OPEN',
  priority: 'HIGH',
  channel: 'TELEGRAM',
  reopenedCount: 0,
  groupNotice: 'PENDING',
  groupNoticeAttempts: 0,
  groupNoticeError: null,
  groupNotifiedAt: null,
  unattendedRemindedAt: null,
  createdAt: co('09:59'),
  updatedAt: co('09:59'),
  reporter: { email: 'ana@clinica.co', role: 'BOOKING_AGENT' },
  organization: { name: 'Hospital de Prueba' },
  ...cambios,
});

describe('SupportTicketGroupNotifier', () => {
  let base: BaseFalsa;
  let canal: TechAlertChannel | null;
  let enviados: Array<{ texto: string; silent: boolean | undefined }>;
  let enviar: jest.Mock;
  let notifier: SupportTicketGroupNotifier;

  const vuelta = (ahora: Date) => {
    base.ahora = ahora;
    return notifier.vuelta(ahora);
  };
  const fila = (id = 'c-58') => base.casos.find((c) => c.id === id) as Fila;

  beforeEach(() => {
    for (const nivel of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation();
    }
    base = new BaseFalsa();
    canal = {
      token: 'T',
      chatId: '-100',
      enabled: true,
      mutedUntilIso: null,
      antirruido: {
        reminderMinutes: 30,
        maxReminders: 3,
        quietHoursEnabled: true,
        quietFromHour: 22,
        quietToHour: 6,
        categories: leerCategorias(null),
      },
      dailySummaryEnabled: true,
      lastDailySummaryIso: null,
      panelBase: 'https://panel.prueba.co',
    };
    enviados = [];
    enviar = jest.fn(async (texto: string, opts: { silent?: boolean }) => {
      enviados.push({ texto, silent: opts.silent });
      return { ok: true };
    });
    const config = {
      canal: jest.fn(async () => canal),
      enviar,
    };
    notifier = new SupportTicketGroupNotifier(
      base as unknown as PrismaService,
      config as unknown as TechAlertConfigService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('el caso nuevo', () => {
    it('🔒 sale con número, prioridad, clínica, quien reporta, canal, título saneado y enlace; nunca la descripción', async () => {
      base.casos = [caso()];
      await expect(vuelta(co('10:00'))).resolves.toMatchObject({ enviados: 1 });
      expect(enviados).toHaveLength(1);
      const { texto } = enviados[0];
      expect(texto.split('\n')).toEqual([
        '🛟 Caso nuevo #58 · Prioridad ALTA',
        'Clínica: Hospital de Prueba',
        'Reporta: Agente de Reservas · ana@clinica.co · por Telegram',
        expect.stringMatching(/^«No salen los recordatorios de la paciente /),
        'Abrir: https://panel.prueba.co/super-admin/support',
      ]);
      expect(texto).not.toContain('1053789456');
      expect(texto).not.toContain('DESCRIPCIÓN');
      expect(fila()).toMatchObject({
        groupNotice: 'SENT',
        groupNotifiedAt: co('10:00'),
        groupNoticeAttempts: 1,
        groupNoticeError: null,
      });
      // Un caso, un aviso.
      await vuelta(co('10:01'));
      expect(enviados).toHaveLength(1);
    });

    it('de noche, la prioridad alta suena y la normal llega sin sonido', async () => {
      base.casos = [
        caso(),
        caso({ id: 'c-59', number: 59, priority: 'NORMAL', channel: 'PANEL' }),
      ];
      await vuelta(co('23:00'));
      expect(enviados.map((e) => e.silent)).toEqual([false, true]);
      expect(enviados[1].texto).toContain('por el panel');
      expect(enviados[1].texto.split('\n')[0]).toBe('🛟 Caso nuevo #59');
    });

    it('el reabierto avisa como «Caso reabierto»', async () => {
      base.casos = [caso({ reopenedCount: 1 })];
      await vuelta(co('10:00'));
      expect(enviados[0].texto.split('\n')[0]).toBe(
        '🔁 Caso reabierto #58 · Prioridad ALTA',
      );
    });

    it('sin el enlace del panel configurado, dice dónde está', async () => {
      (canal as TechAlertChannel).panelBase = null;
      base.casos = [caso()];
      await vuelta(co('10:00'));
      expect(enviados[0].texto).toContain('Abrir: panel › Mesa de Ayuda');
    });

    it('🏁 dos réplicas a la vez: un solo aviso', async () => {
      base.casos = [caso()];
      const otra = new SupportTicketGroupNotifier(
        base as unknown as PrismaService,
        {
          canal: async () => canal,
          enviar,
        } as unknown as TechAlertConfigService,
      );
      await Promise.all([vuelta(co('10:00')), otra.vuelta(co('10:00'))]);
      expect(enviados).toHaveLength(1);
    });

    it('como mucho 10 por vuelta; los demás, en la siguiente', async () => {
      base.casos = Array.from({ length: 12 }, (_, i) =>
        caso({ id: `c-${i}`, number: i + 1 }),
      );
      await vuelta(co('10:00'));
      expect(enviados).toHaveLength(10);
      await vuelta(co('10:01'));
      expect(enviados).toHaveLength(12);
    });
  });

  describe('cuando no sale', () => {
    it('sin el grupo conectado: el caso queda, la Mesa dice por qué y no se reescribe cada minuto', async () => {
      canal = null;
      base.casos = [caso()];
      await vuelta(co('10:00'));
      expect(enviados).toEqual([]);
      expect(fila()).toMatchObject({
        groupNotice: 'PENDING',
        groupNoticeError: TEXTO_SIN_AVISO_CASO.SIN_CANAL,
        groupNoticeAttempts: 0,
      });
      const escrituras = base.escrituras;
      await vuelta(co('10:01'));
      expect(base.escrituras).toBe(escrituras);
    });

    it('con la categoría «Casos de soporte» apagada, espera; al encenderla, sale', async () => {
      (canal as TechAlertChannel).antirruido.categories = leerCategorias({
        CASOS_SOPORTE: false,
      });
      base.casos = [caso()];
      await vuelta(co('10:00'));
      expect(fila().groupNoticeError).toBe(
        TEXTO_SIN_AVISO_CASO.CATEGORIA_APAGADA,
      );
      (canal as TechAlertChannel).antirruido.categories = leerCategorias(null);
      await vuelta(co('10:05'));
      expect(enviados).toHaveLength(1);
      expect(fila()).toMatchObject({
        groupNotice: 'SENT',
        groupNoticeError: null,
      });
    });

    it('si Telegram falla: guarda el error y reintenta con espera (1 min, 2 min…)', async () => {
      enviar.mockResolvedValueOnce({
        ok: false,
        errorCode: 403,
        error: 'El bot ya no está en el grupo.',
      });
      base.casos = [caso()];
      await expect(vuelta(co('10:00'))).resolves.toMatchObject({ fallidos: 1 });
      expect(fila()).toMatchObject({
        groupNotice: 'PENDING',
        groupNoticeAttempts: 1,
        groupNoticeError: 'El bot ya no está en el grupo.',
      });
      await vuelta(new Date(co('10:00').getTime() + 30_000));
      expect(enviar).toHaveBeenCalledTimes(1);
      await vuelta(co('10:01'));
      expect(enviar).toHaveBeenCalledTimes(2);
      expect(fila().groupNotice).toBe('SENT');
    });

    it('un error sin texto deja uno genérico', async () => {
      enviar.mockResolvedValueOnce({ ok: false, errorCode: null, error: '' });
      base.casos = [caso()];
      await vuelta(co('10:00'));
      expect(fila().groupNoticeError).toBe('Telegram no aceptó el aviso.');
    });

    it('ya tomado, o 24 h quieto sin poder avisar: se deja, con el motivo', async () => {
      base.casos = [
        caso({ status: 'IN_PROGRESS' }),
        caso({ id: 'c-2', number: 2, updatedAt: co('09:00', '2026-10-18') }),
      ];
      await expect(vuelta(co('10:00'))).resolves.toMatchObject({
        omitidos: 2,
        enviados: 0,
      });
      expect(fila()).toMatchObject({
        groupNotice: 'SKIPPED',
        groupNoticeError: TEXTO_SIN_AVISO_CASO.YA_TOMADO,
      });
      expect(fila('c-2').groupNoticeError).toBe(TEXTO_SIN_AVISO_CASO.VENCIDO);
    });
  });

  describe('«lleva 2 h sin que nadie lo tome»', () => {
    const avisado = (cambios: Record<string, unknown> = {}) =>
      caso({
        groupNotice: 'SENT',
        groupNotifiedAt: co('09:00'),
        groupNoticeAttempts: 1,
        ...cambios,
      });

    it('a las 2 h del horario del equipo, una sola vez', async () => {
      base.casos = [avisado()];
      await vuelta(co('10:59'));
      expect(enviados).toEqual([]);
      await expect(vuelta(co('11:00'))).resolves.toMatchObject({
        recordados: 1,
      });
      expect(enviados[0].texto.split('\n')[0]).toBe(
        '⏰ El caso #58 lleva 2 h sin que nadie lo tome',
      );
      expect(fila().unattendedRemindedAt).toEqual(co('11:00'));
      await vuelta(co('12:00'));
      expect(enviados).toHaveLength(1);
    });

    it('cuenta con el horario del equipo que guardó el super admin', async () => {
      base.configAsistente = {
        teamDays: [1, 2, 3, 4, 5],
        teamFromHour: 10,
        teamToHour: 17,
        teamTimeZone: 'America/Bogota',
      };
      base.casos = [avisado()];
      await vuelta(co('11:00'));
      expect(enviados).toEqual([]);
      await vuelta(co('12:00'));
      expect(enviados).toHaveLength(1);
    });

    it('si no sale, se devuelve para la vuelta siguiente', async () => {
      enviar.mockResolvedValueOnce({
        ok: false,
        errorCode: null,
        error: 'red',
      });
      base.casos = [avisado()];
      await vuelta(co('11:00'));
      expect(fila().unattendedRemindedAt).toBeNull();
      await vuelta(co('11:01'));
      expect(enviar).toHaveBeenCalledTimes(2);
      expect(enviados).toHaveLength(1);
      expect(fila().unattendedRemindedAt).toEqual(co('11:01'));
    });

    it('sin la fila de configuración del asistente, o si no se puede leer, el horario de siempre', async () => {
      base.supportBotConfig.findUnique.mockRejectedValueOnce(new Error('x'));
      base.casos = [avisado()];
      await vuelta(co('11:00'));
      expect(enviados).toHaveLength(1);
    });

    it('con el canal en silencio no se recuerda', async () => {
      (canal as TechAlertChannel).mutedUntilIso = co('12:00').toISOString();
      base.casos = [avisado()];
      await vuelta(co('11:30'));
      expect(enviados).toEqual([]);
    });
  });

  it('nunca lanza: un error queda en el log', async () => {
    base.supportTicket.findMany.mockRejectedValueOnce(new Error('db caída'));
    await expect(vuelta(co('10:00'))).resolves.toEqual({
      enviados: 0,
      fallidos: 0,
      omitidos: 0,
      recordados: 0,
    });
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('una vuelta pedida mientras corre otra se hace al terminar; «pronto» no espera al minuto', async () => {
    base.casos = [caso()];
    const espia = jest.spyOn(notifier, 'vuelta');
    const primera = vuelta(co('10:00'));
    await notifier.vuelta(co('10:00'));
    await primera;
    await new Promise((r) => setImmediate(r));
    expect(espia).toHaveBeenCalledTimes(3);
    notifier.pronto();
    await new Promise((r) => setImmediate(r));
    expect(espia).toHaveBeenCalledTimes(4);
    await notifier.cadaMinuto();
    expect(espia).toHaveBeenCalledTimes(5);
  });
});
