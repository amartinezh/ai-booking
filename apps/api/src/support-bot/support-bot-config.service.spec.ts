import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ACTUALIZACIONES_DEL_ASISTENTE,
  SupportBotConfigService,
  mismoSecreto,
  urlDelWebhook,
} from './support-bot-config.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CryptoService } from '../common/crypto/crypto.service';
import type { TelegramApiClient } from '../telegram/telegram-api.client';

/**
 * Configuración del asistente de soporte. Lo que no puede fallar:
 *  1. No se guarda nada si Telegram no confirma el webhook.
 *  2. Un bot no puede ser el de alertas ni el de una clínica (S1).
 *  3. Token y secreto se guardan cifrados y nunca vuelven al panel.
 *  4. Un bot nuevo nace apagado y no se enciende sin bot.
 *  5. Todo cambio queda auditado con el actor del token.
 */
describe('SupportBotConfigService', () => {
  const TOKEN = '123456789:AAHsecretoSecretoSecretoSecreto12345';
  const OTRO = '987654321:AAHotroOtroOtroOtroOtroOtroOtro9876';
  const ACTOR = { userId: 'sa-1', email: 'sa@agenia.co', ip: '10.0.0.1' };
  const URL_ORIGINAL = process.env.PUBLIC_API_URL;

  let row: Record<string, unknown> | null;
  let auditorias: Array<Record<string, unknown>>;
  let alertasBotId: string | null;
  let botsDeClinica: string[];
  let prisma: Record<string, Record<string, jest.Mock>> & {
    $transaction: jest.Mock;
  };
  let api: Record<string, jest.Mock>;
  let service: SupportBotConfigService;
  const cipher = {
    encrypt: (s: string) => `cif:${s}`,
    decrypt: (s: string) => {
      if (!s.startsWith('cif:')) throw new Error('bad');
      return s.slice(4);
    },
  };

  const okInfo = (routeKey: string) => ({
    ok: true,
    result: { url: urlDelWebhook(routeKey), pending_update_count: 0 },
  });

  beforeEach(() => {
    process.env.PUBLIC_API_URL = 'https://api.test/';
    for (const nivel of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation();
    }
    row = null;
    auditorias = [];
    alertasBotId = null;
    botsDeClinica = [];
    prisma = {
      supportBotConfig: {
        findUnique: jest.fn(async () => row),
        upsert: jest.fn(async ({ create, update }) => {
          row = row ? { ...row, ...update } : { ...create };
          row.updatedAt = new Date('2026-10-19T15:00:00Z');
          return row;
        }),
        update: jest.fn(async ({ data }) => {
          row = { ...row, ...data };
          return row;
        }),
        updateMany: jest.fn(async ({ data }) => {
          if (row) row = { ...row, ...data };
          return { count: row ? 1 : 0 };
        }),
      },
      techAlertConfig: {
        findUnique: jest.fn(async () =>
          alertasBotId ? { botId: alertasBotId } : null,
        ),
      },
      telegramBotConfig: {
        findUnique: jest.fn(async ({ where }) =>
          botsDeClinica.includes(where.botId)
            ? { organizationId: 'org-x' }
            : null,
        ),
      },
      globalAuditLog: {
        create: jest.fn(async ({ data }) => {
          auditorias.push(data);
          return data;
        }),
      },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) =>
        Promise.all(ops),
      ),
    } as never;
    api = {
      getMe: jest.fn(async (token: string) => ({
        ok: true,
        result: {
          id: Number(token.split(':')[0]),
          is_bot: true,
          username: 'AgeniaSoporteBot',
        },
      })),
      setWebhook: jest.fn(async () => ({ ok: true, result: true })),
      getWebhookInfo: jest.fn(async () =>
        okInfo(typeof row?.routeKey === 'string' ? row.routeKey : ''),
      ),
      setMyCommands: jest.fn(async () => ({ ok: true, result: true })),
      deleteWebhook: jest.fn(async () => ({ ok: true, result: true })),
    };
    service = new SupportBotConfigService(
      prisma as unknown as PrismaService,
      cipher as unknown as CryptoService,
      api as unknown as TelegramApiClient,
    );
  });

  afterEach(() => {
    process.env.PUBLIC_API_URL = URL_ORIGINAL;
    jest.restoreAllMocks();
  });

  describe('connect', () => {
    it('registra el webhook con botones, publica los comandos, guarda cifrado, nace apagado y audita', async () => {
      // getWebhookInfo se pregunta antes de guardar: responde con la URL que se registró.
      api.getWebhookInfo.mockImplementation(async () => ({
        ok: true,
        result: { url: api.setWebhook.mock.calls[0]?.[1].url ?? '' },
      }));
      const pub = await service.connect(`  ${TOKEN} `, ACTOR);

      const [, params] = api.setWebhook.mock.calls[0];
      expect(params.url).toMatch(
        /^https:\/\/api\.test\/support-bot\/webhook\/[A-Za-z0-9_-]{32}$/,
      );
      expect(params.allowedUpdates).toEqual(ACTUALIZACIONES_DEL_ASISTENTE);
      expect(params.secretToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(
        api.setMyCommands.mock.calls[0][1].map(
          (c: { command: string }) => c.command,
        ),
      ).toEqual(['casos', 'nuevo', 'ayuda', 'salir']);
      expect(row).toMatchObject({
        encryptedBotToken: `cif:${TOKEN}`,
        encryptedWebhookSecret: `cif:${params.secretToken}`,
        botId: '123456789',
        botUsername: 'AgeniaSoporteBot',
        enabled: false,
        updatedByEmail: 'sa@agenia.co',
      });
      expect(auditorias[0]).toMatchObject({
        action: 'SUPPORT_BOT_CONFIG_CHANGED',
        actorId: 'sa-1',
        ipAddress: '10.0.0.1',
      });
      expect(auditorias[0].message).toContain(
        'conectó el bot @AgeniaSoporteBot',
      );
      expect(pub).toMatchObject({
        conectado: true,
        enabled: false,
        botUsername: 'AgeniaSoporteBot',
      });
      // 🔒 Nada del token ni del secreto en lo que vuelve al panel.
      expect(JSON.stringify(pub)).not.toContain('AAH');
      expect(JSON.stringify(pub)).not.toContain(params.secretToken);
    });

    it.each(['', 'no-es-token', 42, null])(
      'rechaza un token sin formato: %p',
      async (t) => {
        await expect(service.connect(t, ACTOR)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(api.getMe).not.toHaveBeenCalled();
      },
    );

    it('Telegram rechaza el token → error claro, nada guardado', async () => {
      api.getMe.mockResolvedValue({
        ok: false,
        errorCode: 401,
        description: 'Unauthorized',
      });
      await expect(service.connect(TOKEN, ACTOR)).rejects.toThrow(
        /rechazó el token/,
      );
      expect(row).toBeNull();
    });

    it('Telegram no responde → 503', async () => {
      api.getMe.mockResolvedValue({
        ok: false,
        errorCode: null,
        description: 'timeout',
      });
      await expect(service.connect(TOKEN, ACTOR)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('🚨 el bot de las alertas técnicas no sirve para el asistente', async () => {
      alertasBotId = '123456789';
      await expect(service.connect(TOKEN, ACTOR)).rejects.toThrow(
        /alertas técnicas/,
      );
      expect(api.setWebhook).not.toHaveBeenCalled();
      expect(row).toBeNull();
    });

    it('🏥 el bot de una clínica no sirve para el asistente', async () => {
      botsDeClinica = ['123456789'];
      await expect(service.connect(TOKEN, ACTOR)).rejects.toThrow(
        /pacientes de una clínica/,
      );
      expect(api.setWebhook).not.toHaveBeenCalled();
    });

    it('sin HTTPS en PUBLIC_API_URL no se registra nada', async () => {
      process.env.PUBLIC_API_URL = 'http://localhost:3001';
      await expect(service.connect(TOKEN, ACTOR)).rejects.toThrow(/HTTPS/);
      expect(api.setWebhook).not.toHaveBeenCalled();
    });

    it('Telegram no acepta el webhook → nada guardado', async () => {
      api.setWebhook.mockResolvedValue({
        ok: false,
        errorCode: 400,
        description: 'bad webhook',
      });
      await expect(service.connect(TOKEN, ACTOR)).rejects.toThrow(
        /no aceptó el webhook: bad webhook/,
      );
      expect(row).toBeNull();
    });

    it('Telegram no queda apuntando a AgenIA → nada guardado', async () => {
      api.getWebhookInfo.mockResolvedValue({
        ok: true,
        result: { url: 'https://otra/cosa' },
      });
      await expect(service.connect(TOKEN, ACTOR)).rejects.toThrow(
        /no quedó apuntando/,
      );
      expect(row).toBeNull();
    });

    it('no se puede confirmar el webhook → nada guardado', async () => {
      api.getWebhookInfo.mockResolvedValue({
        ok: false,
        errorCode: null,
        description: 'timeout',
      });
      await expect(service.connect(TOKEN, ACTOR)).rejects.toThrow(
        /No se pudo confirmar/,
      );
    });

    it('si setMyCommands falla, conecta igual (el menú es una ayuda)', async () => {
      api.getWebhookInfo.mockImplementation(async () => ({
        ok: true,
        result: { url: api.setWebhook.mock.calls[0]?.[1].url ?? '' },
      }));
      api.setMyCommands.mockResolvedValue({
        ok: false,
        errorCode: 400,
        description: 'x',
      });
      await expect(service.connect(TOKEN, ACTOR)).resolves.toMatchObject({
        conectado: true,
      });
    });

    it('renovar el token del MISMO bot conserva la ruta y el encendido', async () => {
      row = {
        id: 'global',
        botId: '123456789',
        encryptedBotToken: `cif:${TOKEN}`,
        routeKey: 'ruta-de-siempre',
        encryptedWebhookSecret: 'cif:viejo',
        enabled: true,
      };
      api.getWebhookInfo.mockResolvedValue(okInfo('ruta-de-siempre'));
      await service.connect(TOKEN, ACTOR);
      expect(api.setWebhook.mock.calls[0][1].url).toBe(
        urlDelWebhook('ruta-de-siempre'),
      );
      expect(api.deleteWebhook).not.toHaveBeenCalled();
      expect(row?.enabled).toBe(true);
      expect(auditorias[0].message).toContain('renovó el token');
    });

    it('cambiar de bot desengancha el viejo, cambia la ruta y apaga', async () => {
      row = {
        id: 'global',
        botId: '987654321',
        encryptedBotToken: `cif:${OTRO}`,
        routeKey: 'ruta-vieja',
        encryptedWebhookSecret: 'cif:viejo',
        enabled: true,
      };
      api.getWebhookInfo.mockImplementation(async () => ({
        ok: true,
        result: { url: api.setWebhook.mock.calls[0]?.[1].url ?? '' },
      }));
      await service.connect(TOKEN, ACTOR);
      expect(api.deleteWebhook).toHaveBeenCalledWith(OTRO);
      expect(row?.routeKey).not.toBe('ruta-vieja');
      expect(row?.enabled).toBe(false);
    });
  });

  describe('runtime y destinoDelWebhook', () => {
    beforeEach(() => {
      row = {
        id: 'global',
        enabled: true,
        botUsername: 'AgeniaSoporteBot',
        encryptedBotToken: `cif:${TOKEN}`,
        routeKey: 'ruta',
        encryptedWebhookSecret: 'cif:secreto',
        conversationIdleMinutes: 30,
        maxMessagesPerHour: 40,
        maxMessageChars: 2000,
      };
    });

    it('entrega token y secreto en claro, con caché', async () => {
      await expect(service.runtime()).resolves.toMatchObject({
        token: TOKEN,
        webhookSecret: 'secreto',
        routeKey: 'ruta',
        enabled: true,
      });
      await service.runtime();
      expect(prisma.supportBotConfig.findUnique).toHaveBeenCalledTimes(1);
    });

    it('acepta solo la ruta y el secreto del bot conectado', async () => {
      await expect(
        service.destinoDelWebhook('ruta', 'secreto'),
      ).resolves.not.toBeNull();
      await expect(
        service.destinoDelWebhook('otra', 'secreto'),
      ).resolves.toBeNull();
      await expect(
        service.destinoDelWebhook('ruta', 'secretx'),
      ).resolves.toBeNull();
      await expect(
        service.destinoDelWebhook('ruta', undefined),
      ).resolves.toBeNull();
    });

    it('sin bot, o con un dato que no se puede descifrar, no hay runtime', async () => {
      row = { ...row, encryptedWebhookSecret: 'roto' };
      await expect(service.runtime()).resolves.toBeNull();
      row = null;
      (service as unknown as { cache: null }).cache = null;
      await expect(service.runtime()).resolves.toBeNull();
    });
  });

  describe('getPublic', () => {
    it('sin bot: desconectado, con el horario y los límites por defecto', async () => {
      await expect(service.getPublic()).resolves.toMatchObject({
        conectado: false,
        enabled: false,
        webhook: null,
        horario: {
          dias: [1, 2, 3, 4, 5],
          desdeHora: 8,
          hastaHora: 17,
          zona: 'America/Bogota',
        },
        conversacionMinutos: 30,
        limites: {
          mensajesPorHora: 40,
          caracteresPorMensaje: 2000,
          turnosIaPorClinicaAlDia: 300,
        },
      });
    });

    it('con bot: el estado del webhook según Telegram', async () => {
      row = {
        id: 'global',
        enabled: true,
        encryptedBotToken: `cif:${TOKEN}`,
        routeKey: 'ruta',
      };
      api.getWebhookInfo.mockResolvedValue({
        ok: true,
        result: {
          url: urlDelWebhook('ruta'),
          pending_update_count: 3,
          last_error_message: 'Wrong response',
        },
      });
      await expect(service.getPublic()).resolves.toMatchObject({
        conectado: true,
        enabled: true,
        webhook: { ok: true, pendientes: 3, ultimoError: 'Wrong response' },
      });
      api.getWebhookInfo.mockResolvedValue({
        ok: false,
        errorCode: null,
        description: 'timeout',
      });
      await expect(service.getPublic()).resolves.toMatchObject({
        webhook: { ok: false, pendientes: null, ultimoError: 'timeout' },
      });
    });
  });

  describe('disconnect', () => {
    it('quita el webhook, olvida el bot, apaga y audita', async () => {
      row = {
        id: 'global',
        enabled: true,
        botId: '1',
        botUsername: 'B',
        encryptedBotToken: `cif:${TOKEN}`,
        routeKey: 'r',
        encryptedWebhookSecret: 'cif:s',
      };
      api.deleteWebhook.mockResolvedValue({
        ok: false,
        errorCode: 401,
        description: 'revocado',
      });
      const pub = await service.disconnect(ACTOR);
      expect(api.deleteWebhook).toHaveBeenCalledWith(TOKEN);
      expect(row).toMatchObject({
        enabled: false,
        encryptedBotToken: null,
        routeKey: null,
        encryptedWebhookSecret: null,
      });
      expect(auditorias[0].message).toContain('desconectó el bot @B');
      expect(pub.conectado).toBe(false);
    });

    it('sin bot no hace nada', async () => {
      await service.disconnect(ACTOR);
      expect(api.deleteWebhook).not.toHaveBeenCalled();
      expect(auditorias).toEqual([]);
    });
  });

  describe('updateSettings', () => {
    beforeEach(() => {
      row = {
        id: 'global',
        enabled: false,
        encryptedBotToken: `cif:${TOKEN}`,
        routeKey: 'ruta',
        teamFromHour: 8,
        teamToHour: 17,
      };
      api.getWebhookInfo.mockResolvedValue(okInfo('ruta'));
    });

    it('enciende, cambia horario y límites, y audita una sola vez', async () => {
      const pub = await service.updateSettings(
        {
          enabled: true,
          teamDays: [5, 1, 1, 3],
          teamFromHour: 7,
          teamToHour: 16,
          conversationIdleMinutes: 45,
          maxMessagesPerHour: 60,
          maxMessageChars: 3000,
          maxAiTurnsPerOrgPerDay: 0,
        },
        ACTOR,
      );
      expect(row).toMatchObject({
        enabled: true,
        teamDays: [1, 3, 5],
        teamFromHour: 7,
        teamToHour: 16,
        conversationIdleMinutes: 45,
        maxMessagesPerHour: 60,
        maxMessageChars: 3000,
        maxAiTurnsPerOrgPerDay: 0,
      });
      expect(auditorias).toHaveLength(1);
      expect(auditorias[0].message).toContain('encendió el asistente');
      expect(pub.enabled).toBe(true);
    });

    it('cambiar solo una hora valida contra la otra guardada', async () => {
      await expect(
        service.updateSettings({ teamFromHour: 17 }, ACTOR),
      ).rejects.toThrow(/horario/);
      await service.updateSettings({ teamToHour: 18 }, ACTOR);
      expect(row).toMatchObject({ teamFromHour: 8, teamToHour: 18 });
    });

    it('sin cambios no audita', async () => {
      await service.updateSettings({}, ACTOR);
      expect(auditorias).toEqual([]);
    });

    it('no se enciende sin bot', async () => {
      row = { id: 'global', enabled: false };
      await expect(
        service.updateSettings({ enabled: true }, ACTOR),
      ).rejects.toThrow(/Conecte primero/);
    });

    it.each([
      [{ enabled: 'sí' }, /verdadero o falso/],
      [{ teamDays: [] }, /días/],
      [{ teamDays: [0, 3] }, /días/],
      [{ teamDays: 'lunes' }, /días/],
      [{ teamFromHour: 8.5 }, /horario/],
      [{ teamToHour: 25 }, /horario/],
      [{ teamFromHour: -1 }, /horario/],
      [{ conversationIdleMinutes: 2 }, /conversationIdleMinutes/],
      [{ maxMessagesPerHour: 1000 }, /maxMessagesPerHour/],
      [{ maxMessageChars: 5000 }, /maxMessageChars/],
      [{ maxAiTurnsPerOrgPerDay: -1 }, /maxAiTurnsPerOrgPerDay/],
      [{ maxMessageChars: '2000' }, /maxMessageChars/],
    ])('rechaza %p', async (input, mensaje) => {
      await expect(service.updateSettings(input, ACTOR)).rejects.toThrow(
        mensaje,
      );
      expect(auditorias).toEqual([]);
    });

    it('sin fila todavía, la crea con lo que se cambió', async () => {
      row = null;
      await service.updateSettings({ conversationIdleMinutes: 20 }, ACTOR);
      expect(row).toMatchObject({ id: 'global', conversationIdleMinutes: 20 });
    });
  });

  describe('horario y salud', () => {
    it('el horario sale de la fila (o el de por defecto)', async () => {
      await expect(service.horario()).resolves.toMatchObject({
        desdeHora: 8,
        hastaHora: 17,
      });
      row = {
        teamDays: [1],
        teamFromHour: 9,
        teamToHour: 12,
        teamTimeZone: 'America/Bogota',
      };
      await expect(service.horario()).resolves.toMatchObject({
        dias: [1],
        desdeHora: 9,
        hastaHora: 12,
      });
    });

    it('registra el último envío bueno como mucho cada 5 minutos, y cada error', async () => {
      row = { id: 'global' };
      await service.registrarEnvio(true);
      await service.registrarEnvio(true);
      expect(prisma.supportBotConfig.updateMany).toHaveBeenCalledTimes(1);
      await service.registrarEnvio(
        false,
        'Forbidden: bot was blocked by the user',
      );
      expect(row).toMatchObject({
        lastError: 'Forbidden: bot was blocked by the user',
      });
      // Tras un error, el siguiente envío bueno se vuelve a anotar.
      await service.registrarEnvio(true);
      expect(prisma.supportBotConfig.updateMany).toHaveBeenCalledTimes(3);
    });

    it('nunca lanza aunque la base falle', async () => {
      prisma.supportBotConfig.updateMany.mockRejectedValue(
        new Error('db caída'),
      );
      await expect(service.registrarEnvio(false)).resolves.toBeUndefined();
    });
  });

  it('mismoSecreto compara en tiempo constante y rechaza largos distintos', () => {
    expect(mismoSecreto('abc', 'abc')).toBe(true);
    expect(mismoSecreto('abd', 'abc')).toBe(false);
    expect(mismoSecreto('ab', 'abc')).toBe(false);
    expect(mismoSecreto(undefined, 'abc')).toBe(false);
  });
});
