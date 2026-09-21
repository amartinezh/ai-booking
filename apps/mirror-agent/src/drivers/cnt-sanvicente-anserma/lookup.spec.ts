import { LIMITES_CONSULTA_HIS } from '@agenia/shared';
import type { HisLookupRequestDto } from '@agenia/shared';
import { CntSanVicenteAnsermaDriver } from './index';
import { consultarCitasEnVivo, estadoDeCitaHis } from './lookup';
import { isPatientLookupCapable } from '../../core/driver.interface';
import type { AnsermaMapping } from './mapping';

// ══════════════════════════════════════════════════════════════════════════
// Consulta en vivo al HIS (rastreo de paciente, Fase 2). Es SQL que corre contra
// la base PRODUCTIVA del hospital con un funcionario mirando la pantalla, así que
// se prueba valor a valor lo que sale hacia allá:
//
//   · solo lectura y con parámetros: nada de la petición entra al texto SQL;
//   · la columna de fecha va desnuda (el índice del hospital empieza por ella);
//   · una clave de médico que no cabe NO se recorta en silencio;
//   · tope de filas, y tope de tiempo que CANCELA la consulta en el servidor;
//   · un error del HIS es un error, jamás una lista vacía ("no tiene nada").
//
// Lo que estas pruebas NO pueden decir: cuánto cuesta la consulta por documento
// sobre el millón de filas reales. Eso se mide en el laboratorio del hospital
// antes de encender el interruptor (CONSULTA_EN_VIVO.md).
// ══════════════════════════════════════════════════════════════════════════

const TZ = 'America/Bogota';
// Medianoche BOGOTÁ (UTC-5), no medianoche UTC.
const DESDE = '2026-09-01T05:00:00.000Z';
const HASTA = '2026-12-01T05:00:00.000Z';
const INI = '2026-09-22T15:00:00.000Z'; // 10:00 en Bogotá

interface Consulta {
  texto: string;
  params: Record<string, { tipo: { length?: number }; valor: unknown }>;
}

/** Pool falso: registra cada consulta y contesta con las filas indicadas, una lista por consulta. */
function conPool(respuestas: unknown[][] | Error = [[]]) {
  const consultas: Consulta[] = [];
  const estado = { cancelaciones: 0, solicitudes: 0 };
  const pool = {
    request() {
      estado.solicitudes++;
      const params: Consulta['params'] = {};
      const req: any = {
        input(nombre: string, tipo: { length?: number }, valor: unknown) {
          params[nombre] = { tipo, valor };
          return req;
        },
        cancel() {
          estado.cancelaciones++;
        },
        async query(texto: string) {
          consultas.push({ texto, params });
          if (respuestas instanceof Error) throw respuestas;
          const i = Math.min(consultas.length - 1, respuestas.length - 1);
          return { recordset: respuestas[i] };
        },
      };
      return req;
    },
  };
  return { pool: pool as never, consultas, estado };
}

const fila = (over: Record<string, unknown> = {}) => ({
  med: '76',
  hora: '2026/09/22 10:00',
  estado: 0,
  servicio: '890201',
  hist: '1088123456',
  ...over,
});

const porCupo = (
  slots: HisLookupRequestDto['slots'] = [
    { doctorExternalKey: '76', startTimeIso: INI },
  ],
): HisLookupRequestDto => ({ requestId: 'r-1', kind: 'BY_SLOT', slots });

const porDocumento = (
  over: Partial<HisLookupRequestDto> = {},
): HisLookupRequestDto => ({
  requestId: 'r-2',
  kind: 'BY_DOCUMENT',
  patientDocuments: ['1088123456'],
  fromIso: DESDE,
  toIso: HASTA,
  ...over,
});

describe('estadoDeCitaHis', () => {
  it.each([
    [0, 'SCHEDULED'],
    [1, 'ATTENDED'],
    [2, 'NO_SHOW'],
    [3, 'OTHER'],
    [null, 'OTHER'],
  ] as const)('NU_ESTA_CIT %s → %s', (estado, esperado) => {
    expect(estadoDeCitaHis(estado)).toBe(esperado);
  });
});

