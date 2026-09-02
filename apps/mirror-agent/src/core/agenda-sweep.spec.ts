import { recorrerAgenda } from './agenda-sweep';

describe('recorrerAgenda', () => {
  const respuesta = (over: Record<string, unknown> = {}) => ({
    mode: 'ON' as const,
    created: 0,
    updated: 0,
    removed: 0,
    skipped: [],
    conflicts: [],
    ...over,
  });

  const engineQue = (impl: jest.Mock) => ({ syncAvailability: impl });

  /** Las ventanas con las que se llamó, ya tipadas. */
  const ventanasDe = (spy: jest.Mock): { from: Date; to: Date }[] =>
    spy.mock.calls.map((c: unknown[]) => c[0] as { from: Date; to: Date });

  it('sube un día por petición', async () => {
    // El servidor BORRA, dentro de la ventana que se le declara, todo lo que
    // no venga en el envío: la ventana tiene que ser exactamente la que se
    // está subiendo.
    const spy = jest.fn(async () => respuesta());

    await recorrerAgenda(engineQue(spy), {
      dias: 3,
      desde: new Date('2026-09-03T12:00:00.000Z'),
    });

    expect(spy).toHaveBeenCalledTimes(3);
    const [primera] = ventanasDe(spy);
    expect(primera.to.getTime() - primera.from.getTime()).toBe(86_400_000);
  });

  it('los días son consecutivos y no se solapan', async () => {
    const spy = jest.fn(async () => respuesta());

    await recorrerAgenda(engineQue(spy), {
      dias: 3,
      desde: new Date('2026-09-03T12:00:00.000Z'),
    });

    const ventanas = ventanasDe(spy);
    expect(ventanas[1].from).toEqual(ventanas[0].to);
    expect(ventanas[2].from).toEqual(ventanas[1].to);
  });

  it('cada día arranca a medianoche local, que es el día que ve el hospital', async () => {
    const spy = jest.fn(async () => respuesta());

    await recorrerAgenda(engineQue(spy), {
      dias: 1,
      desde: new Date('2026-09-03T18:45:00.000Z'),
    });

    const [{ from }] = ventanasDe(spy);
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(from.getSeconds()).toBe(0);
  });

  it('suma los totales de todos los días', async () => {
    const spy = jest
      .fn()
      .mockResolvedValueOnce(respuesta({ created: 15, removed: 2 }))
      .mockResolvedValueOnce(respuesta({ created: 12, conflicts: ['x'] }));

    const r = await recorrerAgenda(engineQue(spy), { dias: 2 });

    expect(r).toMatchObject({
      modo: 'ON',
      creados: 27,
      borrados: 2,
      conflictos: 1,
      dias: 2,
    });
  });

  it('OFF corta el barrido en el primer día', async () => {
    // Preguntar 400 veces lo mismo solo carga al HIS y a la API para nada.
    const spy = jest.fn(async () => respuesta({ mode: 'OFF' }));

    const r = await recorrerAgenda(engineQue(spy), { dias: 400 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.modo).toBe('OFF');
    expect(r.dias).toBe(0);
  });

  it('en modo sombra recorre igual: reportar es el objetivo', async () => {
    const spy = jest.fn(async () => respuesta({ mode: 'SHADOW', created: 5 }));

    const r = await recorrerAgenda(engineQue(spy), { dias: 3 });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(r.modo).toBe('SHADOW');
    expect(r.creados).toBe(15);
  });

  it('un fallo a mitad de barrido NO se traga: se cuenta y se reporta', async () => {
    // Este test afirmaba lo contrario —que el error debía propagarse— y esa
    // era justo la causa del defecto: propagarlo abortaba los días restantes.
    // Lo que hacía falta no era parar, sino no callar.
    const spy = jest
      .fn()
      .mockResolvedValueOnce(respuesta())
      .mockRejectedValue(new Error('SQL caído'));

    const r = await recorrerAgenda(engineQue(spy), { dias: 5 });

    expect(r.dias).toBe(1); // el primero sí corrió
    expect(r.diasConError).toBe(4);
    expect(r.primerError).toBe('SQL caído');
  });

  it('cero días no llama a nadie', async () => {
    const spy = jest.fn(async () => respuesta());

    const r = await recorrerAgenda(engineQue(spy), { dias: 0 });

    expect(spy).not.toHaveBeenCalled();
    expect(r.dias).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🚨 Un fallo en UN día no puede tumbar el barrido entero. Pasó de verdad: un
// cupo que no se podía borrar rompía el día 3, el error subía, y los otros 397
// días no se sincronizaban nunca. La agenda quedó media hora desalineada y lo
// único visible era una línea de error por vuelta, sin decir que el resto no
// había corrido. Misma regla que en sync-cycle.
// ══════════════════════════════════════════════════════════════════════════
describe('recorrerAgenda — un día malo no tumba el resto', () => {
  const ok = {
    mode: 'ON' as const,
    created: 1,
    updated: 0,
    removed: 0,
    retired: 0,
    skipped: [],
    conflicts: [],
  };

  it('sigue con los días siguientes cuando uno falla', () => {
    const spy = jest
      .fn()
      .mockResolvedValueOnce(ok)
      .mockRejectedValueOnce(new Error('Foreign key constraint violated'))
      .mockResolvedValueOnce(ok);

    return recorrerAgenda({ syncAvailability: spy }, { dias: 3 }).then((r) => {
      expect(spy).toHaveBeenCalledTimes(3);
      expect(r.dias).toBe(2); // los dos que sí corrieron
      expect(r.creados).toBe(2);
    });
  });

  it('cuenta los días que fallaron: seguir no es lo mismo que estar bien', async () => {
    const spy = jest.fn().mockRejectedValue(new Error('HIS caído'));

    const r = await recorrerAgenda({ syncAvailability: spy }, { dias: 5 });

    expect(r.diasConError).toBe(5);
    expect(r.dias).toBe(0);
  });

  it('guarda el primer motivo, no los 400', async () => {
    const spy = jest
      .fn()
      .mockRejectedValueOnce(new Error('el primero'))
      .mockRejectedValueOnce(new Error('el segundo'));

    const r = await recorrerAgenda({ syncAvailability: spy }, { dias: 2 });

    expect(r.primerError).toBe('el primero');
  });

  it('sin fallos, no reporta ninguno', async () => {
    const spy = jest.fn(async () => ok);

    const r = await recorrerAgenda({ syncAvailability: spy }, { dias: 3 });

    expect(r.diasConError).toBe(0);
    expect(r.primerError).toBeUndefined();
  });
});
