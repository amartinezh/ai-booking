import { CntSanVicenteAnsermaDriver } from './index';
import type { AnsermaMapping } from './mapping';

// ══════════════════════════════════════════════════════════════════════════
// Alta en caliente (docs/PLAN_ALTA_EN_CALIENTE.md, D1): las citas NUEVAS del
// hospital viajan con el nombre y el teléfono del paciente, para que AgenIA
// pueda darlo de alta y mandarle el recordatorio.
//
// Lo que se fija aquí:
//  · se piden SOLO los pacientes de las altas de esta vuelta, por clave primaria;
//  · nunca se lee el teléfono del acompañante (es de un tercero);
//  · un fallo de esa consulta NO rompe la detección de cambios;
//  · un dato que el hospital guardó ilegible se omite, no se inventa.
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
  med: 'MDD2',
  hora: '2026/10/10 07:00',
  estado: 0,
  servicio: 'S39141',
  hist: '900010244',
  dura: 20,
  descripcion: null,
  fecha: '2026-10-10',
  elaborada: '2026-09-18 06:00:00.000',
  ...over,
});

const paciente = (over: Record<string, unknown> = {}) => ({
  hist: '900010244',
  nombre: 'MARIA',
  segNombre: 'LUCIA',
  apellido: 'LOPEZ',
  segApellido: 'NUÑEZ',
  telefono: ' 3001112233 ',
  naci: '1985-03-14',
  sexo: 0,
  ...over,
});

/**
 * Doble del pool que distingue las consultas por su texto, como haría el HIS: la de
 * `CITAS_MEDICAS` y la de `PACIENTES` devuelven cosas distintas.
 */
function conDriver(opts: {
  citas: unknown[][];
  pacientes?: unknown[];
  fallaPacientes?: boolean;
}) {
  const sqls: string[] = [];
  let vuelta = 0;
  const req: any = {
    input() {
      return req;
    },
    async query(texto: string) {
      sqls.push(texto);
      if (texto.includes('dbo.PACIENTES')) {
        if (opts.fallaPacientes)
          throw new Error('permiso denegado en PACIENTES');
        return { recordset: opts.pacientes ?? [] };
      }
      const recordset = opts.citas[vuelta] ?? [];
      vuelta++;
      return { recordset };
    },
  };
  const driver = new CntSanVicenteAnsermaDriver();
  driver.useConnection({ request: () => req } as never, MAPPING);
  const consultasDePacientes = () =>
    sqls.filter((s) => s.includes('dbo.PACIENTES'));
  return { driver, sqls, consultasDePacientes };
}

/** Primera vuelta: línea base (no emite nada). Segunda: los cambios. */
const dosVueltas = async (h: ReturnType<typeof conDriver>) => {
  const base = await h.driver.detectChanges(null);
  return h.driver.detectChanges(base.nextCursor);
};

