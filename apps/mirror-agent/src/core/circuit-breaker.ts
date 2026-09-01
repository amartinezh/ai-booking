/**
 * Modo seguro del agente: deja de intentar cuando el HIS lleva rato
 * rechazando todo.
 *
 * POR QUE
 * Sin esto, un HIS caído recibe un intento por vuelta indefinidamente. Con el
 * backoff del servidor los eventos se espacian solos, pero el agente sigue
 * abriendo conexiones, y cada intento fallido consume uno de los diez que
 * separan un evento del dead-letter. Un reinicio del SQL Server de veinte
 * minutos podía mandar a dead-letter media cola por un problema que ya se
 * había resuelto solo.
 *
 * Tres estados, los clásicos:
 *   CERRADO   → todo normal, se intenta siempre.
 *   ABIERTO   → se saltan los intentos durante `cooldownMs`.
 *   SEMIABIERTO → se deja pasar UNO para ver si el HIS volvió.
 *
 * Es una pieza de `core/`: cualquier driver se beneficia igual.
 */

export type EstadoCircuito = 'CERRADO' | 'ABIERTO' | 'SEMIABIERTO';

export interface CircuitBreakerOptions {
  /** Fallos seguidos antes de abrir. */
  umbralFallos?: number;
  /** Cuánto se espera antes de dejar pasar una prueba. */
  cooldownMs?: number;
  /** Inyectable para que las pruebas no dependan del reloj. */
  ahora?: () => number;
}

const UMBRAL_POR_DEFECTO = 5;
const COOLDOWN_POR_DEFECTO = 60_000;

export class CircuitBreaker {
  private fallosSeguidos = 0;
  private abiertoDesde: number | null = null;
  private pruebaEnCurso = false;

  private readonly umbral: number;
  private readonly cooldownMs: number;
  private readonly ahora: () => number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.umbral = opts.umbralFallos ?? UMBRAL_POR_DEFECTO;
    this.cooldownMs = opts.cooldownMs ?? COOLDOWN_POR_DEFECTO;
    this.ahora = opts.ahora ?? (() => Date.now());
  }

  get estado(): EstadoCircuito {
    if (this.abiertoDesde === null) return 'CERRADO';
    if (this.ahora() - this.abiertoDesde >= this.cooldownMs) return 'SEMIABIERTO';
    return 'ABIERTO';
  }

  /**
   * ¿Se puede intentar ahora?
   *
   * En SEMIABIERTO deja pasar UNO solo: si diez eventos entraran a la vez tras
   * el enfriamiento, el HIS caído recibiría diez conexiones de golpe, que es
   * justo lo que este freno existe para evitar.
   */
  puedeIntentar(): boolean {
    const estado = this.estado;
    if (estado === 'CERRADO') return true;
    if (estado === 'ABIERTO') return false;

    if (this.pruebaEnCurso) return false;
    this.pruebaEnCurso = true;
    return true;
  }

  /** Un intento salió bien: el HIS volvió, se cierra todo. */
  registrarExito(): void {
    this.fallosSeguidos = 0;
    this.abiertoDesde = null;
    this.pruebaEnCurso = false;
  }

  /** Un intento falló. Al llegar al umbral, se abre. */
  registrarFallo(): void {
    this.pruebaEnCurso = false;
    this.fallosSeguidos++;

    if (this.fallosSeguidos >= this.umbral) {
      // Se reabre el reloj también si ya estaba abierto: la prueba del
      // semiabierto falló, así que toca esperar otro ciclo completo.
      this.abiertoDesde = this.ahora();
    }
  }

  /** Para el heartbeat y los logs. */
  resumen(): { estado: EstadoCircuito; fallosSeguidos: number } {
    return { estado: this.estado, fallosSeguidos: this.fallosSeguidos };
  }
}
