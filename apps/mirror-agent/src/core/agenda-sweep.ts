import type { MirrorEngine } from './engine';

/**
 * Recorrido de la agenda del hospital, día por día (Fase 2).
 *
 * Vive aquí y no dentro del `while` de `index.ts` por la misma razón que
 * `sync-cycle.ts`: las propiedades que garantiza —que cada día se sube como
 * una foto completa, que un `OFF` corta el barrido en seco en vez de pasear
 * 400 días para nada, y que los totales suman lo que dicen— son afirmables en
 * un test solo si no están enterradas en un bucle infinito.
 *
 * Un día por petición, y no la ventana entera de una vez, porque el servidor
 * BORRA dentro de la ventana que se le declara todo lo que no venga en el
 * envío. Trocear por día mantiene esa semántica sin que el servidor guarde
 * estado entre páginas, y hace que un día sin turnos pueda llegar vacío — que
 * es información legítima ("ese día el médico no atiende"), no un error.
 */
export interface ResumenAgenda {
  modo: string;
  creados: number;
  actualizados: number;
  borrados: number;
  conflictos: number;
  /** Días efectivamente repasados (menos que los pedidos si el modo era OFF). */
  dias: number;
  /** Días que fallaron. El barrido sigue: uno malo no puede tumbar el resto. */
  diasConError: number;
  /** El primer motivo de fallo, para no repetir 400 veces el mismo mensaje. */
  primerError?: string;
}

const UN_DIA_MS = 86_400_000;

export async function recorrerAgenda(
  engine: Pick<MirrorEngine, 'syncAvailability'>,
  opts: { dias: number; desde?: Date },
): Promise<ResumenAgenda> {
  // Medianoche LOCAL de la VM, que corre en la hora del hospital: el día que
  // se sube es el día que ellos ven en su agenda.
  const inicio = opts.desde ? new Date(opts.desde) : new Date();
  inicio.setHours(0, 0, 0, 0);

  const total: ResumenAgenda = {
    modo: 'OFF',
    creados: 0,
    actualizados: 0,
    borrados: 0,
    conflictos: 0,
    dias: 0,
    diasConError: 0,
  };

  for (let i = 0; i < opts.dias; i++) {
    const from = new Date(inicio.getTime() + i * UN_DIA_MS);
    const to = new Date(from.getTime() + UN_DIA_MS);

    // 🚨 Cada día va en su propio try. Antes un fallo cualquiera subía y
    // abortaba el barrido completo: pasó de verdad — un cupo que no se podía
    // borrar rompía el día 3 y los otros 397 no se sincronizaban nunca. La
    // agenda se quedó media hora desalineada y lo único que se veía era una
    // línea de error por vuelta, sin decir que el resto no había corrido.
    // Es la misma regla que en sync-cycle: un fallo aislado no tumba el todo.
    let r;
    try {
      r = await engine.syncAvailability({ from, to });
    } catch (error) {
      total.diasConError++;
      total.primerError ??=
        error instanceof Error ? error.message : String(error);
      continue;
    }

    total.modo = r.mode;

    // El hospital todavía no cedió su agenda: seguir preguntando 399 veces lo
    // mismo solo carga al HIS y a la API para nada.
    if (r.mode === 'OFF') return total;

    total.creados += r.created;
    total.actualizados += r.updated;
    total.borrados += r.removed;
    total.conflictos += r.conflicts.length;
    total.dias++;
  }

  return total;
}
