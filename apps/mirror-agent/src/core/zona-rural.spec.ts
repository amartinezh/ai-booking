import { MirrorEngine } from './engine';
import type { MirrorApiClient } from './mirror-api-client';
import type { HisDriver } from './driver.interface';
import { LIMITES_ZONA_RURAL } from '@agenia/shared';

// 🌾 Sábados solo para la zona rural: el agente manda la lista de documentos de
// pacientes rurales solo si la clínica encendió la regla, como mucho una vez al
// día, en lotes con el mismo inicio, y el último lote dice que es el último.

const AHORA = new Date('2026-11-20T08:00:00.000Z');

function armar(opts: {
  pedir: boolean;
  ultimaIso?: string | null;
  documentos?: string[];
  conCapacidad?: boolean;
  ignorado?: boolean;
}) {
  const api = {
    getRuralZoneState: jest.fn(async () => ({
      pedir: opts.pedir,
      ultimaIso: opts.ultimaIso ?? null,
    })),
    pushRuralZoneBatch: jest.fn(
      async (input: {
        inicioIso: string;
        documentos: string[];
        ultimo: boolean;
      }) =>
        opts.ignorado
          ? { aceptados: 0, ignorado: true }
          : input.ultimo
            ? input.documentos.length === 0 &&
              (opts.documentos ?? []).length === 0
              ? { aceptados: 0, total: 0, conservada: true }
              : { aceptados: input.documentos.length, total: 12345 }
            : { aceptados: input.documentos.length },
    ),
  };
  const fetchRuralPatientDocuments = jest.fn(async () => opts.documentos ?? []);
  const driver = {
    key: 'test',
    ...(opts.conCapacidad === false ? {} : { fetchRuralPatientDocuments }),
  };
  const engine = new MirrorEngine(
    api as unknown as MirrorApiClient,
    driver as unknown as HisDriver,
    {} as never,
    '0.0.0-test',
  );
  return { api, engine, fetchRuralPatientDocuments };
}

describe('MirrorEngine.syncRuralZone — la lista de pacientes de zona rural', () => {
  it('un driver que no sabe leer la zona: no pregunta ni manda nada', async () => {
    const { api, engine } = armar({ pedir: true, conCapacidad: false });
    expect(await engine.syncRuralZone(AHORA)).toEqual({ skipped: true });
    expect(api.getRuralZoneState).not.toHaveBeenCalled();
  });

  it('con la regla apagada (lo de fábrica) no lee el HIS ni manda nada', async () => {
    const { api, engine, fetchRuralPatientDocuments } = armar({ pedir: false });
    expect(await engine.syncRuralZone(AHORA)).toEqual({
      skipped: false,
      apagado: true,
    });
    expect(fetchRuralPatientDocuments).not.toHaveBeenCalled();
    expect(api.pushRuralZoneBatch).not.toHaveBeenCalled();
  });

  it('si la última lista llegó hace menos de un día, no la vuelve a mandar', async () => {
    const { engine, fetchRuralPatientDocuments } = armar({
      pedir: true,
      ultimaIso: new Date(AHORA.getTime() - 2 * 3_600_000).toISOString(),
    });
    expect(await engine.syncRuralZone(AHORA)).toEqual({
      skipped: false,
      reciente: true,
    });
    expect(fetchRuralPatientDocuments).not.toHaveBeenCalled();
  });

  it('la manda en lotes con el mismo inicio, y solo el último dice que es el último', async () => {
    const documentos = Array.from(
      { length: LIMITES_ZONA_RURAL.LOTE * 2 + 7 },
      (_, i) => String(10_000_000 + i),
    );
    const { api, engine } = armar({
      pedir: true,
      ultimaIso: new Date(AHORA.getTime() - 25 * 3_600_000).toISOString(),
      documentos,
    });
    expect(await engine.syncRuralZone(AHORA)).toEqual({
      skipped: false,
      enviados: documentos.length,
      total: 12345,
    });
    const lotes = api.pushRuralZoneBatch.mock.calls.map((c) => c[0]);
    expect(lotes.map((l) => l.documentos.length)).toEqual([
      LIMITES_ZONA_RURAL.LOTE,
      LIMITES_ZONA_RURAL.LOTE,
      7,
    ]);
    expect(lotes.map((l) => l.ultimo)).toEqual([false, false, true]);
    expect(new Set(lotes.map((l) => l.inicioIso))).toEqual(
      new Set([AHORA.toISOString()]),
    );
  });

  it('sin documentos manda un lote final vacío y el servidor conserva la lista anterior', async () => {
    const { api, engine } = armar({ pedir: true, documentos: [] });
    expect(await engine.syncRuralZone(AHORA)).toEqual({
      skipped: false,
      enviados: 0,
      total: 0,
      conservada: true,
    });
    expect(api.pushRuralZoneBatch).toHaveBeenCalledTimes(1);
  });

  it('si el servidor dice que la regla se apagó a la mitad, deja de mandar', async () => {
    const documentos = Array.from(
      { length: LIMITES_ZONA_RURAL.LOTE + 1 },
      (_, i) => String(20_000_000 + i),
    );
    const { api, engine } = armar({ pedir: true, documentos, ignorado: true });
    expect(await engine.syncRuralZone(AHORA)).toEqual({
      skipped: false,
      apagado: true,
    });
    expect(api.pushRuralZoneBatch).toHaveBeenCalledTimes(1);
  });
});
