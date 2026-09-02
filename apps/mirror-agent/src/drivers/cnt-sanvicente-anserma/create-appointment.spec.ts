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
  const tx = {
    begun: false,
    committed: false,
    rolledBack: false,
    /** Cuántas escrituras se habían hecho ya cuando se confirmó. */
    escriturasAlConfirmar: -1,
  };

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
        tx.escriturasAlConfirmar = requests.length;
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

  it('la fecha va como literal YYYYMMDD, no como Date', async () => {
    // `FE_FECH_CIT` es una fecha SIN ZONA y el hospital la guarda a
    // medianoche. Un `Date` de JS es un instante y `mssql` lo serializa en
    // UTC: desde la VM (America/Bogota) llegaba `2026-09-03 05:00:00`, la
    // fecha correcta con cinco horas que ninguna fila suya tiene. Cualquier
    // consulta de su aplicación que compare la fecha por igualdad exacta
    // dejaba de encontrar nuestras citas.
    const { driver, requests } = conDriver();
    await driver.createAppointment(evento());

    const fecha = insertDeCita(requests)!.fecha;
    expect(fecha).toBe('20260903');
    expect(fecha).not.toBeInstanceOf(Date);
  });

  it('la fecha escrita no depende de la zona horaria del proceso', async () => {
    // El defecto de fondo: el MISMO código escribía `05:00` en la VM y
    // `00:00` en un contenedor sin TZ. Un dato del hospital no puede depender
    // de dónde corra el agente.
    const tz = process.env.TZ;
    const fechaCon = async (zona: string) => {
      process.env.TZ = zona;
      const { driver, requests } = conDriver();
      await driver.createAppointment(evento());
      return insertDeCita(requests)!.fecha;
    };

    try {
      expect(await fechaCon('America/Bogota')).toBe('20260903');
      expect(await fechaCon('UTC')).toBe('20260903');
      expect(await fechaCon('Asia/Tokyo')).toBe('20260903');
    } finally {
      process.env.TZ = tz;
    }
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

// ══════════════════════════════════════════════════════════════════════════
// 🚨 CITAS_ANULADAS NO es CITAS_MEDICAS con el sufijo cambiado. Le faltan
// cuatro columnas que la cita sí tiene, y el driver las nombraba: en el
// hospital ese INSERT fallaba con "Invalid column name" (error 207) y con él
// TODA cancelación — el paciente recibía "cancelada" por WhatsApp y el
// hospital se quedaba con la cita. Localmente pasaba porque el mock se había
// construido creyendo esa equivalencia y las había inventado.
//
// Esquema real confirmado en el bloque 28 (esquema-real.tsv).
// ══════════════════════════════════════════════════════════════════════════
describe('cancelAppointment — solo columnas que CITAS_ANULADAS tiene', () => {
  const INEXISTENTES = [
    'NU_ESTA_CIAN',
    'CD_CODI_CECO_CIAN',
    'CD_CODI_LUAT_CIAN',
    'FE_SOLI_CIAN',
  ];

  const sqlDeAnulacion = async () => {
    const { driver, requests } = conDriver();
    await driver.cancelAppointment({ ...evento(), op: 'CANCEL' });
    return requests.find((r) => /INSERT INTO dbo\.CITAS_ANULADAS/.test(r.sql))!.sql;
  };

  it.each(INEXISTENTES)('no nombra %s: no existe en el hospital', async (col) => {
    expect(await sqlDeAnulacion()).not.toContain(col);
  });

  it('sí archiva las columnas propias de la anulación', async () => {
    const sql = await sqlDeAnulacion();

    expect(sql).toContain('CD_CODI_MOTI_CIAN');
    expect(sql).toContain('TX_OBSE_CIAN');
  });

  it('conserva el resto de la cita en el archivo', async () => {
    // Es una tabla de auditoría: lo que no se copie, se pierde.
    const sql = await sqlDeAnulacion();

    for (const col of [
      'CD_CODI_MED_CIAN',
      'FE_HORA_CIAN',
      'NU_HIST_PAC_CIAN',
      'NU_NUME_CONV_CIAN',
      'DE_DESC_CIAN',
    ]) {
      expect(sql).toContain(col);
    }
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

  it('solo toca la fila VIVA (estado 0): un médico+hora puede tener también una ya atendida', async () => {
    // La PK es (médico, hora, ESTADO): el desenlace de atención libera la
    // tupla (médico, hora, 0) con un UPDATE en sitio, y esa hora se puede
    // volver a agendar — coexisten entonces dos filas reales para el mismo
    // médico+hora. Sin filtrar por estado, cancelar la cita nueva copiaba Y
    // BORRABA también la ya atendida: un paciente atendido desaparecía de la
    // historia del hospital por la cancelación de otro.
    const { driver, requests } = conDriver();
    await driver.cancelAppointment(eventoCancel());

    const copia = sqlDe(requests, /INSERT INTO dbo\.CITAS_ANULADAS/)!;
    const borra = sqlDe(requests, /DELETE FROM dbo\.CITAS_MEDICAS/)!;
    expect(copia.sql).toMatch(/NU_ESTA_CIT\s*=\s*0/);
    expect(borra.sql).toMatch(/NU_ESTA_CIT\s*=\s*0/);
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

  // ══════════════════════════════════════════════════════════════════════
  // Reagendar es MOVER, y mover es una sola cosa o ninguna.
  //
  // Antes la anulación hacía `commit` y solo DESPUÉS se intentaba el alta,
  // fuera de la transacción. Si el alta fallaba, el paciente se quedaba sin
  // NINGUNA cita —la vieja borrada, la nueva nunca escrita— mientras AgenIA
  // creía haberla movido. Ninguna de las pruebas de arriba lo detectaba:
  // todas miran el camino feliz.
  // ══════════════════════════════════════════════════════════════════════
  it('si el médico no tiene turno el día nuevo, la cita anterior NO se borra', async () => {
    const { driver, requests, tx } = conDriver({ turno: null });

    const r = await driver.rescheduleAppointment(eventoResched());

    expect(r.success).toBe(false);
    expect(r.message).toMatch(/la cita anterior sigue en pie/);
    expect(tx.rolledBack).toBe(true);
    expect(tx.committed).toBe(false);
    // Y no queda ninguna cita nueva a medias.
    expect(insertDeCita(requests)).toBeUndefined();
  });

  it('si el cupo nuevo ya está vendido en el HIS, tampoco se pierde la anterior', async () => {
    // Colisión de PK: el hospital vendió ese cupo entre que AgenIA lo ofreció
    // y el agente llegó a escribirlo. Es el caso más probable de todos.
    const { driver, tx } = conDriver({ error: { number: 2627 } });

    const r = await driver.rescheduleAppointment(eventoResched());

    expect(r.success).toBe(false);
    expect(r.message).toMatch(/ya está ocupado/);
    expect(tx.rolledBack).toBe(true);
    expect(tx.committed).toBe(false);
  });

  it('anulación y alta viajan en la MISMA transacción, y se confirma una sola vez', async () => {
    const { driver, requests, tx } = conDriver();

    await driver.rescheduleAppointment(eventoResched());

    const iAlta = requests.findIndex((r) =>
      /INSERT INTO dbo\.CITAS_MEDICAS/.test(r.sql),
    );
    expect(sqlDe(requests, /INSERT INTO dbo\.CITAS_ANULADAS/)).toBeDefined();
    expect(iAlta).toBeGreaterThanOrEqual(0);
    expect(tx.begun).toBe(true);
    expect(tx.committed).toBe(true);
    expect(tx.rolledBack).toBe(false);
    // Lo que de verdad distingue el arreglo del defecto: el commit vino
    // DESPUÉS del alta, no antes. Con el código anterior se confirmaba la
    // anulación y solo entonces se intentaba escribir la cita nueva.
    expect(tx.escriturasAlConfirmar).toBeGreaterThan(iAlta);
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
const filaHis = (over: Record<string, unknown> = {}) => {
  const fila = {
    med: '76',
    hora: '2026/09/03 07:00',
    estado: 0,
    servicio: 'S39141-1',
    hist: '9696544',
    dura: 20,
    descripcion: '',
    ...over,
  };
  // `fecha` es FE_FECH_CIT en fecha local: lo que el driver usa para saber si
  // una fila está dentro de la ventana. Se deriva de la hora salvo que la
  // prueba la fije aparte.
  return { fecha: String(fila.hora).slice(0, 10).replace(/\//g, '-'), ...fila };
};

const conCitasEspiadas = (filas: Record<string, unknown>[]) => {
  const requests: { params: Record<string, unknown>; sql: string }[] = [];
  const driver = new CntSanVicenteAnsermaDriver();
  const pool: any = {
    request: () => {
      const params: Record<string, unknown> = {};
      const req: any = {
        input(nombre: string, _tipo: unknown, valor: unknown) {
          params[nombre] = valor;
          return req;
        },
        async query(sqlText: string) {
          requests.push({ params, sql: sqlText });
          return { recordset: filas };
        },
      };
      return req;
    },
  };
  driver.useConnection(pool, MAPPING);
  return { driver, requests };
};

const conCitas = (filas: Record<string, unknown>[]) =>
  conCitasEspiadas(filas).driver;

// Reloj congelado: la ventana de vigilancia se calcula desde "ahora", así que
// sin esto las pruebas caducarían solas a los 90 días.
const AHORA = '2026-09-01T15:00:00.000Z'; // 10:00 en Bogotá
const VENTANA = { desde: '2026-09-01', hasta: '2026-11-30' }; // +90 días

/** Una foto previa con la forma que persiste el agente. */
const foto = (
  filas: Record<string, Partial<Record<string, unknown>>>,
  ventana: { desde: string; hasta: string } | null = VENTANA,
) => ({
  ...(ventana ? { ventana } : {}),
  filas: Object.fromEntries(
    Object.entries(filas).map(([clave, campos]) => [
      clave,
      {
        e: 0,
        s: null,
        h: null,
        d: null,
        propia: false,
        // Por defecto, la fecha de la propia clave `${médico}|${hora}`.
        f: clave.slice(clave.indexOf('|') + 1).slice(0, 10).replace(/\//g, '-'),
        ...campos,
      },
    ]),
  ),
});

describe('detectChanges', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(AHORA) });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('la PRIMERA lectura no emite nada: solo toma la línea base', async () => {
    // Sin instantánea previa no se sabe qué cambió. Reportar todo como nuevo
    // duplicaría la agenda entera del hospital dentro de AgenIA.
    const driver = conCitas([filaHis()]);

    const r = await driver.detectChanges(null);

    expect(r.events).toHaveLength(0);
    expect(Object.keys((r.nextCursor as any).filas)).toEqual([
      '76|2026/09/03 07:00',
    ]);
  });

  it('sin cambios entre dos lecturas, no emite nada', async () => {
    const driver = conCitas([filaHis()]);
    const base = await driver.detectChanges(null);

    const r = await driver.detectChanges(base.nextCursor);

    expect(r.events).toHaveLength(0);
  });

  it('una cita NUEVA del hospital se reporta como alta', async () => {
    const driver = conCitas([filaHis(), filaHis({ hora: '2026/09/03 09:00' })]);

    const r = await driver.detectChanges(
      foto({ '76|2026/09/03 07:00': {} }) as any,
    );

    expect(r.events).toHaveLength(1);
    expect(r.events[0].op).toBe('INSERT');
    expect(r.events[0].payload.startTimeIso).toBe('2026-09-03T14:00:00.000Z');
  });

  it('una cita que DESAPARECE es una cancelación', async () => {
    // Cancelar borra la fila de CITAS_MEDICAS: no hay estado que consultar,
    // solo la ausencia.
    const driver = conCitas([]);

    const r = await driver.detectChanges(
      foto({
        '76|2026/09/03 07:00': { s: 'S39141-1', h: '9696544', d: 20 },
      }) as any,
    );

    expect(r.events).toHaveLength(1);
    expect(r.events[0].op).toBe('CANCEL');
    expect(r.events[0].payload.doctorExternalKey).toBe('76');
  });

  it('un cambio de estado es un desenlace de atención', async () => {
    const driver = conCitas([filaHis({ estado: 1 })]);

    const r = await driver.detectChanges(
      foto({ '76|2026/09/03 07:00': {} }) as any,
    );

    expect(r.events[0].op).toBe('ATTENDANCE');
    // 🌐 Traducido al vocabulario de AgenIA, no el código crudo del HIS.
    // Esta prueba afirmaba `'1'` — el valor que el driver mandaba y que
    // `Appointment.attendanceStatus` (enum de Prisma) nunca podría aceptar.
    expect(r.events[0].payload.attendanceStatus).toBe('ATTENDED');
  });

  it('el estado 2, cuyo significado nadie confirmó, NO se reporta', async () => {
    // MAPEO_HIS.md §2.1 lo llama "el raro" y deja su disparador sin
    // descubrir. Inventarle una asistencia a un paciente es peor que no
    // escribirla — y el no-show real ni siquiera pasa por aquí: llega como
    // cancelación con motivo NA.
    const avisos = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const driver = conCitas([filaHis({ estado: 2 })]);

    const r = await driver.detectChanges(
      foto({ '76|2026/09/03 07:00': {} }) as any,
    );

    expect(r.events).toEqual([]);
    expect(avisos).toHaveBeenCalledWith(expect.stringMatching(/sin significado confirmado/));
    avisos.mockRestore();
  });

  // 🔁 ANTI-ECO: sin esto, cada cita que el agente escribe volvería como
  // "alta del hospital" en la siguiente vuelta, y AgenIA la aplicaría sobre
  // sí misma en bucle.
  it('una cita que escribió el propio agente NO se reporta como alta', async () => {
    const driver = conCitas([filaHis({ descripcion: 'ASIGNADA POR WHATSAPP' })]);

    const r = await driver.detectChanges(foto({}) as any);

    expect(r.events).toHaveLength(0);
  });

  it('...pero SÍ entra a la instantánea, para detectar si el hospital la cancela', async () => {
    const driver = conCitas([filaHis({ descripcion: 'ASIGNADA POR WHATSAPP' })]);
    const base = await driver.detectChanges(foto({}) as any);

    // El hospital la cancela: desaparece.
    const vacio = conCitas([]);
    const r = await vacio.detectChanges(base.nextCursor);

    expect(r.events).toHaveLength(1);
    expect(r.events[0].op).toBe('CANCEL');
  });

  it('el eventId es estable para la misma observación (idempotencia)', async () => {
    const driver = conCitas([filaHis({ hora: '2026/09/03 09:00' })]);
    const previo = foto({}) as any;

    const a = await driver.detectChanges(previo);
    const b = await driver.detectChanges(previo);

    expect(a.events[0].eventId).toBe(b.events[0].eventId);
  });

  it('reporta varios cambios de distinto tipo en la misma vuelta', async () => {
    const driver = conCitas([
      filaHis({ hora: '2026/09/03 09:00' }), // nueva
      filaHis({ hora: '2026/09/03 10:00', estado: 1 }), // cambió estado
    ]);

    const r = await driver.detectChanges(
      foto({
        '76|2026/09/03 10:00': {},
        '76|2026/09/03 11:00': {}, // desapareció
      }) as any,
    );

    expect(r.events.map((e) => e.op).sort()).toEqual([
      'ATTENDANCE',
      'CANCEL',
      'INSERT',
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// La ventana de vigilancia.
//
// Aquí vivía el peor defecto del espejo: una ventana que se mueve hace
// desaparecer filas sin que nadie las toque, y eso se reportaba como
// cancelación. En AgenIA se traducía en citas canceladas a pacientes que las
// tenían, y en cupos revendidos que el HIS después rechazaba por PK.
//
// Ninguna de estas pruebas habría fallado antes por mirar el SQL: fallan por
// mirar el reloj.
// ══════════════════════════════════════════════════════════════════════════
describe('detectChanges — la ventana que se mueve', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(AHORA) });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('la ventana arranca HOY y se pide en fecha local, no como instante', async () => {
    // El filtro era `FE_FECH_CIT >= new Date()`, y mssql serializa el Date en
    // UTC: el día en curso quedaba SIEMPRE fuera, así que una cita que el
    // hospital cancelaba hoy para hoy no se detectaba nunca.
    const { driver, requests } = conCitasEspiadas([]);

    await driver.detectChanges(null);

    expect(requests[0].params.desde).toBe('20260901'); // hoy, incluido
    // Borde superior EXCLUSIVO: el día siguiente al +90, para que `< @hasta`
    // siga incluyendo el día 90 como lo hacía el BETWEEN.
    expect(requests[0].params.hasta).toBe('20261201');
    // 🔎 La consulta caliente: la columna SIN envolver, para que el índice que
    // el hospital tiene sobre FE_FECH_CIT (bloque 29a) se pueda usar sobre una
    // tabla de 1.084.093 filas.
    expect(requests[0].sql).toMatch(
      /FE_FECH_CIT >= @desde AND FE_FECH_CIT < @hasta/,
    );
  });

  it('a las 20:13 de Bogotá NO se cancela la agenda del día siguiente', async () => {
    // El caso real: a partir de las 19:00 locales, el borde de la ventana
    // llegaba al servidor ya en la fecha de mañana (20:13 en Bogotá viajaba
    // como `2026-09-02 01:13`), y toda la agenda del día siguiente salía de la
    // foto de golpe. Eran ~235 pacientes por noche.
    const manana = filaHis({ hora: '2026/09/02 08:00' });
    const base = await conCitas([manana]).detectChanges(null);

    jest.setSystemTime(new Date('2026-09-02T01:13:00.000Z')); // 20:13 en Bogotá
    const r = await conCitas([manana]).detectChanges(base.nextCursor);

    expect(r.events).toEqual([]);
  });

  it('al cambiar el día, la agenda de ayer no se reporta como cancelada', async () => {
    const ayer = filaHis({ hora: '2026/09/01 08:00' });
    const base = await conCitas([ayer]).detectChanges(null);

    // Un día después la cita ya no entra en la ventana: no está cancelada,
    // simplemente ya pasó.
    jest.setSystemTime(new Date('2026-09-02T15:00:00.000Z'));
    const r = await conCitas([]).detectChanges(base.nextCursor);

    expect(r.events).toEqual([]);
  });

  it('una cita que entra por el borde lejano no es un alta del hospital', async () => {
    // Existía desde antes; lo que cambió es hasta dónde miramos. Su cupo lo
    // cierra `fetchAvailability`, que sí barre esas fechas.
    // La ventana de hoy llega al 30/11; la de mañana, al 01/12.
    const lejana = filaHis({ hora: '2026/12/01 08:00' });
    const base = await conCitas([]).detectChanges(null);

    jest.setSystemTime(new Date('2026-09-02T15:00:00.000Z')); // la ventana avanza
    const r = await conCitas([lejana]).detectChanges(base.nextCursor);

    expect(r.events).toEqual([]);
  });

  it('dentro de la franja común, una cancelación de verdad SÍ se reporta', async () => {
    // El contrapunto imprescindible: si silenciar los bordes silenciara
    // también las cancelaciones reales, el arreglo sería peor que el defecto.
    const cita = filaHis({ hora: '2026/09/10 08:00' });
    const base = await conCitas([cita]).detectChanges(null);

    jest.setSystemTime(new Date('2026-09-02T15:00:00.000Z'));
    const r = await conCitas([]).detectChanges(base.nextCursor);

    expect(r.events.map((e) => e.op)).toEqual(['CANCEL']);
  });

  it('un cursor de la versión anterior no cancela nada en su primera vuelta', async () => {
    // Al desplegar esto, el `state.json` de la VM trae la forma vieja: filas
    // sueltas, sin ventana. Sin saber qué fechas cubría no se puede afirmar
    // que algo desapareció, y equivocarse aquí es cancelarle la cita a un
    // paciente. Las altas sí siguen: ocupan cupos, nunca los liberan.
    const cursorViejo = {
      '76|2026/09/10 08:00': { e: 0, s: null, h: null, d: null, propia: false },
    };

    const r = await conCitas([filaHis({ hora: '2026/09/11 09:00' })]).detectChanges(
      cursorViejo as any,
    );

    expect(r.events.map((e) => e.op)).toEqual(['INSERT']);
    expect((r.nextCursor as any).ventana).toEqual(VENTANA);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Dos filas para el mismo médico+hora.
//
// La PK de CITAS_MEDICAS es (médico, hora, ESTADO) — el estado integra la
// clave a propósito (MAPEO_HIS.md §1). El desenlace de atención LIBERA la
// tupla (médico, hora, 0) con un UPDATE en sitio, y nada impide que esa hora
// se agende de nuevo después: dos filas reales, vigentes las dos, mismo
// médico+hora, estados distintos.
//
// La clave del cursor sigue siendo `${médico}|${hora}` — y no
// `${médico}|${hora}|${estado}` — porque partir por estado rompería lo
// contrario: el desenlace de atención pasaría de verse como "cambió el
// estado de una fila" a verse como "una fila desapareció y otra apareció",
// es decir CANCEL + INSERT en vez de ATTENDANCE. Cada cita atendida se
// cancelaría sola en AgenIA. Lo que hacía falta no era otra clave: era dejar
// de resolver la colisión al azar, según el orden en que SQL Server
// devolviera las filas.
// ══════════════════════════════════════════════════════════════════════════
describe('detectChanges — dos filas para el mismo médico+hora', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(AHORA) });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('con una atendida y otra nueva en el mismo médico+hora, la nueva (estado 0) manda', async () => {
    const filas = [
      filaHis({ hora: '2026/09/10 08:00', estado: 1, hist: 'ATENDIDO' }),
      filaHis({ hora: '2026/09/10 08:00', estado: 0, hist: 'NUEVO' }),
    ];

    const r = await conCitas(filas).detectChanges(
      foto({ '76|2026/09/10 08:00': { e: 1, h: 'ATENDIDO' } }) as any,
    );

    // La fila elegida es la viva: si el motor tuviera que actuar sobre este
    // médico+hora (cancelarla, reagendarla), solo la de estado 0 es la que
    // puede tocar — la atendida ya es historia cerrada.
    const cursorFila = (r.nextCursor as any).filas['76|2026/09/10 08:00'];
    expect(cursorFila.e).toBe(0);
    expect(cursorFila.h).toBe('NUEVO');
  });

  it('el orden en que SQL Server devuelve las filas no cambia cuál se elige', async () => {
    const enOrden = [
      filaHis({ hora: '2026/09/10 08:00', estado: 0, hist: 'NUEVO' }),
      filaHis({ hora: '2026/09/10 08:00', estado: 1, hist: 'ATENDIDO' }),
    ];
    const invertido = [...enOrden].reverse();

    const previo = foto({}) as any;
    const a = await conCitas(enOrden).detectChanges(previo);
    const b = await conCitas(invertido).detectChanges(previo);

    expect((a.nextCursor as any).filas['76|2026/09/10 08:00'].h).toBe('NUEVO');
    expect((b.nextCursor as any).filas['76|2026/09/10 08:00'].h).toBe('NUEVO');
  });

  it('sin colisión, una única fila no dispara la resolución de empate', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await conCitas([filaHis({ hora: '2026/09/10 08:00' })]).detectChanges(null);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('una atención normal (una sola fila, 0→1) sigue siendo ATTENDANCE y no CANCEL+INSERT', async () => {
    // El contrapunto imprescindible: la clave sigue siendo médico+hora sin el
    // estado exactamente para proteger este caso, el común de los dos.
    const r = await conCitas([
      filaHis({ hora: '2026/09/10 08:00', estado: 1 }),
    ]).detectChanges(foto({ '76|2026/09/10 08:00': {} }) as any);

    expect(r.events.map((e) => e.op)).toEqual(['ATTENDANCE']);
  });
});
