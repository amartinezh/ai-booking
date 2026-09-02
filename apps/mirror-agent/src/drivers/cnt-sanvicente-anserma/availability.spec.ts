import { CntSanVicenteAnsermaDriver } from './index';
import type { AnsermaMapping } from './mapping';

// ══════════════════════════════════════════════════════════════════════════
// Fase 2. El HIS no guarda cupos libres: `CITAS_MEDICAS` solo tiene fila
// cuando hay cita. La disponibilidad vive en `TURNOS_MEDICOS` como bloques
// (07:00–12:00) que la aplicación del hospital divide. Si esta división no
// coincide con la suya, AgenIA ofrece horas que allí no existen.
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
  from: new Date('2026-09-03T00:00:00.000Z'),
  to: new Date('2026-09-04T00:00:00.000Z'),
};

function conDriver(
  turnos: unknown[],
  ocupadas: unknown[] = [],
  mapping: AnsermaMapping = MAPPING,
) {
  const sqls: string[] = [];
  const req: any = {
    input: () => req,
    async query(sql: string) {
      sqls.push(sql);
      if (/FROM dbo\.TURNOS_MEDICOS/.test(sql)) return { recordset: turnos };
      if (/FROM dbo\.CITAS_MEDICAS/.test(sql)) return { recordset: ocupadas };
      return { recordset: [] };
    },
  };
  const driver = new CntSanVicenteAnsermaDriver();
  driver.useConnection({ request: () => req } as never, mapping);
  return { driver, sqls };
}

const turno = (over: Record<string, unknown> = {}) => ({
  med: '91-1',
  fecha: '2026-09-03',
  hora_ini: '07:00',
  hora_fin: '12:00',
  ...over,
});

