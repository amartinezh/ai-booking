import { Logger } from '@nestjs/common';
import { SupportBotWatchService } from './support-bot-watch.service';
import type { RedisService } from '../redis/redis.service';
import type { TechAlertService } from '../tech-alerts/tech-alert.service';

/** Redis en memoria con lo que usa la vigilancia. */
class RedisFalso {
  datos = new Map<string, string>();
  hashes = new Map<string, Map<string, number>>();
  ttls = new Map<string, number>();
  caido = false;
  private revisar() {
    if (this.caido) throw new Error('Redis caído');
  }
  async hincrby(k: string, campo: string, n: number) {
    this.revisar();
    const h = this.hashes.get(k) ?? new Map<string, number>();
    h.set(campo, (h.get(campo) ?? 0) + n);
    this.hashes.set(k, h);
    return h.get(campo) as number;
  }
  async incr(k: string) {
    this.revisar();
    const n = Number(this.datos.get(k) ?? 0) + 1;
    this.datos.set(k, String(n));
    return n;
  }
  async expire(k: string, seg: number) {
    this.ttls.set(k, seg);
    return 1;
  }
  async set(k: string, v: string, ..._resto: unknown[]) {
    this.revisar();
    if (this.datos.has(k)) return null;
    this.datos.set(k, v);
    return 'OK';
  }
  async del(k: string) {
    this.revisar();
    return this.datos.delete(k) ? 1 : 0;
  }
}

/**
 * La vigilancia del asistente (docs/PLAN_BOT_SOPORTE.md, Fase 5): cuenta lo que no
 * queda en la base y abre sus alertas técnicas, sin ruido y sin lanzar nunca.
 */
describe('SupportBotWatchService', () => {
  const CLINICA = { id: 'org-1', nombre: 'Hospital de Prueba' };
  // Lunes 19 de octubre de 2026, 10:00 en Colombia.
  const AHORA = new Date('2026-10-19T15:00:00Z');
  let redis: RedisFalso;
  let alertas: { avisar: jest.Mock; resolver: jest.Mock };
  let svc: SupportBotWatchService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    redis = new RedisFalso();
    alertas = {
      avisar: jest.fn(async () => undefined),
      resolver: jest.fn(async () => undefined),
    };
    svc = new SupportBotWatchService(
      redis as unknown as RedisService,
      alertas as unknown as TechAlertService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('cuenta por día de Colombia, en un hash que vive 40 días', async () => {
    await svc.contar('codigos', AHORA);
    await svc.contar('codigos', AHORA);
    await svc.contar('sinCodigo', AHORA);
    // 23:30 del lunes en Colombia ya es martes en UTC: sigue siendo el lunes.
    await svc.contar('codigos', new Date('2026-10-20T04:30:00Z'));
    const h = redis.hashes.get('soporte:cifras:2026-10-19');
    expect(Object.fromEntries(h ?? [])).toEqual({ codigos: 3, sinCodigo: 1 });
    expect(redis.ttls.get('soporte:cifras:2026-10-19')).toBe(40 * 86_400);
  });

  describe('códigos equivocados', () => {
    it('se cuentan en el día y, a los 20 en 10 minutos, una alerta (una sola)', async () => {
      for (let i = 0; i < 19; i++) await svc.codigoFallido(AHORA);
      expect(alertas.avisar).not.toHaveBeenCalled();
      await svc.codigoFallido(AHORA);
      await svc.codigoFallido(AHORA);
      expect(alertas.avisar).toHaveBeenCalledTimes(1);
      expect(alertas.avisar).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'SOPORTE_CODIGOS_FALLIDOS',
          dedupeKey: expect.stringMatching(/^soporte:codigos-fallidos:\d+$/),
          detail: expect.stringContaining('20 códigos equivocados'),
        }),
      );
      expect(
        redis.hashes.get('soporte:cifras:2026-10-19')?.get('fallidos'),
      ).toBe(21);
    });

    it('en otra ventana de 10 minutos, la cuenta empieza de nuevo', async () => {
      for (let i = 0; i < 15; i++) await svc.codigoFallido(AHORA);
      const despues = new Date(AHORA.getTime() + 10 * 60_000);
      for (let i = 0; i < 15; i++) await svc.codigoFallido(despues);
      expect(alertas.avisar).not.toHaveBeenCalled();
    });
  });

  describe('sin la IA de la clínica', () => {
    it('al tercer fallo en 15 minutos, una alerta de la clínica; los siguientes no repiten', async () => {
      await svc.iaFallo(CLINICA, 'la IA falló o tardó');
      await svc.iaFallo(CLINICA, 'la IA falló o tardó');
      expect(alertas.avisar).not.toHaveBeenCalled();
      await svc.iaFallo(CLINICA, 'la IA falló o tardó');
      await svc.iaFallo(CLINICA, 'la IA falló o tardó');
      expect(alertas.avisar).toHaveBeenCalledTimes(1);
      expect(alertas.avisar).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'SOPORTE_SIN_IA',
          dedupeKey: 'soporte:sin-ia:org-1',
          organizationId: 'org-1',
          organizationName: 'Hospital de Prueba',
          detail: expect.stringContaining('(la IA falló o tardó)'),
        }),
      );
      expect(redis.ttls.get('soporte:fallos-ia:org-1')).toBe(15 * 60);
    });

    it('la primera respuesta con IA la resuelve (y solo si estaba abierta)', async () => {
      await svc.iaRespondio('org-1');
      expect(alertas.resolver).not.toHaveBeenCalled();
      for (let i = 0; i < 3; i++) await svc.iaFallo(CLINICA, 'x');
      await svc.iaRespondio('org-1');
      expect(alertas.resolver).toHaveBeenCalledWith('soporte:sin-ia:org-1');
      // Y si vuelve a fallar, avisa de nuevo.
      for (let i = 0; i < 3; i++) await svc.iaFallo(CLINICA, 'x');
      expect(alertas.avisar).toHaveBeenCalledTimes(2);
    });
  });

  it('el tope diario: un aviso por clínica y día', async () => {
    await svc.topeAlcanzado(CLINICA, 300, AHORA);
    expect(alertas.avisar).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'SOPORTE_TOPE_IA',
        dedupeKey: 'soporte:tope-ia:org-1:2026-10-19',
        detail: expect.stringContaining('300 respuestas con IA hoy'),
      }),
    );
  });

  it('sin Redis no cuenta ni alerta, y nunca lanza', async () => {
    redis.caido = true;
    await expect(svc.contar('codigos', AHORA)).resolves.toBeUndefined();
    await expect(svc.codigoFallido(AHORA)).resolves.toBeUndefined();
    await expect(svc.iaFallo(CLINICA, 'x')).resolves.toBeUndefined();
    await expect(svc.iaRespondio('org-1')).resolves.toBeUndefined();
    expect(alertas.avisar).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('sin el módulo de alertas, solo cuenta', async () => {
    const solo = new SupportBotWatchService(redis as unknown as RedisService);
    for (let i = 0; i < 3; i++) await solo.iaFallo(CLINICA, 'x');
    await solo.topeAlcanzado(CLINICA, 1, AHORA);
    expect(alertas.avisar).not.toHaveBeenCalled();
  });
});
