import { CntSanVicenteAnsermaDriver } from './index';
import type { AnsermaMapping } from './mapping';
import type { CanonicalChangeEvent } from '@agenia/shared';

// ══════════════════════════════════════════════════════════════════════════
// El SQL que este driver le escribe a un hospital merece verificarse valor a
// valor. Aquí se inyecta una conexión falsa que captura los parámetros del
// INSERT, en vez de montar un SQL Server para cada aserción.
//
// La prueba contra el motor real vive aparte y corre contra el contenedor
// `mirror-his-mock`; esto cubre las decisiones, aquella cubre el dialecto.
// ══════════════════════════════════════════════════════════════════════════

const MAPPING: AnsermaMapping = {
  lugarAtencion: '01',
  centroCostos: '007',
  marcaOrigen: 'ASIGNADA POR WHATSAPP',
  motivoAnulacion: 'WB',
  sexo: { M: 0, F: 1 },
  convenios: {
    '800088702|SUBSIDIADO': 283,
    '900156264|CONTRIBUTIVO': 473,
  },
  convenioParticular: 26,
  serviciosPyp: [],
  especialidadPorServicio: { 'S39141-1': '000' },
  especialidadPorDefecto: '000',
  duracionMinutos: 20,
};

/** Conexión falsa: registra cada request con sus parámetros y su SQL. */
function fakePool(opts: { pacienteExiste?: boolean; turno?: any; error?: any } = {}) {
  const requests: { params: Record<string, unknown>; sql: string }[] = [];

  const makeRequest = () => {
    const params: Record<string, unknown> = {};
    const req: any = {
      input(nombre: string, _tipo: unknown, valor: unknown) {
        params[nombre] = valor;
        return req;
      },
      async query(sqlText: string) {
        requests.push({ params, sql: sqlText });
        if (opts.error && /INSERT INTO dbo\.CITAS_MEDICAS/.test(sqlText)) {
          throw opts.error;
        }
        if (/FROM dbo\.PACIENTES/.test(sqlText)) {
          return { recordset: opts.pacienteExiste === false ? [] : [{ x: 1 }] };
        }
        if (/FROM dbo\.TURNOS_MEDICOS/.test(sqlText)) {
          return {
            recordset:
              opts.turno === null ? [] : [opts.turno ?? { consultorio: '40' }],
          };
        }
        return { recordset: [] };
      },
    };
    return req;
  };

  return { pool: { request: makeRequest } as any, requests };
}

const evento = (over: Partial<CanonicalChangeEvent['payload']> = {}): CanonicalChangeEvent => ({
  eventId: 'evt-1',
  entityType: 'APPOINTMENT',
  op: 'INSERT',
  occurredAtIso: '2026-08-31T00:00:00.000Z',
  payload: {
    agenIAAppointmentId: 'apt-1',
    doctorExternalKey: '91-1',
    serviceExternalKey: 'S39141-1',
    patientDocument: '1122334455',
    patientFullName: 'CARLOS RAMIREZ LOPEZ',
    patientBirthDateIso: '1985-03-15T00:00:00.000Z',
    patientGender: 'M',
    startTimeIso: '2026-09-03T12:00:00.000Z',
    endTimeIso: '2026-09-03T12:20:00.000Z',
    ...over,
  },
});

const conDriver = (opts: Parameters<typeof fakePool>[0] = {}) => {
  const driver = new CntSanVicenteAnsermaDriver();
  const { pool, requests } = fakePool(opts);
  driver.useConnection(pool, MAPPING);
  return { driver, requests };
};

const insertDeCita = (requests: { params: any; sql: string }[]) =>
  requests.find((r) => /INSERT INTO dbo\.CITAS_MEDICAS/.test(r.sql))?.params;

describe('createAppointment — valores que se le escriben al HIS', () => {
  it('la hora va en formato del HIS y en hora de Bogotá', async () => {
    const { driver, requests } = conDriver();
    await driver.createAppointment(evento());

    // 12:00 UTC son las 07:00 en Bogotá — la hora que el paciente vio.
    expect(insertDeCita(requests)!.hora).toBe('2026/09/03 07:00');
  });

  it('escribe médico, servicio e historia tal como los homologó el servidor', async () => {
    const { driver, requests } = conDriver();
    await driver.createAppointment(evento());

    const p = insertDeCita(requests)!;
    expect(p.med).toBe('91-1');
    expect(p.ser).toBe('S39141-1');
    expect(p.hist).toBe('1122334455');
  });

  it('marca el origen en DE_DESC_CIT, como pidió el hospital', async () => {
    const { driver, requests } = conDriver();
    await driver.createAppointment(evento());

    expect(insertDeCita(requests)!.desc).toBe('ASIGNADA POR WHATSAPP');
  });

  it('fija la sede en la principal y el centro de costos del mapeo', async () => {
    const { driver, requests } = conDriver();
    await driver.createAppointment(evento());

    const p = insertDeCita(requests)!;
    expect(p.luat).toBe('01');
    expect(p.ceco).toBe('007');
  });

  it('el consultorio sale del turno del médico ese día, no de una constante', async () => {
    const { driver, requests } = conDriver({ turno: { consultorio: '51' } });
    await driver.createAppointment(evento());

    expect(insertDeCita(requests)!.cons).toBe('51');
  });

  it('la duración sale del cupo, no del valor por defecto', async () => {
    const { driver, requests } = conDriver();
    await driver.createAppointment(
      evento({
        startTimeIso: '2026-09-03T12:00:00.000Z',
        endTimeIso: '2026-09-03T12:30:00.000Z',
      }),
    );

    expect(insertDeCita(requests)!.dura).toBe(30);
  });

  it('sin EPS factura como particular', async () => {
    const { driver, requests } = conDriver();
    await driver.createAppointment(evento());

    expect(insertDeCita(requests)!.conv).toBe(26);
  });

  it('con EPS y régimen factura al convenio correcto', async () => {
    const { driver, requests } = conDriver();
    await driver.createAppointment(
      evento({ epsNit: '900156264', patientRegime: 'CONTRIBUTIVO' }),
    );

    expect(insertDeCita(requests)!.conv).toBe(473);
  });
});

