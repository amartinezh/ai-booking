import { CntSanVicenteAnsermaDriver } from './index';
import type { AnsermaMapping } from './mapping';

// ══════════════════════════════════════════════════════════════════════════
// 🩺 Traer las citas que la reconciliación pide (2026-10-15): las que el
// hospital agendó antes de que su médico se homologara. La detección de
// cambios solo ve las altas nuevas, así que sin esto no entrarían nunca.
//
// Lo que se fija aquí:
//  · solo las citas pedidas, y solo si siguen VIGENTES (estado 0);
//  · salen como altas iguales a las de la detección, con el paciente;
//  · el eventId es propio (cnt:IMPORT:) y estable: pedirla otra vez no duplica;
//  · las que escribió este agente no se traen.
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
  ventanaVigilanciaDias: 90,
} as AnsermaMapping;

const cita = (over: Record<string, unknown> = {}) => ({
  med: 'MD09',
  hora: '2026/10/20 08:00',
  estado: 0,
  servicio: 'S39141',
  hist: '1053000111',
  dura: 20,
  descripcion: null,
  fecha: '2026-10-20',
  elaborada: '2026-10-01 09:15:00.000',
  ...over,
});

const PEDIDA = {
  doctorExternalKey: 'MD09',
  // 08:00 en Bogotá.
  startTimeIso: '2026-10-20T13:00:00.000Z',
};

function conDriver(citas: unknown[], pacientes: unknown[] = []) {
  const sqls: string[] = [];
  const params: Record<string, unknown> = {};
  const req: any = {
    input(nombre: string, _t: unknown, valor: unknown) {
      params[nombre] = valor;
      return req;
    },
    async query(texto: string) {
      sqls.push(texto);
      return {
        recordset: texto.includes('dbo.PACIENTES') ? pacientes : citas,
      };
    },
  };
  const driver = new CntSanVicenteAnsermaDriver();
  driver.useConnection({ request: () => req } as never, MAPPING);
  return { driver, sqls, params };
}

describe('importAppointments', () => {
  it('la cita pedida sale como ALTA con su servicio y los datos del paciente', async () => {
    const { driver } = conDriver(
      [cita()],
      [
        {
          hist: '1053000111',
          nombre: 'ANA',
          segNombre: null,
          apellido: 'RIOS',
          segApellido: null,
          telefono: '3001112233',
          naci: '1990-01-02',
          sexo: 0,
        },
      ],
    );

    const eventos = await driver.importAppointments([PEDIDA]);

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      eventId: 'cnt:IMPORT:MD09|2026/10/20 08:00:0:2026-10-01 09:15:00.000',
      entityType: 'APPOINTMENT',
      op: 'INSERT',
      payload: {
        doctorExternalKey: 'MD09',
        serviceExternalKey: 'S39141',
        patientDocument: '1053000111',
        startTimeIso: '2026-10-20T13:00:00.000Z',
        endTimeIso: '2026-10-20T13:20:00.000Z',
        patientFullName: 'ANA RIOS',
        patientPhone: '3001112233',
      },
    });
  });

  it('una sola consulta: solo vigentes, solo los médicos pedidos, por fecha local', async () => {
    const { driver, sqls, params } = conDriver([]);

    await driver.importAppointments([
      PEDIDA,
      { doctorExternalKey: 'RU62', startTimeIso: '2026-10-25T14:00:00.000Z' },
    ]);

    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain('NU_ESTA_CIT = 0');
    expect(sqls[0]).toContain('CD_CODI_MED_CIT IN (@m0, @m1)');
    expect(params).toMatchObject({
      desde: '20261020',
      hasta: '20261026',
      m0: 'MD09',
      m1: 'RU62',
    });
  });

  it('una cita que no se pidió, aunque venga en la consulta, no se trae', async () => {
    const { driver } = conDriver([
      cita(),
      cita({ hora: '2026/10/20 08:20', elaborada: '2026-10-02 10:00:00.000' }),
    ]);

    const eventos = await driver.importAppointments([PEDIDA]);

    expect(eventos.map((e) => e.payload.startTimeIso)).toEqual([
      '2026-10-20T13:00:00.000Z',
    ]);
  });

  it('las que escribió este agente no se traen: ya son de AgenIA', async () => {
    const { driver } = conDriver([
      cita({ descripcion: 'ASIGNADA POR WHATSAPP' }),
    ]);

    expect(await driver.importAppointments([PEDIDA])).toEqual([]);
  });

  it('dos filas vigentes en el mismo cupo → una sola alta', async () => {
    const { driver } = conDriver([
      cita(),
      cita({ elaborada: '2026-10-03 11:00:00.000' }),
    ]);

    expect(await driver.importAppointments([PEDIDA])).toHaveLength(1);
  });

  it('sin nada que pedir no consulta el HIS', async () => {
    const { driver, sqls } = conDriver([cita()]);

    expect(await driver.importAppointments([])).toEqual([]);
    expect(sqls).toHaveLength(0);
  });
});
