import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import {
  IntegrationsService,
  sanitizeBearerToken,
} from './integrations.service';
import { LlmFactoryService } from '../llm/llm-factory.service';
import { WhatsappCredentialsService } from '../whatsapp-config/whatsapp-credentials.service';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';

/**
 * El panel de diagnóstico: lo primero que alguien mira cuando "el bot no
 * responde". Su valor entero está en clasificar BIEN el fallo — un "UNKNOWN"
 * genérico manda a la clínica a revisar lo que no es.
 *
 * También vive aquí `sanitizeBearerToken`, que existe por un fallo real:
 * pegar el token de Meta desde su panel arrastra saltos de línea y Node
 * rechaza la cabecera con un error que no dice nada.
 */
/**
 * Los resultados de diagnóstico son uniones discriminadas por `success`. En las
 * ramas de fallo hay que estrecharlas para leer `error_code`/`error_message`:
 * el `expect` de la izquierda deja constancia de por qué la conversión es
 * legítima, además de fallar con un mensaje claro si el camino cambia.
 */
const fallo = <T extends { success: boolean }>(
  r: T,
): Extract<T, { success: false }> & {
  error_code: string;
  error_message: string;
  rtt_ms?: number;
} => {
  expect(r.success).toBe(false);
  return r as never;
};

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let llmFactory: { forOrgOrNull: jest.Mock };
  let whatsappCreds: { forOrg: jest.Mock };
  let http: { get: jest.Mock };
  let prisma: { aiProviderConfig: { findUnique: jest.Mock } };
  let crypto: { decryptJson: jest.Mock };

  const ORG = 'org-1';

  const proveedor = (over: Record<string, unknown> = {}) => ({
    name: 'GEMINI',
    ping: jest.fn(async () => '  gemini-2.5-flash  '),
    ...over,
  });

  beforeEach(async () => {
    llmFactory = { forOrgOrNull: jest.fn(async () => proveedor()) };
    whatsappCreds = { forOrg: jest.fn(async () => null) };
    http = { get: jest.fn() };
    prisma = {
      aiProviderConfig: {
        findUnique: jest.fn(async () => ({
          activeProvider: 'GEMINI',
          encryptedApiConfig: 'cifrado',
        })),
      },
    };
    crypto = { decryptJson: jest.fn(() => ({ model: 'gemini-2.5-flash' })) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: LlmFactoryService, useValue: llmFactory },
        { provide: WhatsappCredentialsService, useValue: whatsappCreds },
        { provide: HttpService, useValue: http },
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile();

    service = module.get(IntegrationsService);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  // ══════════════════════════════════════════════════════════════════
  describe('diagnoseLlm — el proveedor de IA activo', () => {
    it('un proveedor vivo devuelve nombre, modelo, RTT y el eco', async () => {
      const r = await service.diagnoseLlm(ORG);

      expect(r).toMatchObject({
        success: true,
        status: 'alive',
        provider: 'GEMINI',
        model: 'gemini-2.5-flash',
        model_response: 'gemini-2.5-flash',
      });
      expect(r.rtt_ms).toBeGreaterThanOrEqual(0);
    });

    it('sin configuración de IA → NO_PROVIDER, y ni se instancia nada', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue(null);

      const r = await service.diagnoseLlm(ORG);

      expect(r).toMatchObject({ success: false, error_code: 'NO_PROVIDER' });
      expect(llmFactory.forOrgOrNull).not.toHaveBeenCalled();
    });

    it('activeProvider = NONE también es NO_PROVIDER', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue({
        activeProvider: 'NONE',
      });
      await expect(service.diagnoseLlm(ORG)).resolves.toMatchObject({
        error_code: 'NO_PROVIDER',
      });
    });

    it('credenciales corruptas: hay config pero el proveedor no se instancia', async () => {
      llmFactory.forOrgOrNull.mockResolvedValue(null);

      const r = await service.diagnoseLlm(ORG);

      expect(r).toMatchObject({
        success: false,
        error_code: 'NO_PROVIDER',
        provider: 'GEMINI',
        model: 'gemini-2.5-flash',
      });
      expect(fallo(r).error_message).toContain('no se pudo instanciar');
    });

    it('🔒 la API key NUNCA sale en el resultado; el modelo sí', async () => {
      crypto.decryptJson.mockReturnValue({
        model: 'gpt-4o',
        apiKey: 'sk-super-secreta',
      });

      const r = await service.diagnoseLlm(ORG);

      expect(JSON.stringify(r)).not.toContain('sk-super-secreta');
      expect(r.model).toBe('gpt-4o');
    });

    it('si la config cifrada no descifra, sigue adelante con el modelo en «—»', async () => {
      crypto.decryptJson.mockImplementation(() => {
        throw new Error('bad auth tag');
      });

      const r = await service.diagnoseLlm(ORG);

      expect(r.model).toBe('—');
      expect(r.success).toBe(true);
      expect(service['logger'].warn).toHaveBeenCalled();
    });

    it('sin config cifrada guardada, el modelo queda en «—»', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue({
        activeProvider: 'CLAUDE',
        encryptedApiConfig: null,
      });
      await expect(service.diagnoseLlm(ORG)).resolves.toMatchObject({
        model: '—',
      });
    });

    it('una respuesta vacía del modelo se reporta como «ok», no como cadena vacía', async () => {
      llmFactory.forOrgOrNull.mockResolvedValue(
        proveedor({ ping: jest.fn(async () => '   ') }),
      );
      await expect(service.diagnoseLlm(ORG)).resolves.toMatchObject({
        model_response: 'ok',
      });
    });

    it('un fallo del proveedor conserva provider y model en la respuesta', async () => {
      llmFactory.forOrgOrNull.mockResolvedValue(
        proveedor({
          ping: jest.fn(async () => {
            throw new Error('403 permission denied');
          }),
        }),
      );

      const r = await service.diagnoseLlm(ORG);

      expect(r).toMatchObject({
        success: false,
        error_code: 'AUTH',
        provider: 'GEMINI',
        model: 'gemini-2.5-flash',
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('diagnoseGemini', () => {
    it('camino feliz', async () => {
      await expect(service.diagnoseGemini(ORG)).resolves.toMatchObject({
        success: true,
        status: 'alive',
        model: 'GEMINI',
        model_response: 'gemini-2.5-flash',
      });
    });

    it('sin proveedor → NO_PROVIDER', async () => {
      llmFactory.forOrgOrNull.mockResolvedValue(null);
      await expect(service.diagnoseGemini(ORG)).resolves.toMatchObject({
        error_code: 'NO_PROVIDER',
      });
    });

    it('una respuesta nula se reporta como «ok»', async () => {
      llmFactory.forOrgOrNull.mockResolvedValue(
        proveedor({ ping: jest.fn(async () => null) }),
      );
      await expect(service.diagnoseGemini(ORG)).resolves.toMatchObject({
        model_response: 'ok',
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('clasificación de fallos del LLM', () => {
    const conError = async (error: unknown) => {
      llmFactory.forOrgOrNull.mockResolvedValue(
        proveedor({
          ping: jest.fn(async () => {
            throw error;
          }),
        }),
      );
      return service.diagnoseGemini(ORG);
    };

    it.each([
      ['timeout literal', new Error('request timeout')],
      ['timed out', new Error('the call timed out')],
      ['deadline', new Error('DEADLINE_EXCEEDED')],
      ['ETIMEDOUT', new Error('connect ETIMEDOUT')],
      ['SEMANTIC_MAP_TIMEOUT', new Error('SEMANTIC_MAP_TIMEOUT')],
    ])('%s → TIMEOUT', async (_e, error) => {
      await expect(conError(error)).resolves.toMatchObject({
        error_code: 'TIMEOUT',
      });
    });

    it('un error con name TimeoutError también cuenta, aunque el mensaje no lo diga', async () => {
      const e = new Error('se acabó');
      e.name = 'TimeoutError';
      await expect(conError(e)).resolves.toMatchObject({
        error_code: 'TIMEOUT',
      });
    });

    it.each([
      ['API key', new Error('Invalid API key')],
      ['api_key', new Error('api_key not valid')],
      ['permission', new Error('permission denied')],
      ['401', new Error('Request failed with status 401')],
      ['403', new Error('403 Forbidden')],
      ['unauthenticated', new Error('UNAUTHENTICATED')],
    ])(
      '%s → AUTH, con el mensaje original para poder actuar',
      async (_e, error) => {
        const r = fallo(await conError(error));
        expect(r.error_code).toBe('AUTH');
        expect(r.error_message).toContain(error.message);
      },
    );

    it('cualquier otra cosa → UNKNOWN con el mensaje crudo', async () => {
      await expect(
        conError(new Error('el servidor explotó')),
      ).resolves.toMatchObject({
        error_code: 'UNKNOWN',
        error_message: 'el servidor explotó',
      });
    });

    it('un error en forma de string se maneja igual', async () => {
      await expect(conError('cadena pelada')).resolves.toMatchObject({
        error_code: 'UNKNOWN',
        error_message: 'cadena pelada',
      });
    });

    it('un error con cuerpo de respuesta se serializa entero', async () => {
      await expect(
        conError({ response: { data: { detalle: 'cuota agotada' } } }),
      ).resolves.toMatchObject({
        error_message: '{"detalle":"cuota agotada"}',
      });
    });

    it('un error nulo no rompe la clasificación', async () => {
      await expect(conError(null)).resolves.toMatchObject({
        error_code: 'UNKNOWN',
        error_message: 'Error desconocido.',
      });
    });

    it('el RTT se reporta también cuando falla', async () => {
      const r = fallo(await conError(new Error('x')));
      expect(r.rtt_ms).toBeGreaterThanOrEqual(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('diagnoseMeta', () => {
    const CREDS = {
      organizationId: ORG,
      phoneNumberId: '123456',
      accessToken: 'EAAG-token-valido',
      isActive: true,
    };

    it('camino feliz: devuelve el número verificado que Meta reporta', async () => {
      whatsappCreds.forOrg.mockResolvedValue(CREDS);
      http.get.mockReturnValue(
        of({
          data: {
            id: '123456',
            display_phone_number: '+57 300 000 0000',
            verified_name: 'Clínica Demo',
          },
        }),
      );

      const r = await service.diagnoseMeta(ORG);

      expect(r).toMatchObject({
        success: true,
        status: 'verified',
        phone_id: '123456',
        display_number: '+57 300 000 0000',
        verified_name: 'Clínica Demo',
      });
    });

    it('el token va saneado en la cabecera y NO se envía ningún mensaje (es un GET)', async () => {
      whatsappCreds.forOrg.mockResolvedValue({
        ...CREDS,
        accessToken: '  EAAG-con\n-saltos  ',
      });
      http.get.mockReturnValue(of({ data: {} }));

      await service.diagnoseMeta(ORG);

      const [, opts] = http.get.mock.calls[0];
      expect(opts.headers.Authorization).toBe('Bearer EAAG-con-saltos');
      expect(opts.params).toEqual({
        fields: 'id,display_phone_number,verified_name',
      });
    });

    it('sin canal configurado → NOT_CONFIGURED, sin llamar a Meta', async () => {
      whatsappCreds.forOrg.mockResolvedValue(null);

      await expect(service.diagnoseMeta(ORG)).resolves.toMatchObject({
        error_code: 'NOT_CONFIGURED',
      });
      expect(http.get).not.toHaveBeenCalled();
    });

    it('un token con caracteres imposibles se rechaza ANTES de armar la cabecera', async () => {
      whatsappCreds.forOrg.mockResolvedValue({
        ...CREDS,
        accessToken: 'token-con-ñ-y-control',
      });

      const r = fallo(await service.diagnoseMeta(ORG));

      expect(r.error_code).toBe('INVALID_TOKEN_FORMAT');
      expect(http.get).not.toHaveBeenCalled();
    });

    it('una respuesta sin datos cae a los valores que ya se conocían', async () => {
      whatsappCreds.forOrg.mockResolvedValue(CREDS);
      http.get.mockReturnValue(of({}));

      await expect(service.diagnoseMeta(ORG)).resolves.toMatchObject({
        phone_id: '123456',
        display_number: null,
        verified_name: null,
      });
    });

    describe('clasificación de errores de Meta', () => {
      beforeEach(() => whatsappCreds.forOrg.mockResolvedValue(CREDS));

      const conError = (error: unknown) => {
        http.get.mockReturnValue(throwError(() => error));
        return service.diagnoseMeta(ORG);
      };

      it.each([
        [
          'code 190 (token expirado)',
          { response: { data: { error: { code: 190, message: 'expired' } } } },
        ],
        [
          'code 102',
          { response: { data: { error: { code: 102, message: 'session' } } } },
        ],
        [
          'HTTP 401',
          {
            response: {
              status: 401,
              data: { error: { code: 1, message: 'x' } },
            },
          },
        ],
      ])('%s → AUTH', async (_e, error) => {
        await expect(conError(error)).resolves.toMatchObject({
          error_code: 'AUTH',
        });
      });

      it('cualquier otro error de Meta → BAD_REQUEST con su código', async () => {
        const r = fallo(
          await conError({
            response: {
              status: 400,
              data: { error: { code: 100, message: 'parámetro inválido' } },
            },
          }),
        );
        expect(r.error_code).toBe('BAD_REQUEST');
        expect(r.error_message).toContain('code 100');
      });

      it('prefiere el mensaje pensado para el usuario cuando Meta lo manda', async () => {
        const r = fallo(
          await conError({
            response: {
              status: 400,
              data: {
                error: {
                  code: 100,
                  message: 'técnico',
                  error_user_msg: 'Su plantilla no está aprobada',
                },
              },
            },
          }),
        );
        expect(r.error_message).toContain('Su plantilla no está aprobada');
      });

      it('ECONNABORTED → TIMEOUT', async () => {
        await expect(
          conError({ code: 'ECONNABORTED', message: 'timeout of 8000ms' }),
        ).resolves.toMatchObject({ error_code: 'TIMEOUT' });
      });

      it('un error de red sin cuerpo → UNKNOWN', async () => {
        await expect(
          conError(new Error('getaddrinfo ENOTFOUND graph.facebook.com')),
        ).resolves.toMatchObject({ error_code: 'UNKNOWN' });
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  describe('withTimeout — el diagnóstico no puede colgar la petición HTTP', () => {
    const conTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
      (
        service as unknown as {
          withTimeout: (p: Promise<T>, ms: number, l: string) => Promise<T>;
        }
      ).withTimeout(p, ms, label);

    it('una promesa que nunca resuelve se corta con la etiqueta pedida', async () => {
      await expect(
        conTimeout(new Promise(() => undefined), 5, 'SEMANTIC_MAP_TIMEOUT'),
      ).rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'SEMANTIC_MAP_TIMEOUT',
      });
    });

    it('una promesa que sí responde a tiempo pasa intacta', async () => {
      await expect(conTimeout(Promise.resolve('ok'), 500, 'X')).resolves.toBe(
        'ok',
      );
    });

    it('el temporizador se limpia siempre: no deja el proceso vivo', async () => {
      const spy = jest.spyOn(global, 'clearTimeout');
      await conTimeout(Promise.resolve('ok'), 500, 'X');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('un cuelgue del proveedor termina clasificado como TIMEOUT en el diagnóstico', async () => {
      llmFactory.forOrgOrNull.mockResolvedValue(
        proveedor({
          ping: jest.fn(async () => {
            const e = new Error('SEMANTIC_MAP_TIMEOUT');
            e.name = 'TimeoutError';
            throw e;
          }),
        }),
      );

      await expect(service.diagnoseGemini(ORG)).resolves.toMatchObject({
        error_code: 'TIMEOUT',
      });
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('sanitizeBearerToken', () => {
  it('un token limpio pasa tal cual', () => {
    expect(sanitizeBearerToken('EAAGabc123')).toEqual({
      ok: true,
      token: 'EAAGabc123',
    });
  });

  it.each([
    ['saltos de línea', 'EAAG\nabc\r\n123'],
    ['tabs', 'EAAG\tabc'],
    ['espacios internos', 'EAAG abc 123'],
    ['espacios en los extremos', '   EAAGabc   '],
  ])(
    '%s se limpian: un token de Meta no lleva espacios legítimos',
    (_e, raw) => {
      const r = sanitizeBearerToken(raw);
      expect(r.ok).toBe(true);
      expect((r as { token: string }).token).not.toMatch(/\s/);
    },
  );

  it.each([
    ['vacío', ''],
    ['solo espacios', '   \n\t  '],
  ])('%s se rechaza con un motivo legible', (_e, raw) => {
    const r = sanitizeBearerToken(raw);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('vacío');
  });

  it.each([
    ['tilde', 'tokén'],
    ['carácter de control', 'tokenx'],
    ['emoji', 'token🔑'],
  ])('%s se rechaza: rompería la cabecera HTTP', (_e, raw) => {
    const r = sanitizeBearerToken(raw);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/control|ASCII/);
  });

  it('acepta todo el rango imprimible que una cabecera permite', () => {
    const todos = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) =>
      String.fromCharCode(0x21 + i),
    ).join('');
    expect(sanitizeBearerToken(todos).ok).toBe(true);
  });
});