describe('detectChanges — datos del paciente en las citas nuevas', () => {
  it('un alta viaja con nombre completo, teléfono, nacimiento y sexo del HIS', async () => {
    const h = conDriver({ citas: [[], [cita()]], pacientes: [paciente()] });

    const r = await dosVueltas(h);

    expect(r.events).toHaveLength(1);
    expect(r.events[0].op).toBe('INSERT');
    expect(r.events[0].payload).toMatchObject({
      patientDocument: '900010244',
      patientFullName: 'MARIA LUCIA LOPEZ NUÑEZ',
      // Sin normalizar: eso lo hace el servidor (y con los espacios quitados).
      patientPhone: '3001112233',
      patientBirthDateIso: '1985-03-14',
      // NU_SEXO_PAC 0 = F en este hospital (el camino inverso de mapSexo).
      patientGender: 'F',
    });
  });

  it('🔒 nunca lee el teléfono del acompañante', async () => {
    const h = conDriver({ citas: [[], [cita()]], pacientes: [paciente()] });
    await dosVueltas(h);
    expect(h.consultasDePacientes()[0]).toContain('DE_TELE_PAC');
    expect(h.consultasDePacientes()[0]).not.toContain('DE_TELE_ACOM_PAC');
  });

  it('pregunta por la CLAVE PRIMARIA y solo por los documentos de las altas', async () => {
    const h = conDriver({
      citas: [
        [],
        [
          cita(),
          cita({ med: 'MDD1', hora: '2026/10/10 08:00', hist: '900010999' }),
        ],
      ],
      pacientes: [paciente(), paciente({ hist: '900010999' })],
    });

    const r = await dosVueltas(h);

    expect(r.events).toHaveLength(2);
    const consulta = h.consultasDePacientes();
    expect(consulta).toHaveLength(1);
    expect(consulta[0]).toMatch(/WHERE NU_HIST_PAC IN \(@h0, @h1\)/);
  });

  it('el mismo documento en dos citas se pide UNA vez', async () => {
    const h = conDriver({
      citas: [[], [cita(), cita({ hora: '2026/10/10 09:00' })]],
      pacientes: [paciente()],
    });
    const r = await dosVueltas(h);
    expect(r.events).toHaveLength(2);
    expect(h.consultasDePacientes()[0]).toMatch(/IN \(@h0\)/);
    // Los dos eventos quedan completos con esa única fila.
    expect(r.events.map((e) => e.payload.patientPhone)).toEqual([
      '3001112233',
      '3001112233',
    ]);
  });

  it('⚡ sin altas no consulta nada: una cancelación o una asistencia no pagan el viaje', async () => {
    // Vuelta 1: línea base con la cita. Vuelta 2: desaparece → CANCEL.
    const h = conDriver({ citas: [[cita()], []], pacientes: [paciente()] });
    const r = await dosVueltas(h);
    expect(r.events.map((e) => e.op)).toEqual(['CANCEL']);
    expect(h.consultasDePacientes()).toHaveLength(0);
  });

  it('🛡️ si la consulta de pacientes falla, la vuelta sigue y el alta sale sin esos datos', async () => {
    const h = conDriver({ citas: [[], [cita()]], fallaPacientes: true });
    const aviso = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const r = await dosVueltas(h);

    expect(r.events).toHaveLength(1);
    expect(r.events[0].payload.patientDocument).toBe('900010244');
    expect(r.events[0].payload.patientPhone).toBeUndefined();
    expect(r.events[0].payload.patientFullName).toBeUndefined();
    expect(aviso).toHaveBeenCalledWith(
      expect.stringMatching(/no se pudieron leer los datos/),
    );
    aviso.mockRestore();
  });

  it('un paciente que el HIS no tiene deja el alta como está (no revienta)', async () => {
    const h = conDriver({ citas: [[], [cita()]], pacientes: [] });
    const r = await dosVueltas(h);
    expect(r.events[0].payload.patientFullName).toBeUndefined();
  });

  it('lo ilegible se omite, no se inventa: nacimiento imposible y sexo desconocido', async () => {
    const h = conDriver({
      citas: [[], [cita()]],
      pacientes: [paciente({ naci: '0001-01-01 00:00', sexo: 9 })],
    });
    const r = await dosVueltas(h);
    expect(r.events[0].payload.patientBirthDateIso).toBeUndefined();
    expect(r.events[0].payload.patientGender).toBeUndefined();
    // El nombre y el teléfono sí llegan: un campo sucio no arrastra a los demás.
    expect(r.events[0].payload.patientPhone).toBe('3001112233');
  });

  it('un paciente sin nombre ni teléfono en el HIS no deja campos vacíos', async () => {
    const h = conDriver({
      citas: [[], [cita()]],
      pacientes: [
        paciente({
          nombre: null,
          segNombre: null,
          apellido: null,
          segApellido: null,
          telefono: '   ',
        }),
      ],
    });
    const r = await dosVueltas(h);
    expect(r.events[0].payload.patientFullName).toBeUndefined();
    expect(r.events[0].payload.patientPhone).toBeUndefined();
  });

  it('muchas altas se piden en lotes (no un IN de mil marcadores)', async () => {
    const citas = Array.from({ length: 250 }, (_v, i) =>
      cita({
        hora: `2026/10/10 07:${String(i % 60).padStart(2, '0')}`,
        med: `M${Math.floor(i / 60)}`,
        hist: `9000${i}`,
      }),
    );
    const h = conDriver({ citas: [[], citas], pacientes: [] });

    await dosVueltas(h);

    const consultas = h.consultasDePacientes();
    expect(consultas).toHaveLength(2); // 250 documentos = 200 + 50
    expect(consultas[0]).toMatch(/@h199\)/);
    expect(consultas[0]).not.toMatch(/@h200/);
  });
});
