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

/**
 * 🚨 EL ESTADO SE LLEVA POR ETAPA, NO GLOBAL — no es un detalle interno,
 * es la corrección de un bug real visto en producción (Anserma, 2026-09-18).
 *
 * Antes había un solo `lastKey`/`repeats` compartido por TODO el agente. Un
 * único `FailureReporter` se pasa a los seis bucles independientes de
 * `index.ts` (sync-cycle, agenda, catálogo, avisos masivos, reconciliación),
 * cada uno con su propio intervalo. Con estado único, cualquiera de esos
 * bucles reportando SU fallo —aunque fuera un problema totalmente distinto—
 * pisaba el `lastKey` de los demás; y `sync-cycle.ts` llama a `reset()` sin
 * argumentos cada vez que su ciclo sale limpio, borrando el progreso de
 * CUALQUIER otro bucle sin que el motivo tuviera nada que ver con él.
 *
 * El journal de producción de Anserma lo muestra en sus dos formas: al
 * arrancar, la reconciliación (su primera corrida, a los 2 min) y un
 * heartbeat con un 502 aislado interrumpieron el conteo de `avisos masivos`
 * dos veces en 8 minutos. En régimen normal el reset de sync-cycle sale
 * limpio con mucha menos frecuencia —más cerca de una vez por hora que de
 * varias por minuto, según los propios registros— pero cuando ocurre tiene
 * el mismo efecto: la cuenta de una etapa completamente ajena se pierde. El
 * síntoma en el journal: la MISMA línea de error reapareciendo desde cero,
 * en vez de acumular hasta el recuento de `repeatEvery`.
 *
 * (La corrección previa del mismo día —quitar el `timestamp` volátil del
 * cuerpo del error antes de que llegue aquí, en `mirror-api-client.ts`— era
 * necesaria pero no suficiente: resolvía que dos mensajes IGUALES se
 * reconocieran como iguales, pero no que el estado de una etapa sobreviviera
 * a que otra etapa reportara o reiniciara entre medias.)
 */
export class FailureReporter {
  private readonly estados = new Map<
    string,
    { ultimoMensaje: string; repeticiones: number }
  >();
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
   * un recuento en vez de la línea otra vez. Un fallo DISTINTO —o el primero
   * de una etapa nueva— siempre se emite y arranca su propia cuenta: un
   * problema nuevo nunca se silencia, y una etapa nunca hereda ni contamina
   * el contador de otra.
   */
  report(etapa: string, mensaje: string): void {
    const previo = this.estados.get(etapa);

    if (!previo || previo.ultimoMensaje !== mensaje) {
      this.estados.set(etapa, { ultimoMensaje: mensaje, repeticiones: 1 });
      this.sink(`[mirror-agent] ${etapa}: ${mensaje}`);
      return;
    }

    previo.repeticiones++;
    if (previo.repeticiones % this.repeatEvery === 0) {
      this.sink(
        `[mirror-agent] ${etapa}: el mismo fallo lleva ${previo.repeticiones} repeticiones - ${mensaje}`,
      );
    }
  }

  reportAll(etapa: string, mensajes: readonly string[]): void {
    for (const m of mensajes) this.report(etapa, m);
  }

  /**
   * Olvida el último fallo de UNA etapa concreta: si esa etapa vuelve a
   * fallar, se reporta completo otra vez en vez de seguir contando
   * repeticiones de antes del ciclo limpio.
   *
   * `etapa` es obligatorio a propósito — la versión anterior no lo pedía y
   * limpiaba TODO el estado de un golpe, que es justo lo que rompía la
   * amortiguación de las demás etapas cuando una sola salía limpia (ver la
   * nota grande de la clase). Un caller que de verdad necesite olvidar varias
   * etapas las nombra una por una, explícitamente — nunca "todas las que
   * hubiera".
   */
  reset(etapa: string): void {
    this.estados.delete(etapa);
  }
}
