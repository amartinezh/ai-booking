import { PrismaService } from '../prisma/prisma.service';
import { ChannelStatsService } from './channel-stats.service';
import { ChannelActivityService } from '../interaction-log/channel-activity.service';
import { GlobalStatsService } from '../global-stats/global-stats.service';

// 30-sep-2026 20:30:17 Bogotá
const NOW = new Date('2026-10-01T01:30:17.123Z');
const Z = (s: string) => new Date(s);

/**
 * Prueba de INTEGRACIÓN contra un Postgres real (SQL crudo, zonas horarias,
 * agregados). Solo corre con una base desechable cuyo nombre termina en
 * `_verif`, para no sembrar datos jamás en desarrollo ni en producción:
 *
 *   docker run -d --rm --name agenia-canales -p 55433:5432 \
 *     -e POSTGRES_USER=agenia -e POSTGRES_PASSWORD=verif \
 *     -e POSTGRES_DB=agenia_verif postgres:15-alpine
 *   (esquema: `prisma db push` desde packages/database con ese DATABASE_URL)
 *   DATABASE_URL=postgresql://agenia:verif@localhost:55433/agenia_verif \
 *     pnpm exec jest src/channel-stats/channel-stats.integration.spec.ts --runInBand
 *
 * No es idempotente: requiere la base vacía.
 */
const BD_DESECHABLE = /\/[a-z0-9_]*_verif(\?|$)/.test(
  process.env.DATABASE_URL ?? '',
);

