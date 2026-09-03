import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CircuitBreaker } from './circuit-breaker';
import { FileAgentStateStore } from './file-agent-state-store';
import { runOutbound, runInbound } from './sync-cycle';
import { FailureReporter } from './failure-reporter';
import { loadConfig } from '../config';

/**
 * Bordes que las suites por pieza no alcanzaban: valores por defecto, estados
 * de disco corruptos y las ramas de reporte de fallo del ciclo de sync.
 *
 * No son casos exóticos: el estado por defecto es el del PRIMER arranque del
 * agente en la VM del hospital, y un `state.json` a medias es lo que queda
 * tras un corte de luz — los dos momentos en los que menos se quiere descubrir
 * que algo no estaba probado.
 */

describe('CircuitBreaker — valores por defecto', () => {
  it('sin opciones arranca cerrado y usa el reloj real', () => {
    const cb = new CircuitBreaker();
    expect(cb.estado).toBe('CERRADO');
    expect(cb.puedeIntentar()).toBe(true);
  });

  it('con los umbrales por defecto hacen falta varios fallos para abrirlo', () => {
    const cb = new CircuitBreaker();
    cb.registrarFallo();
    expect(cb.estado).toBe('CERRADO');
  });
});

describe('FileAgentStateStore — el estado que sobrevive al reinicio', () => {
  let dir: string;
  let ruta: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenia-estado-'));
    ruta = path.join(dir, 'sub', 'state.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('el primer arranque (sin archivo) parte de cero, sin avisar de nada', async () => {
    const store = new FileAgentStateStore(ruta);
    await store.cargar();

    await expect(store.getOutboxCursor()).resolves.toBe('0');
    await expect(store.getDriverCursor()).resolves.toBeNull();
  });

  it('sin función de aviso propia usa la consola: no revienta por no tenerla', async () => {
    // El constructor cae a `console.warn`; se ejercita esa rama por defecto.
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, 'esto no es JSON');

    const store = new FileAgentStateStore(ruta);
    await store.cargar();

    await expect(store.getOutboxCursor()).resolves.toBe('0');
    spy.mockRestore();
  });

  it('🩹 un state.json a medias no tumba el arranque: cada campo cae a su default', async () => {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify({}));

    const store = new FileAgentStateStore(ruta, () => undefined);
    await store.cargar();

    await expect(store.getOutboxCursor()).resolves.toBe('0');
    await expect(store.getDriverCursor()).resolves.toBeNull();
    await expect(store.hasAppliedLocally('lo-que-sea')).resolves.toBe(false);
  });

  it('un `appliedEventIds` que no es un arreglo se descarta en vez de reventar', async () => {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(
      ruta,
      JSON.stringify({ outboxCursor: '7', appliedEventIds: 'corrupto' }),
    );

    const store = new FileAgentStateStore(ruta, () => undefined);
    await store.cargar();

    await expect(store.getOutboxCursor()).resolves.toBe('7');
    await expect(store.hasAppliedLocally('e1')).resolves.toBe(false);
  });

  it('marcar dos veces el mismo evento no lo duplica ni reescribe', async () => {
    const store = new FileAgentStateStore(ruta, () => undefined);
    await store.cargar();

    await store.markAppliedLocally('evt-1');
    await store.markAppliedLocally('evt-1');

    const datos = JSON.parse(fs.readFileSync(ruta, 'utf8')) as {
      appliedEventIds: string[];
    };
    expect(datos.appliedEventIds).toEqual(['evt-1']);
  });
});

describe('sync-cycle — reporte de fallos', () => {
  const reporter = () => {
    const reportados: string[] = [];
    return {
      reportados,
      reporter: {
        report: (dir: string, msg: string) => reportados.push(`${dir}: ${msg}`),
        reportAll: (dir: string, msgs: string[]) =>
          msgs.forEach((m) => reportados.push(`${dir}: ${m}`)),
      } as unknown as FailureReporter,
    };
  };

  it('un evento que LANZÓ se distingue de uno que el HIS rechazó', async () => {
    const { reportados, reporter: r } = reporter();
    const engine = {
      pullAndApplyOutboxEvents: async () => ({
        applied: 0,
        skippedIdempotent: 0,
        skippedUnsupported: 0,
        failed: 2,
        failures: [
          { eventId: 'e1', seq: '1', threw: true, message: 'ECONNRESET' },
          { eventId: 'e2', seq: '2', threw: false, message: 'PK duplicada' },
        ],
      }),
    };

    const res = await runOutbound(engine as never, r);

    expect(res.hadErrors).toBe(true);
    expect(reportados[0]).toContain('lanzo');
    expect(reportados[1]).toContain('rechazado');
  });

  it('un fallo que no es un Error se reporta igual, con su texto', async () => {
    const { reportados, reporter: r } = reporter();
    const engine = {
      pullAndApplyOutboxEvents: async () => {
        throw 'el HIS cerró la sesión';
      },
    };

    const res = await runOutbound(engine as never, r);

    expect(res.hadErrors).toBe(true);
    expect(reportados.join(' ')).toContain('el HIS cerró la sesión');
  });

  it('🚨 un lote entrante que el servidor no pudo aplicar NO es una vuelta limpia', async () => {
    const { reportados, reporter: r } = reporter();
    const engine = {
      detectAndPushChanges: async () => ({ pushed: 5, errores: 2 }),
    };

    const res = await runInbound(engine as never, r);

    expect(res).toMatchObject({ pushed: 5, noAplicados: 2, hadErrors: true });
    expect(reportados.join(' ')).toContain('2 de 5');
    expect(reportados.join(' ')).toContain('SyncAudit');
  });

  it('un lote entrante limpio no reporta nada', async () => {
    const { reportados, reporter: r } = reporter();
    const engine = {
      detectAndPushChanges: async () => ({ pushed: 3, errores: 0 }),
    };

    const res = await runInbound(engine as never, r);

    expect(res).toMatchObject({ pushed: 3, noAplicados: 0, hadErrors: false });
    expect(reportados).toEqual([]);
  });
});

describe('loadConfig', () => {
  const base = {
    MIRROR_API_URL: 'https://api.agenia.co',
    MIRROR_AGENT_TOKEN: 'tok',
  };

  it.each([
    ['sin URL', { MIRROR_AGENT_TOKEN: 'tok' }, /MIRROR_API_URL/],
    ['sin token', { MIRROR_API_URL: 'https://x' }, /MIRROR_AGENT_TOKEN/],
  ])('%s no arranca: mejor fallar aquí que latir sin poder hablar', (_e, env, patron) => {
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(patron);
  });

  it('con lo mínimo arranca y trae los valores por defecto del resto', () => {
    const cfg = loadConfig(base as NodeJS.ProcessEnv);

    expect(cfg.mirrorApiUrl).toBe('https://api.agenia.co');
    expect(cfg.agentToken).toBe('tok');
    expect(cfg.driverVersion).toEqual(expect.any(String));
  });
});
