import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { SupportBotConfigService } from './support-bot-config.service';
import { SupportBotSessionService } from './support-bot-session.service';

/**
 * Códigos y conversaciones del asistente de soporte contra un Postgres REAL: la
 * transacción que abre la conversación, los índices parciales «una abierta por
 * usuario y por cuenta de Telegram» y el HMAC del código. Redis va en memoria.
 *
 * Solo corre con una base desechable cuyo nombre termina en `_verif`:
 *
 *   docker run -d --rm --name agenia-soporte -p 55433:5432 \
 *     -e POSTGRES_USER=agenia -e POSTGRES_PASSWORD=verif \
 *     -e POSTGRES_DB=agenia_verif postgres:15-alpine
 *   (desde packages/database, con ese DATABASE_URL:
 *    `prisma db push --skip-generate` y `pnpm run db:apply-sql`, que crea los índices parciales)
 *   DATABASE_URL=postgresql://agenia:verif@localhost:55433/agenia_verif \
 *     pnpm exec jest src/support-bot/support-bot-session.integration.spec.ts --runInBand
 */
const BD_DESECHABLE = /\/[a-z0-9_]*_verif(\?|$)/.test(
  process.env.DATABASE_URL ?? '',
);

/** Redis en memoria con lo que usa el servicio. */
class RedisFalso {
  datos = new Map<string, { valor: string; vence: number | null }>();
  private vivo(k: string) {
    const d = this.datos.get(k);
    if (d && d.vence !== null && d.vence <= Date.now()) this.datos.delete(k);
    return this.datos.get(k);
  }
  async get(k: string) {
    return this.vivo(k)?.valor ?? null;
  }
  async set(k: string, v: string, _ex?: string, seg?: number) {
    this.datos.set(k, {
      valor: v,
      vence: seg ? Date.now() + seg * 1000 : null,
    });
    return 'OK';
  }
  async del(k: string) {
    return this.datos.delete(k) ? 1 : 0;
  }
  async incr(k: string) {
    const n = Number(this.vivo(k)?.valor ?? 0) + 1;
    this.datos.set(k, { valor: String(n), vence: this.vivo(k)?.vence ?? null });
    return n;
  }
  async expire(k: string, seg: number) {
    const d = this.vivo(k);
    if (d) d.vence = Date.now() + seg * 1000;
    return d ? 1 : 0;
  }
  async ttl(k: string) {
    const d = this.vivo(k);
    if (!d) return -2;
    return d.vence === null ? -1 : Math.ceil((d.vence - Date.now()) / 1000);
  }
}

