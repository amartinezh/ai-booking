import {
  ConflictException,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@agenia/database';
import { SupportBotSessionService } from './support-bot-session.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { SupportBotConfigService } from './support-bot-config.service';

/**
 * Códigos y conversaciones, con una base EN MEMORIA (corre en el CI). La prueba
 * contra un Postgres real, con la transacción y los índices parciales de verdad,
 * es support-bot-session.integration.spec.ts.
 */

type Fila = Record<string, unknown>;
const repetido = () =>
  new Prisma.PrismaClientKnownRequestError('repetido', {
    code: 'P2002',
    clientVersion: 'x',
  });

class BaseFalsa {
  usuarios: Fila[] = [];
  clinicas: Fila[] = [];
  codigos: Fila[] = [];
  conversaciones: Fila[] = [];
  preferencias: Fila[] = [];
  /** Hace fallar con P2002 los próximos N `create` de un código CORTO. */
  chocarCortos = 0;
  /** Hace fallar con P2002 las próximas N transacciones (el índice parcial). */
  chocarTransacciones = 0;
  private n = 0;

  private clinica = (id: unknown) =>
    this.clinicas.find((c) => c.id === id) ?? null;
  private conUsuario = (c: Fila) => {
    const u = this.usuarios.find((x) => x.id === c.userId) as Fila;
    return {
      ...c,
      user: { ...u, organization: this.clinica(u.organizationId) },
      organization: this.clinica(c.organizationId),
    };
  };
  private abiertasDe = (where: Fila) =>
    this.conversaciones.filter(
      (c) =>
        (where.closedAt === null ? c.closedAt === null : true) &&
        (where.userId === undefined || c.userId === where.userId) &&
        (where.telegramUserId === undefined ||
          c.telegramUserId === where.telegramUserId) &&
        (!Array.isArray(where.OR) ||
          (where.OR as Fila[]).some((o) =>
            o.userId
              ? c.userId === o.userId
              : c.telegramUserId === o.telegramUserId,
          )),
    );

  readonly prisma = {
    user: {
      findUnique: async ({ where }: { where: Fila }) => {
        const u = this.usuarios.find((x) => x.id === where.id);
        return u
          ? { ...u, organization: this.clinica(u.organizationId) }
          : null;
      },
    },
    organization: {
      findUnique: async ({ where }: { where: Fila }) => this.clinica(where.id),
    },
    supportBotCode: {
      deleteMany: async ({ where }: { where: Fila }) => {
        const antes = this.codigos.length;
        this.codigos = this.codigos.filter(
          (c) => !(c.userId === where.userId && c.usedAt === null),
        );
        return { count: antes - this.codigos.length };
      },
      create: async ({ data }: { data: Fila }) => {
        if (data.kind === 'CORTO' && this.chocarCortos > 0) {
          this.chocarCortos--;
          throw repetido();
        }
        if (this.codigos.some((c) => c.codeHmac === data.codeHmac))
          throw repetido();
        const fila = { id: `cod-${++this.n}`, usedAt: null, ...data };
        this.codigos.push(fila);
        return fila;
      },
      findUnique: async ({ where }: { where: Fila }) => {
        const c = this.codigos.find((x) => x.codeHmac === where.codeHmac);
        if (!c) return null;
        const u = this.usuarios.find((x) => x.id === c.userId) as Fila;
        return {
          ...c,
          user: { ...u, organization: this.clinica(u.organizationId) },
        };
      },
      updateMany: async ({ where, data }: { where: Fila; data: Fila }) => {
        const c = this.codigos.find(
          (x) => x.id === where.id && x.usedAt === null,
        );
        if (c) Object.assign(c, data);
        return { count: c ? 1 : 0 };
      },
    },
    supportBotConversation: {
      findMany: async ({ where }: { where: Fila }) => this.abiertasDe(where),
      findFirst: async ({
        where,
        orderBy,
        include,
      }: {
        where: Fila;
        orderBy?: Fila;
        include?: Fila;
      }) => {
        let filas = this.abiertasDe(where);
        if (orderBy)
          filas = [...filas].sort(
            (a, b) => +(b.startedAt as Date) - +(a.startedAt as Date),
          );
        const c = filas[0];
        if (!c) return null;
        return include ? this.conUsuario(c) : c;
      },
      updateMany: async ({ where, data }: { where: Fila; data: Fila }) => {
        const ids = (where.id as { in?: string[] })?.in ?? [where.id];
        let count = 0;
        for (const c of this.conversaciones) {
          if (
            ids.includes(c.id as string) &&
            (where.closedAt === undefined || c.closedAt === null)
          ) {
            Object.assign(c, data);
            count++;
          }
        }
        return { count };
      },
      create: async ({ data }: { data: Fila }) => {
        const fila = {
          id: `conv-${++this.n}`,
          closedAt: null,
          closeReason: null,
          ...data,
        };
        this.conversaciones.push(fila);
        return fila;
      },
    },
    supportBotPreference: {
      findUnique: async ({ where }: { where: Fila }) =>
        this.preferencias.find((p) => p.userId === where.userId) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: Fila;
        create: Fila;
        update: Fila;
      }) => {
        const p = this.preferencias.find((x) => x.userId === where.userId);
        if (p) Object.assign(p, update);
        else this.preferencias.push({ ...create });
        return p;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (this.chocarTransacciones > 0) {
        this.chocarTransacciones--;
        throw repetido();
      }
      return fn(this.prisma);
    },
  };
}

