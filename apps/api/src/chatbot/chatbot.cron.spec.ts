import { of } from 'rxjs';
import { ChatbotCron } from './chatbot.cron';
import { ChatState, SESSION_TTL } from './chatbot.constants';

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────
const ORG = 'org-1';
const PHONE = '573128513575';
const KEY = `chat_state:${ORG}:${PHONE}`;

function build(opts: {
  state: string;
  ttl: number; // segundos restantes (idle = SESSION_TTL - ttl)
  envMinutes?: string;
  /** Identificador del paciente en la clave de sesión. Default: teléfono. */
  sender?: string;
}) {
  const sender = opts.sender ?? PHONE;
  const key = `chat_state:${ORG}:${sender}`;
  if (opts.envMinutes === undefined) {
    delete process.env.CHATBOT_INACTIVITY_TIMEOUT_MINUTES;
  } else {
    process.env.CHATBOT_INACTIVITY_TIMEOUT_MINUTES = opts.envMinutes;
  }

  const redis = {
    keys: jest.fn(async (pattern: string) =>
      pattern.startsWith('chat_state:') ? [key] : [],
    ),
    get: jest.fn(async () => opts.state),
    ttl: jest.fn(async () => opts.ttl),
    del: jest.fn(async () => 1),
  };
  const httpService = { post: jest.fn(() => of({ data: {} })) };
  const whatsappCredentials = {
    forOrg: jest.fn(async () => ({
      organizationId: ORG,
      phoneNumberId: 'pnid',
      accessToken: 'tok',
      isActive: true,
    })),
  };

  const cron = new ChatbotCron(
    redis as any,
    httpService as any,
    whatsappCredentials as any,
  );
  return { cron, redis, httpService, whatsappCredentials };
}

describe('ChatbotCron — cierre por inactividad', () => {
  afterEach(() => {
    delete process.env.CHATBOT_INACTIVITY_TIMEOUT_MINUTES;
  });

  it('no cierra si el inactivo está por debajo del umbral (default 5 min)', async () => {
    // idle = 100s < 300s → no debe notificar ni limpiar.
    const { cron, redis, httpService } = build({
      state: ChatState.AWAITING_SPECIALTY,
      ttl: SESSION_TTL - 100,
    });

    await cron.handleAbandonedSessions();

    expect(httpService.post).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('cierra y notifica cuando el inactivo supera el umbral (default 5 min)', async () => {
    // idle = 400s >= 300s → notifica + limpia.
    const { cron, redis, httpService } = build({
      state: ChatState.AWAITING_SPECIALTY,
      ttl: SESSION_TTL - 400,
    });

    await cron.handleAbandonedSessions();

    expect(httpService.post).toHaveBeenCalledTimes(1);
    // Limpió la sesión (incluye chat_state).
    const deleted = (redis.del.mock.calls[0] as string[]) ?? [];
    expect(deleted).toContain(KEY);
  });

  it('respeta el umbral configurable por env (2 min)', async () => {
    // idle = 150s; con umbral=2min(120s) → 150 >= 120 → cierra.
    const { cron, httpService } = build({
      state: ChatState.AWAITING_SPECIALTY,
      ttl: SESSION_TTL - 150,
      envMinutes: '2',
    });

    await cron.handleAbandonedSessions();

    expect(httpService.post).toHaveBeenCalledTimes(1);
  });

  it('ignora sesiones en estado IDLE', async () => {
    const { cron, redis, httpService } = build({
      state: ChatState.IDLE,
      ttl: SESSION_TTL - 9999,
    });

    await cron.handleAbandonedSessions();

    expect(httpService.post).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  // El cron replica el juego de claves de ChatbotService.cleanUpSession. Los
  // cupos ofrecidos van scoped por organización (slotKey/slotDateKey), así que
  // el patrón debe incluir el tenant: con `temp_slot_*:<phone>` a secas, cerrar
  // por inactividad en una clínica borraba los cupos que otra le estaba
  // ofreciendo al mismo paciente.
  it('busca los cupos ofrecidos con el patrón scoped por organización', async () => {
    const { cron, redis } = build({
      state: ChatState.AWAITING_DATE,
      ttl: SESSION_TTL - 400,
    });

    await cron.handleAbandonedSessions();

    const patrones = redis.keys.mock.calls.map((c: string[]) => c[0]);
    expect(patrones).toContain(`temp_slot_*:${ORG}:${PHONE}`);
    expect(patrones).not.toContain(`temp_slot_*:${PHONE}`);
  });

  // ── Destinatario: teléfono vs BSUID ──────────────────────────────────
  it('sesión de un teléfono → el aviso de cierre va en `to`', async () => {
    const { cron, httpService } = build({
      state: ChatState.AWAITING_SPECIALTY,
      ttl: SESSION_TTL - 400,
    });

    await cron.handleAbandonedSessions();

    const [, body] = httpService.post.mock.calls[0] as any[];
    expect(body).toMatchObject({ to: PHONE });
    expect(body).not.toHaveProperty('recipient');
  });

  it('sesión de un BSUID → el aviso de cierre va en `recipient`', async () => {
    const BSUID = 'CO.13491208655302741918';
    const { cron, httpService } = build({
      state: ChatState.AWAITING_SPECIALTY,
      ttl: SESSION_TTL - 400,
      sender: BSUID,
    });

    await cron.handleAbandonedSessions();

    const [, body] = httpService.post.mock.calls[0] as any[];
    expect(body).toMatchObject({ recipient: BSUID });
    expect(body).not.toHaveProperty('to');
  });

  it('la URL del cron ya no lleva v19.0 incrustada', async () => {
    const { cron, httpService } = build({
      state: ChatState.AWAITING_SPECIALTY,
      ttl: SESSION_TTL - 400,
    });

    await cron.handleAbandonedSessions();

    const [url] = httpService.post.mock.calls[0] as any[];
    expect(url).not.toContain('v19.0');
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\//);
  });
});
