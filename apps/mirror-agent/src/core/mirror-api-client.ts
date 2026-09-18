import type {
  AckInput,
  AckResult,
  ChangesInput,
  ChangesResult,
  HandshakeInput,
  HandshakeResult,
  HeartbeatInput,
  OutboxEventDto,
  ReconcileInput,
  ReconcileResult,
  AvailabilityInput,
  AvailabilityResult,
  CatalogInput,
  CatalogResult,
  NoticeRequestDto,
  NoticeRosterInput,
  NoticeRosterResult,
} from '@agenia/shared';

/**
 * Cliente HTTP hacia /mirror/* en apps/api. Interfaz separada de la
 * implementación para poder probar el motor (engine.ts) sin red real.
 */
export interface MirrorApiClient {
  handshake(input: HandshakeInput): Promise<HandshakeResult>;
  getPendingEvents(
    cursorSeq: string,
    limit?: number,
  ): Promise<OutboxEventDto[]>;
  ack(input: AckInput): Promise<AckResult>;
  pushChanges(input: ChangesInput): Promise<ChangesResult>;
  heartbeat(input: HeartbeatInput): Promise<void>;
  reconcile(input: ReconcileInput): Promise<ReconcileResult>;
  uploadAvailability(input: AvailabilityInput): Promise<AvailabilityResult>;
  uploadCatalog(input: CatalogInput): Promise<CatalogResult>;
  /**
   * Avisos masivos, Fase 2 (§5) — EXCLUSIVO del driver cnt-sanvicente-anserma.
   * Un agente de otro driver simplemente nunca tiene peticiones pendientes
   * (nadie las crea para él) y esta llamada siempre devuelve `[]`.
   */
  getPendingNoticeRequests(): Promise<NoticeRequestDto[]>;
  pushNoticeRoster(input: NoticeRosterInput): Promise<NoticeRosterResult>;
}

/**
 * Implementación real sobre `fetch` nativo de Node (>= 18) — sin dependencias
 * nuevas de HTTP. Solo conexiones salientes HTTPS hacia AgenIA (ver
 * PLAN_ESPEJO_HOSPITAL.md §4.1).
 */
/**
 * Cuánto se espera a la API antes de rendirse.
 *
 * 🚨 `fetch` NO trae timeout: sin esto, una red que TRAGA los paquetes en vez
 * de rechazarlos (un cortafuegos que descarta, un enlace caído a media
 * conexión — lo normal en una red hospitalaria) dejaba al agente colgado
 * indefinidamente. Se comprobó desconectando la VM de internet: durante toda
 * la caída el journal no registró UNA sola línea. `systemctl status` decía
 * "active (running)", el proceso estaba vivo, y no sincronizaba nada. El único
 * síntoma llegaba al servidor como ausencia de latido, y quien estuviera
 * delante de la VM no tenía nada que mirar.
 */
const TIMEOUT_MS = 20_000;
/** El pull usa long-poll: el servidor retiene la respuesta hasta 25 s. */
const TIMEOUT_LONG_POLL_MS = 45_000;

/**
 * Quita el `timestamp` del cuerpo de error antes de que entre al mensaje de
 * la excepción.
 *
 * 🚨 POR QUÉ EXISTE. El filtro de excepciones por defecto de NestJS devuelve
 * `{"statusCode":...,"message":...,"error":...,"timestamp":"...","path":...}`
 * — y `FailureReporter` (core/failure-reporter.ts) decide si calla un fallo
 * repetido comparando el MENSAJE COMPLETO contra el anterior. Con el
 * `timestamp` crudo dentro, dos fallos IDÉNTICOS (mismo endpoint, mismo
 * motivo, mismo 403) nunca se ven iguales — cada petición trae un instante
 * distinto — así que el deduplicador nunca encontraba una repetición que
 * silenciar y el agente escupía la línea entera en cada vuelta del bucle.
 *
 * Se vio en producción con `avisos masivos` contra Anserma (org sin esa
 * función habilitada, 2026-09-18): 2.833 líneas de `journalctl` en 24h por el
 * mismo 403, uno por cada sondeo de ~30s — enterrando cualquier error nuevo
 * que sí necesite verse. No es exclusivo de avisos masivos: CUALQUIER bucle
 * de este agente (agenda, catálogo, reconciliación) que falle contra un
 * endpoint que devuelva este formato queda expuesto igual, así que se arregla
 * en el único sitio por el que pasan todas las llamadas — no donde se detectó
 * el síntoma.
 *
 * Si el cuerpo no es JSON o no tiene esta forma, se deja tal cual: es
 * best-effort sobre el formato conocido, nunca a costa de perder el detalle
 * de un error que no lo sigue.
 */
