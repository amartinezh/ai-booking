import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WhatsappConfigService } from './whatsapp-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';

/**
 * El formulario con el que una clínica conecta su línea de WhatsApp. Es el
 * punto donde entran los secretos de Meta al sistema, así que se prueban las
 * tres cosas que no pueden fallar:
 *
 *  1. El token y el app secret se guardan CIFRADOS y nunca salen en claro.
 *  2. Guardar sin token no borra el que ya funcionaba (UX «no rotar»).
 *  3. 🏢 Dos clínicas no pueden reclamar el mismo `phone_number_id`: si eso
 *     pasara, los mensajes de los pacientes de una entrarían por la otra.
 */
describe('WhatsappConfigService', () => {
  let service: WhatsappConfigService;
  let prisma: {
    whatsappAccountConfig: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let crypto: { encrypt: jest.Mock; decrypt: jest.Mock };

  const ORG = 'org-1';
  const guardado = () =>
    prisma.whatsappAccountConfig.upsert.mock.calls[0][0].update;

  const fila = (over: Record<string, unknown> = {}) => ({
    organizationId: ORG,
    phoneNumberId: '123456',
    businessAccountId: 'waba-1',
    displayPhoneNumber: '+57 300 000 0000',
    verifyToken: 'vt-existente',
    encryptedAccessToken: 'cif:EAAG-token',
    encryptedAppSecret: 'cif:secret',
    isActive: true,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      whatsappAccountConfig: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({})),
      },
    };
    crypto = {
      encrypt: jest.fn((s: string) => `cif:${s}`),
      decrypt: jest.fn((s: string) => s.replace(/^cif:/, '')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile();

    service = module.get(WhatsappConfigService);
  });

  // ────────────────────────────────────────────────────────────────
  describe('buildWebhookUrl', () => {
    const ORIGINAL = { ...process.env };
    afterEach(() => {
      process.env = { ...ORIGINAL };
    });

    it('sale de PUBLIC_API_URL y termina en /chatbot/webhook', () => {
      process.env.PUBLIC_API_URL = 'https://api.miclinica.co';
      expect(service.buildWebhookUrl()).toBe(
        'https://api.miclinica.co/chatbot/webhook',
      );
    });

    it('las barras sobrantes no producen una URL doble', () => {
      process.env.PUBLIC_API_URL = 'https://api.miclinica.co///';
      expect(service.buildWebhookUrl()).toBe(
        'https://api.miclinica.co/chatbot/webhook',
      );
    });

    it('cae a NEXT_PUBLIC_API_URL y luego al dominio por defecto', () => {
      delete process.env.PUBLIC_API_URL;
      process.env.NEXT_PUBLIC_API_URL = 'https://otra.co';
      expect(service.buildWebhookUrl()).toContain('https://otra.co');

      delete process.env.NEXT_PUBLIC_API_URL;
      expect(service.buildWebhookUrl()).toContain('/chatbot/webhook');
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe('getPublic', () => {
    it('sin configuración devuelve todo vacío pero con la URL del webhook', async () => {
      const p = await service.getPublic(ORG);

      expect(p).toMatchObject({
        phoneNumberId: null,
        verifyToken: null,
        hasAccessToken: false,
        accessTokenLast4: null,
        hasAppSecret: false,
        isActive: false,
      });
      expect(p.webhookCallbackUrl).toContain('/chatbot/webhook');
    });

    it('🔒 del token solo salen «existe» y los últimos 4', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila());

      const p = await service.getPublic(ORG);

      expect(p.hasAccessToken).toBe(true);
      expect(p.accessTokenLast4).toBe('oken');
      expect(JSON.stringify(p)).not.toContain('EAAG-token');
    });

    it('un token que no descifra se reporta como ausente, no revienta el panel', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila());
      crypto.decrypt.mockImplementation(() => {
        throw new Error('bad auth tag');
      });

      await expect(service.getPublic(ORG)).resolves.toMatchObject({
        hasAccessToken: false,
        accessTokenLast4: null,
      });
    });

    it('del app secret solo se dice si está puesto', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila());
      const p = await service.getPublic(ORG);
      expect(p.hasAppSecret).toBe(true);
      expect(JSON.stringify(p)).not.toContain('cif:secret');
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe('upsert', () => {
    it('guarda el token y el app secret CIFRADOS', async () => {
      await service.upsert(ORG, {
        phoneNumberId: '123456',
        accessToken: 'EAAG-nuevo',
        appSecret: 'secreto-nuevo',
      } as never);

      expect(crypto.encrypt).toHaveBeenCalledWith('EAAG-nuevo');
      expect(crypto.encrypt).toHaveBeenCalledWith('secreto-nuevo');
      expect(guardado().encryptedAccessToken).toBe('cif:EAAG-nuevo');
      expect(guardado().encryptedAppSecret).toBe('cif:secreto-nuevo');
    });

    it.each([
      ['omitido', undefined],
      ['vacío', ''],
      ['solo espacios', '   '],
    ])(
      'un token %s conserva el que ya funcionaba (UX «no rotar»)',
      async (_e, valor) => {
        prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila());

        await service.upsert(ORG, {
          phoneNumberId: '123456',
          accessToken: valor,
        } as never);

        expect(guardado().encryptedAccessToken).toBe('cif:EAAG-token');
      },
    );

    it('el app secret sigue la misma semántica de no rotar', async () => {
      prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila());
      await service.upsert(ORG, { phoneNumberId: '123456' } as never);
      expect(guardado().encryptedAppSecret).toBe('cif:secret');
    });

    it('los campos vacíos se guardan como null, no como cadena vacía', async () => {
      // Una cadena vacía en una columna UNIQUE haría chocar a dos clínicas.
      await service.upsert(ORG, {
        phoneNumberId: '   ',
        businessAccountId: '',
        displayPhoneNumber: undefined,
      } as never);

      expect(guardado().phoneNumberId).toBeNull();
      expect(guardado().businessAccountId).toBeNull();
      expect(guardado().displayPhoneNumber).toBeNull();
    });

    it('los valores con espacios alrededor se recortan', async () => {
      await service.upsert(ORG, {
        phoneNumberId: '  123456  ',
      } as never);
      expect(guardado().phoneNumberId).toBe('123456');
    });

    describe('verifyToken', () => {
      it('si la clínica no manda uno y no existe previo, se genera fuerte', async () => {
        await service.upsert(ORG, { phoneNumberId: '1' } as never);

        expect(guardado().verifyToken).toMatch(/^[0-9a-f]{64}$/);
      });

      it('si ya existía se conserva: cambiarlo rompería el webhook en Meta', async () => {
        prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila());
        await service.upsert(ORG, { phoneNumberId: '123456' } as never);
        expect(guardado().verifyToken).toBe('vt-existente');
      });

      it('el que mande la clínica manda sobre el existente', async () => {
        prisma.whatsappAccountConfig.findUnique.mockResolvedValue(fila());
        await service.upsert(ORG, {
          phoneNumberId: '123456',
          verifyToken: 'mi-token',
        } as never);
        expect(guardado().verifyToken).toBe('mi-token');
      });

      it('si el token elegido ya es de otra clínica, se regenera', async () => {
        prisma.whatsappAccountConfig.findUnique
          .mockResolvedValueOnce(null) // existing
          .mockResolvedValueOnce(null) // colisión de phoneNumberId
          .mockResolvedValueOnce({ organizationId: 'org-ajena' }) // colisión de verifyToken
          .mockResolvedValue(null);

        await service.upsert(ORG, {
          phoneNumberId: '123456',
          verifyToken: 'repetido',
        } as never);

        expect(guardado().verifyToken).not.toBe('repetido');
        expect(guardado().verifyToken).toMatch(/^[0-9a-f]{64}$/);
      });
    });

    describe('🏢 un phone_number_id pertenece a UNA sola clínica', () => {
      it('si otra clínica ya lo reclama, se rechaza con un mensaje entendible', async () => {
        prisma.whatsappAccountConfig.findUnique
          .mockResolvedValueOnce(null) // existing
          .mockResolvedValueOnce({ organizationId: 'org-ajena' }); // colisión

        await expect(
          service.upsert(ORG, { phoneNumberId: '123456' } as never),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.whatsappAccountConfig.upsert).not.toHaveBeenCalled();
      });

      it('que sea el MISMO tenant no es colisión: puede volver a guardar', async () => {
        prisma.whatsappAccountConfig.findUnique
          .mockResolvedValueOnce(fila())
          .mockResolvedValueOnce(fila())
          .mockResolvedValue(fila());

        await expect(
          service.upsert(ORG, { phoneNumberId: '123456' } as never),
        ).resolves.toBeDefined();
      });
    });

    describe('isActive', () => {
      it('se activa sola cuando hay número y token', async () => {
        await service.upsert(ORG, {
          phoneNumberId: '123456',
          accessToken: 'EAAG',
        } as never);
        expect(guardado().isActive).toBe(true);
      });

      it('sin token no se activa: una línea a medias no debe recibir pacientes', async () => {
        await service.upsert(ORG, { phoneNumberId: '123456' } as never);
        expect(guardado().isActive).toBe(false);
      });

      it('sin número tampoco', async () => {
        await service.upsert(ORG, { accessToken: 'EAAG' } as never);
        expect(guardado().isActive).toBe(false);
      });

      it('la clínica puede apagarla a mano aunque esté completa', async () => {
        await service.upsert(ORG, {
          phoneNumberId: '123456',
          accessToken: 'EAAG',
          isActive: false,
        } as never);
        expect(guardado().isActive).toBe(false);
      });
    });

    it('devuelve la vista pública, no la fila cruda', async () => {
      const r = await service.upsert(ORG, {
        phoneNumberId: '123456',
        accessToken: 'EAAG',
      } as never);
      expect(r).toHaveProperty('webhookCallbackUrl');
      expect(r).not.toHaveProperty('encryptedAccessToken');
    });
  });
});
