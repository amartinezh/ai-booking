import { Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * 🚨 Alertas técnicas (docs/PLAN_ALERTAS_TECNICAS.md, Fase 2): sin Redis el bot
 * pierde las sesiones. ioredis emite `error` en CADA reintento: el grupo técnico
 * recibe UN aviso por caída, y se resuelve al volver.
 *
 * Se prueba con un cliente real contra un puerto cerrado (127.0.0.1:1): los
 * errores son de verdad, no simulados.
 */
describe('RedisService — alertas técnicas', () => {
  const ORIGINAL = process.env.REDIS_URL;
  let redis: RedisService | null = null;

  const esperar = async (cond: () => boolean, ms = 3000) => {
    const hasta = Date.now() + ms;
    while (!cond() && Date.now() < hasta) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(cond()).toBe(true);
  };

  beforeEach(() => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    redis?.disconnect();
    redis = null;
    process.env.REDIS_URL = ORIGINAL;
    jest.restoreAllMocks();
  });

  it('muchos errores de conexión → UN aviso; al volver se resuelve; otra caída → otro aviso', async () => {
    const alertas = {
      avisar: jest.fn(async () => undefined),
      resolver: jest.fn(async () => undefined),
    };
    redis = new RedisService(alertas as never);
    const errores = jest.fn();
    redis.on('error', errores);

    await esperar(() => errores.mock.calls.length >= 3);
    expect(alertas.avisar).toHaveBeenCalledTimes(1);
    expect(alertas.avisar).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'REDIS_ERROR',
        dedupeKey: 'servicio:redis',
        detail: expect.stringContaining('Sin Redis el bot pierde las sesiones'),
      }),
    );

    redis.emit('ready');
    expect(alertas.resolver).toHaveBeenCalledWith('servicio:redis');

    await esperar(() => alertas.avisar.mock.calls.length === 2);
  });

  it('el primer «ready» tras arrancar resuelve lo que otro proceso dejó abierto; los siguientes, no', () => {
    const alertas = { avisar: jest.fn(), resolver: jest.fn() };
    redis = new RedisService(alertas as never);
    redis.removeAllListeners('error'); // sin reintentos que interfieran
    redis.on('error', () => undefined);
    redis.emit('ready');
    redis.emit('ready');
    expect(alertas.resolver).toHaveBeenCalledTimes(1);
  });

  it('sin el servicio de alertas (tests, arranque temprano) no revienta', async () => {
    redis = new RedisService();
    const errores = jest.fn();
    redis.on('error', errores);
    await esperar(() => errores.mock.calls.length >= 1);
  });
});
