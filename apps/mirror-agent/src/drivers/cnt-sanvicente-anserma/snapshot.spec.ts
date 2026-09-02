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
  sexo: { M: 1, F: 0 }, // confirmado contra ESEHSVP (mapping.ts, 2026-09-01)
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

  it('consulta por fecha LOCAL, no por el instante UTC crudo', async () => {
    // FE_FECH_CIT es una fecha local sin zona: pasarle un Date de JS deja que
    // mssql lo serialice en UTC y desplaza el borde de la ventana hasta un
    // día entero según la hora en que corra. Mismo desfase que tenía
    // `detectChanges` antes de corregirse (ESTADO.md).
    const { driver, capturado } = conDriver([]);

    await driver.snapshotAppointments(VENTANA);

    // 2026-09-01T00:00:00Z son las 2026-08-31 19:00 en Bogotá: la fecha local
    // retrocede un día respecto al instante UTC pedido.
    expect(capturado.params.desde).toBe('20260831');
    // El borde superior es EXCLUSIVO: el día SIGUIENTE al último incluido, que
    // es lo que hace equivalente `< @hasta` al `BETWEEN` inclusivo anterior.
    expect(capturado.params.hasta).toBe('20261201');
    // Y la columna va desnuda, para que el índice del hospital sirva.
    expect(capturado.sql).toMatch(
      /FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta/,
    );
  });

  it('recorta el resultado a la ventana UTC real, no al día completo', async () => {
    // La consulta por fecha local trae el día entero como superconjunto; una
    // cita de las 23:50 UTC del último día pedido cae fuera de `window.to` y
    // no debe aparecer en la foto, aunque su fecha local haya calzado.
    const { driver } = conDriver([
      { med: '91-1', hora: '2026/11/30 18:00', hist: '111' }, // dentro: 23:00 UTC
      { med: '91-1', hora: '2026/12/01 08:00', hist: '222' }, // fuera: >= window.to
    ]);

    const foto = await driver.snapshotAppointments(VENTANA);

    expect(foto.map((f) => f.patientDocument)).toEqual(['111']);
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
