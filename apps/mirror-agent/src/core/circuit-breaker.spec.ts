import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let t: number;
  const crear = (opts = {}) =>
    new CircuitBreaker({
      umbralFallos: 3,
      cooldownMs: 1000,
      ahora: () => t,
      ...opts,
    });

  beforeEach(() => {
    t = 0;
  });

  it('empieza cerrado y deja pasar todo', () => {
    const cb = crear();
    expect(cb.estado).toBe('CERRADO');
    expect(cb.puedeIntentar()).toBe(true);
  });

  it('un fallo suelto no abre nada', () => {
    const cb = crear();
    cb.registrarFallo();
    expect(cb.estado).toBe('CERRADO');
    expect(cb.puedeIntentar()).toBe(true);
  });

  it('se abre al llegar al umbral de fallos seguidos', () => {
    const cb = crear();
    cb.registrarFallo();
    cb.registrarFallo();
    cb.registrarFallo();

    expect(cb.estado).toBe('ABIERTO');
    expect(cb.puedeIntentar()).toBe(false);
  });

  it('un éxito por el medio reinicia la cuenta', () => {
    // Un HIS que va y viene no debe acabar bloqueado: solo los fallos
    // SEGUIDOS cuentan.
    const cb = crear();
    cb.registrarFallo();
    cb.registrarFallo();
    cb.registrarExito();
    cb.registrarFallo();
    cb.registrarFallo();

    expect(cb.estado).toBe('CERRADO');
  });

  it('tras el enfriamiento pasa a semiabierto', () => {
    const cb = crear();
    for (let i = 0; i < 3; i++) cb.registrarFallo();
    expect(cb.estado).toBe('ABIERTO');

    t += 1000;
    expect(cb.estado).toBe('SEMIABIERTO');
  });

  it('en semiabierto deja pasar UNO solo', () => {
    // Si dejara pasar todos, el HIS caído recibiría la cola entera de golpe
    // en cuanto venciera el enfriamiento.
    const cb = crear();
    for (let i = 0; i < 3; i++) cb.registrarFallo();
    t += 1000;

    expect(cb.puedeIntentar()).toBe(true);
    expect(cb.puedeIntentar()).toBe(false);
    expect(cb.puedeIntentar()).toBe(false);
  });

  it('si la prueba sale bien, se cierra y todo vuelve a pasar', () => {
    const cb = crear();
    for (let i = 0; i < 3; i++) cb.registrarFallo();
    t += 1000;

    cb.puedeIntentar();
    cb.registrarExito();

    expect(cb.estado).toBe('CERRADO');
    expect(cb.puedeIntentar()).toBe(true);
  });

  it('si la prueba falla, se vuelve a abrir el enfriamiento completo', () => {
    const cb = crear();
    for (let i = 0; i < 3; i++) cb.registrarFallo();
    t += 1000;

    cb.puedeIntentar();
    cb.registrarFallo();

    expect(cb.estado).toBe('ABIERTO');
    t += 999;
    expect(cb.estado).toBe('ABIERTO');
    t += 1;
    expect(cb.estado).toBe('SEMIABIERTO');
  });

  it('el resumen sirve para el heartbeat y los logs', () => {
    const cb = crear();
    cb.registrarFallo();
    cb.registrarFallo();

    expect(cb.resumen()).toEqual({ estado: 'CERRADO', fallosSeguidos: 2 });
  });

  it('con los valores por defecto aguanta cuatro fallos antes de abrir', () => {
    const cb = new CircuitBreaker({ ahora: () => t });
    for (let i = 0; i < 4; i++) cb.registrarFallo();
    expect(cb.estado).toBe('CERRADO');
    cb.registrarFallo();
    expect(cb.estado).toBe('ABIERTO');
  });
});