class RedisFalso {
  datos = new Map<string, string>();
  ttls = new Map<string, number>();
  caido = false;
  private revisar() {
    if (this.caido) throw new Error('Redis caído');
  }
  async get(k: string) {
    this.revisar();
    return this.datos.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.revisar();
    this.datos.set(k, v);
    return 'OK';
  }
  async del(k: string) {
    this.revisar();
    return this.datos.delete(k) ? 1 : 0;
  }
  async incr(k: string) {
    this.revisar();
    const n = Number(this.datos.get(k) ?? 0) + 1;
    this.datos.set(k, String(n));
    return n;
  }
  async expire(k: string, seg: number) {
    this.revisar();
    this.ttls.set(k, seg);
    return 1;
  }
  async ttl(k: string) {
    this.revisar();
    return this.ttls.get(k) ?? -1;
  }
}

describe('SupportBotSessionService (base en memoria)', () => {
  const CLAVE_ORIGINAL = process.env.SUPPORT_BOT_CODE_KEY;
  const MIN = 60_000;
  let base: BaseFalsa;
  let redis: RedisFalso;
  let disponible: boolean;
  let svc: SupportBotSessionService;
  const config = {
    runtime: async () =>
      disponible
        ? {
            enabled: true,
            botUsername: 'AgeniaSoporteBot',
            conversationIdleMinutes: 30,
          }
        : null,
  };

  const crear = () =>
    new SupportBotSessionService(
      base.prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      config as unknown as SupportBotConfigService,
    );
  const validar = (
    codigo: string,
    telegramUserId = '777',
    extra: Record<string, unknown> = {},
  ) =>
    svc.validarCodigo({
      codigo,
      tipo: 'CORTO',
      telegramUserId,
      chatId: telegramUserId,
      telegramName: 'Ana',
      ...extra,
    });

  beforeEach(() => {
    process.env.SUPPORT_BOT_CODE_KEY = 'clave-de-prueba';
    for (const nivel of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation();
    }
    base = new BaseFalsa();
    base.clinicas.push(
      { id: 'org-1', name: 'Hospital de Prueba', isActive: true },
      { id: 'org-2', name: 'Otra', isActive: true },
    );
    base.usuarios.push(
      {
        id: 'ana',
        email: 'ana@clinica.co',
        role: 'BOOKING_AGENT',
        organizationId: 'org-1',
      },
      { id: 'pac', email: 'p@x.co', role: 'PATIENT', organizationId: 'org-1' },
      {
        id: 'sa',
        email: 'sa@agenia.co',
        role: 'SUPER_ADMIN',
        organizationId: null,
      },
    );
    redis = new RedisFalso();
    disponible = true;
    svc = crear();
  });

  afterEach(() => {
    process.env.SUPPORT_BOT_CODE_KEY = CLAVE_ORIGINAL;
    jest.restoreAllMocks();
  });

  describe('generarCodigo', () => {
    it('código de 6 dígitos y enlace; si el sorteo repite un código, saca otro', async () => {
      base.chocarCortos = 2;
      const c = await svc.generarCodigo('ana');
      expect(c.codigo).toMatch(/^\d{6}$/);
      expect(c.enlace).toMatch(/^https:\/\/t\.me\/AgeniaSoporteBot\?start=/);
      expect(base.codigos.map((x) => x.kind).sort()).toEqual([
        'CORTO',
        'ENLACE',
      ]);
    });

    it('si el sorteo choca 8 veces, se rinde con un error claro', async () => {
      base.chocarCortos = 99;
      await expect(svc.generarCodigo('ana')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('sin clave del servidor no hay códigos', async () => {
      delete process.env.SUPPORT_BOT_CODE_KEY;
      const sinClave = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      try {
        await expect(crear().generarCodigo('ana')).rejects.toThrow(
          /clave de los códigos/,
        );
      } finally {
        if (sinClave !== undefined) process.env.ENCRYPTION_KEY = sinClave;
      }
    });

    it('sin el asistente disponible, 409', async () => {
      disponible = false;
      await expect(svc.generarCodigo('ana')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('🔒 el paciente y un usuario que no existe no tienen acceso', async () => {
      await expect(svc.generarCodigo('pac')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(svc.generarCodigo('nadie')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('el super admin prueba como una clínica activa', async () => {
      await expect(svc.generarCodigo('sa')).rejects.toThrow(/Elija la clínica/);
      base.clinicas[1].isActive = false;
      await expect(
        svc.generarCodigo('sa', { testOrganizationId: 'org-2' }),
      ).rejects.toThrow(/suspendida/);
      const c = await svc.generarCodigo('sa', { testOrganizationId: 'org-1' });
      expect(base.codigos.every((x) => x.testOrganizationId === 'org-1')).toBe(
        true,
      );
      await expect(validar(c.codigo)).resolves.toMatchObject({
        tipo: 'ABIERTA',
        interlocutor: { isTest: true },
      });
    });
  });

  describe('validarCodigo', () => {
    it('abre la conversación y borra los intentos fallidos', async () => {
      await validar('000000');
      const c = await svc.generarCodigo('ana');
      await expect(validar(c.codigo)).resolves.toMatchObject({
        tipo: 'ABIERTA',
        chatsCerrados: [],
      });
      expect(redis.datos.has('soporte:fallos:777')).toBe(false);
      expect(redis.ttls.get('soporte:fallos:777')).toBe(3600);
    });

    it('🏁 si el índice parcial choca (otro código del mismo usuario a la vez), reintenta una vez y abre', async () => {
      const c = await svc.generarCodigo('ana');
      base.chocarTransacciones = 1;
      await expect(validar(c.codigo)).resolves.toMatchObject({
        tipo: 'ABIERTA',
      });
    });

    it('otro error de la base no se disfraza', async () => {
      const c = await svc.generarCodigo('ana');
      base.prisma.$transaction = async () => {
        throw new Error('db caída');
      };
      await expect(validar(c.codigo)).rejects.toThrow('db caída');
    });

    it('si otro lo gastó justo antes (la transacción no lo encuentra libre), no sirve', async () => {
      const c = await svc.generarCodigo('ana');
      const original = base.prisma.supportBotCode.updateMany;
      base.prisma.supportBotCode.updateMany = async () => ({ count: 0 });
      await expect(validar(c.codigo)).resolves.toMatchObject({
        tipo: 'INVALIDO',
      });
      base.prisma.supportBotCode.updateMany = original;
    });

    it('al quinto fallo, bloqueo con los minutos que quedan según Redis', async () => {
      for (let i = 0; i < 4; i++) await validar('000000');
      await expect(validar('000000')).resolves.toEqual({
        tipo: 'BLOQUEADO',
        minutos: 60,
      });
      redis.ttls.set('soporte:fallos:777', 125);
      await expect(validar('000000')).resolves.toEqual({
        tipo: 'BLOQUEADO',
        minutos: 3,
      });
      redis.ttls.set('soporte:fallos:777', -1);
      await expect(validar('000000')).resolves.toEqual({
        tipo: 'BLOQUEADO',
        minutos: 60,
      });
    });

    it('sin Redis no se cuentan intentos, pero el código sigue sirviendo una sola vez', async () => {
      const c = await svc.generarCodigo('ana');
      redis.caido = true;
      await expect(validar('000000')).resolves.toEqual({
        tipo: 'INVALIDO',
        restantes: 4,
      });
      await expect(validar(c.codigo)).resolves.toMatchObject({
        tipo: 'ABIERTA',
      });
      await expect(validar(c.codigo, '778')).resolves.toMatchObject({
        tipo: 'INVALIDO',
      });
    });

    it('sin clave del servidor, ningún código sirve', async () => {
      const c = await svc.generarCodigo('ana');
      delete process.env.SUPPORT_BOT_CODE_KEY;
      const enc = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      try {
        await expect(
          crear().validarCodigo({
            codigo: c.codigo,
            tipo: 'CORTO',
            telegramUserId: '1',
            chatId: '1',
            telegramName: null,
          }),
        ).resolves.toMatchObject({ tipo: 'INVALIDO' });
      } finally {
        if (enc !== undefined) process.env.ENCRYPTION_KEY = enc;
      }
    });

    it('🔒 la clínica suspendida o el super admin sin clínica de prueba: sin acceso, y el código se gasta', async () => {
      const c = await svc.generarCodigo('ana');
      base.clinicas[0].isActive = false;
      await expect(validar(c.codigo)).resolves.toEqual({ tipo: 'SIN_ACCESO' });
      expect(
        base.codigos.find((x) => x.kind === 'CORTO')?.usedAt,
      ).not.toBeNull();

      base.clinicas[0].isActive = true;
      const sa = await svc.generarCodigo('sa', { testOrganizationId: 'org-1' });
      base.codigos.forEach((x) => (x.testOrganizationId = null));
      await expect(validar(sa.codigo, '900')).resolves.toEqual({
        tipo: 'SIN_ACCESO',
      });
    });

    it('cierra la vigente de otra cuenta (y la avisa) y la vencida por inactividad', async () => {
      await validar((await svc.generarCodigo('ana')).codigo, '777');
      base.usuarios.push({
        id: 'beto',
        email: 'b@clinica.co',
        role: 'DOCTOR',
        organizationId: 'org-1',
      });
      await validar((await svc.generarCodigo('beto')).codigo, '888');
      base.conversaciones.find(
        (c) => c.telegramUserId === '888',
      )!.lastMessageAt = new Date(Date.now() - 40 * MIN);
      // Ana abre desde la cuenta 888: cierra su conversación de 777 (vigente) y la vieja de Beto en 888.
      const r = await validar((await svc.generarCodigo('ana')).codigo, '888');
      expect(r).toMatchObject({ tipo: 'ABIERTA', chatsCerrados: ['777'] });
      expect(
        base.conversaciones.map((c) => [
          c.userId,
          c.telegramUserId,
          c.closeReason,
        ]),
      ).toEqual([
        ['ana', '777', 'OTRA_CONVERSACION'],
        ['beto', '888', 'INACTIVIDAD'],
        ['ana', '888', null],
      ]);
    });
  });

  describe('conversacionDe', () => {
    beforeEach(async () => {
      await validar((await svc.generarCodigo('ana')).codigo, '777');
    });

    it('vigente, ninguna y vencida', async () => {
      await expect(svc.conversacionDe('777')).resolves.toMatchObject({
        tipo: 'VIGENTE',
        interlocutor: { userId: 'ana' },
      });
      await expect(svc.conversacionDe('999')).resolves.toEqual({
        tipo: 'NINGUNA',
      });
      await expect(
        svc.conversacionDe('777', new Date(Date.now() + 31 * MIN)),
      ).resolves.toEqual({ tipo: 'NINGUNA' });
      expect(base.conversaciones[0].closeReason).toBe('INACTIVIDAD');
    });

    it('🔒 una de prueba no vale para un usuario del personal, ni una normal para el super admin', async () => {
      base.conversaciones[0].isTest = true;
      await expect(svc.conversacionDe('777')).resolves.toMatchObject({
        tipo: 'REVOCADA',
      });

      await validar((await svc.generarCodigo('ana')).codigo, '777');
      base.usuarios[0].role = 'SUPER_ADMIN';
      await expect(svc.conversacionDe('777')).resolves.toMatchObject({
        tipo: 'REVOCADA',
      });
    });

    it('mantenerla viva y cerrarla', async () => {
      const id = base.conversaciones[0].id as string;
      await svc.tocar(id, new Date(Date.now() + 20 * MIN));
      await expect(
        svc.conversacionDe('777', new Date(Date.now() + 45 * MIN)),
      ).resolves.toMatchObject({ tipo: 'VIGENTE' });
      await expect(svc.cerrar(id, 'SALIR')).resolves.toBe(true);
      await expect(svc.cerrar(id, 'SALIR')).resolves.toBe(false);
    });
  });

  describe('la tarjeta de Soporte', () => {
    it('estado, cierre desde el panel y avisos', async () => {
      await expect(svc.estadoPara('ana')).resolves.toMatchObject({
        disponible: true,
        conversacion: null,
        avisos: { activos: true, destino: null },
      });
      await validar((await svc.generarCodigo('ana')).codigo, '777', {
        telegramName: null,
      });
      await expect(svc.estadoPara('ana')).resolves.toMatchObject({
        conversacion: { telegramName: null },
        avisos: { destino: 'tu cuenta de Telegram' },
      });
      await expect(svc.cerrarDesdePanel('ana')).resolves.toBe('777');
      await expect(svc.cerrarDesdePanel('ana')).resolves.toBeNull();

      await svc.cambiarAvisos('ana', false);
      await svc.cambiarAvisos('ana', false);
      await expect(svc.estadoPara('ana')).resolves.toMatchObject({
        avisos: { activos: false },
      });
    });

    it('sin el asistente, la tarjeta no ofrece nada', async () => {
      disponible = false;
      await expect(svc.estadoPara('ana')).resolves.toMatchObject({
        disponible: false,
        botUsername: null,
      });
    });

    it('cerrar una vieja desde el panel la cierra sin aviso', async () => {
      await validar((await svc.generarCodigo('ana')).codigo, '777');
      await expect(
        svc.cerrarDesdePanel('ana', new Date(Date.now() + 31 * MIN)),
      ).resolves.toBeNull();
      expect(base.conversaciones[0].closeReason).toBe('INACTIVIDAD');
    });
  });

  describe('la pregunta en espera', () => {
    it('se guarda y se toma una vez', async () => {
      await expect(svc.guardarPreguntaEnEspera('777', '¿cómo?')).resolves.toBe(
        true,
      );
      await expect(svc.tomarPreguntaEnEspera('777')).resolves.toBe('¿cómo?');
      await expect(svc.tomarPreguntaEnEspera('777')).resolves.toBeNull();
    });

    it('sin Redis: no se guarda y no se toma (sin lanzar)', async () => {
      redis.caido = true;
      await expect(svc.guardarPreguntaEnEspera('777', '¿cómo?')).resolves.toBe(
        false,
      );
      await expect(svc.tomarPreguntaEnEspera('777')).resolves.toBeNull();
    });
  });
});