(BD_DESECHABLE ? describe : describe.skip)(
  'Asistente de soporte — códigos y conversaciones (Postgres real)',
  () => {
    const prisma = new PrismaService();
    let redis: RedisFalso;
    let disponible: boolean;
    let svc: SupportBotSessionService;
    let ORG: string;
    let OTRA_ORG: string;
    let ANA: string;
    let BETO: string;
    let PACIENTE: string;
    let SA: string;
    const MIN = 60_000;
    // Nombres y correos únicos por corrida: la prueba se puede repetir sobre la misma base.
    const SUF = Date.now().toString(36);
    const CLINICA = `Hospital de Prueba ${SUF}`;
    const OTRA = `Otra Clínica ${SUF}`;

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

    const abiertas = (where: Record<string, unknown> = {}) =>
      prisma.supportBotConversation.findMany({
        where: { closedAt: null, ...where },
      });

    beforeAll(async () => {
      process.env.SUPPORT_BOT_CODE_KEY = 'clave-de-prueba';
      for (const nivel of ['log', 'warn', 'error'] as const) {
        jest.spyOn(Logger.prototype, nivel).mockImplementation();
      }
      const org = await prisma.organization.create({
        data: { name: CLINICA },
      });
      const otra = await prisma.organization.create({
        data: { name: OTRA },
      });
      ORG = org.id;
      OTRA_ORG = otra.id;
      const usuario = (
        email: string,
        role: string,
        organizationId: string | null,
      ) =>
        prisma.user.create({
          data: { email, password: 'x', role: role as never, organizationId },
        });
      ANA = (await usuario(`ana.perez.${SUF}@clinica.co`, 'BOOKING_AGENT', ORG))
        .id;
      BETO = (await usuario(`beto.${SUF}@clinica.co`, 'DOCTOR', ORG)).id;
      PACIENTE = (await usuario(`paciente.${SUF}@correo.co`, 'PATIENT', ORG))
        .id;
      SA = (await usuario(`sa.${SUF}@agenia.co`, 'SUPER_ADMIN', null)).id;
    });

    beforeEach(async () => {
      disponible = true;
      redis = new RedisFalso();
      svc = new SupportBotSessionService(
        prisma,
        redis as unknown as RedisService,
        config as unknown as SupportBotConfigService,
      );
      await prisma.supportBotMessage.deleteMany();
      await prisma.supportBotConversation.deleteMany();
      await prisma.supportBotCode.deleteMany();
      await prisma.supportBotPreference.deleteMany();
      await prisma.user.update({
        where: { id: ANA },
        data: { role: 'BOOKING_AGENT', organizationId: ORG },
      });
      await prisma.organization.update({
        where: { id: ORG },
        data: { isActive: true },
      });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

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

    describe('generarCodigo', () => {
      it('6 dígitos y el enlace del QR; en la base solo queda el HMAC', async () => {
        const c = await svc.generarCodigo(ANA);
        expect(c.codigo).toMatch(/^\d{6}$/);
        expect(c.enlace).toMatch(
          /^https:\/\/t\.me\/AgeniaSoporteBot\?start=[A-Za-z0-9_-]{32}$/,
        );
        expect(Date.parse(c.venceEn) - Date.now()).toBeGreaterThan(9 * MIN);
        const filas = await prisma.supportBotCode.findMany({
          where: { userId: ANA },
        });
        expect(filas.map((f) => f.kind).sort()).toEqual(['CORTO', 'ENLACE']);
        for (const f of filas) {
          expect(f.codeHmac).toMatch(/^[0-9a-f]{64}$/);
          expect(f.codeHmac).not.toContain(c.codigo);
        }
      });

      it('generar otro anula el anterior', async () => {
        const viejo = await svc.generarCodigo(ANA);
        await svc.generarCodigo(ANA);
        expect(
          await prisma.supportBotCode.count({ where: { userId: ANA } }),
        ).toBe(2);
        await expect(validar(viejo.codigo)).resolves.toMatchObject({
          tipo: 'INVALIDO',
        });
      });

      it('🔒 el paciente no tiene acceso; una clínica suspendida tampoco', async () => {
        await expect(svc.generarCodigo(PACIENTE)).rejects.toThrow(
          /no tiene acceso/,
        );
        await prisma.organization.update({
          where: { id: ORG },
          data: { isActive: false },
        });
        await expect(svc.generarCodigo(ANA)).rejects.toThrow(/no tiene acceso/);
      });

      it('sin el asistente disponible no hay código', async () => {
        disponible = false;
        await expect(svc.generarCodigo(ANA)).rejects.toThrow(
          /no está disponible/,
        );
      });

      it('el super admin elige la clínica de prueba, y debe existir y estar activa', async () => {
        await expect(svc.generarCodigo(SA)).rejects.toThrow(/Elija la clínica/);
        await expect(
          svc.generarCodigo(SA, { testOrganizationId: 'no-existe' }),
        ).rejects.toThrow(/no existe/);
        const c = await svc.generarCodigo(SA, { testOrganizationId: OTRA_ORG });
        const r = await validar(c.codigo, '900');
        expect(r).toMatchObject({
          tipo: 'ABIERTA',
          interlocutor: {
            isTest: true,
            organizationId: OTRA_ORG,
            organizationName: OTRA,
            role: 'SUPER_ADMIN',
          },
        });
      });
    });

    describe('validarCodigo', () => {
      it('el código correcto abre la conversación, gasta el código y no deja usarlo otra vez', async () => {
        const c = await svc.generarCodigo(ANA);
        const r = await validar(c.codigo);
        expect(r).toMatchObject({
          tipo: 'ABIERTA',
          chatsCerrados: [],
          interlocutor: {
            userId: ANA,
            email: `ana.perez.${SUF}@clinica.co`,
            role: 'BOOKING_AGENT',
            organizationId: ORG,
            organizationName: CLINICA,
            isTest: false,
            chatId: '777',
            telegramName: 'Ana',
          },
        });
        const [conv] = await abiertas({ userId: ANA });
        expect(conv).toMatchObject({
          telegramUserId: '777',
          verifiedBy: 'CODIGO',
        });
        await expect(validar(c.codigo, '778')).resolves.toMatchObject({
          tipo: 'INVALIDO',
        });
      });

      it('el código largo del QR sirve como ENLACE y no como CORTO', async () => {
        const c = await svc.generarCodigo(ANA);
        const largo = c.enlace.split('start=')[1];
        await expect(validar(largo)).resolves.toMatchObject({
          tipo: 'INVALIDO',
        });
        await expect(
          validar(c.codigo, '777', { tipo: 'ENLACE' }),
        ).resolves.toMatchObject({ tipo: 'INVALIDO' });
        await expect(
          validar(largo, '777', { tipo: 'ENLACE' }),
        ).resolves.toMatchObject({
          tipo: 'ABIERTA',
        });
        const [conv] = await abiertas({ userId: ANA });
        expect(conv.verifiedBy).toBe('ENLACE');
      });

      it('un código vencido no sirve', async () => {
        const c = await svc.generarCodigo(ANA);
        await expect(
          validar(c.codigo, '777', { ahora: new Date(Date.now() + 11 * MIN) }),
        ).resolves.toMatchObject({
          tipo: 'INVALIDO',
        });
      });

      it('5 intentos fallidos por cuenta de Telegram y una hora de bloqueo, aunque después llegue el código bueno', async () => {
        const restantes: number[] = [];
        for (let i = 0; i < 4; i++) {
          const r = await validar('000000');
          restantes.push(r.tipo === 'INVALIDO' ? r.restantes : -1);
        }
        expect(restantes).toEqual([4, 3, 2, 1]);
        await expect(validar('000000')).resolves.toEqual({
          tipo: 'BLOQUEADO',
          minutos: 60,
        });
        const c = await svc.generarCodigo(ANA);
        await expect(validar(c.codigo)).resolves.toMatchObject({
          tipo: 'BLOQUEADO',
        });
        // Otra cuenta de Telegram no está bloqueada.
        await expect(validar(c.codigo, '888')).resolves.toMatchObject({
          tipo: 'ABIERTA',
        });
      });

      it('abrir con éxito borra los intentos fallidos', async () => {
        await validar('000000');
        await validar('000001');
        const c = await svc.generarCodigo(ANA);
        await validar(c.codigo);
        expect(await redis.get('soporte:fallos:777')).toBeNull();
      });

      it('🔒 un código de alguien que ya no tiene acceso se gasta y no abre nada', async () => {
        const c = await svc.generarCodigo(ANA);
        await prisma.user.update({
          where: { id: ANA },
          data: { role: 'PATIENT' },
        });
        await expect(validar(c.codigo)).resolves.toEqual({
          tipo: 'SIN_ACCESO',
        });
        expect(await abiertas()).toHaveLength(0);
        const fila = await prisma.supportBotCode.findFirst({
          where: { userId: ANA, kind: 'CORTO' },
        });
        expect(fila?.usedAt).not.toBeNull();
      });

      it('un nuevo código del mismo usuario desde otra cuenta cierra la anterior y avisa a ese chat', async () => {
        await validar((await svc.generarCodigo(ANA)).codigo, '777');
        const r = await validar((await svc.generarCodigo(ANA)).codigo, '888');
        expect(r).toMatchObject({ tipo: 'ABIERTA', chatsCerrados: ['777'] });
        const todas = await prisma.supportBotConversation.findMany({
          where: { userId: ANA },
          orderBy: { startedAt: 'asc' },
        });
        expect(todas.map((c) => [c.telegramUserId, c.closeReason])).toEqual([
          ['777', 'OTRA_CONVERSACION'],
          ['888', null],
        ]);
      });

      it('la misma cuenta de Telegram con el código de otra persona cierra la de la primera', async () => {
        await validar((await svc.generarCodigo(ANA)).codigo, '777');
        const r = await validar((await svc.generarCodigo(BETO)).codigo, '777');
        // Es el mismo chat: no hay que avisarle aparte.
        expect(r).toMatchObject({
          tipo: 'ABIERTA',
          chatsCerrados: [],
          interlocutor: { userId: BETO },
        });
        expect((await abiertas()).map((c) => c.userId)).toEqual([BETO]);
      });

      it('una conversación vieja (sin mensajes en 30 min) se cierra por inactividad y no se avisa', async () => {
        await validar((await svc.generarCodigo(ANA)).codigo, '777');
        await prisma.supportBotConversation.updateMany({
          where: { userId: ANA },
          data: { lastMessageAt: new Date(Date.now() - 31 * MIN) },
        });
        const r = await validar((await svc.generarCodigo(ANA)).codigo, '888');
        expect(r).toMatchObject({ chatsCerrados: [] });
        const vieja = await prisma.supportBotConversation.findFirst({
          where: { telegramUserId: '777' },
        });
        expect(vieja?.closeReason).toBe('INACTIVIDAD');
      });

      it('🏁 el código corto y el del QR del mismo usuario a la vez: los dos responden y queda UNA abierta', async () => {
        const otraConexion = new PrismaService();
        const svc2 = new SupportBotSessionService(
          otraConexion,
          redis as unknown as RedisService,
          config as unknown as SupportBotConfigService,
        );
        const c = await svc.generarCodigo(ANA);
        const largo = c.enlace.split('start=')[1];
        const [a, b] = await Promise.all([
          svc.validarCodigo({
            codigo: c.codigo,
            tipo: 'CORTO',
            telegramUserId: '711',
            chatId: '711',
            telegramName: null,
          }),
          svc2.validarCodigo({
            codigo: largo,
            tipo: 'ENLACE',
            telegramUserId: '712',
            chatId: '712',
            telegramName: null,
          }),
        ]);
        await otraConexion.$disconnect();
        expect([a.tipo, b.tipo]).toEqual(['ABIERTA', 'ABIERTA']);
        expect(await abiertas({ userId: ANA })).toHaveLength(1);
      });

      it('🏁 dos códigos del mismo usuario a la vez dejan UNA sola conversación abierta', async () => {
        // Dos instancias (dos conexiones), como dos réplicas o dos mensajes seguidos.
        const otraConexion = new PrismaService();
        const svc2 = new SupportBotSessionService(
          otraConexion,
          redis as unknown as RedisService,
          config as unknown as SupportBotConfigService,
        );
        const enlace = (await svc.generarCodigo(ANA)).enlace.split('start=')[1];
        const corto = (
          await prisma.supportBotCode.findFirst({
            where: { userId: ANA, kind: 'CORTO' },
          })
        )?.id;
        expect(corto).toBeDefined();
        const resultados = await Promise.allSettled([
          svc.validarCodigo({
            codigo: enlace,
            tipo: 'ENLACE',
            telegramUserId: '701',
            chatId: '701',
            telegramName: null,
          }),
          svc2.validarCodigo({
            codigo: enlace,
            tipo: 'ENLACE',
            telegramUserId: '702',
            chatId: '702',
            telegramName: null,
          }),
        ]);
        await otraConexion.$disconnect();
        const abiertasDeAna = await abiertas({ userId: ANA });
        expect(abiertasDeAna).toHaveLength(1);
        // El mismo código no abre dos conversaciones: la otra queda inválida (o choca con el índice).
        const abiertasOk = resultados.filter(
          (r) => r.status === 'fulfilled' && r.value.tipo === 'ABIERTA',
        );
        expect(abiertasOk).toHaveLength(1);
      });
    });

    describe('conversacionDe', () => {
      beforeEach(async () => {
        await validar((await svc.generarCodigo(ANA)).codigo, '777');
      });

      it('vigente, con quién habla', async () => {
        await expect(svc.conversacionDe('777')).resolves.toMatchObject({
          tipo: 'VIGENTE',
          interlocutor: { userId: ANA, organizationName: CLINICA },
        });
        await expect(svc.conversacionDe('999')).resolves.toEqual({
          tipo: 'NINGUNA',
        });
      });

      it('a los 30 minutos sin mensajes se cierra sola', async () => {
        await expect(
          svc.conversacionDe('777', new Date(Date.now() + 31 * MIN)),
        ).resolves.toEqual({ tipo: 'NINGUNA' });
        expect(
          (
            await prisma.supportBotConversation.findFirst({
              where: { userId: ANA },
            })
          )?.closeReason,
        ).toBe('INACTIVIDAD');
      });

      it('tocar la mantiene viva', async () => {
        const [conv] = await abiertas({ userId: ANA });
        await svc.tocar(conv.id, new Date(Date.now() + 20 * MIN));
        await expect(
          svc.conversacionDe('777', new Date(Date.now() + 40 * MIN)),
        ).resolves.toMatchObject({ tipo: 'VIGENTE' });
      });

      it.each([
        ['pasó a ser paciente', { role: 'PATIENT' }],
        ['la movieron a otra clínica', { organizationId: 'otra' }],
      ])('🔒 se revoca si %s', async (_, cambio) => {
        const data =
          'organizationId' in cambio ? { organizationId: OTRA_ORG } : cambio;
        await prisma.user.update({ where: { id: ANA }, data: data as never });
        await expect(svc.conversacionDe('777')).resolves.toEqual({
          tipo: 'REVOCADA',
          chatId: '777',
        });
        expect(
          (
            await prisma.supportBotConversation.findFirst({
              where: { userId: ANA },
            })
          )?.closeReason,
        ).toBe('ACCESO_REVOCADO');
      });

      it('🔒 se revoca si la clínica se suspende', async () => {
        await prisma.organization.update({
          where: { id: ORG },
          data: { isActive: false },
        });
        await expect(svc.conversacionDe('777')).resolves.toMatchObject({
          tipo: 'REVOCADA',
        });
      });
    });

    describe('la tarjeta de Soporte', () => {
      it('estado: disponible, conversación abierta y a dónde llegan los avisos', async () => {
        await expect(svc.estadoPara(ANA)).resolves.toEqual({
          disponible: true,
          botUsername: 'AgeniaSoporteBot',
          conversacionMinutos: 30,
          conversacion: null,
          avisos: { activos: true, destino: null },
        });
        await validar((await svc.generarCodigo(ANA)).codigo, '777');
        const e = await svc.estadoPara(ANA);
        expect(e.conversacion).toMatchObject({ telegramName: 'Ana' });
        expect(e.avisos).toEqual({ activos: true, destino: 'Ana' });
        // Pasados los 30 minutos ya no se muestra como abierta.
        await expect(
          svc.estadoPara(ANA, new Date(Date.now() + 31 * MIN)),
        ).resolves.toMatchObject({ conversacion: null });
      });

      it('sin el asistente disponible, la tarjeta lo sabe', async () => {
        disponible = false;
        await expect(svc.estadoPara(ANA)).resolves.toMatchObject({
          disponible: false,
          botUsername: null,
        });
      });

      it('cerrar desde el panel devuelve el chat a avisar; una vieja se cierra sin aviso', async () => {
        await expect(svc.cerrarDesdePanel(ANA)).resolves.toBeNull();
        await validar((await svc.generarCodigo(ANA)).codigo, '777');
        await expect(svc.cerrarDesdePanel(ANA)).resolves.toBe('777');
        expect(
          (
            await prisma.supportBotConversation.findFirst({
              where: { userId: ANA },
            })
          )?.closeReason,
        ).toBe('PANEL');

        await validar((await svc.generarCodigo(ANA)).codigo, '777');
        await expect(
          svc.cerrarDesdePanel(ANA, new Date(Date.now() + 31 * MIN)),
        ).resolves.toBeNull();
      });

      it('los avisos de los casos se apagan y se prenden', async () => {
        await svc.cambiarAvisos(ANA, false);
        await expect(svc.estadoPara(ANA)).resolves.toMatchObject({
          avisos: { activos: false },
        });
        await svc.cambiarAvisos(ANA, true);
        await expect(svc.estadoPara(ANA)).resolves.toMatchObject({
          avisos: { activos: true },
        });
      });
    });

    it('la pregunta en espera se toma una sola vez', async () => {
      await expect(
        svc.guardarPreguntaEnEspera('777', '¿cómo abro cupos?'),
      ).resolves.toBe(true);
      await expect(svc.tomarPreguntaEnEspera('777')).resolves.toBe(
        '¿cómo abro cupos?',
      );
      await expect(svc.tomarPreguntaEnEspera('777')).resolves.toBeNull();
    });

    it('borrar al usuario se lleva sus códigos y conversaciones', async () => {
      const u = await prisma.user.create({
        data: {
          email: `temporal.${SUF}@clinica.co`,
          password: 'x',
          role: 'DOCTOR',
          organizationId: ORG,
        },
      });
      await validar((await svc.generarCodigo(u.id)).codigo, '555');
      await prisma.user.delete({ where: { id: u.id } });
      expect(
        await prisma.supportBotConversation.count({ where: { userId: u.id } }),
      ).toBe(0);
      expect(
        await prisma.supportBotCode.count({ where: { userId: u.id } }),
      ).toBe(0);
    });
  },
);
