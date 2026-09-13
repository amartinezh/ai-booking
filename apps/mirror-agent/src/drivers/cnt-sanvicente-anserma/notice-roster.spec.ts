import { CntSanVicenteAnsermaDriver } from './index';
import type { AnsermaMapping } from './mapping';

// ══════════════════════════════════════════════════════════════════════════
// `fetchNoticeRoster` — avisos masivos, Fase 2 (fuente espejo). Ver
// docs/drivers/cnt-sanvicente-anserma/PLAN_AVISOS_MASIVOS.md §5.
//
// Es la ÚNICA consulta de este driver que trae nombre y teléfono del
// paciente: todas las demás solo mueven el documento. Lo que se prueba aquí
// no es solo "trae las filas" — es que NUNCA reporta a alguien sin
// documento, que descarta lo que no puede leer en vez de inventarlo, y que
// respeta la ventana de INSTANTES pedida, no solo el día.
// ══════════════════════════════════════════════════════════════════════════

const MAPPING = {
  lugarAtencion: '01',
  centroCostos: '007',
  marcaOrigen: 'ASIGNADA POR WHATSAPP',
  motivoAnulacion: 'WB',
  sexo: { M: 1, F: 0 },
  convenios: {},
  convenioParticular: 26,
  serviciosPyp: [],
  especialidadPorServicio: {},
  especialidadPorDefecto: '000',
  duracionMinutos: 20,
} as AnsermaMapping;

// Medianoche BOGOTÁ (UTC-5), no medianoche UTC — igual que pide fechaCitaLocal.
const VENTANA = {
  doctorExternalKey: '76',
  fromIso: '2026-09-24T05:00:00.000Z',
  toIso: '2026-09-25T05:00:00.000Z',
};

function conDriver(recordset: unknown[]) {
  const capturado: { params: Record<string, unknown> } = { params: {} };
  const req: any = {
    input(nombre: string, _t: unknown, valor: unknown) {
      capturado.params[nombre] = valor;
      return req;
    },
    async query() {
      return { recordset };
    },
  };
  const driver = new CntSanVicenteAnsermaDriver();
  driver.useConnection({ request: () => req } as never, MAPPING);
  return { driver, capturado };
}

const FILA_BASE = {
  med: '76',
  servicio: '890266ESP',
  hora: '2026/09/24 07:00',
  hist: '1037456123',
  nombre: 'Luz Elena',
  segNombre: null,
  apellido: 'Restrepo',
  segApellido: 'Gómez',
  telefono: '3114567890',
};

