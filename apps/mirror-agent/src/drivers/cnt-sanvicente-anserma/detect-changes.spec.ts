import { CntSanVicenteAnsermaDriver } from './index';
import type { AnsermaMapping } from './mapping';

// ══════════════════════════════════════════════════════════════════════════
// `detectChanges` no tenía spec propio — el bug de colisión de `eventId` que
// arregla este archivo vivió sin cobertura directa hasta ahora (se descubrió
// analizando el código, no con un test rojo). Ver la nota grande sobre
// `eventId` en `eventoDeCita` (index.ts) para el porqué completo.
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

/** Fila cruda tal como la devuelve la consulta SQL de `detectChanges`. */
function filaCita(over: Partial<Record<string, unknown>> = {}) {
  return {
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
  };
}

function conDriver(recordset: unknown[]) {
  const req: any = {
    input() {
      return req;
    },
    async query() {
      return { recordset };
    },
  };
  const driver = new CntSanVicenteAnsermaDriver();
  driver.useConnection({ request: () => req } as never, MAPPING);
  return driver;
}

// ⏰ Las citas de ejemplo son del 2026-10-10 y `detectChanges` solo mira las
// FUTURAS: con el reloj real, desde ese día estas pruebas dejaban de ver sus
// propias citas y fallaban solas. Se fija solo la FECHA (antes de las citas);
// los temporizadores siguen siendo los reales.
beforeEach(() => {
  jest.useFakeTimers({
    now: new Date('2026-10-01T12:00:00.000Z'),
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
      'queueMicrotask',
      'hrtime',
      'performance',
    ],
  });
});
afterEach(() => jest.useRealTimers());