describe('fetchAvailability', () => {
  it('convierte un bloque de turno en la rejilla de cupos', async () => {
    const { driver } = conDriver([turno()]);

    const cupos = await driver.fetchAvailability(VENTANA);

    expect(cupos).toHaveLength(15); // 5 h / 20 min
    expect(cupos[0]).toEqual({
      doctorExternalKey: '91-1',
      // 07:00 en Bogotá = 12:00 UTC.
      startTimeIso: '2026-09-03T12:00:00.000Z',
      endTimeIso: '2026-09-03T12:20:00.000Z',
      occupied: false,
    });
  });

  it('marca ocupado lo que el hospital ya vendió', async () => {
    const { driver } = conDriver(
      [turno()],
      [{ med: '91-1', hora: '2026/09/03 07:20' }],
    );

    const cupos = await driver.fetchAvailability(VENTANA);

    expect(cupos[0].occupied).toBe(false);
    expect(cupos[1].occupied).toBe(true); // 07:20
  });

  it('la ocupación viaja EN el mismo cupo, no en un segundo viaje', async () => {
    // Entre traer la rejilla y marcar lo ocupado cabría una ventana en la que
    // AgenIA ofrecería una hora recién vendida.
    const { driver } = conDriver([turno()]);

    const cupos = await driver.fetchAvailability(VENTANA);

    expect(cupos.every((c) => typeof c.occupied === 'boolean')).toBe(true);
  });

  it('la cita de OTRO médico a la misma hora no ocupa este cupo', async () => {
    const { driver } = conDriver(
      [turno()],
      [{ med: '76', hora: '2026/09/03 07:00' }],
    );

    expect((await driver.fetchAvailability(VENTANA))[0].occupied).toBe(false);
  });

  it('ignora los turnos no vigentes en la propia consulta', async () => {
    // `NU_TIPO_TUME <> 0` es histórico (bloque 20e) e `ID_DISP_TUME = '0'` es
    // un turno dado de baja: filtrarlos en SQL evita traerse la agenda entera
    // del hospital para descartarla en memoria.
    const { driver, sqls } = conDriver([]);
    await driver.fetchAvailability(VENTANA);
    const consultaTurnos = sqls.find((s) => /TURNOS_MEDICOS/.test(s))!;

    expect(consultaTurnos).toMatch(/NU_TIPO_TUME, 0\) = 0/);
    expect(consultaTurnos).toMatch(/ID_DISP_TUME, '1'\) = '1'/);
  });

  it('varios médicos en el mismo día salen todos', async () => {
    const { driver } = conDriver([
      turno({ med: '91-1' }),
      turno({ med: '76', hora_fin: '09:00' }),
    ]);

    const cupos = await driver.fetchAvailability(VENTANA);

    expect(cupos.filter((c) => c.doctorExternalKey === '91-1')).toHaveLength(15);
    expect(cupos.filter((c) => c.doctorExternalKey === '76')).toHaveLength(6);
  });

  it('un médico puede atender cada 30 minutos sin tocar código', async () => {
    // `TURNOS_MEDICOS` no lleva servicio, así que la duración se ajusta por
    // médico desde `mappingJson`: una fila, no un despliegue.
    const { driver } = conDriver([turno()], [], {
      ...MAPPING,
      duracionPorMedico: { '91-1': 30 },
    });

    expect(await driver.fetchAvailability(VENTANA)).toHaveLength(10);
  });

  // ════════════════════════════════════════════════════════════════════════
  // La ventana viaja en UTC; `FE_FECH_TUME` es una fecha LOCAL sin zona. Un
  // día de Bogotá va de las 05:00Z a las 05:00Z siguientes, así que filtrar
  // una con la otra desplazaba el resultado un día entero: los cupos salían
  // fuera de la ventana que el servidor estaba podando y cada vuelta creaba y
  // borraba lo mismo. Lo destapó la primera pasada en modo sombra.
  // ════════════════════════════════════════════════════════════════════════
  describe('la ventana en UTC contra fechas locales del HIS', () => {
    const VENTANA_LOCAL = {
      // El "día 2026-09-03" en Bogotá.
      from: new Date('2026-09-03T05:00:00.000Z'),
      to: new Date('2026-09-04T05:00:00.000Z'),
    };

    it('consulta los turnos por fecha local, no por instante UTC', async () => {
      const { driver, sqls } = conDriver([]);

      await driver.fetchAvailability(VENTANA_LOCAL);

      const consulta = sqls.find((q) => /TURNOS_MEDICOS/.test(q))!;
      expect(consulta).toMatch(/CONVERT\(varchar\(10\), FE_FECH_TUME, 23\) BETWEEN/);
    });

    it('el turno del día cae en SU día, no en el anterior', async () => {
      const { driver } = conDriver([turno({ fecha: '2026-09-03' })]);

      const cupos = await driver.fetchAvailability(VENTANA_LOCAL);

      expect(cupos).toHaveLength(15);
      expect(cupos[0].startTimeIso).toBe('2026-09-03T12:00:00.000Z');
    });

    it('descarta los cupos que se salen de la ventana pedida', async () => {
      // La consulta por fecha local trae el turno entero aunque solo parte de
      // él caiga dentro; devolver lo de fuera haría que el servidor cree algo
      // que la pasada siguiente borra.
      const { driver } = conDriver([
        turno({ fecha: '2026-09-03', hora_ini: '07:00', hora_fin: '12:00' }),
      ]);

      const cupos = await driver.fetchAvailability({
        from: new Date('2026-09-03T12:00:00.000Z'), // 07:00 local
        to: new Date('2026-09-03T13:00:00.000Z'), // 08:00 local
      });

      expect(cupos.map((c) => c.startTimeIso)).toEqual([
        '2026-09-03T12:00:00.000Z',
        '2026-09-03T12:20:00.000Z',
        '2026-09-03T12:40:00.000Z',
      ]);
    });
  });

  it('un día sin turnos devuelve vacío, no falla', async () => {
    const { driver } = conDriver([]);

    expect(await driver.fetchAvailability(VENTANA)).toEqual([]);
  });

  it('sin conexión falla en vez de devolver una agenda vacía', async () => {
    // Subir [] tras un fallo borraría la agenda de ese día en AgenIA.
    await expect(
      new CntSanVicenteAnsermaDriver().fetchAvailability(VENTANA),
    ).rejects.toThrow();
  });
});