describe('fetchNoticeRoster', () => {
  it('trae al paciente con nombre completo armado y teléfono, hora en UTC', async () => {
    const { driver } = conDriver([FILA_BASE]);

    const roster = await driver.fetchNoticeRoster(VENTANA);

    expect(roster).toEqual([
      {
        doctorExternalKey: '76',
        serviceExternalKey: '890266ESP',
        startTimeIso: '2026-09-24T12:00:00.000Z',
        patientDocument: '1037456123',
        patientFullName: 'Luz Elena Restrepo Gómez',
        patientPhone: '3114567890',
      },
    ]);
  });

  it('filtra por médico y por fecha en los parámetros de la consulta', async () => {
    const { driver, capturado } = conDriver([]);

    await driver.fetchNoticeRoster(VENTANA);

    expect(capturado.params.medico).toBe('76');
    expect(capturado.params.desde).toBe('20260924');
    // `toIso` (medianoche Bogotá del 25) cae en el día local 25 — el borde SQL
    // sargable es el día SIGUIENTE a ese (20260926), exclusivo; el filtro
    // fino en memoria es el que de verdad recorta al instante pedido (ver el
    // test de la ventana parcial, más abajo).
    expect(capturado.params.hasta).toBe('20260926');
  });

  it('omite una fila sin historia clínica: sin documento no hay a quién avisar', async () => {
    const { driver } = conDriver([{ ...FILA_BASE, hist: null }]);

    const roster = await driver.fetchNoticeRoster(VENTANA);

    expect(roster).toEqual([]);
  });

  it('omite una fila con FE_HORA_CIT ilegible en vez de reventar el lote entero', async () => {
    const { driver } = conDriver([
      { ...FILA_BASE, hora: '31' },
      { ...FILA_BASE, patientDocument: '999', hora: '2026/09/24 08:00' },
    ]);

    const roster = await driver.fetchNoticeRoster(VENTANA);

    expect(roster).toHaveLength(1);
    expect(roster[0].startTimeIso).toBe('2026-09-24T13:00:00.000Z');
  });

  it('arma el nombre completo aunque falten segundo nombre o segundo apellido', async () => {
    const { driver } = conDriver([
      {
        ...FILA_BASE,
        nombre: 'Ana',
        segNombre: null,
        apellido: 'Ruiz',
        segApellido: null,
      },
    ]);

    const roster = await driver.fetchNoticeRoster(VENTANA);

    expect(roster[0].patientFullName).toBe('Ana Ruiz');
  });

  it('sin ningún dato de nombre, patientFullName queda undefined en vez de una cadena vacía', async () => {
    const { driver } = conDriver([
      {
        ...FILA_BASE,
        nombre: null,
        segNombre: null,
        apellido: null,
        segApellido: null,
      },
    ]);

    const roster = await driver.fetchNoticeRoster(VENTANA);

    expect(roster[0].patientFullName).toBeUndefined();
  });

  it('sin teléfono, patientPhone queda undefined (el servidor decide qué hacer)', async () => {
    const { driver } = conDriver([{ ...FILA_BASE, telefono: null }]);

    const roster = await driver.fetchNoticeRoster(VENTANA);

    expect(roster[0].patientPhone).toBeUndefined();
  });

  it('trae también DE_TELE_ACOM_PAC como companionPhone (§3.4/J.5) — el servidor decide si lo usa', async () => {
    const { driver } = conDriver([{ ...FILA_BASE, telefonoAcom: '3009876543' }]);

    const roster = await driver.fetchNoticeRoster(VENTANA);

    expect(roster[0].patientPhone).toBe('3114567890');
    expect(roster[0].companionPhone).toBe('3009876543');
  });

  it('sin teléfono de acompañante, companionPhone queda undefined (nunca null ni cadena vacía)', async () => {
    const { driver } = conDriver([{ ...FILA_BASE, telefonoAcom: null }]);

    const roster = await driver.fetchNoticeRoster(VENTANA);

    expect(roster[0].companionPhone).toBeUndefined();
  });

  it('descarta una cita fuera de la ventana de INSTANTES aunque el día SQL la incluya', async () => {
    // El borde SQL es por DÍA local (fechaCitaLocal/diaSiguienteLiteralSql):
    // pedir hasta las 10 a.m. del 24 sigue trayendo el día 24 completo desde
    // la base. El filtro fino en memoria es el que de verdad respeta la hora
    // exacta que se pidió — una cita de las 2 p.m. queda fuera aunque su día
    // SQL haya calzado.
    const ventanaParcial = {
      doctorExternalKey: '76',
      fromIso: '2026-09-24T05:00:00.000Z', // medianoche Bogotá del 24
      toIso: '2026-09-24T15:00:00.000Z', // 10 a.m. Bogotá del 24
    };
    const { driver } = conDriver([{ ...FILA_BASE, hora: '2026/09/24 14:00' }]);

    const roster = await driver.fetchNoticeRoster(ventanaParcial);

    expect(roster).toEqual([]);
  });

  it('una cita sin servicio (CD_CODI_SER_CIT null) deja serviceExternalKey undefined', async () => {
    const { driver } = conDriver([{ ...FILA_BASE, servicio: null }]);

    const roster = await driver.fetchNoticeRoster(VENTANA);

    expect(roster[0].serviceExternalKey).toBeUndefined();
  });
});
