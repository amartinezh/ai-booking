import { Logger } from '@nestjs/common';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TelegramConfigService } from './telegram-config.service';
import type { TelegramApiClient } from './telegram-api.client';
import type { PrismaService } from '../prisma/prisma.service';
import type { CryptoService } from '../common/crypto/crypto.service';

/**
 * Conectar el bot desde el panel. Lo que no puede fallar:
 *  1. El canal NO queda activo hasta que Telegram confirma el webhook.
 *  2. Un bot no puede ser de dos clínicas.
 *  3. Token y secreto se guardan cifrados y nunca vuelven al panel en claro.
 *  4. Cambiar de bot desengancha el viejo y renueva la ruta.
 */
describe('TelegramConfigService', () => {
  const ORG = 'org-1';
  const TOKEN = '123456789:AAHsecretoSecretoSecretoSecreto12345';
  const OTHER = '987654321:AAHotroOtroOtroOtroOtroOtroOtro9876';
  const ORIGINAL_URL = process.env.PUBLIC_API_URL;

  let service: TelegramConfigService;
  let row: Record<string, unknown> | null;
  let prisma: {
    telegramBotConfig: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
    };
  };
  let api: {
    getMe: jest.Mock;
    setWebhook: jest.Mock;
    getWebhookInfo: jest.Mock;
    deleteWebhook: jest.Mock;
  };
  const crypto = {
    encrypt: jest.fn((s: string) => `cif:${s}`),
    decrypt: jest.fn((s: string) => {
      if (!s.startsWith('cif:')) throw new Error('bad');
      return s.slice(4);
    }),
  };

  const urlOf = (routeKey: string) =>
    `https://api.test/telegram/webhook/${routeKey}`;

  beforeEach(() => {
    process.env.PUBLIC_API_URL = 'https://api.test/';
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    row = null;
    prisma = {
      telegramBotConfig: {
        findUnique: jest.fn(async ({ where }) => {
          if (where.organizationId) return row;
          if (where.botId) return row && row.botId === where.botId ? row : null;
          if (where.webhookRouteKey)
            return row && row.webhookRouteKey === where.webhookRouteKey
              ? row
              : null;
          return null;
        }),
        upsert: jest.fn(async ({ create, update }) => {
          row = row
            ? { ...row, ...update, updatedAt: new Date() }
            : { ...create, lastWebhookSetAt: null, updatedAt: new Date() };
          return row;
        }),
        update: jest.fn(async ({ data }) => {
          row = { ...row, ...data };
          return row;
        }),
      },
    };
    api = {
      getMe: jest.fn(async () => ({
        ok: true,
        result: { id: 123456789, is_bot: true, username: 'ClinicaBot' },
      })),
      setWebhook: jest.fn(async () => ({ ok: true, result: true })),
      getWebhookInfo: jest.fn(async () => ({
        ok: true,
        result: { url: urlOf(String(row?.webhookRouteKey)) },
      })),
      deleteWebhook: jest.fn(async () => ({ ok: true, result: true })),
    };
    service = new TelegramConfigService(
      prisma as unknown as PrismaService,
      crypto as unknown as CryptoService,
      api as unknown as TelegramApiClient,
    );
  });

  afterEach(() => {
    process.env.PUBLIC_API_URL = ORIGINAL_URL;
    jest.restoreAllMocks();
  });

  describe('connect', () => {
    it('camino feliz: valida, guarda cifrado, registra el webhook y SOLO entonces activa', async () => {
      const pub = await service.connect(ORG, `  ${TOKEN}  `);

      expect(api.getMe).toHaveBeenCalledWith(TOKEN);
      const saved = prisma.telegramBotConfig.upsert.mock.calls[0][0].create;
      expect(saved).toMatchObject({
        organizationId: ORG,
        botId: '123456789',
        botUsername: 'ClinicaBot',
        encryptedBotToken: `cif:${TOKEN}`,
        isActive: false, // apagado mientras se registra el webhook
      });
      expect(saved.encryptedWebhookSecret).toMatch(/^cif:[A-Za-z0-9_-]{43}$/);
      expect(saved.webhookRouteKey).toMatch(/^[A-Za-z0-9_-]{32}$/);

      const secret = String(saved.encryptedWebhookSecret).slice(4);
      expect(api.setWebhook).toHaveBeenCalledWith(TOKEN, {
        url: urlOf(saved.webhookRouteKey),
        secretToken: secret,
      });
      expect(row?.isActive).toBe(true);
      expect(row?.lastWebhookSetAt).toBeInstanceOf(Date);

      expect(pub).toEqual(
        expect.objectContaining({
          connected: true,
          isActive: true,
          botUsername: 'ClinicaBot',
          botLink: 'https://t.me/ClinicaBot',
          botTokenLast4: '2345',
          lastError: null,
        }),
      );
      expect(JSON.stringify(pub)).not.toContain(TOKEN);
      expect(JSON.stringify(pub)).not.toContain(secret);
    });

    it.each(['', '   ', 'abc', '123:corto', `x${TOKEN}`, null, undefined])(
      'rechaza un token con formato inválido (%p) sin llamar a Telegram',
      async (bad) => {
        await expect(service.connect(ORG, bad)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(api.getMe).not.toHaveBeenCalled();
        expect(prisma.telegramBotConfig.upsert).not.toHaveBeenCalled();
      },
    );

    it('token rechazado por Telegram → 400 y nada guardado', async () => {
      api.getMe.mockResolvedValue({
        ok: false,
        errorCode: 401,
        description: 'Unauthorized',
      });
      await expect(service.connect(ORG, TOKEN)).rejects.toThrow(
        /rechazó el token/,
      );
      expect(prisma.telegramBotConfig.upsert).not.toHaveBeenCalled();
    });

    it('Telegram caído → 503 y nada guardado', async () => {
      api.getMe.mockResolvedValue({
        ok: false,
        errorCode: null,
        description: 'timeout',
      });
      await expect(service.connect(ORG, TOKEN)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(prisma.telegramBotConfig.upsert).not.toHaveBeenCalled();
    });

    it('🏢 un bot de otra clínica no se puede conectar', async () => {
      row = {
        organizationId: 'org-2',
        botId: '123456789',
        webhookRouteKey: 'rk',
      };
      prisma.telegramBotConfig.findUnique.mockImplementation(
        async ({ where }) => (where.botId ? row : null),
      );
      await expect(service.connect(ORG, TOKEN)).rejects.toThrow(/otra clínica/);
      expect(prisma.telegramBotConfig.upsert).not.toHaveBeenCalled();
    });

    it('setWebhook falla → canal apagado con el motivo, y error al panel', async () => {
      api.setWebhook.mockResolvedValue({
        ok: false,
        errorCode: 400,
        description: 'bad webhook: HTTPS url must be provided',
      });
      await expect(service.connect(ORG, TOKEN)).rejects.toThrow(
        /no aceptó el webhook/,
      );
      expect(row?.isActive).toBe(false);
      expect(row?.lastError).toMatch(/HTTPS url must be provided/);
    });

    it('el webhook quedó apuntando a otra URL → no se activa', async () => {
      api.getWebhookInfo.mockResolvedValue({
        ok: true,
        result: { url: 'https://otro.servidor/hook' },
      });
      await expect(service.connect(ORG, TOKEN)).rejects.toThrow(
        /no quedó apuntando/,
      );
      expect(row?.isActive).toBe(false);
    });

    it('getWebhookInfo falla → no se activa', async () => {
      api.getWebhookInfo.mockResolvedValue({
        ok: false,
        errorCode: null,
        description: 'timeout',
      });
      await expect(service.connect(ORG, TOKEN)).rejects.toThrow(
        /No se pudo confirmar/,
      );
      expect(row?.isActive).toBe(false);
    });

    it('URL pública sin HTTPS → no se llama a setWebhook', async () => {
      process.env.PUBLIC_API_URL = 'http://localhost:3001';
      await expect(service.connect(ORG, TOKEN)).rejects.toThrow(/HTTPS/);
      expect(api.setWebhook).not.toHaveBeenCalled();
      expect(row?.isActive).toBe(false);
    });

    it('reconectar el MISMO bot conserva la ruta y rota el secreto', async () => {
      await service.connect(ORG, TOKEN);
      const firstRoute = row?.webhookRouteKey;
      const firstSecret = row?.encryptedWebhookSecret;
      await service.connect(ORG, TOKEN);
      expect(row?.webhookRouteKey).toBe(firstRoute);
      expect(row?.encryptedWebhookSecret).not.toBe(firstSecret);
      expect(api.deleteWebhook).not.toHaveBeenCalled();
    });

    it('cambiar de bot desengancha el viejo y renueva la ruta', async () => {
      await service.connect(ORG, TOKEN);
      const firstRoute = row?.webhookRouteKey;
      api.getMe.mockResolvedValue({
        ok: true,
        result: { id: 987654321, is_bot: true, username: 'Nuevo' },
      });
      await service.connect(ORG, OTHER);
      expect(api.deleteWebhook).toHaveBeenCalledWith(TOKEN);
      expect(row?.webhookRouteKey).not.toBe(firstRoute);
      expect(row?.botId).toBe('987654321');
      expect(row?.isActive).toBe(true);
    });

    it('un token viejo que ya no se puede descifrar no impide cambiar de bot', async () => {
      row = {
        organizationId: ORG,
        botId: '1111111',
        encryptedBotToken: 'corrupto',
        webhookRouteKey: 'viejo',
        isActive: true,
        updatedAt: new Date(),
      };
      await expect(service.connect(ORG, TOKEN)).resolves.toMatchObject({
        isActive: true,
      });
      expect(api.deleteWebhook).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('borra el webhook, apaga el canal y conserva el token', async () => {
      await service.connect(ORG, TOKEN);
      const pub = await service.disconnect(ORG);
      expect(api.deleteWebhook).toHaveBeenCalledWith(TOKEN);
      expect(row?.isActive).toBe(false);
      expect(row?.encryptedBotToken).toBe(`cif:${TOKEN}`);
      expect(pub).toMatchObject({ connected: true, isActive: false });
    });

    it('si Telegram falla al borrar el webhook, igual apaga', async () => {
      await service.connect(ORG, TOKEN);
      api.deleteWebhook.mockResolvedValue({
        ok: false,
        errorCode: null,
        description: 'timeout',
      });
      await service.disconnect(ORG);
      expect(row?.isActive).toBe(false);
    });

    it('sin configuración no hace nada', async () => {
      await expect(service.disconnect(ORG)).resolves.toMatchObject({
        connected: false,
        isActive: false,
      });
      expect(prisma.telegramBotConfig.update).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('dice si Telegram sigue apuntando a nosotros', async () => {
      await service.connect(ORG, TOKEN);
      api.getWebhookInfo.mockResolvedValue({
        ok: true,
        result: {
          url: urlOf(String(row?.webhookRouteKey)),
          pending_update_count: 2,
          last_error_message: 'Connection timed out',
        },
      });
      await expect(service.verify(ORG)).resolves.toMatchObject({
        webhookOk: true,
        pendingUpdateCount: 2,
        telegramLastError: 'Connection timed out',
      });
    });

    it('webhook cambiado por fuera → webhookOk false', async () => {
      await service.connect(ORG, TOKEN);
      api.getWebhookInfo.mockResolvedValue({ ok: true, result: { url: '' } });
      await expect(service.verify(ORG)).resolves.toMatchObject({
        webhookOk: false,
      });
    });

    it('token revocado (401) → apaga el canal y lo dice', async () => {
      await service.connect(ORG, TOKEN);
      api.getWebhookInfo.mockResolvedValue({
        ok: false,
        errorCode: 401,
        description: 'Unauthorized',
      });
      const res = await service.verify(ORG);
      expect(res.isActive).toBe(false);
      expect(res.lastError).toMatch(/BotFather/);
    });

    it('Telegram no responde → no toca el estado', async () => {
      await service.connect(ORG, TOKEN);
      api.getWebhookInfo.mockResolvedValue({
        ok: false,
        errorCode: null,
        description: 'timeout',
      });
      const res = await service.verify(ORG);
      expect(res).toMatchObject({
        isActive: true,
        webhookOk: false,
        telegramLastError: 'timeout',
      });
    });

    it('sin configuración', async () => {
      await expect(service.verify(ORG)).resolves.toMatchObject({
        connected: false,
        webhookOk: false,
      });
    });
  });

  describe('forRouteKey / forOrg', () => {
    it('resuelve la clínica, el token y el secreto de una ruta', async () => {
      await service.connect(ORG, TOKEN);
      const target = await service.forRouteKey(String(row?.webhookRouteKey));
      expect(target).toEqual({
        organizationId: ORG,
        botToken: TOKEN,
        webhookSecret: String(row?.encryptedWebhookSecret).slice(4),
        isActive: true,
      });
    });

    it.each(['', 'x'.repeat(129), 'no-existe'])(
      'ruta inválida o desconocida (%p) → null',
      async (rk) => {
        await service.connect(ORG, TOKEN);
        await expect(service.forRouteKey(rk)).resolves.toBeNull();
      },
    );

    it('un secreto que no se puede descifrar → null (se rechazará el update)', async () => {
      row = {
        organizationId: ORG,
        encryptedBotToken: `cif:${TOKEN}`,
        encryptedWebhookSecret: 'corrupto',
        webhookRouteKey: 'rk',
        isActive: true,
      };
      await expect(service.forRouteKey('rk')).resolves.toBeNull();
    });

    it('forOrg devuelve credenciales, o null sin token', async () => {
      await expect(service.forOrg(ORG)).resolves.toBeNull();
      await service.connect(ORG, TOKEN);
      await expect(service.forOrg(ORG)).resolves.toEqual({
        organizationId: ORG,
        botToken: TOKEN,
        botId: '123456789',
        isActive: true,
      });
    });
  });

  it('markTokenRevoked nunca lanza', async () => {
    prisma.telegramBotConfig.update.mockRejectedValue(new Error('db caída'));
    await expect(service.markTokenRevoked(ORG)).resolves.toBeUndefined();
  });
});