function estabilizarCuerpoError(text: string): string {
  if (!text) return text;
  try {
    const cuerpo = JSON.parse(text) as Record<string, unknown>;
    if ('timestamp' in cuerpo) {
      delete cuerpo.timestamp;
      return JSON.stringify(cuerpo);
    }
    return text;
  } catch {
    return text;
  }
}

export interface HttpMirrorApiClientOptions {
  /** Plazo para las llamadas normales. */
  timeoutMs?: number;
  /** Plazo para el pull, que usa long-poll y tarda a propósito. */
  longPollTimeoutMs?: number;
}

export class HttpMirrorApiClient implements MirrorApiClient {
  private readonly timeoutMs: number;
  private readonly longPollTimeoutMs: number;
  /**
   * URL base SIN barra final.
   *
   * Se normaliza porque el valor lo escribe una persona en el `.env` de la VM
   * del hospital, y `https://api.agenia.co/` produce `//mirror/handshake`:
   * una ruta que el router de la API no reconoce. El agente arrancaría,
   * latiría y fallaría el 100 % de sus llamadas con 404 — sin una sola pista
   * de que el problema es una barra de más.
   */
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly agentToken: string,
    opts: HttpMirrorApiClientOptions = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.longPollTimeoutMs = opts.longPollTimeoutMs ?? TIMEOUT_LONG_POLL_MS;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const plazo = timeoutMs ?? this.timeoutMs;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.agentToken}`,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(plazo),
      });
    } catch (error) {
      // Un timeout llega como AbortError y su mensaje por defecto no dice
      // contra qué se estaba hablando — justo lo que hace falta saber.
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(
          `Mirror API no respondió en ${plazo / 1000}s a ${method} ${path}. ` +
            `¿La VM tiene salida HTTPS hacia ${this.baseUrl}?`,
        );
      }
      throw error;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Mirror API respondió ${res.status} en ${method} ${path}: ${estabilizarCuerpoError(text)}`,
      );
    }

    return (await res.json()) as T;
  }

  handshake(input: HandshakeInput): Promise<HandshakeResult> {
    return this.request('POST', '/mirror/handshake', input);
  }

  getPendingEvents(
    cursorSeq: string,
    limit?: number,
  ): Promise<OutboxEventDto[]> {
    const query = new URLSearchParams({ cursor: cursorSeq });
    if (limit) query.set('limit', String(limit));
    return this.request(
      'GET',
      `/mirror/events?${query.toString()}`,
      undefined,
      this.longPollTimeoutMs,
    );
  }

  ack(input: AckInput): Promise<AckResult> {
    return this.request('POST', '/mirror/ack', input);
  }

  pushChanges(input: ChangesInput): Promise<ChangesResult> {
    return this.request('POST', '/mirror/changes', input);
  }

  async heartbeat(input: HeartbeatInput): Promise<void> {
    await this.request('POST', '/mirror/heartbeat', input);
  }

  reconcile(input: ReconcileInput): Promise<ReconcileResult> {
    return this.request('POST', '/mirror/reconcile', input);
  }

  uploadAvailability(input: AvailabilityInput): Promise<AvailabilityResult> {
    return this.request('POST', '/mirror/availability', input);
  }

  uploadCatalog(input: CatalogInput): Promise<CatalogResult> {
    return this.request('POST', '/mirror/catalog', input);
  }

  getPendingNoticeRequests(): Promise<NoticeRequestDto[]> {
    return this.request('GET', '/mirror/notice-requests');
  }

  pushNoticeRoster(input: NoticeRosterInput): Promise<NoticeRosterResult> {
    return this.request('POST', '/mirror/notice-roster', input);
  }
}
