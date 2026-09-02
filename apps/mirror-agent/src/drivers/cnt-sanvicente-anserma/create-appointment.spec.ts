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
  sexo: { M: 1, F: 0 }, // confirmado contra ESEHSVP (mapping.ts, 2026-09-01)
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
function fakePool(
  opts: {
    pacienteExiste?: boolean;
    turno?: any;
    error?: any;
    /** Filas que afecta la copia a CITAS_ANULADAS: 0 = la cita no existía. */
    filasAnuladas?: number;
  } = {},
) {
  const requests: { params: Record<string, unknown>; sql: string }[] = [];
  const tx = { begun: false, committed: false, rolledBack: false };

  const makeRequest = () => {
    const params: Record<string, unknown> = {};
    const req: any = {
      input(nombre: string, _tipo: unknown, valor: unknown) {
        params[nombre] = valor;
        return req;
      },
      async query(sqlText: string) {
        requests.push({ params, sql: sqlText });
        if (/INSERT INTO dbo\.CITAS_ANULADAS/.test(sqlText)) {
          return { rowsAffected: [opts.filasAnuladas ?? 1], recordset: [] };
        }
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

  // El driver usa `pool.transaction()` y `tx.request()` — la API idiomática
  // de mssql — precisamente para que este doble pueda sustituirlos sin tocar
  // el módulo global (los constructores de `mssql` no son redefinibles).
  const pool: any = {
    request: makeRequest,
    transaction: () => ({
      request: makeRequest,
      async begin() {
        tx.begun = true;
      },
      async commit() {
        tx.committed = true;
      },
      async rollback() {
        tx.rolledBack = true;
      },
    }),
  };

  return { pool, requests, tx };
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
  const { pool, requests, tx } = fakePool(opts);
  driver.useConnection(pool, MAPPING);
  return { driver, requests, tx };
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
    expect(alta.params.sexo).toBe(1); // M — confirmado contra ESEHSVP
  });

  // 🚨 Este test afirmaba lo contrario y por eso el defecto pasó: daba por
  // bueno meter el nombre completo recortado a 60 en `NO_NOMB_PAC`, que en el
  // hospital es varchar(20) y solo guarda el PRIMER NOMBRE. En producción ese
  // INSERT habría fallado con el error 8152 para casi todos los pacientes.
  it('parte el nombre en las cuatro columnas del HIS', async () => {
    const { driver, requests } = conDriver({ pacienteExiste: false });
    await driver.createAppointment(
      evento({ patientFullName: 'JORGE ANDRES TABORDA RUIZ' }),
    );

    const alta = requests.find((r) => /INSERT INTO dbo\.PACIENTES/.test(r.sql))!;
    expect(alta.params.nomb).toBe('JORGE');
    expect(alta.params.sgno).toBe('ANDRES');
    expect(alta.params.prap).toBe('TABORDA');
    expect(alta.params.sgap).toBe('RUIZ');
  });

  it('cada columna se recorta a SU ancho real, no a uno inventado', async () => {
    const { driver, requests } = conDriver({ pacienteExiste: false });
    await driver.createAppointment(
      evento({ patientFullName: `${'N'.repeat(40)} ${'A'.repeat(40)}` }),
    );

    const alta = requests.find((r) => /INSERT INTO dbo\.PACIENTES/.test(r.sql))!;
    expect((alta.params.nomb as string).length).toBe(20); // NO_NOMB_PAC
    expect((alta.params.prap as string).length).toBe(30); // DE_PRAP_PAC
  });

  it('escribe las cuatro columnas de nombre, no solo una', async () => {
    const { driver, requests } = conDriver({ pacienteExiste: false });
    await driver.createAppointment(evento());

    const alta = requests.find((r) => /INSERT INTO dbo\.PACIENTES/.test(r.sql))!;
    expect(alta.sql).toMatch(/NO_NOMB_PAC/);
    expect(alta.sql).toMatch(/NO_SGNO_PAC/);
    expect(alta.sql).toMatch(/DE_PRAP_PAC/);
    expect(alta.sql).toMatch(/DE_SGAP_PAC/);
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

// ══════════════════════════════════════════════════════════════════════════
// Cancelar = DELETE de CITAS_MEDICAS + INSERT en CITAS_ANULADAS, en UNA
// transacción. No es un cambio de estado en sitio: lo confirmó el hospital
// ejecutando una cancelación real desde su aplicación.
// ══════════════════════════════════════════════════════════════════════════
const eventoCancel = (over: Partial<CanonicalChangeEvent['payload']> = {}) => ({
  ...evento(over),
  op: 'CANCEL' as const,
});

const sqlDe = (requests: { sql: string }[], patron: RegExp) =>
  requests.find((r) => patron.test(r.sql));

describe('cancelAppointment', () => {
  it('copia la cita a CITAS_ANULADAS y la borra de CITAS_MEDICAS', async () => {
    const { driver, requests } = conDriver();

    const r = await driver.cancelAppointment(eventoCancel());

    expect(r.success).toBe(true);
    expect(sqlDe(requests, /INSERT INTO dbo\.CITAS_ANULADAS/)).toBeDefined();
    expect(sqlDe(requests, /DELETE FROM dbo\.CITAS_MEDICAS/)).toBeDefined();
  });

  it('las dos escrituras van en una transacción que se confirma', async () => {
    // Borrar la cita sin dejar el registro de auditoría le rompería los
    // reportes al hospital: las dos cosas, o ninguna.
    const { driver, tx } = conDriver();

    await driver.cancelAppointment(eventoCancel());

    expect(tx.begun).toBe(true);
    expect(tx.committed).toBe(true);
    expect(tx.rolledBack).toBe(false);
  });

  it('el orden importa: primero copia, después borra', async () => {
    const { driver, requests } = conDriver();
    await driver.cancelAppointment(eventoCancel());

    const iCopia = requests.findIndex((r) =>
      /INSERT INTO dbo\.CITAS_ANULADAS/.test(r.sql),
    );
    const iBorra = requests.findIndex((r) =>
      /DELETE FROM dbo\.CITAS_MEDICAS/.test(r.sql),
    );
    expect(iCopia).toBeLessThan(iBorra);
  });

  it('usa el motivo que el hospital pidió (WB) y una observación legible', async () => {
    const { driver, requests } = conDriver();
    await driver.cancelAppointment(eventoCancel());

    const copia = sqlDe(requests, /INSERT INTO dbo\.CITAS_ANULADAS/)!;
    expect((copia as any).params.moti).toBe('WB');
    expect((copia as any).params.obse).toMatch(/WhatsApp/);
  });

  it('identifica la cita por médico y hora, que es su clave en el HIS', async () => {
    const { driver, requests } = conDriver();
    await driver.cancelAppointment(eventoCancel());

    const copia = sqlDe(requests, /INSERT INTO dbo\.CITAS_ANULADAS/)! as any;
    expect(copia.params.med).toBe('91-1');
    expect(copia.params.hora).toBe('2026/09/03 07:00');
  });

  it('si la cita ya no está, es éxito: reintentar no cambiaría nada', async () => {
    // O el hospital ya la canceló por su lado, o nunca llegó a escribirse. En
    // los dos casos el resultado deseado ya se cumple.
    const { driver, tx } = conDriver({ filasAnuladas: 0 });

    const r = await driver.cancelAppointment(eventoCancel());

    expect(r.success).toBe(true);
    expect(r.message).toMatch(/ya no existía/);
    expect(tx.committed).toBe(false);
    expect(tx.rolledBack).toBe(true);
  });

  it('sin médico u hora no toca la base', async () => {
    const { driver, requests } = conDriver();

    const r = await driver.cancelAppointment(
      eventoCancel({ startTimeIso: undefined }),
    );

    expect(r.success).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe('rescheduleAppointment', () => {
  const eventoResched = () => ({
    ...evento({
      startTimeIso: '2026-09-03T13:00:00.000Z', // nuevo: 08:00 Bogotá
      endTimeIso: '2026-09-03T13:20:00.000Z',
      previousStartTimeIso: '2026-09-03T12:20:00.000Z', // anterior: 07:20
      previousDoctorExternalKey: '76',
    }),
    op: 'UPDATE' as const,
  });

  it('anula el cupo ANTERIOR y crea el nuevo', async () => {
    const { driver, requests } = conDriver();

    const r = await driver.rescheduleAppointment(eventoResched());

    expect(r.success).toBe(true);
    const anulada = sqlDe(requests, /INSERT INTO dbo\.CITAS_ANULADAS/)! as any;
    expect(anulada.params.med).toBe('76'); // el médico ANTERIOR
    expect(anulada.params.hora).toBe('2026/09/03 07:20'); // la hora ANTERIOR
    expect(insertDeCita(requests)!.hora).toBe('2026/09/03 08:00'); // la nueva
  });

  it('la observación distingue reagendar de cancelar', async () => {
    // Sin esto, cada cambio de hora sumaría una anulación y le inflaría al
    // hospital su tasa de cancelación, que hoy es del 8-9%.
    const { driver, requests } = conDriver();
    await driver.rescheduleAppointment(eventoResched());

    const anulada = sqlDe(requests, /INSERT INTO dbo\.CITAS_ANULADAS/)! as any;
    expect(anulada.params.obse).toMatch(/Reagendada/);
  });

  it('sin el cupo anterior NO borra nada: no adivina cuál era', async () => {
    const { driver, requests } = conDriver();

    const r = await driver.rescheduleAppointment({
      ...evento(),
      op: 'UPDATE' as const,
    });

    expect(r.success).toBe(false);
    expect(r.message).toMatch(/cupo anterior/);
    expect(requests).toHaveLength(0);
  });

  it('el alta nueva reusa createAppointment: mismas reglas de convenio', async () => {
    const { driver, requests } = conDriver();
    await driver.rescheduleAppointment({
      ...eventoResched(),
      payload: {
        ...eventoResched().payload,
        epsNit: '900156264',
        patientRegime: 'CONTRIBUTIVO',
      },
    });

    expect(insertDeCita(requests)!.conv).toBe(473);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// detectChanges — instantánea diferencial.
//
// Es la pieza que evita la sobreventa: si el hospital vende un cupo por su
// lado y AgenIA no se entera, el chatbot lo sigue ofreciendo. Un fallo aquí
// no da error, solo silencio, así que se prueba caso por caso.
// ══════════════════════════════════════════════════════════════════════════
const filaHis = (over: Record<string, unknown> = {}) => ({
  med: '76',
  hora: '2026/09/03 07:00',
  estado: 0,
  servicio: 'S39141-1',
  hist: '9696544',
  dura: 20,
  descripcion: '',
  ...over,
});

const conCitas = (filas: Record<string, unknown>[]) => {
  const driver = new CntSanVicenteAnsermaDriver();
  const pool: any = {
    request: () => {
      const req: any = {
        input: () => req,
        async query() {
          return { recordset: filas };
        },
      };
      return req;
    },
  };
  driver.useConnection(pool, MAPPING);
  return driver;
};

describe('detectChanges', () => {
  it('la PRIMERA lectura no emite nada: solo toma la línea base', async () => {
    // Sin instantánea previa no se sabe qué cambió. Reportar todo como nuevo
    // duplicaría la agenda entera del hospital dentro de AgenIA.
    const driver = conCitas([filaHis()]);

    const r = await driver.detectChanges(null);

    expect(r.events).toHaveLength(0);
    expect(Object.keys(r.nextCursor as any)).toEqual(['76|2026/09/03 07:00']);
  });

  it('sin cambios entre dos lecturas, no emite nada', async () => {
    const driver = conCitas([filaHis()]);
    const base = await driver.detectChanges(null);

    const r = await driver.detectChanges(base.nextCursor);

    expect(r.events).toHaveLength(0);
  });

  it('una cita NUEVA del hospital se reporta como alta', async () => {
    const driver = conCitas([filaHis(), filaHis({ hora: '2026/09/03 09:00' })]);

    const r = await driver.detectChanges({ '76|2026/09/03 07:00': { e: 0, s: null, h: null, d: null, propia: false } } as any);

    expect(r.events).toHaveLength(1);
    expect(r.events[0].op).toBe('INSERT');
    expect(r.events[0].payload.startTimeIso).toBe('2026-09-03T14:00:00.000Z');
  });

  it('una cita que DESAPARECE es una cancelación', async () => {
    // Cancelar borra la fila de CITAS_MEDICAS: no hay estado que consultar,
    // solo la ausencia.
    const driver = conCitas([]);

    const r = await driver.detectChanges({
      '76|2026/09/03 07:00': { e: 0, s: 'S39141-1', h: '9696544', d: 20, propia: false },
    } as any);

    expect(r.events).toHaveLength(1);
    expect(r.events[0].op).toBe('CANCEL');
    expect(r.events[0].payload.doctorExternalKey).toBe('76');
  });

  it('un cambio de estado es un desenlace de atención', async () => {
    const driver = conCitas([filaHis({ estado: 1 })]);

    const r = await driver.detectChanges({
      '76|2026/09/03 07:00': { e: 0, s: null, h: null, d: null, propia: false },
    } as any);

    expect(r.events[0].op).toBe('ATTENDANCE');
    expect(r.events[0].payload.attendanceStatus).toBe('1');
  });

  // 🔁 ANTI-ECO: sin esto, cada cita que el agente escribe volvería como
  // "alta del hospital" en la siguiente vuelta, y AgenIA la aplicaría sobre
  // sí misma en bucle.
  it('una cita que escribió el propio agente NO se reporta como alta', async () => {
    const driver = conCitas([filaHis({ descripcion: 'ASIGNADA POR WHATSAPP' })]);

    const r = await driver.detectChanges({} as any);

    expect(r.events).toHaveLength(0);
  });

  it('...pero SÍ entra a la instantánea, para detectar si el hospital la cancela', async () => {
    const driver = conCitas([filaHis({ descripcion: 'ASIGNADA POR WHATSAPP' })]);
    const base = await driver.detectChanges({} as any);

    // El hospital la cancela: desaparece.
    const vacio = conCitas([]);
    const r = await vacio.detectChanges(base.nextCursor);

    expect(r.events).toHaveLength(1);
    expect(r.events[0].op).toBe('CANCEL');
  });

  it('el eventId es estable para la misma observación (idempotencia)', async () => {
    const driver = conCitas([filaHis({ hora: '2026/09/03 09:00' })]);
    const previo = {} as any;

    const a = await driver.detectChanges(previo);
    const b = await driver.detectChanges(previo);

    expect(a.events[0].eventId).toBe(b.events[0].eventId);
  });

  it('reporta varios cambios de distinto tipo en la misma vuelta', async () => {
    const driver = conCitas([
      filaHis({ hora: '2026/09/03 09:00' }), // nueva
      filaHis({ hora: '2026/09/03 10:00', estado: 1 }), // cambió estado
    ]);

    const r = await driver.detectChanges({
      '76|2026/09/03 10:00': { e: 0, s: null, h: null, d: null, propia: false },
      '76|2026/09/03 11:00': { e: 0, s: null, h: null, d: null, propia: false }, // desapareció
    } as any);

    expect(r.events.map((e) => e.op).sort()).toEqual([
      'ATTENDANCE',
      'CANCEL',
      'INSERT',
    ]);
  });
});