describe('detectChanges — eventId no colisiona entre instancias distintas', () => {
  it('agendar dos veces el mismo cupo (con la cancelación detectada en medio) produce dos INSERT con eventId distinto', async () => {
    const driver = conDriver([]);

    // Primera lectura: no hay foto previa, no se emite nada, solo se
    // establece la línea base (comportamiento documentado en detectChanges).
    const base = await driver.detectChanges(null);
    expect(base.events).toHaveLength(0);

    // El cupo aparece ocupado por primera vez (instancia A, elaborada a las
    // 06:00).
    const conA = conDriver([
      filaCita({ elaborada: '2026-09-18 06:00:00.000' }),
    ]);
    const rondaA = await conA.detectChanges(base.nextCursor);
    expect(rondaA.events).toHaveLength(1);
    expect(rondaA.events[0].op).toBe('INSERT');
    const idA = rondaA.events[0].eventId;

    // Se cancela y la vuelta siguiente la DETECTA (queda fuera de esta
    // aserción: es justo lo que cubre el test de abajo).
    const rondaCancelA = await conDriver([]).detectChanges(rondaA.nextCursor);
    expect(rondaCancelA.events[0].op).toBe('CANCEL');

    // El cupo se reagenda con OTRO paciente: misma clave médico|hora, mismo
    // estado 0, pero es una fila NUEVA — el HIS le puso una FE_ELAB_CIT
    // distinta (instancia B, elaborada a las 09:00).
    const conB = conDriver([
      filaCita({ hist: '900010999', elaborada: '2026-09-18 09:00:00.000' }),
    ]);
    const rondaB = await conB.detectChanges(rondaCancelA.nextCursor);
    expect(rondaB.events).toHaveLength(1);
    expect(rondaB.events[0].op).toBe('INSERT');
    const idB = rondaB.events[0].eventId;

    // 🎯 La aserción que antes de este fix habría fallado: dos observaciones
    // reales y distintas no pueden compartir eventId, porque el servidor las
    // trataría como la misma entrega reintentada y descartaría la segunda.
    expect(idA).not.toBe(idB);
  });

  it('cancelar el mismo cupo dos veces (con un reagendamiento en medio) produce dos CANCEL con eventId distinto', async () => {
    const driver = conDriver([]);
    const base = await driver.detectChanges(null);

    // Instancia A viva.
    const conA = conDriver([
      filaCita({ elaborada: '2026-09-18 06:00:00.000' }),
    ]);
    const rondaA = await conA.detectChanges(base.nextCursor);

    // Instancia A desaparece: primera cancelación.
    const cancelA = conDriver([]);
    const rondaCancelA = await cancelA.detectChanges(rondaA.nextCursor);
    expect(rondaCancelA.events).toHaveLength(1);
    expect(rondaCancelA.events[0].op).toBe('CANCEL');
    const idCancelA = rondaCancelA.events[0].eventId;

    // El cupo se reagenda: instancia B, con OTRA FE_ELAB_CIT.
    const conB = conDriver([
      filaCita({ elaborada: '2026-09-18 09:00:00.000' }),
    ]);
    const rondaB = await conB.detectChanges(rondaCancelA.nextCursor);
    expect(rondaB.events).toHaveLength(1);
    expect(rondaB.events[0].op).toBe('INSERT');

    // Instancia B también se cancela: segunda cancelación de la MISMA clave
    // médico|hora con el MISMO estado (0) que la primera cancelación.
    const cancelB = conDriver([]);
    const rondaCancelB = await cancelB.detectChanges(rondaB.nextCursor);
    expect(rondaCancelB.events).toHaveLength(1);
    expect(rondaCancelB.events[0].op).toBe('CANCEL');
    const idCancelB = rondaCancelB.events[0].eventId;

    // Antes de este fix: idCancelA === idCancelB === "cnt:CANCEL:MDD2|2026/10/10 07:00:0"
    // — la segunda cancelación real se habría descartado como si fuera un
    // reintento de la primera.
    expect(idCancelA).not.toBe(idCancelB);
  });

  it('reintentar la ENTREGA de la misma observación sí conserva el eventId', async () => {
    // No es solo "que nunca colisione" — el reintento legítimo (la respuesta
    // del servidor se perdió por un corte de red, el cursor no avanzó) tiene
    // que seguir produciendo el mismo eventId, o se rompe la protección
    // contra doble aplicación que ya existía.
    const driver = conDriver([]);
    const base = await driver.detectChanges(null);

    const fila = filaCita({ elaborada: '2026-09-18 06:00:00.000' });
    const primerIntento = await conDriver([fila]).detectChanges(
      base.nextCursor,
    );
    // Cursor NO avanzó (simulando que la entrega falló): se repite la MISMA
    // consulta contra el MISMO cursor anterior.
    const reintento = await conDriver([fila]).detectChanges(base.nextCursor);

    expect(reintento.events[0].eventId).toBe(primerIntento.events[0].eventId);
  });

  it('🔵 hallazgo adyacente, NO corregido aquí: cancelar y reagendar el mismo cupo DENTRO de una sola vuelta de detectChanges no emite nada', async () => {
    // Deliberadamente fuera de alcance de este fix. El diff solo compara
    // `previo.e !== fila.e`: si la clave médico|hora sigue presente en las
    // dos fotos con el MISMO estado (0), lo trata como "sin cambios" aunque
    // el paciente (`hist`) y la fila real (`el`) hayan cambiado por debajo.
    // Requeriría comparar también `el` para detectarlo como
    // CANCEL+INSERT encadenados, un cambio más grande a la lógica del diff
    // que el que se pidió (evitar la colisión de eventId). Se deja anotado
    // porque la campaña de certificación ya produjo el patrón "cancelada +
    // viva sobre el mismo cupo" de forma orgánica (tres casos) — la ventana
    // de riesgo es real, aunque angosta (tiene que ocurrir dentro de un
    // mismo ciclo de sondeo).
    const driver = conDriver([]);
    const base = await driver.detectChanges(null);
    const rondaA = await conDriver([
      filaCita({ elaborada: '2026-09-18 06:00:00.000' }),
    ]).detectChanges(base.nextCursor);

    const rondaB = await conDriver([
      filaCita({ hist: '900010999', elaborada: '2026-09-18 09:00:00.000' }),
    ]).detectChanges(rondaA.nextCursor);

    expect(rondaB.events).toHaveLength(0);
  });

  it('un cursor persistido por una versión anterior (sin `el`) no revienta', async () => {
    const cursorViejo = {
      ventana: { desde: '2026-09-18', hasta: '2026-12-16' },
      filas: {
        'MDD2|2026/10/10 07:00': {
          e: 0,
          s: 'S39141',
          h: '900010244',
          d: 20,
          f: '2026-10-10',
          propia: false,
          // sin `el`: así quedó guardado por el agente antes de este cambio
        },
      },
    };

    const driver = conDriver([]); // el cupo ya no está: cancelación

    const r = await driver.detectChanges(cursorViejo as never);

    expect(r.events).toHaveLength(1);
    expect(r.events[0].op).toBe('CANCEL');
    expect(r.events[0].eventId).toContain(':na');
  });
});

