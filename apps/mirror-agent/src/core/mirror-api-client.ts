import type {
  AckInput,
  AckResult,
  ChangesInput,
  ChangesResult,
  HandshakeInput,
  HandshakeResult,
  HeartbeatInput,
  OutboxEventDto,
} from '@agenia/shared';

/**
 * Cliente HTTP hacia /mirror/* en apps/api. Interfaz separada de la
 * implementación para poder probar el motor (engine.ts) sin red real.
 */
export interface MirrorApiClient {
  handshake(input: HandshakeInput): Promise<HandshakeResult>;
  getPendingEvents(cursorSeq: string, limit?: number): Promise<OutboxEventDto[]>;
  ack(input: AckInput): Promise<AckResult>;
  pushChanges(input: ChangesInput): Promise<ChangesResult>;
  heartbeat(input: HeartbeatInput): Promise<void>;
}

/**
 * Implementación real sobre `fetch` nativo de Node 20 — sin dependencias
 * nuevas de HTTP. Solo conexiones salientes HTTPS hacia AgenIA (ver
 * PLAN_ESPEJO_HOSPITAL.md §4.1).
 */
export class HttpMirrorApiClient implements MirrorApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly agentToken: string,
  ) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.agentToken}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Mirror API respondió ${res.status} en ${method} ${path}: ${text}`,
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
    return this.request('GET', `/mirror/events?${query.toString()}`);
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
}
