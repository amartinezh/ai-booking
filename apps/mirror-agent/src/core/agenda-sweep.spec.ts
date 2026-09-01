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

  it('un fallo a mitad de barrido se propaga, no se traga', async () => {
    // Tragarlo dejaría la agenda medio sincronizada sin que nadie se entere.
    const spy = jest
      .fn()
      .mockResolvedValueOnce(respuesta())
      .mockRejectedValueOnce(new Error('SQL caído'));

    await expect(
      recorrerAgenda(engineQue(spy), { dias: 5 }),
    ).rejects.toThrow('SQL caído');
  });

  it('cero días no llama a nadie', async () => {
    const spy = jest.fn(async () => respuesta());

    const r = await recorrerAgenda(engineQue(spy), { dias: 0 });

    expect(spy).not.toHaveBeenCalled();
    expect(r.dias).toBe(0);
  });
});
