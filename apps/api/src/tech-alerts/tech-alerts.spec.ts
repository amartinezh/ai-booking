import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ALFABETO_CODIGO_VINCULACION, DATO_OCULTO } from '@agenia/shared';
import { TechAlertConfigService } from './tech-alert-config.service';
import { TechAlertDispatcher } from './tech-alert.dispatcher';
import { TechAlertService } from './tech-alert.service';
import { contenidoArchivoVigia } from './tech-alert-vigia';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TechAlertActor } from './tech-alerts.types';
import type { PrismaService } from '../prisma/prisma.service';
import type { CryptoService } from '../common/crypto/crypto.service';
import type { TelegramApiClient } from '../telegram/telegram-api.client';

/**
 * 🚨 Alertas técnicas por Telegram (docs/PLAN_ALERTAS_TECNICAS.md, Fase 1):
 * configuración, `avisar`/`resolver` y el despachador, juntos, contra una base
 * falsa en memoria que respeta el índice parcial (una ABIERTA por clave) y un
 * Telegram falso.
 *
 * Lo que no puede fallar:
 *  1. Un mensaje por PROBLEMA, no por chequeo; el «resuelto» solo de lo avisado.
 *  2. Nada sale apagado, silenciado o con la categoría apagada (pero queda).
 *  3. Dos réplicas no mandan lo mismo dos veces.
 *  4. Con la base caída, se avisa igual.
 *  5. El token nunca vuelve al panel en claro, y el bot de una clínica no sirve.
 */

// ── Base falsa ──────────────────────────────────────────────────────────────

type Fila = Record<string, unknown>;

const comparable = (v: unknown): number | string =>
  v instanceof Date ? v.getTime() : (v as number | string);

function igual(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }
  return a === b;
}

function coincide(fila: Fila, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') {
      return (cond as Record<string, unknown>[]).some((w) => coincide(fila, w));
    }
    const v = fila[k] ?? null;
    if (cond === null) return v === null;
    if (cond instanceof Date || typeof cond !== 'object') return igual(v, cond);
    const c = cond as Record<string, unknown>;
    if ('not' in c && (c.not === null ? v === null : igual(v, c.not))) {
      return false;
    }
    if ('in' in c && !(c.in as unknown[]).includes(v)) return false;
    if ('gt' in c && !(v !== null && comparable(v) > comparable(c.gt)))
      return false;
    if ('gte' in c && !(v !== null && comparable(v) >= comparable(c.gte))) {
      return false;
    }
    if ('lt' in c && !(v !== null && comparable(v) < comparable(c.lt)))
      return false;
    return true;
  });
}

function aplicar(fila: Fila, data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (
      v &&
      typeof v === 'object' &&
      !(v instanceof Date) &&
      'increment' in v
    ) {
      fila[k] =
        ((fila[k] as number) ?? 0) + (v as { increment: number }).increment;
    } else {
      fila[k] = v;
    }
  }
  fila.updatedAt = new Date();
}

const CONFIG_POR_DEFECTO: Fila = {
  id: 'global',
  enabled: false,
  encryptedBotToken: null,
  botId: null,
  botUsername: null,
  chatId: null,
  chatTitle: null,
  linkCode: null,
  linkCodeExpiresAt: null,
  mutedUntil: null,
  categories: null,
  reminderMinutes: 60,
  maxReminders: 3,
  quietHoursEnabled: true,
  quietFromHour: 22,
  quietToHour: 6,
  dailySummaryEnabled: true,
  lastDailySummaryAt: null,
  panelBaseUrl: null,
  lastOkAt: null,
  lastError: null,
  lastErrorAt: null,
  updatedByUserId: null,
  updatedByEmail: null,
};

class BaseFalsa {
  alertas: Fila[] = [];
  config: Fila | null = null;
  auditorias: Fila[] = [];
  botsDeClinica: Fila[] = [];
  /** La base no responde. */
  caida = false;
  private seq = 0;

  private vigilar() {
    if (this.caida) throw new Error("Can't reach database server at db:5432");
  }

  private seleccionar(
    where: Record<string, unknown> | undefined,
    orderBy?: Record<string, 'asc' | 'desc'>,
    take?: number,
  ): Fila[] {
    let filas = this.alertas.filter((f) => coincide(f, where));
    if (orderBy) {
      const [campo, dir] = Object.entries(orderBy)[0];
      filas = [...filas].sort((a, b) => {
        const d =
          (comparable(a[campo]) as number) - (comparable(b[campo]) as number);
        return dir === 'asc' ? d : -d;
      });
    }
    return take ? filas.slice(0, take) : filas;
  }

