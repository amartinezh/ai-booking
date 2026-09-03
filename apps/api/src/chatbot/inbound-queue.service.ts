import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { getErrorMessage, getErrorStack } from '../common/error-message.util';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * COLA DE ENTRADA DEL WEBHOOK — backpressure + serialización + deduplicación
 * ══════════════════════════════════════════════════════════════════════════
 *
 * El controller ya NO hace `processIncomingMessage()` como fire-and-forget
 * suelto. En su lugar delega en esta cola en proceso, que resuelve de un solo
 * golpe tres debilidades del webhook:
 *
 *   • Backpressure (#6): un semáforo global limita cuántos turnos LLM corren a
 *     la vez (`INBOUND_MAX_CONCURRENCY`) y un tope total de tareas encoladas
 *     (`INBOUND_MAX_QUEUE`) evita que una ráfaga acumule promesas sin límite en
 *     memoria. Al superar el tope se rechaza la tarea (Meta reintimará el
 *     webhook), en vez de tumbar el contenedor por OOM.
 *
 *   • Serialización por remitente (#3): los mensajes de un mismo paciente se
 *     encadenan y se procesan de a uno en orden de llegada, para que dos
 *     mensajes rápidos no pisen el estado de la conversación en Redis.
 *
 *   • Deduplicación por wamid (#2): `admit()` usa `SET NX` en Redis para que un
 *     reintento del mismo webhook de Meta no procese dos veces el mensaje (lo
 *     que podía avanzar dos pasos el flujo).
 *
 * Es una cola EN MEMORIA (misma durabilidad que el fire-and-forget anterior:
 * lo pendiente se pierde si el proceso muere). El dedup sí es distribuido
 * (Redis), así que funciona aunque haya varias réplicas del API.
 */
@Injectable()
export class InboundQueueService {
  private readonly logger = new Logger(InboundQueueService.name);

  /** Turnos que pueden ejecutarse simultáneamente (semáforo global). */
  private readonly maxConcurrency: number;
  /** Tope de tareas encoladas + en ejecución antes de aplicar backpressure. */
  private readonly maxQueue: number;
  /** Ventana (segundos) durante la cual un wamid ya visto se considera duplicado. */
  private readonly dedupTtl: number;

  /** Tareas encoladas o en ejecución (para el tope de backpressure). */
  private pending = 0;
  /** Turnos ejecutándose ahora mismo (para el semáforo). */
  private active = 0;
  /** Waiters esperando un cupo del semáforo. */
  private readonly waiters: Array<() => void> = [];
  /**
   * Última promesa de la cadena de cada remitente. Encadenar contra ella
   * garantiza el orden FIFO por paciente. Se limpia cuando la cadena se vacía.
   */
  private readonly senderChains = new Map<string, Promise<void>>();

  constructor(private readonly redis: RedisService) {
    this.maxConcurrency = this.readIntEnv('INBOUND_MAX_CONCURRENCY', 20, 1);
    this.maxQueue = this.readIntEnv('INBOUND_MAX_QUEUE', 500, 1);
    this.dedupTtl = this.readIntEnv('INBOUND_DEDUP_TTL_SECONDS', 21600, 1);
  }

  /**
   * Deduplicación por id de mensaje de WhatsApp (wamid). Devuelve `true` si es
   * la primera vez que se ve (debe procesarse) y `false` si es un duplicado.
   *
   * Sin `wamid` no se puede deduplicar → se admite (mejor procesar que perder).
   * Si Redis falla, también se admite (fail-open): el dedup es una optimización,
   * la barrera real de doble-reserva es la transacción de `bookAppointment`.
   */
  async admit(wamid?: string): Promise<boolean> {
    if (!wamid) return true;
    try {
      const res = await this.redis.set(
        this.dedupKey(wamid),
        '1',
        'EX',
        this.dedupTtl,
        'NX',
      );
      return res === 'OK';
    } catch (err: unknown) {
      this.logger.warn(
        `Dedup no disponible (Redis): admito el mensaje ${wamid}. ${getErrorMessage(err)}`,
      );
      return true;
    }
  }

  /**
   * Revierte la marca de `admit()`. Se usa cuando la tarea NO pudo encolarse por
   * backpressure: así el reintento del webhook de Meta vuelve a ser admitido en
   * vez de quedar silenciosamente descartado como "duplicado".
   */
  async releaseAdmission(wamid?: string): Promise<void> {
    if (!wamid) return;
    try {
      await this.redis.del(this.dedupKey(wamid));
    } catch {
      // best-effort: si no se pudo borrar, la clave expira sola por TTL.
    }
  }

  /**
   * Encola el procesamiento de un turno, serializado por `senderId`. Devuelve
   * `false` si la cola está llena (backpressure) — en ese caso el llamador debe
   * revertir el dedup para no perder el mensaje. `task` nunca debe rechazar de
   * forma no controlada; aun así lo envolvemos para que un error no rompa la
   * cadena del remitente ni el semáforo.
   */
  enqueue(senderId: string, task: () => Promise<void>): boolean {
    if (this.pending >= this.maxQueue) {
      return false;
    }
    this.pending++;

    const prev = this.senderChains.get(senderId) ?? Promise.resolve();
    const run = prev.then(async () => {
      await this.acquire();
      try {
        await task();
      } catch (err: unknown) {
        // `processIncomingMessage` ya audita sus propios errores; este catch es
        // la última red para que un throw inesperado no deje colgado el semáforo.
        this.logger.error(
          `Tarea de la cola falló para ${senderId}: ${getErrorMessage(err)}`,
          getErrorStack(err),
        );
      } finally {
        this.release();
        this.pending--;
      }
    });

    // La cadena nunca debe quedar en estado "rejected" o el siguiente `then`
    // no correría; `run` ya no lanza, pero lo blindamos por si acaso.
    const chained = run.catch(() => {});
    this.senderChains.set(senderId, chained);
    // Al vaciarse la cadena, soltamos la entrada del Map para no acumular
    // remitentes históricos en memoria.
    void chained.finally(() => {
      if (this.senderChains.get(senderId) === chained) {
        this.senderChains.delete(senderId);
      }
    });

    return true;
  }

  /** Métrica ligera para logs/health: tareas encoladas o en ejecución. */
  get inFlight(): number {
    return this.pending;
  }

  // ── semáforo ──────────────────────────────────────────────────────────────

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return Promise.resolve();
    }
    // Sin cupo: esperamos. `release()` nos cederá el turno directamente (sin
    // decrementar `active`), evitando una carrera con otro waiter.
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next(); // cede el cupo al siguiente sin tocar `active`
    } else {
      this.active--;
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private dedupKey(wamid: string): string {
    return `wamid_seen:${wamid}`;
  }

  private readIntEnv(name: string, fallback: number, min: number): number {
    const raw = process.env[name];
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= min) return parsed;
    return fallback;
  }
}