(BD_DESECHABLE ? describe : describe.skip)(
  'Canales en vivo — Postgres real',
  () => {
    const prisma = new PrismaService();
    let act: ChannelActivityService;
    let A: string;
    let B: string;

    beforeAll(async () => {
      process.env.ENCRYPTION_KEY = 'clave-verif';
      act = new ChannelActivityService(prisma);
      const orgA = await prisma.organization.create({
        data: { name: 'Org A' },
      });
      const orgB = await prisma.organization.create({
        data: { name: 'Org B' },
      });
      A = orgA.id;
      B = orgB.id;
      const h = (org: string, s: string) => act.hashSender(org, s)!;
      const ev = (
        org: string,
        sender: string,
        event: any,
        at: string,
        channel: any = 'WHATSAPP',
        messageType: string | null = 'text',
      ) => ({
        organizationId: org,
        senderHash: h(org, sender),
        event,
        createdAt: Z(at),
        channel,
        messageType: event === 'INBOUND' ? messageType : null,
      });
      await prisma.channelActivityLog.createMany({
        data: [
          ev(A, 'w1', 'INBOUND', '2026-09-30T14:15:03.4Z'),
          ev(A, 'w1', 'INBOUND', '2026-09-30T14:16:03.4Z', 'WHATSAPP', 'audio'),
          ev(A, 'w1', 'INBOUND', '2026-09-30T14:17:03.4Z'),
          ev(A, 'w1', 'BOOKED', '2026-09-30T14:20:09.1Z'),
          ev(A, 'w2', 'INBOUND', '2026-10-01T01:10:41.7Z'),
          ev(A, 'w2', 'INBOUND', '2026-10-01T01:11:41.7Z'),
          ev(A, 'w3', 'INBOUND', '2026-10-01T01:25:12.2Z'),
          ev(A, 'w3', 'PROBLEM', '2026-10-01T01:25:13.2Z'),
          ev(A, 'w4', 'INBOUND', '2026-09-29T15:00:55.5Z'),
          ev(A, 'w4', 'INBOUND', '2026-09-30T16:00:55.5Z'),
          ev(A, 'w4', 'MANAGE', '2026-09-30T16:01:55.5Z'),
          ev(A, 'tg:1', 'INBOUND', '2026-09-30T13:00:27.9Z', 'TELEGRAM'),
          ev(
            A,
            'tg:1',
            'INBOUND',
            '2026-09-30T13:01:27.9Z',
            'TELEGRAM',
            'audio',
          ),
          ev(A, 'tg:1', 'BOOKED', '2026-09-30T13:05:27.9Z', 'TELEGRAM'),
          // Mañana en Bogotá (1-oct 00:30 local): NO es de hoy.
          ev(A, 'w9', 'INBOUND', '2026-10-01T05:30:00.0Z'),
          // Otra clínica: no se cuela.
          ev(B, 'w1', 'INBOUND', '2026-09-30T14:15:03.4Z'),
        ],
      });

      // Citas: una por WhatsApp, una por Telegram, una manual (no cuenta).
      const svc = await prisma.medicalService.create({
        data: { name: 'MG', organizationId: A },
      });
      const du = await prisma.user.create({
        data: { email: 'd@x', password: 'x' },
      });
      const doc = await prisma.doctorProfile.create({
        data: {
          cedula: '1',
          fullName: 'Doc',
          userId: du.id,
          organizationId: A,
        },
      });
      const cita = async (
        i: number,
        origin: any,
        createdAt: string,
        status: any = 'SCHEDULED',
      ) => {
        const pu = await prisma.user.create({
          data: { email: `p${i}@x`, password: 'x' },
        });
        const p = await prisma.patientProfile.create({
          data: {
            cedula: `c${i}`,
            fullName: 'P',
            userId: pu.id,
            organizationId: A,
          },
        });
        const slot = await prisma.scheduleSlot.create({
          data: {
            startTime: Z(`2026-10-1${i}T14:00:00Z`),
            endTime: Z(`2026-10-1${i}T14:20:00Z`),
            doctorId: doc.id,
            serviceId: svc.id,
            organizationId: A,
          },
        });
        await prisma.appointment.create({
          data: {
            scheduleSlotId: slot.id,
            patientId: p.id,
            organizationId: A,
            origin,
            createdAt: Z(createdAt),
            status,
          },
        });
      };
      await cita(1, 'WHATSAPP', '2026-09-30T14:20:08.0Z');
      await cita(2, 'TELEGRAM', '2026-09-30T13:05:26.0Z', 'CANCELLED');
      await cita(3, 'MANUAL', '2026-09-30T15:00:00.0Z');
      await cita(4, 'WHATSAPP', '2026-10-01T06:00:00.0Z'); // mañana local

      await prisma.interactionLog.createMany({
        data: [
          {
            whatsappId: 'w3',
            organizationId: A,
            status: 'FAILED',
            failureReason: 'NO_AGENDA',
            createdAt: Z('2026-10-01T01:25:13Z'),
          },
          {
            whatsappId: 'w5',
            organizationId: A,
            status: 'FAILED',
            failureReason: 'META_API_ERROR',
            metadata: { outbound: true },
            createdAt: Z('2026-09-30T18:00:00Z'),
          },
          {
            whatsappId: 'w4',
            organizationId: A,
            status: 'CANCELLATION_FLOW',
            createdAt: Z('2026-09-30T16:01:55Z'),
          },
          {
            whatsappId: 'tg:1',
            organizationId: A,
            status: 'EMERGENCY_ESCALATED',
            createdAt: Z('2026-09-30T13:03:00Z'),
          },
        ],
      });
      await prisma.whatsappMessageLog.createMany({
        data: [
          {
            wamid: 'a',
            organizationId: A,
            recipientId: 'w1',
            messageType: 'TEXT',
            kind: 'BOT_REPLY',
            status: 'READ',
            createdAt: Z('2026-09-30T14:16:00Z'),
          },
          {
            wamid: 'b',
            organizationId: A,
            recipientId: 'w2',
            messageType: 'TEXT',
            kind: 'BOT_REPLY',
            status: 'DELIVERED',
            createdAt: Z('2026-10-01T01:11:00Z'),
          },
          {
            wamid: 'c',
            organizationId: A,
            recipientId: 'w3',
            messageType: 'TEXT',
            kind: 'BOT_REPLY',
            status: 'FAILED',
            createdAt: Z('2026-10-01T01:26:00Z'),
          },
        ],
      });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it('record() escribe una fila con HMAC y canal correcto', async () => {
      await act.record({
        organizationId: B,
        senderId: 'tg:77',
        event: 'INBOUND',
        messageType: 'text',
      });
      const r = await prisma.channelActivityLog.findFirst({
        where: { organizationId: B, channel: 'TELEGRAM' },
      });
      expect(r?.senderHash).toBe(act.hashSender(B, 'tg:77'));
      await prisma.channelActivityLog.delete({ where: { id: r!.id } });
    });

    it('TODAY en org A: cifras exactas por canal', async () => {
      const s = await new ChannelStatsService(prisma).getStats({
        organizationId: A,
        range: 'TODAY',
        now: NOW,
      });
      expect(s.filters.startDate).toBe('2026-09-30T05:00:00.000Z');
      expect(s.channels.WHATSAPP.totals).toEqual({
        writers: 4,
        messages: 7,
        appointmentsRequested: 1,
        bookedWriters: 1,
        managedWriters: 1,
        noBooking: 2,
        problemWriters: 1,
        conversionPct: 25,
        messagesPerWriter: 1.8,
        newWriters: 3,
        returningWriters: 1,
        activeNow: 1,
      });
      expect(s.channels.TELEGRAM.totals).toMatchObject({
        writers: 1,
        messages: 2,
        appointmentsRequested: 1,
        bookedWriters: 1,
        noBooking: 0,
        conversionPct: 100,
        activeNow: 0,
      });
      const wa = s.channels.WHATSAPP.series;
      expect(wa).toHaveLength(24);
      expect(wa.find((p) => p.bucket === '2026-09-30T20')).toEqual({
        bucket: '2026-09-30T20',
        writers: 2,
        messages: 3,
        appointments: 0,
        noBooking: 2,
        problems: 1,
      });
      expect(wa.find((p) => p.bucket === '2026-09-30T09')).toEqual({
        bucket: '2026-09-30T09',
        writers: 1,
        messages: 3,
        appointments: 1,
        noBooking: 0,
        problems: 0,
      });
      expect(
        s.channels.TELEGRAM.series.find((p) => p.bucket === '2026-09-30T08'),
      ).toMatchObject({ writers: 1, appointments: 1 });

      expect(s.details.appointmentsByStatus).toEqual({
        WHATSAPP: { scheduled: 1, completed: 0, cancelled: 0, noShow: 0 },
        TELEGRAM: { scheduled: 0, completed: 0, cancelled: 1, noShow: 0 },
      });
      expect(s.details.failureReasons).toEqual([
        { channel: 'WHATSAPP', reason: 'NO_AGENDA', count: 1 },
      ]);
      expect(s.details.flows.WHATSAPP.CANCELLATION_FLOW).toBe(1);
      expect(s.details.flows.TELEGRAM.EMERGENCY_ESCALATED).toBe(1);
      expect(s.details.delivery.WHATSAPP).toEqual({
        READ: 1,
        DELIVERED: 1,
        FAILED: 1,
      });
      expect(s.details.messageTypes).toEqual(
        expect.arrayContaining([
          { channel: 'WHATSAPP', type: 'text', messages: 6 },
          { channel: 'WHATSAPP', type: 'audio', messages: 1 },
          { channel: 'TELEGRAM', type: 'audio', messages: 1 },
        ]),
      );
      const pico = s.details.peakHours.find(
        (p) => p.channel === 'WHATSAPP' && p.hour === 20,
      );
      expect(pico).toEqual({
        channel: 'WHATSAPP',
        dow: 3,
        hour: 20,
        messages: 3,
      });
    });

    it('WEEK: w4 cuenta una vez aunque escribió dos días; por día de Bogotá', async () => {
      const s = await new ChannelStatsService(prisma).getStats({
        organizationId: A,
        range: 'WEEK',
        now: NOW,
      });
      // w1..w4 + w9 (1-oct 00:30 local, misma semana); w4 una sola vez.
      expect(s.channels.WHATSAPP.totals.writers).toBe(5);
      expect(s.channels.WHATSAPP.totals.messages).toBe(9);
      const dias = Object.fromEntries(
        s.channels.WHATSAPP.series.map((p) => [p.bucket, p.writers]),
      );
      expect(dias['2026-09-29']).toBe(1);
      expect(dias['2026-09-30']).toBe(4);
      expect(dias['2026-10-01']).toBe(1); // w9, a las 00:30 local
      expect(s.channels.WHATSAPP.totals.newWriters).toBe(5);
      expect(s.channels.WHATSAPP.totals.returningWriters).toBe(0);
    });

    it('YEAR por mes y vista global incluye las dos clínicas', async () => {
      const s = await new ChannelStatsService(prisma).getStats({
        organizationId: null,
        range: 'YEAR',
        now: NOW,
      });
      const sep = s.channels.WHATSAPP.series.find(
        (p) => p.bucket === '2026-09',
      )!;
      expect(sep.writers).toBe(5); // 4 de A + 1 de B (hash distinto por clínica)
      expect(
        s.channels.WHATSAPP.series.find((p) => p.bucket === '2026-10')!.writers,
      ).toBe(1); // w9
      expect(s.channels.WHATSAPP.series).toHaveLength(12);
    });

    it('GlobalStats TODAY: mensajes del bot y emergencias en día de Bogotá', async () => {
      jest.useFakeTimers({
        now: NOW,
        doNotFake: [
          'nextTick',
          'setImmediate',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'queueMicrotask',
          'hrtime',
          'performance',
        ],
      });
      try {
        const g = await new GlobalStatsService(prisma).getGlobalStats({
          organizationId: A,
          range: 'TODAY',
        });
        expect(g.metrics.botMessagesReceived).toBe(9);
        expect(g.metrics.emergencyEscalations).toBe(1);
        expect(g.trends.botMessagesReceived).toEqual([
          { date: '2026-09-30', count: 9 },
        ]);
      } finally {
        jest.useRealTimers();
      }
    });
  },
);
