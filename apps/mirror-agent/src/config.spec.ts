import { loadConfig } from './config';

describe('loadConfig', () => {
  const minimo = {
    MIRROR_API_URL: 'https://api.example.com',
    MIRROR_AGENT_TOKEN: 'mirror_org_secreto',
  } as NodeJS.ProcessEnv;

  it('sin URL de la API no arranca', () => {
    expect(() => loadConfig({ MIRROR_AGENT_TOKEN: 'x' })).toThrow(
      /MIRROR_API_URL/,
    );
  });

  it('sin token no arranca', () => {
    expect(() => loadConfig({ MIRROR_API_URL: 'https://x' })).toThrow(
      /MIRROR_AGENT_TOKEN/,
    );
  });

  it('con lo mínimo, el resto son valores por defecto sensatos', () => {
    const c = loadConfig(minimo);

    expect(c.pollIntervalMs).toBe(5_000);
    expect(c.heartbeatIntervalMs).toBe(60_000);
    // Una vez al día: la reconciliación lee la agenda entera del hospital.
    expect(c.reconcileIntervalMs).toBe(86_400_000);
    expect(c.reconcileDias).toBe(90);
  });

  it('los intervalos se pueden ajustar por entorno', () => {
    const c = loadConfig({
      ...minimo,
      MIRROR_POLL_INTERVAL_MS: '1000',
      MIRROR_RECONCILE_INTERVAL_MS: '300000',
      MIRROR_RECONCILE_DELAY_MS: '10000',
      MIRROR_RECONCILE_DIAS: '30',
    });

    expect(c.pollIntervalMs).toBe(1_000);
    expect(c.reconcileIntervalMs).toBe(300_000);
    expect(c.reconcileDelayMs).toBe(10_000);
    expect(c.reconcileDias).toBe(30);
  });

  it('un valor que no es número cae al defecto en vez de dejar NaN', () => {
    // `Number('cada hora')` es NaN, y un setTimeout con NaN dispara de
    // inmediato: el agente machacaría al hospital en un bucle cerrado.
    const c = loadConfig({ ...minimo, MIRROR_POLL_INTERVAL_MS: 'cada hora' });

    expect(c.pollIntervalMs).toBe(5_000);
  });

  it('un cero también cae al defecto: un intervalo de 0 ms es un bucle cerrado', () => {
    const c = loadConfig({ ...minimo, MIRROR_HEARTBEAT_INTERVAL_MS: '0' });

    expect(c.heartbeatIntervalMs).toBe(60_000);
  });

  it('la versión del driver viaja en el handshake y se puede fijar', () => {
    expect(loadConfig(minimo).driverVersion).toBe('0.1.0-fase1');
    expect(
      loadConfig({ ...minimo, MIRROR_DRIVER_VERSION: '0.2.0' }).driverVersion,
    ).toBe('0.2.0');
  });
});