describe('consultarCitasEnVivo — por cupo', () => {
  it('pregunta con la hora LOCAL del HIS y el formato de su clave primaria', async () => {
    const { pool, consultas } = conPool();

    await consultarCitasEnVivo(pool, TZ, porCupo());

    // Dos: la del cupo y, porque vino vacío, la que comprueba si el HIS tiene ahí
    // filas con una hora que no se puede interpretar.
    expect(consultas).toHaveLength(2);
    // 15:00 UTC = 10:00 en Bogotá, con BARRAS y 16 caracteres.
    expect(consultas[0].params.hora.valor).toBe('2026/09/22 10:00');
    expect(consultas[0].params.med.valor).toBe('76');
  });

  it('un cupo OCUPADO no gasta la segunda consulta', async () => {
    const { pool, consultas } = conPool([[fila()]]);

    await consultarCitasEnVivo(pool, TZ, porCupo());

    expect(consultas).toHaveLength(1);
  });

  it('los parámetros tienen el tipo y el largo de las columnas', async () => {
    const { pool, consultas } = conPool();

    await consultarCitasEnVivo(pool, TZ, porCupo());

    expect(consultas[0].params.med.tipo.length).toBe(4);
    expect(consultas[0].params.hora.tipo.length).toBe(18);
  });

  it('busca por igualdad de médico y hora: un prefijo de la PK, no un scan', async () => {
    const { pool, consultas } = conPool();

    await consultarCitasEnVivo(pool, TZ, porCupo());

    expect(consultas[0].texto).toMatch(
      /CD_CODI_MED_CIT\s*=\s*@med\s+AND\s+FE_HORA_CIT\s*=\s*@hora/,
    );
  });

  it('🔒 solo lectura y sin valores en el texto SQL: todo va por parámetro', async () => {
    const { pool, consultas } = conPool();

    await consultarCitasEnVivo(pool, TZ, porCupo());

    const { texto } = consultas[0];
    expect(texto.trim()).toMatch(/^SELECT\b/);
    expect(texto).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|EXEC|MERGE|ALTER)\b/i,
    );
    expect(texto).not.toContain('76');
    expect(texto).not.toContain('2026');
  });

  it('acota la respuesta con TOP (parametrizado)', async () => {
    const { pool, consultas } = conPool();

    await consultarCitasEnVivo(pool, TZ, porCupo());

    expect(consultas[0].texto).toMatch(/SELECT\s+TOP\s*\(@tope\)/);
    expect(consultas[0].params.tope.valor).toBeGreaterThan(1);
  });

  it('devuelve la fila con la hora en UTC, el estado traducido y el documento tal cual', async () => {
    const { pool } = conPool([[fila()]]);

    const r = await consultarCitasEnVivo(pool, TZ, porCupo());

    expect(r).toEqual({
      appointments: [
        {
          doctorExternalKey: '76',
          startTimeIso: INI,
          serviceExternalKey: '890201',
          patientDocument: '1088123456',
          status: 'SCHEDULED',
        },
      ],
      truncated: false,
    });
  });

  it('un cupo con una cita atendida y otra vigente: trae las dos, cada una con su estado', async () => {
    const { pool } = conPool([[fila({ estado: 1 }), fila({ estado: 0 })]]);

    const r = await consultarCitasEnVivo(pool, TZ, porCupo());

    expect(r.appointments.map((a) => a.status)).toEqual([
      'ATTENDED',
      'SCHEDULED',
    ]);
  });

  it('cupo libre: lista vacía, sin marcar truncado (significa "no hay nada en el HIS")', async () => {
    const { pool } = conPool([[]]);

    await expect(consultarCitasEnVivo(pool, TZ, porCupo())).resolves.toEqual({
      appointments: [],
      truncated: false,
    });
  });

  it('una fila sin servicio ni documento no inventa ninguno', async () => {
    const { pool } = conPool([[fila({ servicio: null, hist: null })]]);

    const r = await consultarCitasEnVivo(pool, TZ, porCupo());

    expect(r.appointments[0].serviceExternalKey).toBeUndefined();
    expect(r.appointments[0].patientDocument).toBeNull();
  });

  it('una consulta por cupo, en orden, y junta lo que encuentra', async () => {
    const { pool, consultas } = conPool([
      [fila({ med: '76' })], // cupo 76: ocupado
      [], // cupo 80: vacío…
      [], // …y su comprobación de horas ilegibles, que tampoco encuentra nada
      [fila({ med: '91', hist: '52123456' })], // cupo 91: ocupado
    ]);

    const r = await consultarCitasEnVivo(
      pool,
      TZ,
      porCupo([
        { doctorExternalKey: '76', startTimeIso: INI },
        { doctorExternalKey: '80', startTimeIso: INI },
        { doctorExternalKey: '91', startTimeIso: INI },
      ]),
    );

    expect(consultas.map((c) => c.params.med.valor)).toEqual([
      '76',
      '80',
      '80',
      '91',
    ]);
    expect(r.appointments.map((a) => a.doctorExternalKey)).toEqual([
      '76',
      '91',
    ]);
  });

  // ══════════════════════════════════════════════════════════════════════
  // El hospital guarda parte de las horas en un formato que no cumple
  // 'YYYY/MM/DD HH:MM' (MAPEO_HIS.md §2.1). La consulta del cupo compara la hora
  // con `=`, así que esas filas NO coinciden y el cupo llega vacío: el servidor
  // concluía «el HIS no tiene ninguna cita en ese cupo», un falso negativo.
  // ══════════════════════════════════════════════════════════════════════
  describe('🚨 horas que el HIS guardó de forma ilegible', () => {
    /** Cupo vacío y, en la segunda consulta, dos filas de ese médico ese día. */
    const conIlegibles = () =>
      conPool([[], [fila({ hora: '2026/09/22 1' }), fila({ hora: '31' })]]);

    it('un cupo vacío se comprueba, y lo encontrado se DECLARA por cupo', async () => {
      const { pool } = conIlegibles();

      const r = await consultarCitasEnVivo(pool, TZ, porCupo());

      expect(r.appointments).toEqual([]);
      expect(r.unreadableSlots).toEqual([
        { doctorExternalKey: '76', startTimeIso: INI, count: 2 },
      ]);
    });

    it('NO se inventa la hora: solo se cuenta', async () => {
      const { pool } = conIlegibles();
      const r = await consultarCitasEnVivo(pool, TZ, porCupo());
      // Nada de '2026/09/22 1' ni de '31' se convierte en una cita.
      expect(r.appointments).toHaveLength(0);
      expect(JSON.stringify(r)).not.toContain('"31"');
    });

    it('la comprobación es un PREFIJO de la PK (médico + día), no un barrido', async () => {
      const { pool, consultas } = conIlegibles();

      await consultarCitasEnVivo(pool, TZ, porCupo());

      const c = consultas[1];
      expect(c.texto).toMatch(
        /CD_CODI_MED_CIT\s*=\s*@med\s+AND\s+FE_HORA_CIT\s+LIKE\s+@dia\s+AND\s+FE_HORA_CIT\s+NOT\s+LIKE\s+@patron/,
      );
      expect(c.params.dia.valor).toBe('2026/09/22%');
      expect(c.params.med.valor).toBe('76');
    });

    it('🔒 sigue siendo solo lectura y sin valores en el texto SQL', async () => {
      const { pool, consultas } = conIlegibles();

      await consultarCitasEnVivo(pool, TZ, porCupo());

      const { texto } = consultas[1];
      expect(texto.trim()).toMatch(/^SELECT\b/);
      expect(texto).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|DROP|EXEC|MERGE|ALTER)\b/i,
      );
      expect(texto).not.toContain('2026');
      expect(texto).not.toContain('76');
    });

    it('el patrón de hora legible viaja como parámetro, no en el texto', async () => {
      const { pool, consultas } = conIlegibles();
      await consultarCitasEnVivo(pool, TZ, porCupo());
      expect(consultas[1].params.patron.valor).toBe(
        '[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9] [0-9][0-9]:[0-9][0-9]',
      );
    });

    it('si no hay ninguna, el campo no se manda', async () => {
      const { pool } = conPool([[], []]);
      const r = await consultarCitasEnVivo(pool, TZ, porCupo());
      expect(r.unreadableSlots).toBeUndefined();
    });

    it('el tope de tiempo también cubre la comprobación', async () => {
      const { pool } = conIlegibles();
      await expect(
        consultarCitasEnVivo(pool, TZ, porCupo(), { timeoutMs: -1 }),
      ).rejects.toThrow(/tiempo máximo/);
    });
  });

  it('🚨 una clave de médico que NO CABE en la columna se rechaza antes de tocar el HIS', async () => {
    // Pasada como VarChar(4) se recortaría en silencio y se buscaría OTRO médico
    // (o ninguno, y "cupo libre" sería mentira).
    const { pool, estado } = conPool();

    await expect(
      consultarCitasEnVivo(
        pool,
        TZ,
        porCupo([
          { doctorExternalKey: '76', startTimeIso: INI },
          { doctorExternalKey: '12345', startTimeIso: INI },
        ]),
      ),
    ).rejects.toThrow(/no cabe en el HIS/);
    // Ni siquiera la primera, que sí era válida: se valida todo antes de empezar.
    expect(estado.solicitudes).toBe(0);
  });

  it('más filas que el tope por cupo: se recorta y se DECLARA', async () => {
    const muchas = Array.from({ length: 11 }, () => fila());
    const { pool } = conPool([muchas]);

    const r = await consultarCitasEnVivo(pool, TZ, porCupo());

    expect(r.appointments).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });
});

