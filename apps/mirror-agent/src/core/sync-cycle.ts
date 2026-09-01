import type { MirrorEngine } from './engine';
import type { FailureReporter } from './failure-reporter';
import type { CircuitBreaker } from './circuit-breaker';

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

const mensajeDe = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

/**
 * Una vuelta de AgenIA -> HIS. Se autorregula sola: el `getPendingEvents` del
 * servidor usa long-poll y se queda esperando hasta 25 s cuando no hay nada.
 */
export async function runOutbound(
  engine: Pick<MirrorEngine, 'pullAndApplyOutboxEvents'>,
  reporter: FailureReporter,
): Promise<{
  applied: number;
  failed: number;
  /** Eventos que este driver no espeja; ya quedaron cerrados en el servidor. */
  skipped: number;
  hadErrors: boolean;
}> {
  try {
    const r = await engine.pullAndApplyOutboxEvents();
    if (r.failed > 0) {
      reporter.reportAll(
        'AgenIA->HIS',
        r.failures.map(
          (f) =>
            `evento ${f.eventId} (seq ${f.seq})` +
            `${f.threw ? ' lanzo' : ' rechazado'}: ${f.message}`,
        ),
      );
    }
    return {
      applied: r.applied,
      failed: r.failed,
      skipped: r.skippedUnsupported,
      hadErrors: r.failed > 0,
    };
  } catch (error) {
    reporter.report('AgenIA->HIS', mensajeDe(error));
    return { applied: 0, failed: 0, skipped: 0, hadErrors: true };
  }
}

/** Una vuelta de HIS -> AgenIA. */
export async function runInbound(
  engine: Pick<MirrorEngine, 'detectAndPushChanges'>,
  reporter: FailureReporter,
): Promise<{ pushed: number; hadErrors: boolean }> {
  try {
    const r = await engine.detectAndPushChanges();
    return { pushed: r.pushed, hadErrors: false };
  } catch (error) {
    reporter.report('HIS->AgenIA', mensajeDe(error));
    return { pushed: 0, hadErrors: true };
  }
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

  // Las dos direcciones corren EN PARALELO, no una detrás de otra.
  //
  // El pull hacia el HIS usa long-poll: cuando no hay eventos pendientes se
  // queda esperando hasta 25 s. Encadenadas, esa espera bloqueaba la lectura
  // DESDE el HIS, así que una cita agendada en el hospital tardaba media
  // vuelta larga en llegar a AgenIA — y mientras tanto ese cupo se seguía
  // ofreciendo por WhatsApp. Se detectó probando justo eso: el agente no
  // reportó el cambio porque nunca llegó a mirarlo.
  //
  // `allSettled` y no `all`: que una dirección falle no debe cancelar la otra.
  const [salida, entrada] = await Promise.allSettled([
    engine.pullAndApplyOutboxEvents(),
    engine.detectAndPushChanges(),
  ]);

  // --- AgenIA -> HIS -------------------------------------------------------
  if (salida.status === 'fulfilled') {
    applied = salida.value.applied;
    failed = salida.value.failed;
    if (salida.value.failed > 0) {
      hadErrors = true;
      reporter.reportAll(
        'AgenIA->HIS',
        salida.value.failures.map(
          (f) =>
            `evento ${f.eventId} (seq ${f.seq})` +
            `${f.threw ? ' lanzo' : ' rechazado'}: ${f.message}`,
        ),
      );
    }
  } else {
    hadErrors = true;
    reporter.report('AgenIA->HIS', mensajeDe(salida.reason));
  }

  // --- HIS -> AgenIA -------------------------------------------------------
  if (entrada.status === 'fulfilled') {
    pushed = entrada.value.pushed;
  } else {
    hadErrors = true;
    reporter.report('HIS->AgenIA', mensajeDe(entrada.reason));
  }

  if (!hadErrors) reporter.reset();

  return { applied, failed, pushed, hadErrors };
}


/**
 * Una vuelta de AgenIA -> HIS con el modo seguro delante.
 *
 * El freno y la vuelta van juntos porque la regla que los une —"si el circuito
 * está abierto NO se toca el HIS, y el resultado de cada vuelta abre o cierra
 * ese circuito"— es la que evita que un SQL Server reiniciándose veinte
 * minutos mande media cola a dead-letter. Enterrada en el `while` de index.ts
 * no se podía afirmar en ningún test.
 */
export async function runOutboundConFreno(
  engine: Pick<MirrorEngine, 'pullAndApplyOutboxEvents'>,
  reporter: FailureReporter,
  breaker: Pick<
    CircuitBreaker,
    'puedeIntentar' | 'registrarExito' | 'registrarFallo' | 'resumen'
  >,
): Promise<{
  applied: number;
  failed: number;
  skipped: number;
  hadErrors: boolean;
  /** true si ni se intentó: el circuito estaba abierto. */
  frenado: boolean;
}> {
  if (!breaker.puedeIntentar()) {
    // Se avisa una vez por vuelta; el amortiguador del reporter evita que
    // inunde el log mientras el HIS siga caído.
    reporter.report(
      'AgenIA->HIS',
      `modo seguro activo (${breaker.resumen().fallosSeguidos} fallos seguidos): ` +
        `no se intenta escribir hasta que el HIS responda.`,
    );
    return { applied: 0, failed: 0, skipped: 0, hadErrors: false, frenado: true };
  }

  const r = await runOutbound(engine, reporter);
  if (r.hadErrors) breaker.registrarFallo();
  else breaker.registrarExito();
  return { ...r, frenado: false };
}
