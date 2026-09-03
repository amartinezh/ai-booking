import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { SystemLogService } from './system-log.service';

/**
 * El último filtro antes de que un error llegue al cliente. Tres cosas que
 * este archivo promete y que hay que sostener:
 *
 *  1. NUNCA lanza. Si el filtro revienta, la petición muere sin respuesta.
 *  2. Solo persiste 5xx. Persistir 4xx convierte la tabla en un vertedero y
 *     en un vector de agotamiento (cualquier escáner genera una fila por hit).
 *  3. Sanea el body antes de guardarlo: nada de contraseñas ni tokens en
 *     `SystemLog`.
 */
describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let logs: { error: jest.Mock };
  let json: jest.Mock;
  let status: jest.Mock;

  const UMBRAL_ORIGINAL = process.env.SYSTEMLOG_PERSIST_MIN_STATUS;

  const host = (request: Record<string, unknown> = {}): ArgumentsHost => {
    json = jest.fn();
    status = jest.fn(() => ({ json }));
    return {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          method: 'POST',
          originalUrl: '/chatbot/webhook',
          headers: {},
          query: {},
          ...request,
        }),
      }),
    } as unknown as ArgumentsHost;
  };

  const persistido = () => logs.error.mock.calls[0][0];

  beforeEach(() => {
    delete process.env.SYSTEMLOG_PERSIST_MIN_STATUS;
    logs = { error: jest.fn().mockResolvedValue(undefined) };
    filter = new GlobalExceptionFilter(logs as unknown as SystemLogService);
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'verbose').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (UMBRAL_ORIGINAL === undefined)
      delete process.env.SYSTEMLOG_PERSIST_MIN_STATUS;
    else process.env.SYSTEMLOG_PERSIST_MIN_STATUS = UMBRAL_ORIGINAL;
  });

  describe('respuesta al cliente', () => {
    it('un HttpException conserva su código y su mensaje', () => {
      filter.catch(new BadRequestException('falta el campo X'), host());

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          path: '/chatbot/webhook',
        }),
      );
    });

    it('un Error cualquiera se convierte en 500 con su mensaje', () => {
      filter.catch(new Error('la BD se cayó'), host());

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 500, message: 'la BD se cayó' }),
      );
    });

    it('algo que ni siquiera es un Error se serializa sin reventar', () => {
      filter.catch({ raro: true }, host());

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ message: '{"raro":true}' }),
      );
    });

    it('un objeto con ciclos tampoco lo tumba', () => {
      const ciclo: Record<string, unknown> = {};
      ciclo.yo = ciclo;
      expect(() => filter.catch(ciclo, host())).not.toThrow();
      expect(status).toHaveBeenCalledWith(500);
    });

    it('un Error sin mensaje cae al texto genérico', () => {
      filter.catch(new Error(''), host());
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Internal server error' }),
      );
    });

    it('un HttpException con cuerpo de objeto lo devuelve tal cual', () => {
      filter.catch(
        new HttpException({ message: ['a', 'b'], error: 'x' }, 422),
        host(),
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 422,
          message: { message: ['a', 'b'], error: 'x' },
        }),
      );
    });

    it('sin objeto response utilizable no intenta responder (ni lanza)', () => {
      const h = {
        switchToHttp: () => ({
          getResponse: () => undefined,
          getRequest: () => ({ method: 'GET', url: '/x', headers: {} }),
        }),
      } as unknown as ArgumentsHost;
      expect(() => filter.catch(new Error('x'), h)).not.toThrow();
    });
  });

  describe('qué se persiste', () => {
    it('un 500 sí se guarda', () => {
      filter.catch(new Error('boom'), host());
      expect(logs.error).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['400', new BadRequestException('x')],
      ['403', new ForbiddenException('firma inválida')],
      ['404', new NotFoundException('no existe')],
    ])('un %s NO se guarda: es del cliente, no una avería', (_e, exc) => {
      filter.catch(exc, host());
      expect(logs.error).not.toHaveBeenCalled();
    });

    it('el umbral se puede bajar por env para depurar', () => {
      process.env.SYSTEMLOG_PERSIST_MIN_STATUS = '400';
      filter.catch(new BadRequestException('x'), host());
      expect(logs.error).toHaveBeenCalledTimes(1);
    });

    it('un umbral basura cae al valor por defecto (500)', () => {
      process.env.SYSTEMLOG_PERSIST_MIN_STATUS = 'no-es-un-numero';
      filter.catch(new BadRequestException('x'), host());
      expect(logs.error).not.toHaveBeenCalled();

      filter.catch(new Error('boom'), host());
      expect(logs.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('antirrepetición', () => {
    it('el mismo fallo en bucle se guarda UNA vez por ventana', () => {
      for (let i = 0; i < 25; i++) filter.catch(new Error('BD caída'), host());
      expect(logs.error).toHaveBeenCalledTimes(1);
    });

    it('fallos distintos en la misma ruta sí se guardan por separado', () => {
      filter.catch(new Error('BD caída'), host());
      filter.catch(new Error('Redis caído'), host());
      expect(logs.error).toHaveBeenCalledTimes(2);
    });

    it('el mismo mensaje en otra ruta también se guarda', () => {
      filter.catch(new Error('BD caída'), host({ originalUrl: '/a' }));
      filter.catch(new Error('BD caída'), host({ originalUrl: '/b' }));
      expect(logs.error).toHaveBeenCalledTimes(2);
    });

    it('el query string no crea firmas distintas: /a?x=1 y /a?x=2 son la misma ruta', () => {
      filter.catch(new Error('BD caída'), host({ originalUrl: '/a?x=1' }));
      filter.catch(new Error('BD caída'), host({ originalUrl: '/a?x=2' }));
      expect(logs.error).toHaveBeenCalledTimes(1);
    });

    it('el mapa de firmas no crece sin límite', () => {
      for (let i = 0; i < 700; i++) {
        filter.catch(new Error(`fallo ${i}`), host({ originalUrl: `/r/${i}` }));
      }
      expect(filter['lastPersisted'].size).toBeLessThanOrEqual(500);
    });
  });

  describe('metadata para soporte', () => {
    it('recoge método, ruta, query, params, IP y user-agent', () => {
      filter.catch(
        new Error('boom'),
        host({
          method: 'PUT',
          originalUrl: '/mirror/ack?x=1',
          query: { x: '1' },
          params: { id: '7' },
          headers: { 'user-agent': 'agente/1.0', 'x-forwarded-for': '9.9.9.9' },
        }),
      );

      expect(persistido().metadata).toMatchObject({
        method: 'PUT',
        path: '/mirror/ack?x=1',
        query: { x: '1' },
        params: { id: '7' },
        ip: '9.9.9.9',
        userAgent: 'agente/1.0',
        statusCode: 500,
        exception: 'Error',
      });
    });

    it('sin x-forwarded-for cae a request.ip y luego al socket', () => {
      filter.catch(new Error('boom'), host({ ip: '1.1.1.1' }));
      expect(persistido().metadata.ip).toBe('1.1.1.1');

      logs.error.mockClear();
      filter.catch(
        new Error('otro'),
        host({ socket: { remoteAddress: '2.2.2.2' } }),
      );
      expect(persistido().metadata.ip).toBe('2.2.2.2');
    });

    it('el stack se recorta a 50 líneas', () => {
      const e = new Error('boom');
      e.stack = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
      filter.catch(e, host());
      expect(persistido().metadata.stack.split('\n')).toHaveLength(50);
    });

    it('la acción lleva estado, método y ruta, con tope de largo', () => {
      filter.catch(new Error('boom'), host());
      expect(persistido().action).toBe('HTTP_500_POST_/chatbot/webhook');

      logs.error.mockClear();
      filter.catch(
        new Error('otro'),
        host({ originalUrl: `/${'x'.repeat(200)}` }),
      );
      // 'HTTP_500_POST_' + 60 caracteres de ruta recortada.
      expect(persistido().action.length).toBeLessThanOrEqual(74);
      expect(persistido().action).toContain('...');
    });

    it('el mensaje se recorta a 2000 caracteres', () => {
      filter.catch(new Error('z'.repeat(5000)), host());
      expect(persistido().message).toHaveLength(2000);
    });

    it('usuario y organización salen de la request cuando el guard ya los puso', () => {
      filter.catch(
        new Error('boom'),
        host({ user: { id: 'u-1', organizationId: 'org-1' } }),
      );
      expect(persistido().userId).toBe('u-1');
      expect(persistido().organizationId).toBe('org-1');
    });

    it('sin usuario autenticado quedan en null', () => {
      filter.catch(new Error('boom'), host());
      expect(persistido().userId).toBeNull();
      expect(persistido().organizationId).toBeNull();
    });

    it('la organización también puede venir por cabecera', () => {
      filter.catch(
        new Error('boom'),
        host({ headers: { 'x-organization-id': 'org-hdr' } }),
      );
      expect(persistido().organizationId).toBe('org-hdr');
    });
  });

  describe('🔒 saneado del body', () => {
    it('las claves sensibles se reemplazan por [REDACTED]', () => {
      filter.catch(
        new Error('boom'),
        host({
          body: {
            password: 'p4ss',
            accessToken: 'ya29...',
            API_KEY: 'sk-live',
            Authorization: 'Bearer x',
            appSecret: 's3cr3t',
            cedula: '123456',
          },
        }),
      );

      expect(persistido().metadata.body).toEqual({
        password: '[REDACTED]',
        accessToken: '[REDACTED]',
        API_KEY: '[REDACTED]',
        Authorization: '[REDACTED]',
        appSecret: '[REDACTED]',
        cedula: '123456',
      });
    });

    it('un body enorme se trunca en vez de volcarse entero', () => {
      filter.catch(
        new Error('boom'),
        host({ body: { blob: 'x'.repeat(20000) } }),
      );
      const body = persistido().metadata.body;
      expect(body._truncated).toBe(true);
      expect(body.preview).toHaveLength(6000);
    });

    it.each([
      ['sin body', undefined, null],
      ['body de texto', 'hola', 'hola'],
    ])('%s no rompe nada', (_e, entrada, esperado) => {
      filter.catch(new Error('boom'), host({ body: entrada }));
      expect(persistido().metadata.body).toEqual(esperado);
    });

    it('un body con ciclos se marca como no serializable en vez de lanzar', () => {
      const body: Record<string, unknown> = { a: 1 };
      body.yo = body;
      filter.catch(new Error('boom'), host({ body }));
      expect(persistido().metadata.body).toEqual({ _unserializable: true });
    });

    it('un arreglo se conserva como arreglo', () => {
      filter.catch(new Error('boom'), host({ body: [{ a: 1 }] }));
      expect(Array.isArray(persistido().metadata.body)).toBe(true);
    });
  });

  it('si la escritura del log falla, el cliente igual recibe su respuesta y el proceso sigue vivo', async () => {
    // Sin el `.catch` interno esto sería una unhandled rejection, y Node 15+
    // mata el proceso por eso: la API entera se cae por un log que no entró.
    logs.error.mockRejectedValue(new Error('SystemLog caído'));

    expect(() => filter.catch(new Error('boom'), host())).not.toThrow();
    expect(status).toHaveBeenCalledWith(500);

    await new Promise((r) => setImmediate(r));
    expect(filter['logger'].warn).toHaveBeenCalledWith(
      expect.stringContaining('SystemLog caído'),
    );
  });

  it('la escritura NO se espera: la respuesta sale sin depender de la BD', () => {
    let resolver!: () => void;
    logs.error.mockReturnValue(
      new Promise<void>((res) => {
        resolver = res;
      }),
    );

    filter.catch(new Error('boom'), host());

    // La respuesta ya salió aunque el log siga colgado.
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalled();
    resolver();
  });
});