describe('consultarCitasEnVivo — por documento', () => {
  it('acota por FECHAS LOCALES con literal YYYYMMDD y el borde superior EXCLUSIVO', async () => {
    const { pool, consultas } = conPool();

    await consultarCitasEnVivo(pool, TZ, porDocumento());

    expect(consultas[0].params.desde.valor).toBe('20260901');
    // `toIso` cae el 1 de diciembre local: el borde exclusivo es el día siguiente.
    expect(consultas[0].params.hasta.valor).toBe('20261202');
    expect(consultas[0].params.desde.tipo.length).toBe(8);
  });

  it('🐢 la columna de fecha va DESNUDA: el índice del hospital empieza por ella', async () => {
    const { pool, consultas } = conPool();

    await consultarCitasEnVivo(pool, TZ, porDocumento());

    const { texto } = consultas[0];
    expect(texto).toMatch(
      /FE_FECH_CIT\s*>=\s*@desde\s+AND\s+FE_FECH_CIT\s*<\s*@hasta/,
    );
    // Envolverla en una función apaga el índice: scan de ~1.084.093 filas.
    expect(texto).not.toMatch(
      /\b(CONVERT|CAST|DATEDIFF|DATEPART|YEAR|MONTH|LTRIM|RTRIM)\s*\(/i,
    );
  });

  it('el documento y su variante sin ceros viajan por parámetro, nunca en el texto', async () => {
    const { pool, consultas } = conPool();

    await consultarCitasEnVivo(
      pool,
      TZ,
      porDocumento({ patientDocuments: ['0012345', '12345'] }),
    );

    const { texto, params } = consultas[0];
    expect(texto).toMatch(/NU_HIST_PAC_CIT\s+IN\s*\(@hist0,\s*@hist1\)/);
    expect(params.hist0.valor).toBe('0012345');
    expect(params.hist1.valor).toBe('12345');
    expect(params.hist0.tipo.length).toBe(20);
    expect(texto).not.toContain('12345');
  });

  it('un solo documento: una sola variable', async () => {
    const { pool, consultas } = conPool();

    await consultarCitasEnVivo(pool, TZ, porDocumento());

    expect(consultas[0].texto).toMatch(/IN\s*\(@hist0\)/);
    expect(consultas[0].params).not.toHaveProperty('hist1');
  });

  it('ordena por fecha y hora, para que un recorte deje las MÁS CERCANAS', async () => {
    const { pool, consultas } = conPool();

    await consultarCitasEnVivo(pool, TZ, porDocumento());

    expect(consultas[0].texto).toMatch(/ORDER BY\s+FE_FECH_CIT,\s*FE_HORA_CIT/);
  });

  it('pide una fila MÁS que el tope: es cómo se sabe que hubo recorte', async () => {
    const { pool, consultas } = conPool();

    await consultarCitasEnVivo(pool, TZ, porDocumento());

    expect(consultas[0].params.tope.valor).toBe(
      LIMITES_CONSULTA_HIS.maxFilas + 1,
    );
  });

  it('devuelve las citas del paciente con la hora en UTC', async () => {
    const { pool } = conPool([
      [
        fila({ hora: '2026/09/22 10:00' }),
        fila({ hora: '2026/10/05 07:00', estado: 2 }),
      ],
    ]);

    const r = await consultarCitasEnVivo(pool, TZ, porDocumento());

    expect(r.appointments.map((a) => [a.startTimeIso, a.status])).toEqual([
      [INI, 'SCHEDULED'],
      ['2026-10-05T12:00:00.000Z', 'NO_SHOW'],
    ]);
    expect(r.truncated).toBe(false);
  });

  it('filtro fino por INSTANTES: los bordes SQL son por día, la petición no', async () => {
    const { pool } = conPool([
      [
        fila({ hora: '2026/08/31 23:50' }), // un minuto antes de `fromIso` (00:00 local)
        fila({ hora: '2026/09/01 00:00' }), // justo en `fromIso`: entra
        fila({ hora: '2026/12/01 00:00' }), // justo en `toIso`: NO entra (exclusivo)
        fila({ hora: '2026/12/01 08:00' }), // después de `toIso`, aunque el día SQL lo incluya
      ],
    ]);

    const r = await consultarCitasEnVivo(pool, TZ, porDocumento());

    expect(r.appointments.map((a) => a.startTimeIso)).toEqual([
      '2026-09-01T05:00:00.000Z',
    ]);
  });

  it('una fila con la hora ilegible se omite y el resultado se marca INCOMPLETO', async () => {
    const { pool } = conPool([[fila({ hora: 'no es una hora' }), fila()]]);

    const r = await consultarCitasEnVivo(pool, TZ, porDocumento());

    expect(r.appointments).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });

  it('más filas que el tope: se recorta al tope y se DECLARA', async () => {
    const max = LIMITES_CONSULTA_HIS.maxFilas;
    const filas = Array.from({ length: max + 1 }, () => fila());
    const { pool } = conPool([filas]);

    const r = await consultarCitasEnVivo(pool, TZ, porDocumento());

    expect(r.appointments).toHaveLength(max);
    expect(r.truncated).toBe(true);
  });

  it('exactamente el tope: NO es un recorte', async () => {
    const max = LIMITES_CONSULTA_HIS.maxFilas;
    const { pool } = conPool([Array.from({ length: max }, () => fila())]);

    const r = await consultarCitasEnVivo(pool, TZ, porDocumento());

    expect(r.appointments).toHaveLength(max);
    expect(r.truncated).toBe(false);
  });

  it('sin filas: lista vacía y NO truncado ("el HIS no tiene citas de este documento")', async () => {
    const { pool } = conPool([[]]);

    await expect(
      consultarCitasEnVivo(pool, TZ, porDocumento()),
    ).resolves.toEqual({
      appointments: [],
      truncated: false,
    });
  });
});

describe('consultarCitasEnVivo — defensas', () => {
  it.each([
    [
      'un documento con inyección SQL',
      porDocumento({ patientDocuments: ["1'; DROP TABLE CITAS_MEDICAS;--"] }),
    ],
    ['una ventana invertida', porDocumento({ fromIso: HASTA, toIso: DESDE })],
    [
      'una ventana de más de lo permitido',
      porDocumento({ toIso: '2028-01-01T05:00:00.000Z' }),
    ],
    ['sin cupos', porCupo([])],
    ['un tipo desconocido', { requestId: 'x', kind: 'BY_NAME' } as never],
  ])('🔒 %s: se rechaza SIN tocar el HIS', async (_n, consulta) => {
    const { pool, estado } = conPool();

    await expect(consultarCitasEnVivo(pool, TZ, consulta)).rejects.toThrow(
      /Petición inválida/,
    );
    expect(estado.solicitudes).toBe(0);
  });

  it('🚨 un error del HIS se PROPAGA: nunca se convierte en una lista vacía', async () => {
    const { pool } = conPool(new Error('Login failed for user agenia_sync'));

    await expect(
      consultarCitasEnVivo(pool, TZ, porDocumento()),
    ).rejects.toThrow('Login failed');
    await expect(consultarCitasEnVivo(pool, TZ, porCupo())).rejects.toThrow(
      'Login failed',
    );
  });
});

describe('consultarCitasEnVivo — tope de tiempo', () => {
  /** Un pool cuyas consultas tardan `ms` (o nunca, con Infinity) y responden `filas`. */
  function poolLento(ms: number[], filas: unknown[] = []) {
    const estado = { cancelaciones: 0, consultas: 0 };
    const pool = {
      request() {
        const req: any = {
          input: () => req,
          cancel() {
            estado.cancelaciones++;
          },
          query() {
            const espera = ms[Math.min(estado.consultas++, ms.length - 1)];
            return new Promise((resolver) => {
              if (Number.isFinite(espera)) {
                setTimeout(() => resolver({ recordset: filas }), espera);
              }
            });
          },
        };
        return req;
      },
    };
    return { pool: pool as never, estado };
  }

  it('⏱ una consulta que no termina se CANCELA en el servidor y se reporta como error', async () => {
    const { pool, estado } = poolLento([Infinity]);

    await expect(
      consultarCitasEnVivo(pool, TZ, porCupo(), { timeoutMs: 30 }),
    ).rejects.toThrow(/tiempo máximo y se canceló/);
    // No basta con dejar de esperar: la consulta seguiría corriendo en la base.
    expect(estado.cancelaciones).toBe(1);
  });

  it('una consulta que termina a tiempo NO se cancela', async () => {
    const { pool, estado } = poolLento([1]);

    await consultarCitasEnVivo(pool, TZ, porCupo(), { timeoutMs: 500 });

    expect(estado.cancelaciones).toBe(0);
  });

  it('⏱ el tiempo es un PRESUPUESTO TOTAL, no por cupo: con diez cupos no se multiplica', async () => {
    // La primera tarda 40 ms de un presupuesto de 60; a la segunda le quedan ~20.
    const { pool, estado } = poolLento([40, Infinity]);

    await expect(
      consultarCitasEnVivo(
        pool,
        TZ,
        porCupo([
          { doctorExternalKey: '76', startTimeIso: INI },
          { doctorExternalKey: '80', startTimeIso: INI },
        ]),
        { timeoutMs: 60 },
      ),
    ).rejects.toThrow(/tiempo máximo/);
    expect(estado.cancelaciones).toBe(1);
    expect(estado.consultas).toBe(2);
  });

  it('con el presupuesto ya agotado ni siquiera LANZA la siguiente consulta', async () => {
    // Reloj controlado: la primera consulta responde al instante pero el reloj
    // ya pasó el límite cuando toca la segunda. Con tiempo real esto sería una
    // carrera; aquí es determinista.
    const ahora = jest.spyOn(Date, 'now');
    ahora
      .mockReturnValueOnce(1_000) // límite = 1_000 + 60 = 1_060
      .mockReturnValueOnce(1_010) // 1.ª consulta: quedan 50 ms
      .mockReturnValue(2_000); // 2.ª consulta: ya pasó el límite
    try {
      const { pool, consultas } = conPool([[fila()], [fila()]]);

      await expect(
        consultarCitasEnVivo(
          pool,
          TZ,
          porCupo([
            { doctorExternalKey: '76', startTimeIso: INI },
            { doctorExternalKey: '80', startTimeIso: INI },
          ]),
          { timeoutMs: 60 },
        ),
      ).rejects.toThrow('La consulta al HIS superó el tiempo máximo.');
      // La primera sí corrió; la segunda no llegó a salir hacia el hospital.
      expect(consultas).toHaveLength(1);
    } finally {
      ahora.mockRestore();
    }
  });

  it('el presupuesto por defecto es el de los límites compartidos, y menor que la espera de la pantalla', () => {
    expect(LIMITES_CONSULTA_HIS.timeoutHisMs).toBeLessThan(
      LIMITES_CONSULTA_HIS.esperaPantallaMs,
    );
  });
});

describe('CntSanVicenteAnsermaDriver — capacidad de consulta en vivo', () => {
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

  it('el driver de Anserma se reconoce como capaz', () => {
    expect(isPatientLookupCapable(new CntSanVicenteAnsermaDriver())).toBe(true);
  });

  it('un driver sin el método NO es capaz (capacidad opt-in)', () => {
    expect(isPatientLookupCapable({ key: 'otro' } as never)).toBe(false);
  });

  it('sin conexión al HIS, rechaza en vez de contestar vacío', async () => {
    await expect(
      new CntSanVicenteAnsermaDriver().lookupAppointments(porCupo()),
    ).rejects.toThrow(/no está conectado/);
  });

  it('con conexión, consulta con la zona del hospital', async () => {
    const { pool, consultas } = conPool([[fila()]]);
    const driver = new CntSanVicenteAnsermaDriver();
    driver.useConnection(pool, MAPPING);

    const r = await driver.lookupAppointments(porCupo());

    expect(consultas[0].params.hora.valor).toBe('2026/09/22 10:00');
    expect(r.appointments).toHaveLength(1);
  });
});
