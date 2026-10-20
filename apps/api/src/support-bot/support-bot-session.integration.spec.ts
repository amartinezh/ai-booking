import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { SupportBotConfigService } from './support-bot-config.service';
import { SupportBotSessionService } from './support-bot-session.service';
import { SupportBotCasesService } from './support-bot-cases.service';
import { SupportBotNoticesService } from './support-bot-notices.service';
import { SupportBotStatsService } from './support-bot-stats.service';
import type { SupportBotService } from './support-bot.service';
import { SupportTicketGroupNotifier } from '../tech-alerts/support-ticket-group.notifier';
import type { TechAlertConfigService } from '../tech-alerts/tech-alert-config.service';
import {
  FLUJO_VACIO,
  claveCifrasDelDia,
  diaLocal,
  leerCategorias,
  type BorradorCaso,
} from '@agenia/shared';

/**
 * Códigos y conversaciones del asistente de soporte contra un Postgres REAL: la
 * transacción que abre la conversación, los índices parciales «una abierta por
 * usuario y por cuenta de Telegram» y el HMAC del código; (Fase 3) el caso a
 * medio abrir que pasa a la conversación siguiente y los casos que abre el
 * asistente; (Fase 4) reabrir, el aviso al grupo y el seguimiento a quien
 * reportó, con sus compare-and-set; y (Fase 5) las consultas de las cifras y de
 * las conversaciones del panel. Redis va en memoria.
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
  async hgetall(k: string) {
    const d = this.vivo(k);
    return d ? (JSON.parse(d.valor) as Record<string, string>) : {};
  }
}

(BD_DESECHABLE ? describe : describe.skip)(
  'Asistente de soporte — códigos y conversaciones (Postgres real)',
  () => {
    const prisma = new PrismaService();
    let redis: RedisFalso;
    let disponible: boolean;
    let svc: SupportBotSessionService;
    let casos: SupportBotCasesService;
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
              piloto: { activo: false, usuarios: [] },
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
      casos = new SupportBotCasesService(prisma);
      await prisma.supportTicket.deleteMany({
        where: { organizationId: { in: [ORG, OTRA_ORG] } },
      });
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

    describe('🧩 el caso a medio abrir (Fase 3)', () => {
      const BORRADOR: BorradorCaso = {
        fase: 'CONFIRMANDO',
        titulo: 'No salen los recordatorios',
        descripcion: 'Desde las 7 no sale ningún recordatorio.',
        pantalla: null,
        falta: [],
        prioridad: 'HIGH',
        creadoEn: new Date().toISOString(),
        venceEn: null,
      };
      const flujoDe = async (id: string) =>
        (
          await prisma.supportBotConversation.findUnique({
            where: { id },
            select: { flowState: true },
          })
        )?.flowState ?? null;
      const abrirConBorrador = async (telegramUserId = '777') => {
        const r = await validar(
          (await svc.generarCodigo(ANA)).codigo,
          telegramUserId,
        );
        if (r.tipo !== 'ABIERTA') throw new Error(r.tipo);
        await casos.guardarFlujo(r.interlocutor.conversationId, {
          ...FLUJO_VACIO,
          borrador: BORRADOR,
          notaPendiente: { caso: 58, texto: 'x' },
          modoCaso: true,
        });
        return r.interlocutor.conversationId;
      };

      it('el flujo vacío queda NULL en la base; con algo, se lee igual', async () => {
        const id = await abrirConBorrador();
        expect(await casos.leerFlujo(id)).toMatchObject({
          borrador: { titulo: 'No salen los recordatorios' },
          modoCaso: true,
        });
        await casos.guardarFlujo(id, { ...FLUJO_VACIO });
        expect(await flujoDe(id)).toBeNull();
        expect(await casos.leerFlujo(id)).toEqual(FLUJO_VACIO);
      });

      it('al cerrar con /salir queda 24 h y la conversación siguiente lo ofrece (sin la nota ni el modo caso)', async () => {
        const vieja = await abrirConBorrador();
        await svc.cerrar(vieja, 'SALIR');
        expect(await flujoDe(vieja)).toMatchObject({
          borrador: { venceEn: expect.any(String) },
          notaPendiente: null,
        });
        const r = await validar((await svc.generarCodigo(ANA)).codigo, '777');
        expect(r).toMatchObject({
          tipo: 'ABIERTA',
          borradorRetomado: {
            titulo: 'No salen los recordatorios',
            venceEn: null,
          },
        });
        if (r.tipo !== 'ABIERTA') return;
        // Pasa a la nueva y deja de estar en la vieja: no se ofrece dos veces.
        expect(await flujoDe(vieja)).toBeNull();
        expect(
          await casos.leerFlujo(r.interlocutor.conversationId),
        ).toMatchObject({
          borrador: { fase: 'CONFIRMANDO' },
          notaPendiente: null,
          modoCaso: false,
        });
      });

      it('también si la cerró un código nuevo desde otra cuenta (la misma transacción)', async () => {
        const vieja = await abrirConBorrador('777');
        const r = await validar((await svc.generarCodigo(ANA)).codigo, '888');
        expect(r).toMatchObject({
          chatsCerrados: ['777'],
          borradorRetomado: { titulo: 'No salen los recordatorios' },
        });
        expect(await flujoDe(vieja)).toBeNull();
      });

      it('vencidas las 24 h, no se ofrece', async () => {
        const vieja = await abrirConBorrador();
        await svc.cerrar(vieja, 'SALIR', new Date(Date.now() - 25 * 60 * MIN));
        const r = await validar((await svc.generarCodigo(ANA)).codigo, '777');
        expect(r).toMatchObject({ tipo: 'ABIERTA', borradorRetomado: null });
      });

      it('🔒 el borrador de una persona no le llega a otra en la misma cuenta de Telegram', async () => {
        await abrirConBorrador('777');
        const r = await validar((await svc.generarCodigo(BETO)).codigo, '777');
        expect(r).toMatchObject({ tipo: 'ABIERTA', borradorRetomado: null });
      });
    });

    describe('los casos del asistente (Fase 3)', () => {
      const interlocutor = async (userId = ANA, telegramUserId = '777') => {
        const r = await validar(
          (await svc.generarCodigo(userId)).codigo,
          telegramUserId,
        );
        if (r.tipo !== 'ABIERTA') throw new Error(r.tipo);
        return r.interlocutor;
      };

      it('abrir: número, canal Telegram, prioridad, conversación y lo que escribió tal cual', async () => {
        const yo = await interlocutor();
        for (const text of [
          '/nuevo',
          'no salen, la de la cédula 1053789456 llamó',
        ]) {
          await prisma.supportBotMessage.create({
            data: {
              conversationId: yo.conversationId,
              direction: 'ENTRADA',
              text,
            },
          });
        }
        const numero = await casos.abrirCaso(yo, {
          fase: 'CONFIRMANDO',
          titulo: 'No salen los recordatorios',
          descripcion: 'Desde las 7 no sale ningún recordatorio.',
          pantalla: null,
          falta: [],
          prioridad: 'HIGH',
          creadoEn: new Date().toISOString(),
          venceEn: null,
        });
        const caso = await prisma.supportTicket.findUnique({
          where: { number: numero },
        });
        expect(caso).toMatchObject({
          title: 'No salen los recordatorios',
          reporterId: ANA,
          organizationId: ORG,
          channel: 'TELEGRAM',
          priority: 'HIGH',
          status: 'OPEN',
          conversationId: yo.conversationId,
          groupNotice: 'PENDING',
        });
        expect(caso?.description).toContain(
          '«no salen, la de la cédula 1053789456 llamó»',
        );
        expect(caso?.description).not.toContain('/nuevo');
        // Y aparece en sus casos.
        expect((await casos.casosDe(yo)).map((c) => c.numero)).toEqual([
          numero,
        ]);
      });

      it('🔒 la nota: solo a SU caso y sin solucionar', async () => {
        const ana = await interlocutor(ANA, '777');
        const suyo = await prisma.supportTicket.create({
          data: {
            title: 'Suyo',
            description: 'x',
            reporterId: ANA,
            organizationId: ORG,
          },
        });
        const deBeto = await prisma.supportTicket.create({
          data: {
            title: 'De Beto',
            description: 'x',
            reporterId: BETO,
            organizationId: ORG,
          },
        });
        const resuelto = await prisma.supportTicket.create({
          data: {
            title: 'Resuelto',
            description: 'x',
            reporterId: ANA,
            organizationId: ORG,
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolutionNote: 'Listo',
          },
        });
        expect(
          await casos.agregarNota(ana, suyo.number, 'también el Dr. Ruiz'),
        ).toBe(true);
        expect(await casos.agregarNota(ana, deBeto.number, 'x')).toBe(false);
        expect(await casos.agregarNota(ana, resuelto.number, 'x')).toBe(false);
        expect(
          await prisma.supportTicketNote.findMany({
            select: {
              ticketId: true,
              authorId: true,
              channel: true,
              kind: true,
              text: true,
            },
            where: { ticket: { organizationId: ORG } },
          }),
        ).toEqual([
          {
            ticketId: suyo.id,
            authorId: ANA,
            channel: 'TELEGRAM',
            kind: 'AMPLIACION',
            text: 'también el Dr. Ruiz',
          },
        ]);
        // Sus casos: los dos suyos (el resuelto con la respuesta), no el de Beto.
        expect(
          (await casos.casosDe(ana)).map((c) => [c.titulo, c.respuesta]),
        ).toEqual([
          ['Resuelto', 'Listo'],
          ['Suyo', null],
        ]);
      });

      it('lo que el equipo ya sabe que falla: de su clínica o global, solo lo abierto', async () => {
        const alerta = (
          kind: string,
          dedupeKey: string,
          extra: Record<string, unknown> = {},
        ) =>
          prisma.techAlert.create({
            data: {
              kind,
              category: 'SERVICIOS',
              severity: 'CRITICA',
              dedupeKey,
              title: 't',
              ...extra,
            },
          });
        await prisma.techAlert.deleteMany({
          where: { dedupeKey: { startsWith: `prueba-${SUF}` } },
        });
        await alerta('RECORDATORIOS_FALLIDOS', `prueba-${SUF}-1`);
        await alerta('AVISO_AGENDADOR_NO_SALE', `prueba-${SUF}-2`, {
          organizationId: OTRA_ORG,
        });
        await alerta('RECORDATORIOS_FALLIDOS', `prueba-${SUF}-3`, {
          status: 'RESUELTA',
        });
        await alerta('ERROR_5XX', `prueba-${SUF}-4`);
        const r = await casos.incidentesPara(ORG, null);
        expect(r.map((i) => i.frase)).toEqual([
          'Los recordatorios automáticos no están saliendo',
        ]);
        await prisma.techAlert.deleteMany({
          where: { dedupeKey: { startsWith: `prueba-${SUF}` } },
        });
      });
    });

    describe('📣 los avisos de los casos (Fase 4)', () => {
      const ticket = (data: Record<string, unknown> = {}) =>
        prisma.supportTicket.create({
          data: {
            title: 'No salen los recordatorios',
            description: 'DETALLE CON DATOS',
            reporterId: ANA,
            organizationId: ORG,
            ...data,
          },
        });
      const yoDe = async (telegramUserId = '777') => {
        const r = await validar(
          (await svc.generarCodigo(ANA)).codigo,
          telegramUserId,
        );
        if (r.tipo !== 'ABIERTA') throw new Error(r.tipo);
        return r.interlocutor;
      };

      it('🔒 reabrir: solo un caso suyo solucionado hace menos de 7 días, una vez, con su nota', async () => {
        const yo = await yoDe();
        const reciente = await ticket({
          status: 'RESOLVED',
          startedAt: new Date(Date.now() - 3 * 86_400_000),
          resolvedAt: new Date(Date.now() - 2 * 86_400_000),
          resolutionNote: 'Se reinició.',
          groupNotice: 'SENT',
          groupNotifiedAt: new Date(Date.now() - 3 * 86_400_000),
          reporterNotifiedStatus: 'RESOLVED',
        });
        const viejo = await ticket({
          status: 'RESOLVED',
          resolvedAt: new Date(Date.now() - 8 * 86_400_000),
        });
        const deBeto = await ticket({
          reporterId: BETO,
          status: 'RESOLVED',
          resolvedAt: new Date(),
        });

        expect(await casos.reabrir(yo, reciente.number)).toBe(true);
        expect(await casos.reabrir(yo, reciente.number)).toBe(false);
        expect(await casos.reabrir(yo, viejo.number)).toBe(false);
        expect(await casos.reabrir(yo, deBeto.number)).toBe(false);

        expect(
          await prisma.supportTicket.findUnique({ where: { id: reciente.id } }),
        ).toMatchObject({
          status: 'OPEN',
          startedAt: null,
          resolvedAt: null,
          resolutionNote: 'Se reinició.',
          reopenedCount: 1,
          groupNotice: 'PENDING',
          groupNotifiedAt: null,
          reporterNotifiedStatus: 'OPEN',
        });
        expect(
          await prisma.supportTicketNote.findMany({
            where: { ticket: { organizationId: ORG } },
            select: { ticketId: true, kind: true, authorId: true },
          }),
        ).toEqual([
          { ticketId: reciente.id, kind: 'REAPERTURA', authorId: ANA },
        ]);
        expect(await casos.casoDelAviso(yo, deBeto.number)).toBeNull();
      });

      it('🏁 el aviso al grupo: uno por caso aunque corran dos réplicas, y el recordatorio una vez', async () => {
        const enviados: string[] = [];
        const canal = {
          token: 'T',
          chatId: '-100',
          enabled: true,
          mutedUntilIso: null,
          antirruido: {
            reminderMinutes: 30,
            maxReminders: 3,
            quietHoursEnabled: false,
            quietFromHour: 22,
            quietToHour: 6,
            categories: leerCategorias(null),
          },
          dailySummaryEnabled: false,
          lastDailySummaryIso: null,
          panelBase: 'https://panel.prueba.co',
        };
        const config = {
          canal: async () => canal,
          enviar: async (texto: string) => {
            enviados.push(texto);
            return { ok: true };
          },
        } as unknown as TechAlertConfigService;
        const otraConexion = new PrismaService();
        const a = new SupportTicketGroupNotifier(prisma, config);
        const b = new SupportTicketGroupNotifier(otraConexion, config);
        const caso = await ticket({ priority: 'HIGH', channel: 'TELEGRAM' });
        const ahora = new Date();
        await Promise.all([a.vuelta(ahora), b.vuelta(ahora)]);
        const misAvisos = () =>
          enviados.filter((t) => t.includes(`#${caso.number}`));
        expect(misAvisos()).toHaveLength(1);
        expect(misAvisos()[0]).not.toContain('DETALLE');
        expect(
          await prisma.supportTicket.findUnique({ where: { id: caso.id } }),
        ).toMatchObject({
          groupNotice: 'SENT',
          groupNoticeAttempts: 1,
          groupNoticeError: null,
        });

        // Dos horas del horario del equipo después (lunes 9:00 → 11:00 en Colombia).
        await prisma.supportTicket.update({
          where: { id: caso.id },
          data: { groupNotifiedAt: new Date('2026-10-19T14:00:00Z') },
        });
        const lunes11 = new Date('2026-10-19T16:00:00Z');
        await Promise.all([a.vuelta(lunes11), b.vuelta(lunes11)]);
        await otraConexion.$disconnect();
        expect(misAvisos().filter((t) => t.startsWith('⏰'))).toHaveLength(1);
      });

      it('🏁 el seguimiento: «tomado» y «resuelto» una vez, a su cuenta, con la respuesta si conversa', async () => {
        await yoDe('777');
        const avisos: Array<{
          chatId: string;
          yo: unknown;
          texto: string;
          resuelto: unknown;
        }> = [];
        const bot = {
          enviarAviso: async (
            _rt: unknown,
            destino: { chatId: string; yo: unknown },
            texto: string,
            resuelto: unknown,
          ) => {
            avisos.push({ ...destino, texto, resuelto });
            return { ok: true, messageId: '1' };
          },
        } as unknown as SupportBotService;
        const rt = {
          runtime: async () => ({
            enabled: true,
            token: 'T',
            piloto: { activo: false, usuarios: [] },
          }),
        };
        const otraConexion = new PrismaService();
        const a = new SupportBotNoticesService(
          prisma,
          rt as unknown as SupportBotConfigService,
          svc,
          bot,
        );
        const b = new SupportBotNoticesService(
          otraConexion,
          rt as unknown as SupportBotConfigService,
          svc,
          bot,
        );
        const caso = await ticket({
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        });
        await Promise.all([a.vuelta(), b.vuelta()]);
        const mios = () =>
          avisos.filter((x) => x.texto.includes(`#${caso.number}`));
        expect(mios()).toEqual([
          expect.objectContaining({ chatId: '777', resuelto: null }),
        ]);
        expect(mios()[0].texto.startsWith('👀')).toBe(true);

        await prisma.supportTicket.update({
          where: { id: caso.id },
          data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolutionNote: 'Se reinició el envío.',
          },
        });
        await Promise.all([a.vuelta(), b.vuelta()]);
        await otraConexion.$disconnect();
        expect(mios()).toHaveLength(2);
        expect(mios()[1]).toMatchObject({
          chatId: '777',
          yo: expect.objectContaining({ userId: ANA }),
          resuelto: { caso: caso.number, conVer: false },
        });
        expect(mios()[1].texto).toContain('Se reinició el envío.');
        expect(
          await prisma.supportTicket.findUnique({ where: { id: caso.id } }),
        ).toMatchObject({ reporterNotifiedStatus: 'RESOLVED' });
      });
    });

    describe('📊 lo que ve el super admin (Fase 5)', () => {
      it('las cifras, lo que el manual no cubrió y las conversaciones, con consultas de verdad', async () => {
        const conv = async (telegramUserId: string, userId = ANA) => {
          const r = await validar(
            (await svc.generarCodigo(userId)).codigo,
            telegramUserId,
          );
          if (r.tipo !== 'ABIERTA') throw new Error(r.tipo);
          return r.interlocutor.conversationId;
        };
        const c1 = await conv('901');
        const c2 = await conv('902', BETO);
        const msg = (conversationId: string, data: Record<string, unknown>) =>
          prisma.supportBotMessage.create({
            data: {
              conversationId,
              direction: 'SALIDA',
              text: 'x',
              ...data,
            } as never,
          });
        await prisma.supportBotMessage.create({
          data: {
            conversationId: c1,
            direction: 'ENTRADA',
            text: '¿exporto a Excel lo de la paciente 1053789456?',
          },
        });
        await msg(c1, {
          source: 'IA',
          uncovered: true,
          inputTokens: 30_000,
          outputTokens: 80,
          latencyMs: 1500,
        });
        await msg(c1, {
          source: 'IA',
          inputTokens: 1000,
          outputTokens: 20,
          latencyMs: 2500,
        });
        await msg(c2, { source: 'SIN_IA' });
        await msg(c2, { source: 'FIJO' });
        await prisma.supportBotConversation.update({
          where: { id: c1 },
          data: { feedback: 'UTIL', hadUncoveredQuestion: true },
        });
        await prisma.supportTicket.create({
          data: {
            title: 'Caso',
            description: 'x',
            reporterId: BETO,
            organizationId: ORG,
            channel: 'TELEGRAM',
            conversationId: c2,
          },
        });
        redis.datos.set(claveCifrasDelDia(diaLocal(new Date())), {
          valor: JSON.stringify({ codigos: '5', fallidos: '2' }),
          vence: null,
        });

        const stats = new SupportBotStatsService(
          prisma,
          redis as unknown as RedisService,
        );
        const r = await stats.cifras(7);
        // Puede haber datos de otras pruebas en la base: se mira lo de esta clínica.
        const mia = r.porClinica.find((f) => f.organizationId === ORG);
        expect(mia).toMatchObject({
          conversaciones: 2,
          personas: 2,
          respuestasIA: 2,
          respuestasSinIA: 1,
          tokensEntrada: 31_000,
          tokensSalida: 100,
          casos: 1,
        });
        expect(r.respuestas.tiempoMedioMs).toBeGreaterThan(0);
        expect(r.codigo).toMatchObject({ pedidos: 5, fallidos: 2 });

        const preguntas = await stats.preguntasSinCubrir(7);
        expect(preguntas).toEqual([
          expect.objectContaining({
            conversationId: c1,
            clinica: CLINICA,
            pregunta: '¿exporto a Excel lo de la paciente [dato oculto]?',
          }),
        ]);

        const lista = await stats.conversaciones({
          dias: 7,
          organizationId: ORG,
          tipo: 'TODAS',
        });
        expect(lista.filas.map((f) => f.id).sort()).toEqual([c1, c2].sort());
        expect(
          (
            await stats.conversaciones({
              dias: 7,
              organizationId: ORG,
              tipo: 'CON_CASO',
            })
          ).filas.map((f) => f.id),
        ).toEqual([c2]);
        expect(
          (
            await stats.conversaciones({
              dias: 7,
              organizationId: ORG,
              tipo: 'SIN_CUBRIR',
            })
          ).filas.map((f) => f.id),
        ).toEqual([c1]);
        // El cursor: la página siguiente empieza después del último.
        const primera = lista.filas[0].id;
        const resto = await stats.conversaciones({
          dias: 7,
          organizationId: ORG,
          tipo: 'TODAS',
          cursor: primera,
        });
        expect(resto.filas.map((f) => f.id)).toEqual(
          lista.filas.slice(1).map((f) => f.id),
        );

        const detalle = await stats.conversacion(c1, {
          userId: SA,
          email: 'sa@agenia.co',
        });
        expect(detalle.mensajesDetalle.map((m) => m.direccion)).toEqual([
          'ENTRADA',
          'SALIDA',
          'SALIDA',
        ]);
        expect(detalle.mensajesDetalle[0].texto).toContain('1053789456');
      });
    });

    it('🧪 el piloto (Fase 6) se arma con los correos, sin importar mayúsculas, y solo con personal', async () => {
      const cfg = new SupportBotConfigService(
        prisma,
        { encrypt: (x: string) => x, decrypt: (x: string) => x } as never,
        {
          getWebhookInfo: async () => ({ ok: false, description: 'x' }),
        } as never,
      );
      const actor = { userId: SA, email: 'sa@agenia.co', ip: null };
      await prisma.supportBotConfig.deleteMany();
      const pub = await cfg.updateSettings(
        { pilotEmails: [`ANA.PEREZ.${SUF}@CLINICA.CO`] },
        actor,
      );
      expect(pub.piloto).toEqual({
        activo: true,
        personas: [
          expect.objectContaining({
            id: ANA,
            rol: 'BOOKING_AGENT',
            clinica: CLINICA,
          }),
        ],
      });
      await expect(
        cfg.updateSettings(
          { pilotEmails: [`paciente.${SUF}@correo.co`] },
          actor,
        ),
      ).rejects.toThrow(/no son del personal/);
      const fila = await prisma.supportBotConfig.findUnique({
        where: { id: 'global' },
      });
      expect(fila).toMatchObject({ pilotOnly: true, pilotUserIds: [ANA] });
      await prisma.supportBotConfig.deleteMany();
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
