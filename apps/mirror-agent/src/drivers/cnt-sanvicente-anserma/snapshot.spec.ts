import { CntSanVicenteAnsermaDriver } from './index';
import type { AnsermaMapping } from './mapping';

// ══════════════════════════════════════════════════════════════════════════
// `snapshotAppointments` alimenta la reconciliación: la capa 5 del plan §6, la
// única defensa que detecta que los dos sistemas divergieron sin que nada
// fallara. Si esta foto sale mal, la reconciliación miente en la dirección
// más peligrosa — "todo en orden" mientras un cupo ya vendido se sigue
// ofreciendo por WhatsApp.
// ══════════════════════════════════════════════════════════════════════════

const MAPPING = {
  lugarAtencion: '01',
  centroCostos: '007',
  marcaOrigen: 'ASIGNADA POR WHATSAPP',
  motivoAnulacion: 'WB',
  sexo: { M: 0, F: 1 },
  convenios: {},
  convenioParticular: 26,
  serviciosPyp: [],
  especialidadPorServicio: {},
  especialidadPorDefecto: '000',
  duracionMinutos: 20,
} as AnsermaMapping;

const VENTANA = {
  from: new Date('2026-09-01T00:00:00.000Z'),
  to: new Date('2026-12-01T00:00:00.000Z'),
};

function conDriver(recordset: unknown[]) {
  const capturado: { sql?: string; params: Record<string, unknown> } = {
    params: {},
  };
  const req: any = {
    input(nombre: string, _t: unknown, valor: unknown) {
      capturado.params[nombre] = valor;
      return req;
    },
    async query(sql: string) {
      capturado.sql = sql;
      return { recordset };
    },
  };
  const driver = new CntSanVicenteAnsermaDriver();
  driver.useConnection({ request: () => req } as never, MAPPING);
  return { driver, capturado };
}

describe('snapshotAppointments', () => {
  it('traduce la hora local del HIS a UTC', async () => {
    // El HIS guarda hora de Bogotá; el protocolo viaja en UTC (plan §8).
    const { driver } = conDriver([
      { med: '91-1', hora: '2026/09/03 07:20', hist: '1099887766' },
    ]);

    const foto = await driver.snapshotAppointments(VENTANA);

    expect(foto).toEqual([
      {
        doctorExternalKey: '91-1',
        startTimeIso: '2026-09-03T12:20:00.000Z',
        patientDocument: '1099887766',
      },
    ]);
  });

  it('acota la consulta a la ventana que se le pide', async () => {
    const { driver, capturado } = conDriver([]);

    await driver.snapshotAppointments(VENTANA);

    expect(capturado.params.desde).toEqual(VENTANA.from);
    expect(capturado.params.hasta).toEqual(VENTANA.to);
  });

  it('NO filtra por marca de origen: reconciliar es comparar TODO', async () => {
    // Filtrando solo lo nuestro, la comparación confirmaría lo que ya sabemos
    // y las citas de ventanilla del hospital quedarían invisibles.
    const { driver, capturado } = conDriver([]);

    await driver.snapshotAppointments(VENTANA);

    expect(capturado.sql).not.toMatch(/DE_DESC_CIT\s*=/);
  });

  it('una cita sin historia no rompe la foto', async () => {
    const { driver } = conDriver([
      { med: '76', hora: '2026/09/03 08:00', hist: null },
    ]);

    const foto = await driver.snapshotAppointments(VENTANA);

    expect(foto[0].patientDocument).toBeUndefined();
    expect(foto[0].startTimeIso).toBe('2026-09-03T13:00:00.000Z');
  });

  it('sin conexión falla en vez de devolver una foto vacía', async () => {
    // Una foto vacía se interpretaría como "el hospital no tiene ninguna cita"
    // y la reconciliación reportaría deriva en todas.
    const driver = new CntSanVicenteAnsermaDriver();

    await expect(driver.snapshotAppointments(VENTANA)).rejects.toThrow();
  });
});