describe('detectChanges — anti-eco con las marcas de cada canal', () => {
  // Una cita que escribió el propio agente no puede volver a AgenIA como un
  // alta del hospital. Con Telegram hay DOS marcas propias: si solo se
  // reconociera la de WhatsApp, cada cita de Telegram regresaría duplicada.
  it.each([
    ['WhatsApp', 'ASIGNADA POR WHATSAPP'],
    ['Telegram', 'ASIGNADA POR TELEGRAM'],
  ])(
    'una cita con la marca de %s no se reporta como alta',
    async (_c, marca) => {
      const base = await conDriver([]).detectChanges(null);
      const ronda = await conDriver([
        filaCita({ descripcion: marca }),
      ]).detectChanges(base.nextCursor);
      expect(ronda.events).toHaveLength(0);
    },
  );

  // 🔁 2026-10-22: el hospital cambió de hora una cita que agendó el asistente.
  // La nueva conserva la elaboración y la marca: antes se tomaba por eco y AgenIA
  // solo veía la cancelación.
  it('🔁 una cita NUESTRA que el hospital cambió de hora: alta en la hora nueva y cancelación de la vieja', async () => {
    const nuestra = {
      descripcion: 'ASIGNADA POR WHATSAPP',
      elaborada: '2026-10-01 10:04:45.257',
      hist: '1054928310',
    };
    const base = await conDriver([
      filaCita({ ...nuestra, hora: '2026/10/10 15:20' }),
    ]).detectChanges(null);
    const ronda = await conDriver([
      filaCita({ ...nuestra, hora: '2026/10/11 09:00', fecha: '2026-10-11' }),
    ]).detectChanges(base.nextCursor);

    const ops = ronda.events.map((e) => [e.op, e.payload.startTimeIso]);
    expect(ops).toEqual(
      expect.arrayContaining([
        ['INSERT', '2026-10-11T14:00:00.000Z'],
        ['CANCEL', '2026-10-10T20:20:00.000Z'],
      ]),
    );
    // El alta va primero: al llegar la cancelación, AgenIA ya tiene la nueva.
    expect(ronda.events[0].op).toBe('INSERT');
  });

  it('una cita nuestra RECIÉN escrita sigue sin devolverse (su elaboración no estaba en otra hora)', async () => {
    const base = await conDriver([
      filaCita({
        hora: '2026/10/10 08:00',
        elaborada: '2026-09-18 06:00:00.000',
      }),
    ]).detectChanges(null);
    const ronda = await conDriver([
      filaCita({
        hora: '2026/10/10 08:00',
        elaborada: '2026-09-18 06:00:00.000',
      }),
      filaCita({
        hora: '2026/10/10 09:00',
        descripcion: 'ASIGNADA POR WHATSAPP',
        elaborada: '2026-10-01 11:00:00.123',
      }),
    ]).detectChanges(base.nextCursor);
    expect(ronda.events).toHaveLength(0);
  });

  it('la misma elaboración de OTRO paciente no cuenta como cambio de hora', async () => {
    const base = await conDriver([
      filaCita({
        hora: '2026/10/10 15:20',
        elaborada: '2026-10-01 10:00:00.000',
        hist: '111',
        descripcion: 'ASIGNADA POR WHATSAPP',
      }),
    ]).detectChanges(null);
    const ronda = await conDriver([
      filaCita({
        hora: '2026/10/10 15:20',
        elaborada: '2026-10-01 10:00:00.000',
        hist: '111',
        descripcion: 'ASIGNADA POR WHATSAPP',
      }),
      filaCita({
        hora: '2026/10/10 16:00',
        elaborada: '2026-10-01 10:00:00.000',
        hist: '222',
        descripcion: 'ASIGNADA POR WHATSAPP',
      }),
    ]).detectChanges(base.nextCursor);
    expect(ronda.events).toHaveLength(0);
  });

  // 🔀 2026-10-29: el «traslado» del hospital es un UPDATE en sitio que cambia
  // médico y hora y REESCRIBE FE_ELAB_CIT. El 28-oct cuatro citas del asistente
  // pasaron del Dr. Cárdenas (RU70) a la Dra. Ríos (RU69) a la misma hora; AgenIA
  // solo vio la cancelación y les dijo a los pacientes que se había cancelado.
  describe('🔀 una cita NUESTRA que el hospital trasladó (elaboración nueva)', () => {
    const nuestra = {
      descripcion: 'ASIGNADA POR WHATSAPP',
      hist: '24387319',
    };

    it('a otro médico, a la misma hora: alta con el médico nuevo y cancelación de la vieja', async () => {
      const base = await conDriver([
        filaCita({
          ...nuestra,
          med: 'RU70',
          hora: '2026/10/10 13:00',
          elaborada: '2026-10-01 00:32:28.210',
        }),
      ]).detectChanges(null);
      const ronda = await conDriver([
        filaCita({
          ...nuestra,
          med: 'RU69',
          hora: '2026/10/10 13:00',
          elaborada: '2026-10-01 11:27:00.000',
        }),
      ]).detectChanges(base.nextCursor);

      const ops = ronda.events.map((e) => [
        e.op,
        e.payload.doctorExternalKey,
        e.payload.startTimeIso,
      ]);
      expect(ops).toEqual([
        ['INSERT', 'RU69', '2026-10-10T18:00:00.000Z'],
        ['CANCEL', 'RU70', '2026-10-10T18:00:00.000Z'],
      ]);
    });

    it('a otra hora del mismo día: alta en la hora nueva y cancelación de la vieja', async () => {
      const base = await conDriver([
        filaCita({
          ...nuestra,
          med: 'RU70',
          hora: '2026/10/10 14:40',
          elaborada: '2026-10-01 05:57:18.083',
        }),
      ]).detectChanges(null);
      const ronda = await conDriver([
        filaCita({
          ...nuestra,
          med: 'RU69',
          hora: '2026/10/10 14:50',
          elaborada: '2026-10-01 11:28:00.000',
        }),
      ]).detectChanges(base.nextCursor);

      expect(ronda.events.map((e) => e.op)).toEqual(['INSERT', 'CANCEL']);
      expect(ronda.events[0].payload.startTimeIso).toBe(
        '2026-10-10T19:50:00.000Z',
      );
    });

    it('una nuestra nueva de OTRO paciente mientras otra nuestra desaparece: sigue siendo eco', async () => {
      const base = await conDriver([
        filaCita({
          ...nuestra,
          hora: '2026/10/10 13:00',
          elaborada: '2026-10-01 00:32:28.210',
        }),
      ]).detectChanges(null);
      const ronda = await conDriver([
        filaCita({
          descripcion: 'ASIGNADA POR WHATSAPP',
          hist: '99999999',
          hora: '2026/10/10 13:20',
          elaborada: '2026-10-01 11:30:00.000',
        }),
      ]).detectChanges(base.nextCursor);

      expect(ronda.events.map((e) => e.op)).toEqual(['CANCEL']);
    });

    it('una segunda cita nuestra del mismo paciente, con la primera todavía viva: sigue siendo eco', async () => {
      const primera = filaCita({
        ...nuestra,
        hora: '2026/10/10 13:00',
        elaborada: '2026-10-01 00:32:28.210',
      });
      const base = await conDriver([primera]).detectChanges(null);
      const ronda = await conDriver([
        primera,
        filaCita({
          ...nuestra,
          hora: '2026/10/12 08:00',
          fecha: '2026-10-12',
          elaborada: '2026-10-01 11:30:00.000',
        }),
      ]).detectChanges(base.nextCursor);

      expect(ronda.events).toHaveLength(0);
    });

    it('la vieja que se borró era del hospital (sin marca): la nuestra nueva sigue siendo eco', async () => {
      const base = await conDriver([
        filaCita({
          descripcion: 'ASIGNADA EN VENTANILLA',
          hist: nuestra.hist,
          hora: '2026/10/10 13:00',
        }),
      ]).detectChanges(null);
      const ronda = await conDriver([
        filaCita({
          ...nuestra,
          hora: '2026/10/10 15:00',
          elaborada: '2026-10-01 11:30:00.000',
        }),
      ]).detectChanges(base.nextCursor);

      expect(ronda.events.map((e) => e.op)).toEqual(['CANCEL']);
    });
  });

  it('una cita del hospital (sin marca) sí se reporta como alta', async () => {
    const base = await conDriver([]).detectChanges(null);
    const ronda = await conDriver([
      filaCita({ descripcion: 'ASIGNADA EN VENTANILLA' }),
    ]).detectChanges(base.nextCursor);
    expect(ronda.events).toHaveLength(1);
    expect(ronda.events[0].op).toBe('INSERT');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🏥 La duración la define el HOSPITAL: cada cita viaja con la suya
// (`NU_DURA_CIT`). Con ella el servidor le crea a la cita un cupo a la medida
// cuando no cae en la rejilla de AgenIA.
// ══════════════════════════════════════════════════════════════════════════
describe('detectChanges — la cita viaja con su duración real', () => {
  const altaCon = async (dura: unknown) => {
    const base = await conDriver([]).detectChanges(null);
    const r = await conDriver([
      filaCita({ hora: '2026/10/10 07:00', dura }),
    ]).detectChanges(base.nextCursor);
    return r.events[0];
  };

  it('una cita de 30 min llega con fin a los 30 min (07:00 en Bogotá = 12:00 UTC)', async () => {
    const e = await altaCon(30);
    expect(e.op).toBe('INSERT');
    expect(e.payload.startTimeIso).toBe('2026-10-10T12:00:00.000Z');
    expect(e.payload.endTimeIso).toBe('2026-10-10T12:30:00.000Z');
  });

  it('sin duración en el HIS no se inventa un fin: el servidor usa la configurada', async () => {
    expect((await altaCon(null)).payload.endTimeIso).toBeUndefined();
  });

  it('una duración de 0 tampoco se usa', async () => {
    expect((await altaCon(0)).payload.endTimeIso).toBeUndefined();
  });
});