describe('createAppointment — se niega antes que escribir a medias', () => {
  it.each([
    ['médico', { doctorExternalKey: undefined }],
    ['servicio', { serviceExternalKey: undefined }],
    ['documento del paciente', { patientDocument: undefined }],
    ['hora de la cita', { startTimeIso: undefined }],
  ])('sin %s no toca la base', async (falta, over) => {
    const { driver, requests } = conDriver();

    const r = await driver.createAppointment(evento(over as any));

    expect(r.success).toBe(false);
    expect(r.message).toContain(falta);
    expect(requests).toHaveLength(0); // ni una consulta
  });

  it('sin turno del médico ese día NO inventa el consultorio', async () => {
    const { driver, requests } = conDriver({ turno: null });

    const r = await driver.createAppointment(evento());

    expect(r.success).toBe(false);
    expect(r.message).toMatch(/no tiene turno/);
    expect(insertDeCita(requests)).toBeUndefined();
  });

  it('con EPS pero sin régimen se niega: no adivina el convenio', async () => {
    const { driver, requests } = conDriver();

    const r = await driver.createAppointment(evento({ epsNit: '800088702' }));

    expect(r.success).toBe(false);
    expect(r.message).toMatch(/régimen/);
    expect(insertDeCita(requests)).toBeUndefined();
  });

  it('un paciente nuevo sin nacimiento ni sexo no se da de alta a medias', async () => {
    const { driver, requests } = conDriver({ pacienteExiste: false });

    const r = await driver.createAppointment(
      evento({ patientBirthDateIso: undefined, patientGender: undefined }),
    );

    expect(r.success).toBe(false);
    expect(r.message).toMatch(/NOT NULL/);
    expect(insertDeCita(requests)).toBeUndefined();
  });

  it('sin mappingJson no escribe nada', async () => {
    const driver = new CntSanVicenteAnsermaDriver();
    const { pool } = fakePool();
    driver.useConnection(pool, undefined);

    await expect(driver.createAppointment(evento())).rejects.toThrow(
      /mappingJson/,
    );
  });
});

describe('createAppointment — alta de paciente', () => {
  it('si el paciente YA existe en el HIS, no lo vuelve a crear', async () => {
    const { driver, requests } = conDriver({ pacienteExiste: true });
    await driver.createAppointment(evento());

    const altas = requests.filter((r) => /INSERT INTO dbo\.PACIENTES/.test(r.sql));
    expect(altas).toHaveLength(0);
  });

  it('si no existe, lo crea con historia = documento', async () => {
    const { driver, requests } = conDriver({ pacienteExiste: false });
    await driver.createAppointment(evento());

    const alta = requests.find((r) => /INSERT INTO dbo\.PACIENTES/.test(r.sql))!;
    // Confirmado en Fase 0: la historia ES el documento, en el 100% de los
    // 78.654 pacientes del hospital.
    expect(alta.params.hist).toBe('1122334455');
    expect(alta.params.docu).toBe('1122334455');
    expect(alta.params.sexo).toBe(0); // M
  });

  it('recorta el nombre a lo que cabe en NO_NOMB_PAC (60)', async () => {
    const { driver, requests } = conDriver({ pacienteExiste: false });
    await driver.createAppointment(
      evento({ patientFullName: 'A'.repeat(90) }),
    );

    const alta = requests.find((r) => /INSERT INTO dbo\.PACIENTES/.test(r.sql))!;
    expect((alta.params.nomb as string).length).toBe(60);
  });
});

describe('createAppointment — colisión de cupo en el HIS', () => {
  it('una violación de PK se reporta como cupo ya ocupado, no como error genérico', async () => {
    // La PK es (médico, hora, estado): que reviente es el detector natural de
    // que el hospital ya vendió ese cupo. La política de este hospital es que
    // el HIS gana.
    const { driver } = conDriver({ error: Object.assign(new Error('PK'), { number: 2627 }) });

    const r = await driver.createAppointment(evento());

    expect(r.success).toBe(false);
    expect(r.message).toMatch(/ya está ocupado en el HIS/);
    expect(r.message).toContain('2026/09/03 07:00');
  });

  it('un error que NO es de PK se propaga: no se disfraza de conflicto', async () => {
    const { driver } = conDriver({
      error: Object.assign(new Error('se cayó la red'), { number: 10054 }),
    });

    await expect(driver.createAppointment(evento())).rejects.toThrow(
      /se cayó la red/,
    );
  });
});
