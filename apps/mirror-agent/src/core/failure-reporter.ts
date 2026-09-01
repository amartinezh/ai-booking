/**
 * Amortigua el reporte de fallos repetidos del ciclo de sync.
 *
 * Cuando el driver falla, falla igual en cada vuelta mientras la causa de
 * fondo siga ahí. En una corrida real contra el mock, el agente escupió la
 * MISMA traza completa veinte veces y enterró todo lo demás: el log dejó de
 * servir justo cuando más falta hacía.
 *
 * Vive en `core/` y no dentro de `index.ts` porque es lógica con estado y
 * reglas propias — merece sus propias pruebas, y `index.ts` debe quedarse
 * como puro cableado.
 */

/** Destino del reporte. `console` en producción; un array en las pruebas. */
export type ReportSink = (line: string) => void;

export interface FailureReporterOptions {
  /** Cada cuántas repeticiones consecutivas se vuelve a emitir un recuento. */
  repeatEvery?: number;
}

const DEFAULT_REPEAT_EVERY = 20;

export class FailureReporter {
  private lastKey = '';
  private repeats = 0;
  private readonly repeatEvery: number;

  constructor(
    private readonly sink: ReportSink,
    options: FailureReporterOptions = {},
  ) {
    this.repeatEvery = options.repeatEvery ?? DEFAULT_REPEAT_EVERY;
  }

  /**
   * Reporta un fallo. El primero de su tipo se emite completo; los repetidos
   * consecutivos se callan hasta cumplir `repeatEvery`, y entonces se emite
   * un recuento en vez de la línea otra vez. Un fallo DISTINTO siempre se
   * emite y reinicia la cuenta: un problema nuevo nunca se silencia.
   */
  report(etapa: string, mensaje: string): void {
    const key = `${etapa} ${mensaje}`;

    if (key !== this.lastKey) {
      this.lastKey = key;
      this.repeats = 1;
      this.sink(`[mirror-agent] ${etapa}: ${mensaje}`);
      return;
    }

    this.repeats++;
    if (this.repeats % this.repeatEvery === 0) {
      this.sink(
        `[mirror-agent] ${etapa}: el mismo fallo lleva ${this.repeats} repeticiones - ${mensaje}`,
      );
    }
  }

  reportAll(etapa: string, mensajes: readonly string[]): void {
    for (const m of mensajes) this.report(etapa, m);
  }

  /** Un ciclo limpio olvida el ultimo fallo: si vuelve, se reporta de nuevo. */
  reset(): void {
    this.lastKey = '';
    this.repeats = 0;
  }
}