  readonly prisma = {
    techAlert: {
      findMany: async (a: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, 'asc' | 'desc'>;
        take?: number;
        skip?: number;
      }) => {
        this.vigilar();
        const filas = this.seleccionar(a.where, a.orderBy);
        return filas.slice(
          a.skip ?? 0,
          (a.skip ?? 0) + (a.take ?? filas.length),
        );
      },
      findFirst: async (a: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, 'asc' | 'desc'>;
      }) => {
        this.vigilar();
        return this.seleccionar(a.where, a.orderBy, 1)[0] ?? null;
      },
      count: async (a: { where?: Record<string, unknown> }) => {
        this.vigilar();
        return this.seleccionar(a.where).length;
      },
      create: async ({ data }: { data: Fila }) => {
        this.vigilar();
        const status = (data.status as string) ?? 'ABIERTA';
        if (
          status === 'ABIERTA' &&
          this.alertas.some(
            (f) => f.status === 'ABIERTA' && f.dedupeKey === data.dedupeKey,
          )
        ) {
          throw Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          });
        }
        const ahora = new Date();
        const fila: Fila = {
          id: `a${++this.seq}`,
          detail: null,
          organizationId: null,
          organizationName: null,
          serviceIncidentId: null,
          meta: null,
          occurrences: 1,
          firstSeenAt: ahora,
          lastSeenAt: ahora,
          resolvedAt: null,
          notifiedAt: null,
          notifiedSeverity: null,
          resolutionNotifiedAt: null,
          reminderCount: 0,
          lastReminderAt: null,
          sendAttempts: 0,
          lastSendAttemptAt: null,
          lastSendError: null,
          claimedAt: null,
          createdAt: ahora,
          updatedAt: ahora,
          ...data,
          status,
        };
        this.alertas.push(fila);
        return fila;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        this.vigilar();
        const fila = this.alertas.find((f) => f.id === where.id);
        if (!fila) throw new Error('Record not found');
        aplicar(fila, data);
        return fila;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        this.vigilar();
        const filas = this.alertas.filter((f) => coincide(f, where));
        filas.forEach((f) => aplicar(f, data));
        return { count: filas.length };
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        this.vigilar();
        const antes = this.alertas.length;
        this.alertas = this.alertas.filter((f) => !coincide(f, where));
        return { count: antes - this.alertas.length };
      },
    },
    techAlertConfig: {
      findUnique: async () => {
        this.vigilar();
        return this.config ? { ...this.config } : null;
      },
      upsert: async ({ create, update }: { create: Fila; update: Fila }) => {
        this.vigilar();
        this.config = this.config
          ? { ...this.config, ...update, updatedAt: new Date() }
          : { ...CONFIG_POR_DEFECTO, ...create, updatedAt: new Date() };
        return this.config;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        this.vigilar();
        if (!this.config) throw new Error('Record not found');
        aplicar(this.config, data);
        return this.config;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        this.vigilar();
        if (this.config && coincide(this.config, where)) {
          aplicar(this.config, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    telegramBotConfig: {
      findUnique: async ({ where }: { where: { botId: string } }) =>
        this.botsDeClinica.find((b) => b.botId === where.botId) ?? null,
    },
    globalAuditLog: {
      create: async ({ data }: { data: Fila }) => {
        this.auditorias.push(data);
        return data;
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
}

// ── Montaje ─────────────────────────────────────────────────────────────────

/** Lunes 19-oct-2026, 10:38:41 en Bogotá: fuera del horario nocturno. */
const T0 = Date.parse('2026-10-19T15:38:41.512Z');
const MIN = 60_000;
const TOKEN = '555000111:AAHsecretoSecretoSecretoSecreto12345';
const GRUPO = '-1001234567890';
const ACTOR: TechAlertActor = {
  userId: 'u-super',
  email: 'soporte@agenia.co',
  ip: '186.87.28.46',
};
const ORG = '97f18182-d0d9-4a3b-9eb6-4fbc031b917c';

const cipher = {
  encrypt: (s: string) => `cif:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith('cif:')) throw new Error('bad');
    return s.slice(4);
  },
};

function montar() {
  const base = new BaseFalsa();
  const api = {
    getMe: jest.fn(async () => ({
      ok: true,
      result: { id: 555000111, is_bot: true, username: 'AgeniaTecnicoBot' },
    })),
    deleteWebhook: jest.fn(async () => ({ ok: true, result: true })),
    getUpdates: jest.fn(
      async (): Promise<unknown> => ({ ok: true, result: [] }),
    ),
    sendMessage: jest.fn(
      async (..._args: unknown[]): Promise<unknown> => ({
        ok: true,
        result: { message_id: 1 },
      }),
    ),
  };
  const prisma = base.prisma as unknown as PrismaService;
  const config = new TechAlertConfigService(
    prisma,
    cipher as unknown as CryptoService,
    api as unknown as TelegramApiClient,
  );
  const dispatcher = new TechAlertDispatcher(prisma, config);
  const alertas = new TechAlertService(prisma, config, dispatcher);
  const enviados = () =>
    api.sendMessage.mock.calls.map((c) => ({
      chatId: c[1] as string,
      texto: c[2] as string,
      silent: Boolean((c[3] as { silent?: boolean } | undefined)?.silent),
    }));
  /** Bot conectado, grupo vinculado y canal encendido. */
  const conectado = (extra: Fila = {}) => {
    base.config = {
      ...CONFIG_POR_DEFECTO,
      encryptedBotToken: `cif:${TOKEN}`,
      botId: '555000111',
      botUsername: 'AgeniaTecnicoBot',
      chatId: GRUPO,
      chatTitle: 'AgenIA · Técnico',
      enabled: true,
      panelBaseUrl: 'https://app.hsvpanserma.agenia.co',
      // El resumen de hoy ya salió: las pruebas del resumen lo ponen en null.
      lastDailySummaryAt: new Date(T0),
      updatedAt: new Date(),
      ...extra,
    };
    config.invalidar();
  };
  return { base, api, config, dispatcher, alertas, enviados, conectado };
}

const espejoCaido = {
  kind: 'SERVICIO_CAIDO' as const,
  dedupeKey: 'servicio:mirror',
  title: 'Espejo con el HIS',
  detail: `Sin heartbeat del agente hace 7 min (org ${ORG}).`,
  category: 'ESPEJO' as const,
  organizationId: ORG,
  organizationName: 'E.S.E. Hospital San Vicente de Paúl',
  fuente: 'centinela del monitor',
};

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
  });
  jest.setSystemTime(T0);
  for (const nivel of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, nivel).mockImplementation();
  }
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const avanzar = (min: number) => jest.setSystemTime(Date.now() + min * MIN);

// ── Configuración ───────────────────────────────────────────────────────────

describe('TechAlertConfigService — conectar el bot', () => {
  it('rechaza lo que no tiene forma de token sin llamar a Telegram', async () => {
    const { config, api } = montar();
    await expect(config.connect('hola', ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(config.connect(undefined, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it('un token que Telegram rechaza es un 400; Telegram caído, un 503', async () => {
    const { config, api } = montar();
    api.getMe.mockResolvedValueOnce({
      ok: false,
      errorCode: 401,
      description: 'Unauthorized',
    } as never);
    await expect(config.connect(TOKEN, ACTOR)).rejects.toThrow(
      /rechazó el token/,
    );
    api.getMe.mockResolvedValueOnce({
      ok: false,
      errorCode: null,
      description: 'timeout',
    } as never);
    await expect(config.connect(TOKEN, ACTOR)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('🏥 el bot de una clínica no sirve para las alertas (A1)', async () => {
    const { config, base } = montar();
    base.botsDeClinica.push({ botId: '555000111', organizationId: ORG });
    await expect(config.connect(TOKEN, ACTOR)).rejects.toThrow(
      /atiende pacientes/,
    );
    expect(base.config).toBeNull();
  });

  it('guarda el token cifrado, quita el webhook, audita y NUNCA devuelve el token', async () => {
    const { config, base, api } = montar();
    const pub = await config.connect(`  ${TOKEN}  `, ACTOR);
    expect(api.deleteWebhook).toHaveBeenCalledWith(TOKEN);
    expect(base.config?.encryptedBotToken).toBe(`cif:${TOKEN}`);
    expect(pub).toMatchObject({
      connected: true,
      botUsername: 'AgeniaTecnicoBot',
      botLink: 'https://t.me/AgeniaTecnicoBot',
      botTokenLast4: '2345',
      chatLinked: false,
      enabled: false,
    });
    expect(JSON.stringify(pub)).not.toContain('AAHsecreto');
    expect(base.auditorias).toHaveLength(1);
    expect(base.auditorias[0]).toMatchObject({
      action: 'TECH_ALERTS_CONFIG_CHANGED',
      actorId: 'u-super',
      actorEmail: 'soporte@agenia.co',
      ipAddress: '186.87.28.46',
    });
    expect(JSON.stringify(base.auditorias)).not.toContain('AAHsecreto');
  });

  it('renovar el MISMO bot conserva el grupo; cambiar de bot obliga a vincular de nuevo', async () => {
    const { config, base, api, conectado } = montar();
    conectado();
    await config.connect(TOKEN, ACTOR);
    expect(base.config).toMatchObject({ chatId: GRUPO, enabled: true });

    api.getMe.mockResolvedValueOnce({
      ok: true,
      result: { id: 999000222, is_bot: true, username: 'OtroBot' },
    });
    await config.connect(
      '999000222:AAHotroOtroOtroOtroOtroOtroOtro9876',
      ACTOR,
    );
    expect(base.config).toMatchObject({
      botId: '999000222',
      chatId: null,
      enabled: false,
    });
  });

  it('desconectar se despide del grupo y olvida bot y grupo', async () => {
    const { config, base, enviados, conectado } = montar();
    conectado();
    const pub = await config.disconnect(ACTOR);
    expect(enviados()[0].texto).toMatch(/ya no recibirá las alertas/);
    expect(base.config).toMatchObject({
      encryptedBotToken: null,
      chatId: null,
      enabled: false,
    });
    expect(pub.connected).toBe(false);
    expect(base.auditorias).toHaveLength(1);
  });

  it('desconectar sin bot no hace nada', async () => {
    const { config, base } = montar();
    await expect(config.disconnect(ACTOR)).resolves.toMatchObject({
      connected: false,
    });
    expect(base.auditorias).toHaveLength(0);
  });
});

describe('TechAlertConfigService — vincular el grupo', () => {
  const update = (id: number, texto: string, chat: Fila) => ({
    update_id: id,
    message: { message_id: id, text: texto, chat },
  });

  async function conCodigo() {
    const m = montar();
    await m.config.connect(TOKEN, ACTOR);
    const pub = await m.config.startLink(ACTOR);
    return { ...m, codigo: pub.linkPending!.code, pub };
  }

  it('sin bot no hay código', async () => {
    const { config } = montar();
    await expect(config.startLink(ACTOR)).rejects.toThrow(/conecte el bot/);
  });

  it('el código es de 6 caracteres sin confusiones, vence en 15 min y trae el comando listo', async () => {
    const { codigo, pub } = await conCodigo();
    expect(codigo).toHaveLength(6);
    expect(
      [...codigo].every((c) => ALFABETO_CODIGO_VINCULACION.includes(c)),
    ).toBe(true);
    expect(pub.linkPending).toEqual({
      code: codigo,
      command: `/vincular@AgeniaTecnicoBot ${codigo}`,
      expiresAt: new Date(T0 + 15 * MIN),
    });
  });

  it('encuentra el grupo, le da la bienvenida, lo enciende y confirma lo leído', async () => {
    const { config, base, api, codigo, enviados } = await conCodigo();
    api.getUpdates.mockResolvedValueOnce({
      ok: true,
      result: [
        update(10, 'hola', { id: -1, type: 'group', title: 'Otro' }),
        update(11, `/vincular@AgeniaTecnicoBot ${codigo.toLowerCase()}`, {
          id: Number(GRUPO),
          type: 'supergroup',
          title: 'AgenIA · Técnico',
        }),
      ],
    });
    const r = await config.findLink(ACTOR);
    expect(r.found).toBe(true);
    expect(enviados()).toEqual([
      expect.objectContaining({
        chatId: GRUPO,
        texto: expect.stringMatching(/recibirá las alertas técnicas/),
      }),
    ]);
    expect(base.config).toMatchObject({
      chatId: GRUPO,
      chatTitle: 'AgenIA · Técnico',
      enabled: true,
      linkCode: null,
      // El primer resumen llega mañana, no justo después de la bienvenida.
      lastDailySummaryAt: new Date(T0),
    });
    expect(api.getUpdates).toHaveBeenLastCalledWith(TOKEN, {
      offset: 12,
      limit: 1,
    });
    expect(base.auditorias.at(-1)?.message).toMatch(
      /vinculó el grupo «AgenIA · Técnico»/,
    );
  });

  it('si el código no llegó, lo dice (y no vincula nada)', async () => {
    const { config, base } = await conCodigo();
    await expect(config.findLink(ACTOR)).resolves.toMatchObject({
      found: false,
      reason: 'NO_LLEGO',
    });
    expect(base.config?.chatId).toBeNull();
  });

  it('un código escrito en un chat privado no vincula: tiene que ser un grupo', async () => {
    const { config, api, codigo } = await conCodigo();
    api.getUpdates.mockResolvedValueOnce({
      ok: true,
      result: [
        update(5, `/vincular ${codigo}`, { id: 123456789, type: 'private' }),
      ],
    });
    await expect(config.findLink(ACTOR)).resolves.toMatchObject({
      found: false,
      reason: 'CHAT_PRIVADO',
    });
  });

  it('sin código, o vencido, no busca', async () => {
    const m = montar();
    await m.config.connect(TOKEN, ACTOR);
    await expect(m.config.findLink(ACTOR)).resolves.toMatchObject({
      reason: 'SIN_CODIGO',
    });
    await m.config.startLink(ACTOR);
    avanzar(16);
    await expect(m.config.findLink(ACTOR)).resolves.toMatchObject({
      reason: 'VENCIDO',
    });
    expect((await m.config.getPublic()).linkPending).toBeNull();
    expect(m.api.getUpdates).not.toHaveBeenCalled();
  });

  it('con un webhook puesto por fuera (409), lo quita y reintenta', async () => {
    const { config, api } = await conCodigo();
    api.getUpdates.mockResolvedValueOnce({
      ok: false,
      errorCode: 409,
      description: 'Conflict',
    });
    await config.findLink(ACTOR);
    expect(api.deleteWebhook).toHaveBeenCalledTimes(2);
    expect(api.getUpdates).toHaveBeenCalledTimes(2);
  });

  it('token revocado → 400; Telegram caído → 503', async () => {
    const { config, api } = await conCodigo();
    api.getUpdates.mockResolvedValueOnce({
      ok: false,
      errorCode: 401,
      description: 'Unauthorized',
    });
    await expect(config.findLink(ACTOR)).rejects.toThrow(/revocó/);
    api.getUpdates.mockResolvedValueOnce({
      ok: false,
      errorCode: null,
      description: 'timeout',
    });
    await expect(config.findLink(ACTOR)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('si no puede escribirle al grupo, no lo vincula', async () => {
    const { config, base, api, codigo } = await conCodigo();
    api.getUpdates.mockResolvedValueOnce({
      ok: true,
      result: [update(1, `/vincular ${codigo}`, { id: -5, type: 'group' })],
    });
    api.sendMessage.mockResolvedValueOnce({
      ok: false,
      errorCode: 403,
      description: 'Forbidden: bot is not a member',
    });
    await expect(config.findLink(ACTOR)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(base.config?.chatId).toBeNull();
  });

  it('si el grupo pasó a supergrupo justo ahora, guarda el id nuevo', async () => {
    const { config, base, api, codigo } = await conCodigo();
    api.getUpdates.mockResolvedValueOnce({
      ok: true,
      result: [
        update(1, `/vincular ${codigo}`, { id: -5, type: 'group', title: 'G' }),
      ],
    });
    api.sendMessage.mockResolvedValueOnce({
      ok: false,
      errorCode: 400,
      description: 'upgraded',
      migrateToChatId: '-100555',
    });
    await config.findLink(ACTOR);
    expect(base.config?.chatId).toBe('-100555');
  });
});

describe('TechAlertConfigService — ajustes, silencio y prueba', () => {
  it('no se enciende sin bot y grupo', async () => {
    const { config } = montar();
    await expect(
      config.updateSettings({ enabled: true }, ACTOR),
    ).rejects.toThrow(/vincule el grupo/);
  });

  it('lo imposible cae dentro de los límites; las categorías no nombradas siguen encendidas', async () => {
    const { config, conectado, base } = montar();
    conectado();
    const pub = await config.updateSettings(
      {
        reminderMinutes: 5,
        maxReminders: 50,
        categories: { ERRORES: false },
        quietFromHour: 23,
        dailySummaryEnabled: false,
      },
      ACTOR,
    );
    expect(pub).toMatchObject({
      reminderMinutes: 15,
      maxReminders: 10,
      quietFromHour: 23,
      quietToHour: 6,
      dailySummaryEnabled: false,
      enabled: true,
    });
    expect(pub.categories).toMatchObject({ ERRORES: false, ESPEJO: true });
    expect(base.auditorias.at(-1)?.message).toMatch(/cambió los ajustes/);
  });

  it('la URL de los enlaces: válida, vacía (= la de la API) o rechazada', async () => {
    const { config, conectado } = montar();
    conectado({ panelBaseUrl: null });
    process.env.PUBLIC_API_URL = 'https://app.hsvpanserma.agenia.co/api';
    await expect(
      config.updateSettings({ panelBaseUrl: 'ftp://x' }, ACTOR),
    ).rejects.toThrow(/https/);
    let pub = await config.updateSettings(
      { panelBaseUrl: 'https://panel.agenia.co/' },
      ACTOR,
    );
    expect(pub.panelBaseUrl).toBe('https://panel.agenia.co');
    pub = await config.updateSettings({ panelBaseUrl: '' }, ACTOR);
    expect(pub.panelBaseUrl).toBeNull();
    expect(pub.panelBaseEffective).toBe('https://app.hsvpanserma.agenia.co');
    delete process.env.PUBLIC_API_URL;
  });

  it('apagar y encender quedan en la auditoría', async () => {
    const { config, conectado, base } = montar();
    conectado();
    await config.updateSettings({ enabled: false }, ACTOR);
    expect(base.auditorias.at(-1)?.message).toMatch(/apagó las alertas/);
    await config.updateSettings({ enabled: true }, ACTOR);
    expect(base.auditorias.at(-1)?.message).toMatch(/encendió las alertas/);
  });

  it('silenciar 1 hora, hasta mañana a las 7, y quitar el silencio', async () => {
    const { config, conectado } = montar();
    conectado();
    await expect(config.mute('UN_RATO', ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect((await config.mute('UNA_HORA', ACTOR)).mutedUntil).toEqual(
      new Date(T0 + 60 * MIN),
    );
    expect((await config.mute('HASTA_MANANA', ACTOR)).mutedUntil).toEqual(
      new Date('2026-10-20T12:00:00Z'),
    );
    expect((await config.unmute(ACTOR)).mutedUntil).toBeNull();
  });

  it('silenciar sin configuración no tiene sentido', async () => {
    const { config } = montar();
    await expect(config.mute('UNA_HORA', ACTOR)).rejects.toThrow(
      /conecte el bot/,
    );
  });

  it('la prueba sale aunque esté apagado, con sonido, y deja la salud del canal', async () => {
    const { config, conectado, enviados, base } = montar();
    await expect(config.sendTest()).rejects.toBeInstanceOf(BadRequestException);
    conectado({ enabled: false });
    await expect(config.sendTest()).resolves.toEqual({ ok: true });
    expect(enviados()[0]).toMatchObject({ chatId: GRUPO, silent: false });
    expect(enviados()[0].texto).toMatch(/Mensaje de prueba/);
    expect(base.config?.lastOkAt).toEqual(new Date(T0));
  });

  it('si el bot ya no está en el grupo, lo dice y queda en la salud del canal', async () => {
    const { config, conectado, api, base } = montar();
    conectado();
    api.sendMessage.mockResolvedValueOnce({
      ok: false,
      errorCode: 403,
      description: 'Forbidden: bot was kicked from the supergroup chat',
    });
    const r = await config.sendTest();
    expect(r).toMatchObject({ ok: false, errorCode: 403 });
    expect(base.config?.lastError).toMatch(/ya no puede escribir en el grupo/);
    expect(base.config?.lastErrorAt).toEqual(new Date(T0));
  });

  it('la copia en memoria evita leer la base en cada envío', async () => {
    const { config, conectado, base } = montar();
    conectado();
    const lectura = jest.spyOn(base.prisma.techAlertConfig, 'findUnique');
    await config.canal();
    await config.canal();
    expect(lectura).toHaveBeenCalledTimes(1);
    avanzar(2);
    await config.canal();
    expect(lectura).toHaveBeenCalledTimes(2);
  });
});

// ── avisar → despachar ──────────────────────────────────────────────────────

describe('TechAlertService + despachador — un mensaje por problema', () => {
  it('un problema nuevo se avisa una vez, con todo lo que el equipo necesita', async () => {
    const { alertas, dispatcher, conectado, enviados, base } = montar();
    conectado();
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(1);
    const { texto, silent, chatId } = enviados()[0];
    expect(chatId).toBe(GRUPO);
    expect(silent).toBe(false);
    expect(texto.split('\n')[0]).toBe('🔴 CRÍTICA · Servicio caído');
    expect(texto).toContain('Clínica: E.S.E. Hospital San Vicente de Paúl');
    expect(texto).toContain('Detectado por: centinela del monitor');
    expect(texto).toContain(
      'Ver: https://app.hsvpanserma.agenia.co/super-admin/monitor',
    );
    expect(base.alertas[0]).toMatchObject({
      status: 'ABIERTA',
      notifiedSeverity: 'CRITICA',
      sendAttempts: 1,
      claimedAt: null,
    });
  });

  it('el mismo fallo otra vez suma ocurrencias en la MISMA fila y no manda otro mensaje', async () => {
    const { alertas, dispatcher, conectado, enviados, base } = montar();
    conectado();
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    expect(base.alertas).toHaveLength(1);
    expect(base.alertas[0].occurrences).toBe(2);
    expect(enviados()).toHaveLength(1);
  });

  it('se recuerda a los 60 min, hasta 3 veces', async () => {
    const { alertas, dispatcher, conectado, enviados } = montar();
    conectado();
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    for (let i = 0; i < 5; i++) {
      avanzar(60);
      await dispatcher.vuelta();
    }
    const textos = enviados().map((e) => e.texto.split('\n')[0]);
    expect(textos).toEqual([
      '🔴 CRÍTICA · Servicio caído',
      '⏰ RECORDATORIO 1 de 3 · 🔴 CRÍTICA · Servicio caído',
      '⏰ RECORDATORIO 2 de 3 · 🔴 CRÍTICA · Servicio caído',
      '⏰ RECORDATORIO 3 de 3 · 🔴 CRÍTICA · Servicio caído',
    ]);
  });

  it('al resolverse, el «resuelto» con la duración; y otra caída es un problema NUEVO', async () => {
    const { alertas, dispatcher, conectado, enviados, base } = montar();
    conectado();
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    avanzar(6);
    await alertas.resolver('servicio:mirror');
    await dispatcher.vuelta();
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(2);
    expect(enviados()[1].texto).toMatch(/^✅ RESUELTO · Servicio caído/);
    expect(enviados()[1].texto).toContain('Duró 6 min');

    avanzar(60);
    await alertas.avisar(espejoCaido);
    expect(base.alertas).toHaveLength(2);
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(3);
  });

  it('lo que se resolvió antes de avisar no se anuncia', async () => {
    const { alertas, dispatcher, conectado, enviados } = montar();
    conectado({ mutedUntil: new Date(T0 + 30 * MIN) });
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    await alertas.resolver('servicio:mirror');
    avanzar(31);
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(0);
  });

  it('si empeora (degradado → caído), se avisa de nuevo con «empeoró»', async () => {
    const { alertas, dispatcher, conectado, enviados, base } = montar();
    conectado();
    await alertas.avisar({
      ...espejoCaido,
      kind: 'SERVICIO_DEGRADADO',
      detail: 'La cola no avanza.',
    });
    await dispatcher.vuelta();
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    expect(base.alertas).toHaveLength(1);
    expect(enviados().map((e) => e.texto.split('\n')[0])).toEqual([
      '🟠 ADVERTENCIA · Servicio degradado',
      '🔴 CRÍTICA · Servicio caído (empeoró)',
    ]);
  });

  it('una tarea que falla tres veces seguidas sube a crítica y se vuelve a avisar', async () => {
    const { alertas, dispatcher, conectado, enviados } = montar();
    conectado();
    const cron = {
      kind: 'CRON_FALLO' as const,
      dedupeKey: 'cron:retencion',
      title: 'Retención',
      detail: 'timeout',
    };
    for (let i = 0; i < 3; i++) {
      await alertas.avisar(cron);
      await dispatcher.vuelta();
      avanzar(5); // tres fallos a lo largo de 10 minutos
    }
    expect(enviados().map((e) => e.texto.split('\n')[0])).toEqual([
      '🟠 ADVERTENCIA · Una tarea programada falló',
      '🔴 CRÍTICA · Una tarea programada falló (empeoró)',
    ]);
  });

  it('lo que se abre en la misma vuelta va en UN mensaje', async () => {
    const { alertas, dispatcher, conectado, enviados } = montar();
    conectado();
    for (const [key, name] of [
      ['gemini', 'Gemini AI'],
      ['meta', 'Meta WhatsApp Cloud API'],
    ]) {
      await alertas.avisar({
        kind: 'SERVICIO_DEGRADADO',
        dedupeKey: `servicio:${key}`,
        title: name,
        detail: 'Latencia 4096ms supera el umbral de 3000ms.',
      });
    }
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(1);
    expect(enviados()[0].texto.split('\n')[0]).toBe('🟠 2 alertas nuevas');
  });

  it('pide la vuelta sola unos segundos después de avisar', async () => {
    const { alertas, dispatcher, conectado } = montar();
    conectado();
    const vuelta = jest.spyOn(dispatcher, 'vuelta').mockResolvedValue({
      enviados: 0,
      fallidos: 0,
      suprimidos: 0,
      resumenDiario: false,
    });
    await alertas.avisar(espejoCaido);
    await alertas.avisar({ ...espejoCaido, dedupeKey: 'servicio:gemini' });
    expect(vuelta).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3_000);
    expect(vuelta).toHaveBeenCalledTimes(1);
    alertas.onModuleDestroy();
  });

  it('🔒 el título y el detalle se guardan sanitizados', async () => {
    const { alertas, dispatcher, conectado, base, enviados } = montar();
    conectado();
    await alertas.avisar({
      ...espejoCaido,
      title: 'Recordatorio a 1088123456',
      detail: 'falló el envío a +57 300 111 2233 (ana@gmail.com)',
    });
    await dispatcher.vuelta();
    expect(base.alertas[0].title).toBe(`Recordatorio a ${DATO_OCULTO}`);
    expect(base.alertas[0].detail).toBe(
      `falló el envío a ${DATO_OCULTO} (${DATO_OCULTO})`,
    );
    expect(enviados()[0].texto).not.toMatch(
      /1088123456|300 111 2233|ana@gmail/,
    );
  });
});

describe('eventos sueltos', () => {
  const error5xx = {
    kind: 'ERROR_5XX' as const,
    dedupeKey: '5xx:500:GET:/appointments/:id:Error',
    title: '500 GET /appointments/:id',
  };

  it('la misma firma, una vez por hora: el resto se cuenta', async () => {
    const { alertas, dispatcher, conectado, enviados, base } = montar();
    conectado();
    await alertas.avisar(error5xx);
    await dispatcher.vuelta();
    avanzar(10);
    await alertas.avisar(error5xx);
    await dispatcher.vuelta();
    expect(base.alertas).toHaveLength(1);
    expect(base.alertas[0]).toMatchObject({ status: 'EVENTO', occurrences: 2 });
    expect(enviados()).toHaveLength(1);
    avanzar(61);
    await alertas.avisar(error5xx);
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(2);
  });

  it('un evento que no salió en su hora ya no se manda (sería viejo)', async () => {
    const { alertas, dispatcher, conectado, enviados } = montar();
    conectado({ enabled: false });
    await alertas.avisar(error5xx);
    await dispatcher.vuelta();
    avanzar(61);
    conectado({ enabled: true });
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(0);
  });

  it('un arranque llega sin sonido', async () => {
    const { alertas, dispatcher, conectado, enviados } = montar();
    conectado();
    await alertas.avisar({
      kind: 'API_ARRANCO',
      dedupeKey: 'api:arranque',
      title: 'API',
    });
    await dispatcher.vuelta();
    expect(enviados()[0]).toMatchObject({ silent: true });
  });
});

describe('lo que no sale (pero queda)', () => {
  it('sin bot conectado no se manda nada, y el problema queda registrado', async () => {
    const { alertas, dispatcher, enviados, base } = montar();
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(0);
    expect(base.alertas).toHaveLength(1);
  });

  it('apagado o con la categoría apagada: nada; al encender, lo que SIGUE abierto sale', async () => {
    const { alertas, dispatcher, conectado, enviados } = montar();
    conectado({ categories: { ESPEJO: false } });
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    conectado({ enabled: false });
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(0);
    conectado();
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(1);
  });

  it('en silencio no sale; al terminar el silencio, sí', async () => {
    const { alertas, dispatcher, conectado, enviados } = montar();
    conectado({ mutedUntil: new Date(T0 + 30 * MIN) });
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(0);
    avanzar(31);
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(1);
  });

  it('de noche, una advertencia llega sin sonido y una crítica con sonido', async () => {
    const { alertas, dispatcher, conectado, enviados } = montar();
    conectado();
    jest.setSystemTime(Date.parse('2026-10-20T04:00:00Z')); // 23:00 en Bogotá
    await alertas.avisar({ ...espejoCaido, kind: 'SERVICIO_DEGRADADO' });
    await dispatcher.vuelta();
    await alertas.avisar({ ...espejoCaido, dedupeKey: 'servicio:gemini' });
    await dispatcher.vuelta();
    expect(enviados().map((e) => e.silent)).toEqual([true, false]);
  });
});

describe('entrega fiable', () => {
  it('si Telegram falla, queda pendiente con el motivo y la vuelta siguiente reintenta', async () => {
    const { alertas, dispatcher, conectado, enviados, api, base } = montar();
    conectado();
    api.sendMessage.mockResolvedValueOnce({
      ok: false,
      errorCode: null,
      description: 'fetch failed',
    });
    await alertas.avisar(espejoCaido);
    const r1 = await dispatcher.vuelta();
    expect(r1).toMatchObject({ enviados: 0, fallidos: 1 });
    expect(base.alertas[0]).toMatchObject({
      notifiedAt: null,
      lastSendError: 'fetch failed',
      sendAttempts: 1,
      claimedAt: null,
    });
    avanzar(1);
    const r2 = await dispatcher.vuelta();
    expect(r2).toMatchObject({ enviados: 1 });
    expect(enviados()).toHaveLength(2);
    expect(base.alertas[0].lastSendError).toBeNull();
  });

  it('si el grupo pasó a supergrupo, lo sigue y reenvía', async () => {
    const { alertas, dispatcher, conectado, enviados, api, base } = montar();
    conectado();
    api.sendMessage.mockResolvedValueOnce({
      ok: false,
      errorCode: 400,
      description: 'Bad Request: group chat was upgraded to a supergroup chat',
      migrateToChatId: '-100999',
    });
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    expect(enviados().map((e) => e.chatId)).toEqual([GRUPO, '-100999']);
    expect(base.config?.chatId).toBe('-100999');
    expect(base.alertas[0].notifiedAt).not.toBeNull();
  });

  it('👥 dos réplicas a la vez: el aviso sale UNA vez', async () => {
    const { alertas, dispatcher, conectado, enviados, base, config } = montar();
    conectado();
    const otra = new TechAlertDispatcher(
      base.prisma as unknown as PrismaService,
      config,
    );
    await alertas.avisar(espejoCaido);
    await Promise.all([dispatcher.vuelta(), otra.vuelta()]);
    expect(enviados()).toHaveLength(1);
  });

  it('👥 dos réplicas abren el mismo problema a la vez: UNA fila', async () => {
    const { alertas, base, config, dispatcher } = montar();
    const otra = new TechAlertService(
      base.prisma as unknown as PrismaService,
      config,
      dispatcher,
    );
    await Promise.all([alertas.avisar(espejoCaido), otra.avisar(espejoCaido)]);
    expect(base.alertas).toHaveLength(1);
    expect(base.alertas[0].occurrences).toBe(2);
    otra.onModuleDestroy();
  });

  it('una vuelta pedida mientras otra corre se hace al terminar', async () => {
    const { dispatcher, conectado } = montar();
    conectado();
    const una = dispatcher.vuelta();
    await expect(dispatcher.vuelta()).resolves.toMatchObject({ enviados: 0 });
    await una;
  });

  it('la vuelta nunca lanza', async () => {
    const { dispatcher, conectado, base } = montar();
    conectado();
    await dispatcher.vuelta(); // deja la copia en memoria
    base.caida = true;
    await expect(dispatcher.vuelta()).resolves.toMatchObject({ enviados: 0 });
  });

  it('🗄️ con la base caída, avisa directo —una vez— y lo dice', async () => {
    const { alertas, conectado, enviados, base, config } = montar();
    conectado();
    await config.canal({ fresco: true });
    base.caida = true;
    await alertas.avisar(espejoCaido);
    await alertas.avisar(espejoCaido);
    expect(enviados()).toHaveLength(1);
    expect(enviados()[0].texto).toMatch(/^🔴 CRÍTICA · Servicio caído/);
    expect(enviados()[0].texto).toMatch(/La base de datos no respondió/);
    // Se resuelve: la próxima caída vuelve a avisarse.
    await alertas.resolver('servicio:mirror');
    await alertas.avisar(espejoCaido);
    expect(enviados()).toHaveLength(2);
  });

  it('🗄️ con la base caída y en silencio, tampoco sale', async () => {
    const { alertas, conectado, enviados, base, config } = montar();
    conectado({ mutedUntil: new Date(T0 + 60 * MIN) });
    await config.canal({ fresco: true });
    base.caida = true;
    await alertas.avisar(espejoCaido);
    expect(enviados()).toHaveLength(0);
  });
});

describe('antirruido: intermitencia y tope', () => {
  it('una clave que se abre y se cierra sin parar: un «intermitente» y silencio', async () => {
    const { alertas, dispatcher, conectado, enviados } = montar();
    conectado();
    for (let i = 0; i < 5; i++) {
      await alertas.avisar(espejoCaido);
      await dispatcher.vuelta();
      avanzar(1);
      await alertas.resolver('servicio:mirror');
      await dispatcher.vuelta();
      avanzar(2);
    }
    const encabezados = enviados().map((e) => e.texto.split('\n')[0]);
    expect(encabezados).toEqual([
      '🔴 CRÍTICA · Servicio caído',
      '✅ RESUELTO · Servicio caído',
      '🔴 CRÍTICA · Servicio caído',
      '✅ RESUELTO · Servicio caído',
      '🔴 CRÍTICA · Servicio caído',
      '✅ RESUELTO · Servicio caído',
      '⚠️ INTERMITENTE · Servicio caído',
    ]);
    expect(enviados()[6].texto).toContain(
      'Se abrió y se cerró 4 veces en 30 min',
    );
  });

  it('lo que no cabe en el tope va en UN «y N alertas más»', async () => {
    const { alertas, dispatcher, conectado, enviados, base } = montar();
    conectado();
    // B ya se avisó y se resolvió: le toca su «resuelto». A es nuevo.
    const b = {
      ...espejoCaido,
      dedupeKey: 'servicio:gemini',
      title: 'Gemini AI',
    };
    await alertas.avisar(b);
    await dispatcher.vuelta();
    await alertas.resolver(b.dedupeKey);
    await alertas.avisar(espejoCaido);
    // Quedan 19 mensajes en los últimos 10 min: cabe UNO, y hacen falta dos.
    (dispatcher as unknown as { enviosRecientes: string[] }).enviosRecientes =
      Array.from({ length: 19 }, () => new Date(T0 - MIN).toISOString());
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(2);
    expect(enviados()[1].texto).toMatch(
      /^🔕 Y 2 alertas más en los últimos 10 min/,
    );
    const [filaB, filaA] = base.alertas;
    expect(filaA.meta).toMatchObject({ suprimida: 'TOPE' });
    expect(filaA.notifiedAt).not.toBeNull();
    expect(filaB.resolutionNotifiedAt).not.toBeNull();
    // El «resuelto» de A tampoco se anuncia.
    await alertas.resolver('servicio:mirror');
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(2);
    expect(filaA.resolutionNotifiedAt).not.toBeNull();
  });

  it('sin cupo ni para el «y N más», todo espera a la vuelta siguiente', async () => {
    const { alertas, dispatcher, conectado, enviados, base } = montar();
    conectado();
    (dispatcher as unknown as { enviosRecientes: string[] }).enviosRecientes =
      Array.from({ length: 20 }, () => new Date(T0 - MIN).toISOString());
    await alertas.avisar(espejoCaido);
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(0);
    expect(base.alertas[0]).toMatchObject({
      notifiedAt: null,
      claimedAt: null,
    });
    avanzar(10);
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(1);
  });
});

describe('resumen diario (A13)', () => {
  const SIETE_Y_CINCO = Date.parse('2026-10-19T12:05:00Z'); // 07:05 en Bogotá

  it('sale una vez a las 7, sin sonido, con lo de ayer y lo abierto', async () => {
    const { dispatcher, conectado, enviados, base } = montar();
    jest.setSystemTime(SIETE_Y_CINCO);
    conectado({ lastDailySummaryAt: new Date('2026-10-18T12:00:10Z') });
    const ayer = new Date('2026-10-18T20:00:00Z');
    base.alertas.push(
      {
        id: 'x1',
        kind: 'SERVICIO_CAIDO',
        category: 'ESPEJO',
        severity: 'CRITICA',
        status: 'ABIERTA',
        dedupeKey: 'servicio:mirror',
        title: 'Espejo con el HIS',
        detail: null,
        organizationName: null,
        meta: null,
        occurrences: 1,
        firstSeenAt: ayer,
        resolvedAt: null,
        notifiedAt: ayer,
        notifiedSeverity: 'CRITICA',
        reminderCount: 3,
        lastReminderAt: ayer,
        claimedAt: null,
      },
      {
        id: 'x2',
        kind: 'API_ARRANCO',
        category: 'ARRANQUES',
        severity: 'INFO',
        status: 'EVENTO',
        dedupeKey: 'api:arranque',
        title: 'API',
        firstSeenAt: ayer,
        notifiedAt: ayer,
        meta: null,
      },
    );
    await dispatcher.vuelta();
    await dispatcher.vuelta();
    const resumenes = enviados().filter((e) => e.texto.startsWith('☀️'));
    expect(resumenes).toHaveLength(1);
    expect(resumenes[0].silent).toBe(true);
    // Los arranques (INFO) no cuentan como problemas.
    expect(resumenes[0].texto).toContain(
      'Ese día: 1 problema (1 crítico), 0 resueltos.',
    );
    expect(resumenes[0].texto).toContain('Abiertos ahora: 1');
    expect(base.config?.lastDailySummaryAt).toEqual(new Date(SIETE_Y_CINCO));
  });

  it('antes de las 7, o apagado, no sale', async () => {
    const { dispatcher, conectado, enviados } = montar();
    jest.setSystemTime(Date.parse('2026-10-19T11:30:00Z')); // 06:30
    conectado({ lastDailySummaryAt: null });
    await dispatcher.vuelta();
    jest.setSystemTime(SIETE_Y_CINCO);
    conectado({ lastDailySummaryAt: null, dailySummaryEnabled: false });
    await dispatcher.vuelta();
    expect(enviados()).toHaveLength(0);
  });

  it('si el envío falla, se devuelve la reclamación y se reintenta', async () => {
    const { dispatcher, conectado, enviados, api, base } = montar();
    jest.setSystemTime(SIETE_Y_CINCO);
    conectado({ lastDailySummaryAt: null });
    api.sendMessage.mockResolvedValueOnce({
      ok: false,
      errorCode: null,
      description: 'fetch failed',
    });
    await dispatcher.vuelta();
    expect(base.config?.lastDailySummaryAt).toBeNull();
    avanzar(1);
    await dispatcher.vuelta();
    expect(enviados().filter((e) => e.texto.startsWith('☀️'))).toHaveLength(2);
    expect(base.config?.lastDailySummaryAt).not.toBeNull();
  });
});

describe('bitácora', () => {
  it('lo más reciente primero, con filtro de estado y límites', async () => {
    const { alertas } = montar();
    await alertas.avisar(espejoCaido);
    avanzar(1);
    await alertas.avisar({
      kind: 'ERROR_5XX',
      dedupeKey: '5xx:x',
      title: '500 GET /x',
    });
    let r = await alertas.listar({});
    expect(r.total).toBe(2);
    expect(r.rows[0].kind).toBe('ERROR_5XX');
    r = await alertas.listar({ status: 'ABIERTA' });
    expect(r.rows.map((f) => f.kind)).toEqual(['SERVICIO_CAIDO']);
    r = await alertas.listar({ status: 'CUALQUIERA', limit: 1, offset: 1 });
    expect(r.total).toBe(2);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].kind).toBe('SERVICIO_CAIDO');
  });
});

// ── Fase 2: los enganches que usan los chequeos ─────────────────────────────

describe('crones: cronFallo / cronBien', () => {
  it('un cron que falla abre su problema con el mensaje del error, sanitizado', async () => {
    const { alertas, base } = montar();
    await alertas.cronFallo(
      'retencion',
      'Retención de datos personales',
      new Error('Timeout borrando la conversación de 1088123456'),
    );
    expect(base.alertas).toHaveLength(1);
    expect(base.alertas[0]).toMatchObject({
      kind: 'CRON_FALLO',
      category: 'CRONES',
      severity: 'ADVERTENCIA',
      dedupeKey: 'cron:retencion',
      title: 'Retención de datos personales',
      detail: `Timeout borrando la conversación de ${DATO_OCULTO}`,
      meta: { fuente: 'cron «retencion»' },
    });
  });

  it('a la tercera seguida Y con 10 minutos fallando es crítico', async () => {
    const { alertas, base } = montar();
    for (let i = 0; i < 3; i++) {
      await alertas.cronFallo(
        'vigilante-espejo',
        'Vigilante del espejo',
        new Error('x'),
      );
      avanzar(5);
    }
    expect(base.alertas[0]).toMatchObject({
      occurrences: 3,
      severity: 'CRITICA',
    });
  });

  it('un cron de cada pocos segundos no se vuelve crítico a los 20 segundos (la caída de Redis de la prueba real)', async () => {
    const { alertas, base } = montar();
    for (let i = 0; i < 73; i++) {
      await alertas.cronFallo(
        'confirmaciones-his',
        'Confirmaciones del HIS al paciente',
        new Error('Reached the max retries per request limit'),
      );
      jest.setSystemTime(Date.now() + 8_000);
    }
    expect(base.alertas).toHaveLength(1);
    expect(base.alertas[0]).toMatchObject({
      occurrences: 73,
      severity: 'ADVERTENCIA',
    });
    avanzar(1); // ya pasaron más de 10 minutos
    await alertas.cronFallo('confirmaciones-his', 'x', new Error('x'));
    expect(base.alertas[0].severity).toBe('CRITICA');
  });

  it('cronBien resuelve lo que falló, y no vuelve a tocar la base mientras siga bien', async () => {
    const { alertas, base } = montar();
    const escrituras = jest.spyOn(base.prisma.techAlert, 'updateMany');
    await alertas.cronFallo(
      'consultas-his',
      'Consultas al HIS',
      new Error('x'),
    );
    await alertas.cronBien('consultas-his');
    expect(base.alertas[0].status).toBe('RESUELTA');
    expect(escrituras).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) await alertas.cronBien('consultas-his');
    expect(escrituras).toHaveBeenCalledTimes(1);
  });

  it('el primer cronBien tras arrancar cierra lo que otro proceso dejó abierto', async () => {
    const { alertas, base } = montar();
    await alertas.cronFallo(
      'centinela',
      'Centinela del monitor',
      new Error('x'),
    );
    // Otro proceso (reinicio): no sabe que «centinela» fallaba.
    const otro = new TechAlertService(
      base.prisma as unknown as PrismaService,
      montar().config,
      montar().dispatcher,
    );
    await otro.cronBien('centinela');
    expect(base.alertas[0].status).toBe('RESUELTA');
    otro.onModuleDestroy();
  });
});

describe('arranque de la API', () => {
  it('cada arranque es un evento (sin sonido) con el proceso y la versión', async () => {
    const { alertas, base, dispatcher, conectado, enviados } = montar();
    conectado();
    process.env.AGENIA_VERSION = 'abc1234';
    await alertas.registrarArranque();
    delete process.env.AGENIA_VERSION;
    expect(base.alertas).toHaveLength(1);
    expect(base.alertas[0]).toMatchObject({
      kind: 'API_ARRANCO',
      status: 'EVENTO',
      severity: 'INFO',
    });
    expect(base.alertas[0].detail).toMatch(
      /Proceso \d+ en .+\. Versión: abc1234\./,
    );
    await dispatcher.vuelta();
    expect(enviados()[0]).toMatchObject({ silent: true });
    expect(enviados()[0].texto).toMatch(/^ℹ️ INFORMACIÓN · La API arrancó/);
  });

  it('sin versión registrada lo dice', async () => {
    const { alertas, base } = montar();
    await alertas.registrarArranque();
    expect(base.alertas[0].detail).toContain('Versión: sin registrar.');
  });

  it('dos arranques en 10 minutos: «reiniciándose en bucle», crítico', async () => {
    const { alertas, base, dispatcher, conectado, enviados } = montar();
    conectado();
    await alertas.registrarArranque();
    await dispatcher.vuelta();
    avanzar(3);
    await alertas.registrarArranque();
    await dispatcher.vuelta();
    const bucle = base.alertas.find((f) => f.kind === 'REINICIOS_EN_BUCLE');
    expect(bucle).toMatchObject({ severity: 'CRITICA', status: 'EVENTO' });
    expect(bucle?.detail).toContain('a los 3 min del arranque anterior');
    expect(enviados().map((e) => e.texto.split('\n')[0])).toEqual([
      'ℹ️ INFORMACIÓN · La API arrancó',
      '🔴 CRÍTICA · La API se está reiniciando en bucle',
    ]);
  });

  it('un arranque a los 11 minutos del anterior es normal', async () => {
    const { alertas, base } = montar();
    await alertas.registrarArranque();
    avanzar(11);
    await alertas.registrarArranque();
    expect(base.alertas.some((f) => f.kind === 'REINICIOS_EN_BUCLE')).toBe(
      false,
    );
  });

  it('con la base caída al arrancar, no revienta', async () => {
    const { alertas, base } = montar();
    base.caida = true;
    await expect(alertas.registrarArranque()).resolves.toBeUndefined();
  });
});

describe('retención de la bitácora', () => {
  it('borra lo resuelto y los eventos de más de 180 días; lo abierto nunca', async () => {
    const { dispatcher, base } = montar();
    const viejo = new Date(T0 - 181 * 24 * 60 * MIN);
    const reciente = new Date(T0 - 10 * 24 * 60 * MIN);
    base.alertas.push(
      { id: 'r-viejo', status: 'RESUELTA', lastSeenAt: viejo },
      { id: 'e-viejo', status: 'EVENTO', lastSeenAt: viejo },
      { id: 'a-viejo', status: 'ABIERTA', lastSeenAt: viejo },
      { id: 'r-nuevo', status: 'RESUELTA', lastSeenAt: reciente },
    );
    await expect(dispatcher.limpiar()).resolves.toBe(2);
    expect(base.alertas.map((f) => f.id).sort()).toEqual([
      'a-viejo',
      'r-nuevo',
    ]);
  });

  it('nunca lanza', async () => {
    const { dispatcher, base } = montar();
    base.caida = true;
    await expect(dispatcher.limpiar()).resolves.toBe(0);
    await expect(dispatcher.limpiezaDiaria()).resolves.toBeUndefined();
  });
});

// ── Fase 3: el archivo que lee el vigía del servidor ────────────────────────

describe('el archivo del vigía (deploy/vigia.sh)', () => {
  const leer = (texto: string) =>
    Object.fromEntries(
      texto
        .split('\n')
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
  const fila = (extra: Fila = {}) =>
    ({
      ...CONFIG_POR_DEFECTO,
      enabled: true,
      chatId: GRUPO,
      ...extra,
    }) as never;

  it('lleva lo que el vigía necesita, con los mismos ajustes del panel', () => {
    const v = leer(
      contenidoArchivoVigia(
        fila({
          mutedUntil: new Date('2026-10-20T12:00:00Z'),
          categories: { SERVIDOR: false },
          quietFromHour: 23,
        }),
        TOKEN,
        'https://app.hsvpanserma.agenia.co',
      ),
    );
    expect(v).toEqual({
      ENABLED: 'true',
      TOKEN,
      CHAT_ID: GRUPO,
      SERVIDOR: 'false',
      MUTED_UNTIL: String(Date.parse('2026-10-20T12:00:00Z') / 1000),
      QUIET_ENABLED: 'true',
      QUIET_FROM: '23',
      QUIET_TO: '6',
      REMINDER_MINUTES: '60',
      MAX_REMINDERS: '3',
      PANEL_URL: 'https://app.hsvpanserma.agenia.co',
    });
  });

  it('apagado, sin bot o sin grupo: ENABLED=false (el vigía no envía)', () => {
    expect(
      leer(contenidoArchivoVigia(fila({ enabled: false }), TOKEN, null))
        .ENABLED,
    ).toBe('false');
    expect(leer(contenidoArchivoVigia(fila(), null, null))).toMatchObject({
      ENABLED: 'false',
      TOKEN: '',
    });
    expect(
      leer(contenidoArchivoVigia(fila({ chatId: null }), TOKEN, null)).ENABLED,
    ).toBe('false');
    expect(leer(contenidoArchivoVigia(null, null, null))).toMatchObject({
      ENABLED: 'false',
      SERVIDOR: 'true',
      MUTED_UNTIL: '0',
    });
  });

  it('cada valor se valida: nada raro llega a una línea del archivo', () => {
    const v = leer(
      contenidoArchivoVigia(
        fila({ chatId: '-100; rm -rf /' }),
        'no-es-un-token\nENABLED=true',
        'https://x.co/$(reboot)',
      ),
    );
    expect(v).toMatchObject({
      ENABLED: 'false',
      TOKEN: '',
      CHAT_ID: '',
      PANEL_URL: '',
    });
  });

  it('el servicio lo escribe al cambiar algo: atómico, 600 y al día', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
    const ruta = path.join(dir, 'telegram.env');
    process.env.TECH_ALERTS_VIGIA_FILE = ruta;
    try {
      const { config } = montar();
      await config.connect(TOKEN, ACTOR);
      await config.exportarParaVigia();
      let v = leer(fs.readFileSync(ruta, 'utf8'));
      expect(v).toMatchObject({ ENABLED: 'false', TOKEN }); // sin grupo todavía
      expect(fs.statSync(ruta).mode & 0o777).toBe(0o600);

      await config.mute('UNA_HORA', ACTOR);
      await config.exportarParaVigia();
      v = leer(fs.readFileSync(ruta, 'utf8'));
      expect(Number(v.MUTED_UNTIL)).toBe(Math.floor((T0 + 60 * MIN) / 1000));

      await config.disconnect(ACTOR);
      await config.exportarParaVigia();
      v = leer(fs.readFileSync(ruta, 'utf8'));
      expect(v).toMatchObject({ ENABLED: 'false', TOKEN: '' });
      // No quedan temporales a medias.
      expect(fs.readdirSync(dir)).toEqual(['telegram.env']);
    } finally {
      delete process.env.TECH_ALERTS_VIGIA_FILE;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('si no puede escribir (carpeta inexistente), no revienta', async () => {
    process.env.TECH_ALERTS_VIGIA_FILE = '/no/existe/telegram.env';
    try {
      const { config } = montar();
      await expect(config.exportarParaVigia()).resolves.toBeUndefined();
    } finally {
      delete process.env.TECH_ALERTS_VIGIA_FILE;
    }
  });

  it('el panel ve el latido del vigía (o que nunca ha corrido)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
    process.env.TECH_ALERTS_VIGIA_FILE = path.join(dir, 'telegram.env');
    try {
      const { config } = montar();
      expect((await config.getPublic()).vigia).toEqual({
        ultimaVueltaAt: null,
      });
      fs.writeFileSync(path.join(dir, 'vigia.latido'), '1792422000\n');
      expect((await config.getPublic()).vigia).toEqual({
        ultimaVueltaAt: new Date(1792422000 * 1000),
      });
    } finally {
      delete process.env.TECH_ALERTS_VIGIA_FILE;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sin la variable (desarrollo) no escribe nada', async () => {
    const { config } = montar();
    await expect(config.exportarParaVigia()).resolves.toBeUndefined();
    expect((await config.getPublic()).vigia).toBeNull();
  });
});
