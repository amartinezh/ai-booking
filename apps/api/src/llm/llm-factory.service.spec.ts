import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  LlmFactoryService,
  NoActiveLlmProviderError,
} from './llm-factory.service';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { GeminiProvider } from './providers/gemini.provider';
import { ChatGptProvider } from './providers/chatgpt.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { AiConfigService } from './ai-config.service';

/**
 * Quién atiende cada turno del chatbot. Dos propiedades caras de perder:
 *
 *  - NO se cachea: si la clínica rota su API key, el siguiente turno la usa.
 *    Cachear aquí significa un bot mudo hasta reiniciar el contenedor.
 *  - El blob multi-proveedor conserva las credenciales de los OTROS: sin eso,
 *    el failover no tiene a quién recurrir cuando el activo se cae.
 */
describe('LlmFactoryService', () => {
  let service: LlmFactoryService;
  let prisma: { aiProviderConfig: { findUnique: jest.Mock } };
  let crypto: { decryptJson: jest.Mock };

  const ORG = 'org-1';

  const config = (over: Record<string, unknown> = {}) => ({
    organizationId: ORG,
    activeProvider: 'GEMINI',
    encryptedApiConfig: 'cifrado',
    ...over,
  });

  const blob = (byProvider: Record<string, unknown>) => ({ byProvider });

  beforeEach(async () => {
    prisma = {
      aiProviderConfig: { findUnique: jest.fn(async () => config()) },
    };
    crypto = {
      decryptJson: jest.fn(() =>
        blob({ GEMINI: { apiKey: 'k-gemini', model: 'gemini-2.5-flash' } }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmFactoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile();

    service = module.get(LlmFactoryService);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  describe('forOrgOrNull', () => {
    it.each([
      ['GEMINI', GeminiProvider],
      ['CHATGPT', ChatGptProvider],
      ['CLAUDE', ClaudeProvider],
    ])('%s se instancia con su implementación', async (activo, Clase) => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue(
        config({ activeProvider: activo }),
      );
      crypto.decryptJson.mockReturnValue(
        blob({ [activo]: { apiKey: 'k', model: 'm' } }),
      );

      await expect(service.forOrgOrNull(ORG)).resolves.toBeInstanceOf(Clase);
    });

    it.each([
      ['sin fila de configuración', null],
      ['con IA desactivada', config({ activeProvider: 'NONE' })],
      ['con blob vacío', config({ encryptedApiConfig: null })],
    ])('%s → null (el chatbot degrada, no revienta)', async (_e, fila) => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue(fila);
      await expect(service.forOrgOrNull(ORG)).resolves.toBeNull();
    });

    it('el proveedor activo no tiene credenciales en el blob → null, con aviso', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue(
        config({ activeProvider: 'CLAUDE' }),
      );
      crypto.decryptJson.mockReturnValue(blob({ GEMINI: { apiKey: 'k' } }));

      await expect(service.forOrgOrNull(ORG)).resolves.toBeNull();
      expect(service['logger'].warn).toHaveBeenCalledWith(
        expect.stringContaining('no trae sus credenciales'),
      );
    });

    it('un blob que no descifra → null, no una excepción hacia el paciente', async () => {
      crypto.decryptJson.mockImplementation(() => {
        throw new Error('bad auth tag');
      });

      await expect(service.forOrgOrNull(ORG)).resolves.toBeNull();
      expect(service['logger'].error).toHaveBeenCalled();
    });

    it('🔑 NO cachea: cada turno relee la base, así una key rotada se usa ya', async () => {
      await service.forOrgOrNull(ORG);
      await service.forOrgOrNull(ORG);
      expect(prisma.aiProviderConfig.findUnique).toHaveBeenCalledTimes(2);
    });

    it('la configuración se busca por organización', async () => {
      await service.forOrgOrNull(ORG);
      expect(prisma.aiProviderConfig.findUnique).toHaveBeenCalledWith({
        where: { organizationId: ORG },
      });
    });
  });

  describe('forOrg — cuando la operación NO puede seguir sin IA', () => {
    it('devuelve el proveedor si lo hay', async () => {
      await expect(service.forOrg(ORG)).resolves.toBeInstanceOf(GeminiProvider);
    });

    it('lanza un error con nombre propio y con la ruta para arreglarlo', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue(null);

      await expect(service.forOrg(ORG)).rejects.toBeInstanceOf(
        NoActiveLlmProviderError,
      );
      await expect(service.forOrg(ORG)).rejects.toThrow(/Integración de IA/);
    });
  });

  describe('forOrgByProvider — el failover del chatbot', () => {
    beforeEach(() => {
      crypto.decryptJson.mockReturnValue(
        blob({
          GEMINI: { apiKey: 'k-gemini', model: 'g' },
          CHATGPT: { apiKey: 'k-openai', model: 'o' },
        }),
      );
    });

    it('puede pedir un proveedor que NO es el activo', async () => {
      await expect(
        service.forOrgByProvider(ORG, 'CHATGPT'),
      ).resolves.toBeInstanceOf(ChatGptProvider);
    });

    it('sin key para ese proveedor → null: no se intenta el failover a ciegas', async () => {
      await expect(service.forOrgByProvider(ORG, 'CLAUDE')).resolves.toBeNull();
    });

    it('una entrada sin apiKey cuenta como ausente', async () => {
      crypto.decryptJson.mockReturnValue(
        blob({ CLAUDE: { model: 'sin-key' } }),
      );
      await expect(service.forOrgByProvider(ORG, 'CLAUDE')).resolves.toBeNull();
    });

    it.each([
      ['sin fila', null],
      ['sin blob', config({ encryptedApiConfig: null })],
    ])('%s → null', async (_e, fila) => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue(fila);
      await expect(service.forOrgByProvider(ORG, 'GEMINI')).resolves.toBeNull();
    });

    it('funciona aunque la IA esté desactivada: el blob conserva las keys', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue(
        config({ activeProvider: 'NONE' }),
      );
      await expect(
        service.forOrgByProvider(ORG, 'GEMINI'),
      ).resolves.toBeInstanceOf(GeminiProvider);
    });
  });

  describe('build', () => {
    it('un proveedor desconocido se rechaza en vez de devolver algo roto', () => {
      expect(() =>
        (
          service as unknown as {
            build: (p: string, c: unknown) => unknown;
          }
        ).build('MISTRAL', { apiKey: 'k' }),
      ).toThrow(NotFoundException);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('AiConfigService', () => {
  let service: AiConfigService;
  let prisma: {
    aiProviderConfig: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let crypto: { decryptJson: jest.Mock; encryptJson: jest.Mock };

  const ORG = 'org-1';
  const guardado = () => prisma.aiProviderConfig.upsert.mock.calls[0][0];

  beforeEach(async () => {
    prisma = {
      aiProviderConfig: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({})),
      },
    };
    crypto = {
      decryptJson: jest.fn(() => ({ byProvider: {} })),
      encryptJson: jest.fn((o: unknown) => `cifrado:${JSON.stringify(o)}`),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile();
    service = module.get(AiConfigService);
  });

  describe('getPublic', () => {
    it('sin configuración devuelve el estado neutro', async () => {
      await expect(service.getPublic(ORG)).resolves.toEqual({
        activeProvider: 'NONE',
        model: null,
        hasApiKey: false,
        apiKeyLast4: null,
        openaiOrganizationId: null,
        updatedAt: null,
      });
    });

    it('🔒 nunca devuelve la API key: solo si existe y sus 4 últimos', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue({
        activeProvider: 'GEMINI',
        encryptedApiConfig: 'x',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      crypto.decryptJson.mockReturnValue({
        byProvider: {
          GEMINI: {
            apiKey: 'AIzaSy-SUPER-SECRETA-9876',
            model: 'gemini-2.5-flash',
          },
        },
      });

      const r = await service.getPublic(ORG);

      expect(r.hasApiKey).toBe(true);
      expect(r.apiKeyLast4).toBe('9876');
      expect(JSON.stringify(r)).not.toContain('AIzaSy-SUPER-SECRETA');
    });

    it('un blob que no descifra se trata como vacío, no como error', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue({
        activeProvider: 'GEMINI',
        encryptedApiConfig: 'roto',
        updatedAt: null,
      });
      crypto.decryptJson.mockImplementation(() => {
        throw new Error('bad auth tag');
      });

      await expect(service.getPublic(ORG)).resolves.toMatchObject({
        hasApiKey: false,
        model: null,
      });
    });

    it('la organización de OpenAI se expone cuando el proveedor activo es CHATGPT', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue({
        activeProvider: 'CHATGPT',
        encryptedApiConfig: 'x',
        updatedAt: null,
      });
      crypto.decryptJson.mockReturnValue({
        byProvider: {
          CHATGPT: {
            apiKey: 'sk-1234',
            model: 'gpt-4o',
            organizationId: 'org-openai',
          },
        },
      });

      await expect(service.getPublic(ORG)).resolves.toMatchObject({
        openaiOrganizationId: 'org-openai',
      });
    });
  });

  describe('upsert', () => {
    it('apagar la IA limpia el blob entero (también las keys de respaldo)', async () => {
      await service.upsert(ORG, { activeProvider: 'NONE' } as never);

      expect(guardado().update).toEqual({
        activeProvider: 'NONE',
        encryptedApiConfig: null,
      });
    });

    it('guarda la key nueva cifrada, nunca en claro', async () => {
      await service.upsert(ORG, {
        activeProvider: 'GEMINI',
        apiKey: '  AIzaSy-nueva  ',
      } as never);

      expect(crypto.encryptJson).toHaveBeenCalledWith({
        byProvider: {
          GEMINI: { apiKey: 'AIzaSy-nueva', model: expect.any(String) },
        },
      });
      expect(guardado().update.encryptedApiConfig).toContain('cifrado:');
    });

    it('🔁 activar otro proveedor NO borra las credenciales del anterior', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue({
        activeProvider: 'GEMINI',
        encryptedApiConfig: 'x',
      });
      crypto.decryptJson.mockReturnValue({
        byProvider: { GEMINI: { apiKey: 'k-gemini', model: 'g' } },
      });

      await service.upsert(ORG, {
        activeProvider: 'CHATGPT',
        apiKey: 'sk-openai',
      } as never);

      const blob = crypto.encryptJson.mock.calls[0][0] as {
        byProvider: Record<string, unknown>;
      };
      expect(blob.byProvider.GEMINI).toEqual({
        apiKey: 'k-gemini',
        model: 'g',
      });
      expect(blob.byProvider.CHATGPT).toMatchObject({ apiKey: 'sk-openai' });
    });

    it('sin apiKey nueva se conserva la que ya había (UX «no rotar»)', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue({
        activeProvider: 'GEMINI',
        encryptedApiConfig: 'x',
      });
      crypto.decryptJson.mockReturnValue({
        byProvider: { GEMINI: { apiKey: 'k-vieja', model: 'g' } },
      });

      await service.upsert(ORG, { activeProvider: 'GEMINI' } as never);

      const blob = crypto.encryptJson.mock.calls[0][0] as {
        byProvider: Record<string, { apiKey: string }>;
      };
      expect(blob.byProvider.GEMINI.apiKey).toBe('k-vieja');
    });

    it('sin key nueva ni previa se rechaza: activar sin credenciales es un bot mudo', async () => {
      await expect(
        service.upsert(ORG, { activeProvider: 'CLAUDE' } as never),
      ).rejects.toThrow(/apiKey es requerida/);
      expect(prisma.aiProviderConfig.upsert).not.toHaveBeenCalled();
    });

    it('un modelo que no está en el catálogo cae al primero permitido', async () => {
      await service.upsert(ORG, {
        activeProvider: 'GEMINI',
        apiKey: 'k',
        model: 'gemini-inventado-9',
      } as never);

      const blob = crypto.encryptJson.mock.calls[0][0] as {
        byProvider: Record<string, { model: string }>;
      };
      expect(blob.byProvider.GEMINI.model).not.toBe('gemini-inventado-9');
      expect(blob.byProvider.GEMINI.model).toEqual(expect.any(String));
    });

    it('la organización de OpenAI solo se guarda para CHATGPT', async () => {
      await service.upsert(ORG, {
        activeProvider: 'GEMINI',
        apiKey: 'k',
        openaiOrganizationId: 'org-openai',
      } as never);

      const blob = crypto.encryptJson.mock.calls[0][0] as {
        byProvider: Record<string, Record<string, unknown>>;
      };
      expect(blob.byProvider.GEMINI.organizationId).toBeUndefined();
    });
  });
});
