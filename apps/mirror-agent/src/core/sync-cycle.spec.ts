import { runSyncCycle, runOutbound, runInbound } from './sync-cycle';
import { FailureReporter } from './failure-reporter';

describe('runSyncCycle', () => {
  let lines: string[];
  let reporter: FailureReporter;

  const engineDoble = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      pullAndApplyOutboxEvents: jest.fn().mockResolvedValue({
        applied: 0,
        skippedIdempotent: 0,
        failed: 0,
        failures: [],
      }),
      detectAndPushChanges: jest.fn().mockResolvedValue({ pushed: 0 }),
      ...over,
    }) as any;

  beforeEach(() => {
    lines = [];
    reporter = new FailureReporter((l) => lines.push(l));
  });

  it('un ciclo limpio corre las dos direcciones y no reporta nada', async () => {
    const engine = engineDoble();

    const r = await runSyncCycle(engine, reporter);

    expect(engine.pullAndApplyOutboxEvents).toHaveBeenCalledTimes(1);
    expect(engine.detectAndPushChanges).toHaveBeenCalledTimes(1);
    expect(r.hadErrors).toBe(false);
    expect(lines).toEqual([]);
  });

  // ⭐ La propiedad central de C2. Antes las dos direcciones compartian un
  // unico try y la lectura iba despues de la escritura: si la escritura
  // lanzaba, la lectura NO se ejecutaba jamas.
  it('si la escritura al HIS LANZA, la lectura desde el HIS igual se ejecuta', async () => {
    const engine = engineDoble({
      pullAndApplyOutboxEvents: jest
        .fn()
        .mockRejectedValue(new Error('el HIS rechazo la conexion')),
    });

    const r = await runSyncCycle(engine, reporter);

    expect(engine.detectAndPushChanges).toHaveBeenCalledTimes(1);
    expect(r.hadErrors).toBe(true);
    expect(lines[0]).toContain('AgenIA->HIS: el HIS rechazo la conexion');
  });

  it('si la lectura desde el HIS lanza, no se pierde lo ya aplicado en la escritura', async () => {
    const engine = engineDoble({
      pullAndApplyOutboxEvents: jest.fn().mockResolvedValue({
        applied: 3,
        skippedIdempotent: 0,
        failed: 0,
        failures: [],
      }),
      detectAndPushChanges: jest
        .fn()
        .mockRejectedValue(new Error('detectChanges: pendiente de Fase 4')),
    });

    const r = await runSyncCycle(engine, reporter);

    expect(r.applied).toBe(3);
    expect(r.hadErrors).toBe(true);
    expect(lines[0]).toContain('HIS->AgenIA: detectChanges');
  });

  it('las dos direcciones fallando reportan las dos, cada una con su etapa', async () => {
    const engine = engineDoble({
      pullAndApplyOutboxEvents: jest.fn().mockRejectedValue(new Error('sube')),
      detectAndPushChanges: jest.fn().mockRejectedValue(new Error('baja')),
    });

    await runSyncCycle(engine, reporter);

    expect(lines).toEqual([
      '[mirror-agent] AgenIA->HIS: sube',
      '[mirror-agent] HIS->AgenIA: baja',
    ]);
  });

  it('los eventos fallidos se reportan uno por uno, distinguiendo lanzo de rechazado', async () => {
    const engine = engineDoble({
      pullAndApplyOutboxEvents: jest.fn().mockResolvedValue({
        applied: 0,
        skippedIdempotent: 0,
        failed: 2,
        failures: [
          { seq: '1', eventId: 'e1', message: 'SLOT no soportado' },
          { seq: '2', eventId: 'e2', message: 'pendiente Fase 3', threw: true },
        ],
      }),
    });

    const r = await runSyncCycle(engine, reporter);

    expect(r.failed).toBe(2);
    expect(lines[0]).toContain('evento e1 (seq 1) rechazado: SLOT no soportado');
    expect(lines[1]).toContain('evento e2 (seq 2) lanzo: pendiente Fase 3');
  });

  it('un ciclo limpio reinicia la amortiguacion: el mismo fallo vuelve a verse', async () => {
    const fallando = engineDoble({
      pullAndApplyOutboxEvents: jest.fn().mockRejectedValue(new Error('X')),
    });

    await runSyncCycle(fallando, reporter); // se reporta
    await runSyncCycle(fallando, reporter); // repetido: callado
    expect(lines).toHaveLength(1);

    await runSyncCycle(engineDoble(), reporter); // ciclo limpio -> reset
    await runSyncCycle(fallando, reporter); // vuelve a fallar: se reporta
    expect(lines).toHaveLength(2);
  });

  // 🐛 El long-poll de la salida (hasta 25 s) bloqueaba la entrada cuando las
  // dos iban encadenadas: una cita agendada en el hospital tardaba una vuelta
  // larga en llegar, y mientras tanto ese cupo se seguía ofreciendo por
  // WhatsApp. Se detectó probando el ciclo completo contra el mock.
  it('las dos direcciones arrancan en PARALELO, no una tras otra', async () => {
    const orden: string[] = [];
    const engine = engineDoble({
      pullAndApplyOutboxEvents: jest.fn(async () => {
        orden.push('salida:inicio');
        await new Promise((r) => setTimeout(r, 30)); // simula el long-poll
        orden.push('salida:fin');
        return { applied: 0, skippedIdempotent: 0, failed: 0, failures: [] };
      }),
      detectAndPushChanges: jest.fn(async () => {
        orden.push('entrada:inicio');
        return { pushed: 2 };
      }),
    });

    const r = await runSyncCycle(engine, reporter);

    // La entrada arranca ANTES de que la salida termine de esperar.
    expect(orden.indexOf('entrada:inicio')).toBeLessThan(
      orden.indexOf('salida:fin'),
    );
    expect(r.pushed).toBe(2);
  });

  it('si la salida se cuelga y falla, la entrada igual entrega su resultado', async () => {
    const engine = engineDoble({
      pullAndApplyOutboxEvents: jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 20));
        throw new Error('long-poll cortado');
      }),
      detectAndPushChanges: jest.fn().mockResolvedValue({ pushed: 5 }),
    });

    const r = await runSyncCycle(engine, reporter);

    expect(r.pushed).toBe(5);
    expect(r.hadErrors).toBe(true);
  });

  it('runOutbound reporta el fallo y devuelve hadErrors', async () => {
    const engine = engineDoble({
      pullAndApplyOutboxEvents: jest.fn().mockRejectedValue(new Error('boom')),
    });

    const r = await runOutbound(engine, reporter);

    expect(r).toEqual({ applied: 0, failed: 0, hadErrors: true });
    expect(lines[0]).toContain('AgenIA->HIS: boom');
  });

  it('runOutbound reporta los eventos rechazados uno por uno', async () => {
    const engine = engineDoble({
      pullAndApplyOutboxEvents: jest.fn().mockResolvedValue({
        applied: 1,
        skippedIdempotent: 0,
        failed: 1,
        failures: [{ seq: '9', eventId: 'e9', message: 'lo rechazó el HIS' }],
      }),
    });

    const r = await runOutbound(engine, reporter);

    expect(r.applied).toBe(1);
    expect(r.hadErrors).toBe(true);
    expect(lines[0]).toContain('evento e9 (seq 9) rechazado: lo rechazó el HIS');
  });

  it('runInbound aísla su fallo y no contamina la otra dirección', async () => {
    const engine = engineDoble({
      detectAndPushChanges: jest.fn().mockRejectedValue(new Error('HIS caído')),
    });

    const r = await runInbound(engine, reporter);

    expect(r).toEqual({ pushed: 0, hadErrors: true });
    expect(lines[0]).toContain('HIS->AgenIA: HIS caído');
  });

  it('runInbound devuelve cuántos cambios subió', async () => {
    const engine = engineDoble({
      detectAndPushChanges: jest.fn().mockResolvedValue({ pushed: 7 }),
    });

    expect(await runInbound(engine, reporter)).toEqual({
      pushed: 7,
      hadErrors: false,
    });
  });
});
