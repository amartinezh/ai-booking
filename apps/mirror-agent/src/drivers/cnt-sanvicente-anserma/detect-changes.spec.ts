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
