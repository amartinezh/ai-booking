import type { MirrorEngine } from './engine';
import type { FailureReporter } from './failure-reporter';

/**
 * Una vuelta del ciclo de sync: primero AgenIA -> HIS, despues HIS -> AgenIA.
 *
 * Vive aqui y no dentro del `while` de `index.ts` por una razon concreta: la
 * propiedad que este codigo garantiza -- que un fallo en una direccion NO
 * impide que la otra corra -- es justo la que se rompio en produccion y nadie
 * pudo detectar, porque estaba enterrada en un bucle infinito imposible de
 * probar. Como funcion pura sobre el engine, se afirma en un test.
 *
 * Antes las dos direcciones compartian un unico try/catch y `detectChanges`
 * iba despues: cuando la escritura hacia el HIS lanzaba -- que es lo que hace
 * hoy el driver real -- la lectura desde el HIS no llegaba a ejecutarse nunca.
 * Un espejo que solo va en un sentido es peor que uno apagado, porque nadie
 * se entera.
 */
export interface SyncCycleResult {
  applied: number;
  failed: number;
  pushed: number;
  /** true si CUALQUIERA de las dos direcciones tuvo problemas. */
  hadErrors: boolean;
}

export async function runSyncCycle(
  engine: Pick<
    MirrorEngine,
    'pullAndApplyOutboxEvents' | 'detectAndPushChanges'
  >,
  reporter: FailureReporter,
): Promise<SyncCycleResult> {
  let applied = 0;
  let failed = 0;
  let pushed = 0;
  let hadErrors = false;

  // --- AgenIA -> HIS -------------------------------------------------------
  try {
    const result = await engine.pullAndApplyOutboxEvents();
    applied = result.applied;
    failed = result.failed;

    if (result.failed > 0) {
      hadErrors = true;
      reporter.reportAll(
        'AgenIA->HIS',
        result.failures.map(
          (f) =>
            `evento ${f.eventId} (seq ${f.seq})` +
            `${f.threw ? ' lanzo' : ' rechazado'}: ${f.message}`,
        ),
      );
    }
  } catch (error) {
    hadErrors = true;
    reporter.report(
      'AgenIA->HIS',
      error instanceof Error ? error.message : String(error),
    );
  }

  // --- HIS -> AgenIA -------------------------------------------------------
  // try/catch PROPIO, no un `else` ni el mismo bloque de arriba.
  try {
    const result = await engine.detectAndPushChanges();
    pushed = result.pushed;
  } catch (error) {
    hadErrors = true;
    reporter.report(
      'HIS->AgenIA',
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!hadErrors) reporter.reset();

  return { applied, failed, pushed, hadErrors };
}
