import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService } from './appointments.service';
import { PrismaService } from '../prisma/prisma.service';
import { LimiteCitasService } from './limite-citas.service';

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let findMany: jest.Mock;
  let mirrorConfig: { findUnique: jest.Mock };
  let entityMap: { findMany: jest.Mock };
  let orgFindUnique: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn(() => []);
    // Sin fila de ajustes: la clínica ofrece el default (6).
    orgFindUnique = jest.fn(() => null);
    // Por defecto: organización SIN espejo. Es el caso de cualquier clínica
    // normal, y el que no debe cambiar de comportamiento.
    mirrorConfig = { findUnique: jest.fn(() => null) };
    entityMap = { findMany: jest.fn(() => []) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        {
          provide: PrismaService,
          useValue: {
            scheduleSlot: {
              findUnique: jest.fn(),
              update: jest.fn(),
              findMany,
            },
            appointment: {
              create: jest.fn(),
              update: jest.fn(),
              findFirst: jest.fn(),
            },
            hospitalMirrorConfig: mirrorConfig,
            mirrorEntityMap: entityMap,
            organization: { findUnique: orgFindUnique },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('bookAppointment — colisión de cupo', () => {
    // Construye un servicio cuyo $transaction ejecuta el callback contra un tx
    // en el que el slot indicado ya NO está disponible (o no existe / es de otro
    // tenant), reproduciendo la carrera real entre dos pacientes.
    // `doctor` va en el fixture porque la consulta real lo incluye: sin el,
    // el chequeo de `whatsappBookingEnabled` no tendria nada que mirar.
    const conMedico = (slot: any) =>
      slot === null
        ? null
        : { doctor: { whatsappBookingEnabled: true }, ...slot };

    const serviceWithSlot = async (slot: any) => {
      const tx = {
        scheduleSlot: {
          findUnique: jest.fn(() => conMedico(slot)),
          update: jest.fn(),
        },
        appointment: { create: jest.fn(() => ({ id: 'apt1' })) },
        $executeRawUnsafe: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          {
            provide: PrismaService,
            useValue: {
              $transaction: jest.fn((cb: any) => cb(tx)),
            },
          },
        ],
      }).compile();
      return {
        svc: module.get<AppointmentsService>(AppointmentsService),
        tx,
      };
    };

    it('slot ya tomado (isAvailable=false) → success:false, NO relanza (bug SLOT_TAKEN_OR_INVALID)', async () => {
      const { svc, tx } = await serviceWithSlot({
        id: 's1',
        isAvailable: false,
        organizationId: 'org1',
      });

      const result = await svc.bookAppointment(
        'p1',
        's1',
        null,
        'WHATSAPP',
        'org1',
      );

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/acaba de ser reservado/i);
      // No debió intentar crear la cita ni ocupar el slot.
      expect(tx.appointment.create).not.toHaveBeenCalled();
      expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
    });

    it('🏥 cupo cerrado por el barrido para ESTA cita del HIS → MIRROR la monta encima', async () => {
      const { svc, tx } = await serviceWithSlot({
        id: 's1',
        isAvailable: false,
        organizationId: 'org1',
      });

      const result = await svc.bookAppointment(
        'p1',
        's1',
        null,
        'MIRROR',
        'org1',
        { cupoCerradoPorElHis: true },
      );

      expect(result.success).toBe(true);
      expect(tx.appointment.create).toHaveBeenCalled();
    });

    it('🛡️ el permiso de cupo cerrado NO vale para WhatsApp ni el panel', async () => {
      for (const origen of ['WHATSAPP', 'TELEGRAM', 'MANUAL'] as const) {
        const { svc, tx } = await serviceWithSlot({
          id: 's1',
          isAvailable: false,
          organizationId: 'org1',
        });

        const result = await svc.bookAppointment(
          'p1',
          's1',
          null,
          origen,
          'org1',
          { cupoCerradoPorElHis: true },
        );

        expect(result.success).toBe(false);
        expect(tx.appointment.create).not.toHaveBeenCalled();
      }
    });

    it('🛡️ MIRROR sin el permiso sigue rechazando el cupo cerrado', async () => {
      const { svc, tx } = await serviceWithSlot({
        id: 's1',
        isAvailable: false,
        organizationId: 'org1',
      });

      const result = await svc.bookAppointment(
        'p1',
        's1',
        null,
        'MIRROR',
        'org1',
      );

      expect(result.success).toBe(false);
      expect(tx.appointment.create).not.toHaveBeenCalled();
    });

    it('slot inexistente → success:false (misma rama del catch)', async () => {
      const { svc } = await serviceWithSlot(null);

      const result = await svc.bookAppointment(
        'p1',
        's1',
        null,
        'WHATSAPP',
        'org1',
      );

      expect(result.success).toBe(false);
    });

    it('slot de otro tenant → success:false (aislamiento)', async () => {
      const { svc } = await serviceWithSlot({
        id: 's1',
        isAvailable: true,
        organizationId: 'OTRA_ORG',
      });

      const result = await svc.bookAppointment(
        'p1',
        's1',
        null,
        'WHATSAPP',
        'org1',
      );

      expect(result.success).toBe(false);
    });
  });

  describe('bookAppointment — anti-eco espejo (origin=MIRROR)', () => {
    // `doctor` va en el fixture porque la consulta real lo incluye: sin el,
    // el chequeo de `whatsappBookingEnabled` no tendria nada que mirar.
    const conMedico = (slot: any) =>
      slot === null
        ? null
        : { doctor: { whatsappBookingEnabled: true }, ...slot };

    const serviceWithSlot = async (slot: any) => {
      const tx = {
        scheduleSlot: {
          findUnique: jest.fn(() => conMedico(slot)),
          update: jest.fn(),
        },
        appointment: { create: jest.fn(() => ({ id: 'apt1' })) },
        $executeRawUnsafe: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          {
            provide: PrismaService,
            useValue: {
              $transaction: jest.fn((cb: any) => cb(tx)),
            },
          },
        ],
      }).compile();
      return {
        svc: module.get<AppointmentsService>(AppointmentsService),
        tx,
      };
    };

    it('origin=MIRROR → marca SET LOCAL agenia.sync_origin ANTES de tocar el slot', async () => {
      const { svc, tx } = await serviceWithSlot({
        id: 's1',
        isAvailable: true,
        organizationId: 'org1',
      });

      await svc.bookAppointment('p1', 's1', null, 'MIRROR', 'org1');

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        `SET LOCAL agenia.sync_origin = 'MIRROR'`,
      );
      // Orden: el anti-eco debe fijarse ANTES del INSERT que el trigger va a
      // capturar — si se marcara después, la fila ya habría entrado sin el
      // origin correcto y el evento se reenviaría de vuelta al HIS que lo originó.
      const rawCallOrder = tx.$executeRawUnsafe.mock.invocationCallOrder[0];
      const createCallOrder = tx.appointment.create.mock.invocationCallOrder[0];
      expect(rawCallOrder).toBeLessThan(createCallOrder);
    });

    it.each(['WHATSAPP', 'MANUAL'] as const)(
      'origin=%s → NUNCA marca el anti-eco (solo aplica a MIRROR)',
      async (origin) => {
        const { svc, tx } = await serviceWithSlot({
          id: 's1',
          isAvailable: true,
          organizationId: 'org1',
          startTime: new Date(Date.now() + 86_400_000),
        });

        await svc.bookAppointment('p1', 's1', null, origin, 'org1');

        expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
      },
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  // El nombre que ve el paciente sale de aquí ya formateado.
  //
  // Los cuatro perfiles con los que arranca el piloto de Anserma —76, 077,
  // 91-1 y 91-2— son AGENDAS FUNCIONALES del HIS, no personas. El chatbot
  // anteponía el honorífico a mano y eso producía «Dr(a). MEDICO ATENCIÓN
  // HTA 2» para prácticamente todos los pacientes del arranque.
  // ══════════════════════════════════════════════════════════════════════
  describe('getAvailableSlots — cómo se nombra al médico', () => {
    const cupo = (doctor: Record<string, unknown>) => ({
      id: 's1',
      startTime: new Date(Date.now() + 86400000),
      doctor,
      service: { name: 'Consulta ambulatoria control hipertensos' },
    });

    it('una persona lleva honorífico', async () => {
      findMany.mockResolvedValueOnce([
        cupo({ fullName: 'Juan Pérez', isFunctionalAgenda: false }),
      ]);
      const [slot] = await service.getAvailableSlots('Medicina', null, 'org1');
      expect(slot.doctor).toBe('Dr(a). Juan Pérez');
    });

    it('🚨 una agenda funcional NO — nada de «Dr(a). MEDICO ATENCIÓN HTA 2»', async () => {
      findMany.mockResolvedValueOnce([
        cupo({
          fullName: 'Programa de Hipertensión',
          isFunctionalAgenda: true,
        }),
      ]);
      const [slot] = await service.getAvailableSlots('Medicina', null, 'org1');
      expect(slot.doctor).toBe('Programa de Hipertensión');
      expect(slot.doctor).not.toMatch(/Dr/);
    });
  });

  // Retroalimentación del 2026-09-24: con la agenda llena el menú traía 10
  // cupos de la misma mañana. Ahora se ofrecen N (ajuste de la clínica),
  // mitad mañana y mitad tarde.
  describe('getAvailableSlots — cuántos cupos se ofrecen', () => {
    // Cupo a esa hora de Bogotá (UTC-5), dentro de 30 días.
    const enBogota = (h: number, m = 0) => {
      const d = new Date(Date.now() + 30 * 86400000);
      d.setUTCHours(h + 5, m, 0, 0);
      return d;
    };
    const agendaLlena = () =>
      [
        ...[0, 15, 30, 45].flatMap((m) => [7, 8].map((h) => enBogota(h, m))),
        ...[0, 15, 30, 45].map((m) => enBogota(14, m)),
      ]
        .sort((a, b) => a.getTime() - b.getTime())
        .map((startTime, i) => ({
          id: `s${i}`,
          startTime,
          doctor: { fullName: 'Ana', isFunctionalAgenda: false },
          service: { name: 'Medicina' },
        }));
    const hora = (d: Date) => d.getUTCHours() - 5;

    it('consulta una bolsa amplia, no solo los 10 más próximos', async () => {
      await service.getAvailableSlots('Medicina', null, 'org1');
      expect(findMany.mock.calls[0][0].take).toBeGreaterThan(10);
    });

    it('sin ajuste ofrece 6: 3 de mañana y 3 de tarde', async () => {
      findMany.mockResolvedValueOnce(agendaLlena());
      const slots = await service.getAvailableSlots('Medicina', null, 'org1');
      expect(slots).toHaveLength(6);
      expect(slots.filter((s) => hora(s.fecha) < 12)).toHaveLength(3);
      expect(slots.filter((s) => hora(s.fecha) >= 12)).toHaveLength(3);
    });

    it('respeta el número que configuró la clínica', async () => {
      findMany.mockResolvedValueOnce(agendaLlena());
      orgFindUnique.mockResolvedValueOnce({
        timezone: null,
        settings: { slotsOfferedCount: 4 },
      });
      const slots = await service.getAvailableSlots('Medicina', null, 'org1');
      expect(slots).toHaveLength(4);
      expect(orgFindUnique.mock.calls[0][0].where).toEqual({ id: 'org1' });
    });

    it('con { todos: true } devuelve la bolsa completa (match de hora por voz)', async () => {
      findMany.mockResolvedValueOnce(agendaLlena());
      const slots = await service.getAvailableSlots(
        'Medicina',
        null,
        'org1',
        null,
        { todos: true },
      );
      expect(slots).toHaveLength(12);
    });

    // 2026-10-28: con «para las 3:30» se mostraba la tarde desde el principio.
    it('con una hora pedida ofrece los más cercanos a ella, en orden de hora', async () => {
      findMany.mockResolvedValueOnce(agendaLlena());
      const slots = await service.getAvailableSlots(
        'Medicina',
        null,
        'org1',
        null,
        { hora: { hour24: 2, minute: 30, meridiemKnown: false } },
      );
      // «2:30» sin franja es las 14:30: los cuatro de la tarde y, de la
      // mañana, los dos más tardíos (los más cercanos a la tarde).
      expect(
        slots.map((s) => `${hora(s.fecha)}:${s.fecha.getUTCMinutes()}`),
      ).toEqual(['8:30', '8:45', '14:0', '14:15', '14:30', '14:45']);
    });
  });

  describe('getAvailableSlots — filtro de fecha', () => {
    const whereOf = () => findMany.mock.calls[0][0].where;

    it('⏱️ sin dateWindow → solo cupos desde 60 minutos después de ahora', async () => {
      const antes = Date.now();
      await service.getAvailableSlots('Medicina', null, 'org1');
      const startTime = whereOf().startTime;
      expect(startTime.gte.getTime()).toBeGreaterThanOrEqual(
        antes + 60 * 60_000,
      );
      expect(startTime.gte.getTime()).toBeLessThan(antes + 61 * 60_000);
      expect(startTime).not.toHaveProperty('lte');
    });

    it('⏱️ con ventana que empieza ya («hoy») → desde 60 minutos después, no desde ahora', async () => {
      const antes = Date.now();
      await service.getAvailableSlots('Medicina', null, 'org1', {
        desde: new Date(antes - 3_600_000),
        hasta: new Date(antes + 12 * 3_600_000),
      });
      expect(whereOf().startTime.gte.getTime()).toBeGreaterThanOrEqual(
        antes + 60 * 60_000,
      );
    });

    it('con dateWindow futuro → gte: desde, lte: hasta', async () => {
      const desde = new Date(Date.now() + 24 * 3600 * 1000);
      const hasta = new Date(Date.now() + 48 * 3600 * 1000);
      await service.getAvailableSlots('Medicina', null, 'org1', {
        desde,
        hasta,
      });
      const startTime = whereOf().startTime;
      expect(startTime.gte).toEqual(desde);
      expect(startTime.lte).toEqual(hasta);
    });

    it('con dateWindow cuyo desde es pasado → usa now como gte (no ofrece horas pasadas)', async () => {
      const desde = new Date(Date.now() - 6 * 3600 * 1000); // "hoy" 00:00 ya pasó
      const hasta = new Date(Date.now() + 6 * 3600 * 1000);
      const before = Date.now();
      await service.getAvailableSlots('Medicina', null, 'org1', {
        desde,
        hasta,
      });
      const startTime = whereOf().startTime;
      expect(startTime.gte.getTime()).toBeGreaterThanOrEqual(before);
      expect(startTime.lte).toEqual(hasta);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Activación por médico (bloque E).
//
// `whatsappBookingEnabled` existía en el schema desde la Fase 1 del espejo
// pero NO SE LEÍA EN NINGÚN SITIO — verificado con un grep sobre todo el
// repo el 2026-08-31: una sola aparición, la del schema. La activación
// gradual médico por médico que el hospital pidió no existía.
// ═══════════════════════════════════════════════════════════════════════════
describe('AppointmentsService — activación por médico', () => {
  let service: AppointmentsService;
  let slotFindMany: jest.Mock;
  let mirrorConfig: { findUnique: jest.Mock };
  let entityMap: { findMany: jest.Mock };

  const construir = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        {
          provide: PrismaService,
          useValue: {
            scheduleSlot: { findMany: slotFindMany },
            organization: { findUnique: jest.fn(() => null) },
            hospitalMirrorConfig: mirrorConfig,
            mirrorEntityMap: entityMap,
          },
        },
      ],
    }).compile();
    return module.get<AppointmentsService>(AppointmentsService);
  };

  beforeEach(async () => {
    slotFindMany = jest.fn(() => []);
    mirrorConfig = { findUnique: jest.fn(() => null) };
    entityMap = { findMany: jest.fn(() => []) };
    service = await construir();
  });

  const whereDeLaConsulta = () => slotFindMany.mock.calls[0][0].where;

  describe('sin espejo (clínica normal)', () => {
    it('solo ofrece cupos de médicos con la reserva por WhatsApp activa', async () => {
      await service.getAvailableSlots('Medicina General', null, 'org1');

      expect(whereDeLaConsulta().doctor).toEqual({
        whatsappBookingEnabled: true,
      });
    });

    it('NO consulta la homologación: una clínica normal no sabe qué es eso', async () => {
      await service.getAvailableSlots('Medicina General', null, 'org1');

      expect(entityMap.findMany).not.toHaveBeenCalled();
    });

    it('el resto de la consulta no cambia (tenant, disponibilidad, EPS)', async () => {
      await service.getAvailableSlots('Medicina General', 'eps-1', 'org1');

      const where = whereDeLaConsulta();
      expect(where.organizationId).toBe('org1');
      expect(where.isAvailable).toBe(true);
      expect(where.OR).toEqual([
        { allowedEpsId: null },
        { allowedEpsId: 'eps-1' },
      ]);
    });
  });

  describe('con espejo activo', () => {
    beforeEach(async () => {
      mirrorConfig.findUnique = jest.fn(() => ({ enabled: true }));
      entityMap.findMany = jest.fn(() => [
        { agenIAId: 'doc-1' },
        { agenIAId: 'doc-2' },
      ]);
      service = await construir();
    });

    it('además exige que el médico esté homologado con el HIS', async () => {
      await service.getAvailableSlots('Medicina General', null, 'org1');

      expect(whereDeLaConsulta().doctor).toEqual({
        whatsappBookingEnabled: true,
        id: { in: ['doc-1', 'doc-2'] },
      });
    });

    it('sin ningún médico homologado, no ofrece nada', async () => {
      // Prometerle un cupo al paciente cuya cita jamás llegará al HIS es la
      // misma sobreventa que encontró la prueba E2E, vista desde el otro lado.
      entityMap.findMany = jest.fn(() => []);
      service = await construir();

      await service.getAvailableSlots('Medicina General', null, 'org1');

      expect(whereDeLaConsulta().doctor.id).toEqual({ in: [] });
    });

    it('un espejo configurado pero APAGADO se comporta como sin espejo', async () => {
      mirrorConfig.findUnique = jest.fn(() => ({ enabled: false }));
      service = await construir();

      await service.getAvailableSlots('Medicina General', null, 'org1');

      expect(whereDeLaConsulta().doctor).toEqual({
        whatsappBookingEnabled: true,
      });
      expect(entityMap.findMany).not.toHaveBeenCalled();
    });

    it('la homologación se consulta acotada a la organización', async () => {
      await service.getAvailableSlots('Medicina General', null, 'org1');

      expect(entityMap.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1', entityType: 'DOCTOR' },
        select: { agenIAId: true },
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Revalidación al confirmar: entre que el paciente ve el menú y responde "SÍ"
// pasan minutos, y al hospital le basta apagar a un médico en ese rato.
// ═══════════════════════════════════════════════════════════════════════════
describe('AppointmentsService — el médico se apaga mientras el paciente decide', () => {
  const conCupo = async (slot: any) => {
    const tx = {
      scheduleSlot: {
        findUnique: jest.fn(() => slot),
        update: jest.fn(),
      },
      appointment: { create: jest.fn(() => ({ id: 'apt1' })) },
      $executeRawUnsafe: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        {
          provide: PrismaService,
          useValue: { $transaction: jest.fn((cb: any) => cb(tx)) },
        },
      ],
    }).compile();
    return { svc: module.get<AppointmentsService>(AppointmentsService), tx };
  };

  const cupoLibre = (whatsappBookingEnabled: boolean) => ({
    id: 's1',
    isAvailable: true,
    organizationId: 'org1',
    startTime: new Date(Date.now() + 86_400_000),
    doctor: { whatsappBookingEnabled },
  });

  it('rechaza la reserva si el médico ya no acepta WhatsApp', async () => {
    const { svc, tx } = await conCupo(cupoLibre(false));

    const r = await svc.bookAppointment('p1', 's1', null, 'WHATSAPP', 'org1');

    expect(r.success).toBe(false);
    expect(tx.appointment.create).not.toHaveBeenCalled();
    expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
  });

  it('el mensaje NO dice que otro paciente se llevó el cupo: sería mentira', async () => {
    const { svc } = await conCupo(cupoLibre(false));

    const r = await svc.bookAppointment('p1', 's1', null, 'WHATSAPP', 'org1');

    expect(r.message).not.toContain('otro paciente');
    expect(r.message).toContain('este medio');
  });

  it('con el médico activo, la reserva pasa', async () => {
    const { svc, tx } = await conCupo(cupoLibre(true));

    const r = await svc.bookAppointment('p1', 's1', null, 'WHATSAPP', 'org1');

    expect(r.success).toBe(true);
    expect(tx.appointment.create).toHaveBeenCalled();
  });

  describe('⏱️ anticipación mínima al reservar (2026-10-21)', () => {
    const cupoEn = (minutos: number) => ({
      ...cupoLibre(true),
      startTime: new Date(Date.now() + minutos * 60_000),
    });

    it.each(['WHATSAPP', 'TELEGRAM'] as const)(
      'por el bot (%s), un cupo que empieza en 20 minutos ya no se reserva: se le ofrecen otros',
      async (origin) => {
        const { svc, tx } = await conCupo(cupoEn(20));

        const r = await svc.bookAppointment('p1', 's1', null, origin, 'org1');

        expect(r.success).toBe(false);
        expect(r.reason).toBe('SLOT_TAKEN');
        expect(tx.appointment.create).not.toHaveBeenCalled();
        expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
      },
    );

    it('por el bot, un cupo a 45 minutos todavía se reserva (el rato de la conversación)', async () => {
      const { svc } = await conCupo(cupoEn(45));
      const r = await svc.bookAppointment('p1', 's1', null, 'WHATSAPP', 'org1');
      expect(r.success).toBe(true);
    });

    it.each(['MANUAL', 'MIRROR'] as const)(
      '%s (el personal o el hospital) agenda a cualquier hora',
      async (origin) => {
        const { svc } = await conCupo(cupoEn(10));
        const r = await svc.bookAppointment('p1', 's1', null, origin, 'org1');
        expect(r.success).toBe(true);
      },
    );
  });

  it('una cita que viene del HIS se salta el interruptor', async () => {
    // El hospital ya la agendó: rechazarla dejaría los dos sistemas
    // divergiendo, que es justo lo que el espejo existe para evitar.
    const { svc, tx } = await conCupo(cupoLibre(false));

    const r = await svc.bookAppointment('p1', 's1', null, 'MIRROR', 'org1');

    expect(r.success).toBe(true);
    expect(tx.appointment.create).toHaveBeenCalled();
  });

  it('un cupo sin médico se trata como inválido, no se reserva a ciegas', async () => {
    const { svc, tx } = await conCupo({
      id: 's1',
      isAvailable: true,
      organizationId: 'org1',
      doctor: null,
    });

    const r = await svc.bookAppointment('p1', 's1', null, 'WHATSAPP', 'org1');

    expect(r.success).toBe(false);
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rechazar ANTES de confirmar una EPS+régimen sin convenio en el HIS.
//
// Antes esto solo lo veía `resolveConvenio`, en el mirror-agent, AL ESCRIBIR
// la cita — es decir, DESPUÉS de que WhatsApp ya le dijo "confirmada" al
// paciente. La cita moría en dead-letter y nadie se enteraba hasta revisar
// la cola (caso real: Nueva EPS contributivo, ver ESTADO.md del driver
// cnt-sanvicente-anserma — el hospital confirmó que el convenio 473 es de
// Sura, no un genérico de "contributivo", y esa combinación no tiene ninguno).
// ═══════════════════════════════════════════════════════════════════════════
describe('AppointmentsService — EPS+régimen sin convenio en el HIS', () => {
  const cupoLibre = () => ({
    id: 's1',
    isAvailable: true,
    organizationId: 'org1',
    startTime: new Date(Date.now() + 86_400_000),
    doctor: { whatsappBookingEnabled: true },
  });

  const construir = async (opts: {
    epsName?: string;
    regime?: string | null;
    bloqueadas?: { epsName: string; regime: string }[] | null;
    nit?: string | null;
    espejo?: boolean;
    padron?: { epsId: string; regime: string | null }[];
  }) => {
    const tx = {
      scheduleSlot: {
        findUnique: jest.fn(() => cupoLibre()),
        update: jest.fn(),
      },
      appointment: { create: jest.fn(() => ({ id: 'apt1' })) },
      eps: {
        findUnique: jest.fn(() => ({
          name: opts.epsName ?? 'Nueva EPS',
          nit: opts.nit ?? null,
        })),
      },
      patientProfile: {
        // OJO: `??` habría convertido el `regime: null` explícito del test de
        // abajo en 'CONTRIBUTIVO' de nuevo — hace falta `'regime' in opts`
        // para distinguir "no lo pasé, usa el default" de "lo pasé, es null".
        findUnique: jest.fn(() => ({
          regime: 'regime' in opts ? opts.regime : 'CONTRIBUTIVO',
          cedula: '1088123456',
        })),
        update: jest.fn(),
      },
      epsEnrolledPatient: {
        findMany: jest.fn(() => opts.padron ?? []),
      },
      hospitalMirrorConfig: {
        findUnique: jest.fn(() => ({
          enabled: opts.espejo ?? false,
          blockedEpsRegimeCombos: opts.bloqueadas ?? null,
        })),
      },
      $executeRawUnsafe: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        {
          provide: PrismaService,
          useValue: { $transaction: jest.fn((cb: any) => cb(tx)) },
        },
      ],
    }).compile();
    return { svc: module.get<AppointmentsService>(AppointmentsService), tx };
  };

  it('🚨 EPS+régimen bloqueados → rechaza SIN crear la cita ni ocupar el cupo', async () => {
    const { svc, tx } = await construir({
      epsName: 'Nueva EPS',
      regime: 'CONTRIBUTIVO',
      bloqueadas: [{ epsName: 'Nueva EPS', regime: 'CONTRIBUTIVO' }],
    });

    const r = await svc.bookAppointment(
      'p1',
      's1',
      'eps-nueva',
      'WHATSAPP',
      'org1',
    );

    expect(r.success).toBe(false);
    expect(r.reason).toBe('EPS_REGIME_NOT_BILLABLE');
    expect(tx.appointment.create).not.toHaveBeenCalled();
    expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
  });

  it('el mensaje no habla de horario: el cupo sigue libre, el problema es la EPS', async () => {
    const { svc } = await construir({
      bloqueadas: [{ epsName: 'Nueva EPS', regime: 'CONTRIBUTIVO' }],
    });

    const r = await svc.bookAppointment(
      'p1',
      's1',
      'eps-nueva',
      'WHATSAPP',
      'org1',
    );

    expect(r.message).not.toMatch(/horario/i);
  });

  it('mismo régimen, OTRA EPS → no bloquea (el hueco es específico, no genérico)', async () => {
    const { svc, tx } = await construir({
      epsName: 'Sura',
      regime: 'CONTRIBUTIVO',
      bloqueadas: [{ epsName: 'Nueva EPS', regime: 'CONTRIBUTIVO' }],
    });

    const r = await svc.bookAppointment(
      'p1',
      's1',
      'eps-sura',
      'WHATSAPP',
      'org1',
    );

    expect(r.success).toBe(true);
    expect(tx.appointment.create).toHaveBeenCalled();
  });

  it('misma EPS, OTRO régimen → no bloquea', async () => {
    const { svc, tx } = await construir({
      epsName: 'Nueva EPS',
      regime: 'SUBSIDIADO',
      bloqueadas: [{ epsName: 'Nueva EPS', regime: 'CONTRIBUTIVO' }],
    });

    const r = await svc.bookAppointment(
      'p1',
      's1',
      'eps-nueva',
      'WHATSAPP',
      'org1',
    );

    expect(r.success).toBe(true);
    expect(tx.appointment.create).toHaveBeenCalled();
  });

  it('sin lista de bloqueadas (org sin espejo, o mapeo nunca aplicado) → no bloquea a nadie', async () => {
    const { svc, tx } = await construir({ bloqueadas: null });

    const r = await svc.bookAppointment(
      'p1',
      's1',
      'eps-nueva',
      'WHATSAPP',
      'org1',
    );

    expect(r.success).toBe(true);
    expect(tx.appointment.create).toHaveBeenCalled();
  });

  it('régimen del paciente desconocido (null) → no bloquea: solo se niega lo confirmado, no lo ignorado', async () => {
    const { svc, tx } = await construir({
      epsName: 'Nueva EPS',
      regime: null,
      bloqueadas: [{ epsName: 'Nueva EPS', regime: 'CONTRIBUTIVO' }],
    });

    const r = await svc.bookAppointment(
      'p1',
      's1',
      'eps-nueva',
      'WHATSAPP',
      'org1',
    );

    expect(r.success).toBe(true);
    expect(tx.appointment.create).toHaveBeenCalled();
  });

  it('paciente particular (epsId=null) → ni siquiera consulta el cruce', async () => {
    const { svc, tx } = await construir({
      bloqueadas: [{ epsName: 'Nueva EPS', regime: 'CONTRIBUTIVO' }],
    });

    const r = await svc.bookAppointment('p1', 's1', null, 'WHATSAPP', 'org1');

    expect(r.success).toBe(true);
    expect(tx.eps.findUnique).not.toHaveBeenCalled();
    expect(tx.patientProfile.findUnique).not.toHaveBeenCalled();
    expect(tx.hospitalMirrorConfig.findUnique).not.toHaveBeenCalled();
  });

  it('origin=MIRROR se salta el chequeo: el HIS ya facturó esa cita', async () => {
    // Misma razón que el interruptor del médico: rechazar algo que el
    // hospital ya agendó dejaría los dos sistemas divergiendo.
    const { svc, tx } = await construir({
      epsName: 'Nueva EPS',
      regime: 'CONTRIBUTIVO',
      bloqueadas: [{ epsName: 'Nueva EPS', regime: 'CONTRIBUTIVO' }],
    });

    const r = await svc.bookAppointment(
      'p1',
      's1',
      'eps-nueva',
      'MIRROR',
      'org1',
    );

    expect(r.success).toBe(true);
    expect(tx.eps.findUnique).not.toHaveBeenCalled();
  });

  // Caso real del 2026-09-26: una paciente de Salud Total que ya existía sin
  // régimen agendó por WhatsApp, el bot le confirmó y el agente rechazó la cita
  // diez veces («no tiene régimen»). El hospital nunca la tuvo.
  describe('régimen que el espejo necesita para elegir el convenio', () => {
    const saludTotal = {
      epsName: 'Salud Total',
      nit: '800130907',
      espejo: true,
      regime: null,
    };

    it('🚨 espejo activo + EPS con NIT + paciente sin régimen → frena SIN crear la cita ni ocupar el cupo', async () => {
      const { svc, tx } = await construir(saludTotal);

      const r = await svc.bookAppointment(
        'p1',
        's1',
        'eps-st',
        'WHATSAPP',
        'org1',
      );

      expect(r.success).toBe(false);
      expect(r.reason).toBe('PATIENT_REGIME_MISSING');
      expect(tx.appointment.create).not.toHaveBeenCalled();
      expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
    });

    it('también frena una cita MANUAL: el personal tampoco puede mandar al HIS una cita sin convenio', async () => {
      const { svc } = await construir(saludTotal);

      const r = await svc.bookAppointment(
        'p1',
        's1',
        'eps-st',
        'MANUAL',
        'org1',
      );

      expect(r.reason).toBe('PATIENT_REGIME_MISSING');
    });

    it('con el régimen puesto, la reserva pasa', async () => {
      const { svc, tx } = await construir({
        ...saludTotal,
        regime: 'SUBSIDIADO',
      });

      const r = await svc.bookAppointment(
        'p1',
        's1',
        'eps-st',
        'WHATSAPP',
        'org1',
      );

      expect(r.success).toBe(true);
      expect(tx.appointment.create).toHaveBeenCalled();
    });

    it('sin espejo activo no se exige: una clínica sin HIS no factura contra convenios', async () => {
      const { svc } = await construir({ ...saludTotal, espejo: false });

      const r = await svc.bookAppointment(
        'p1',
        's1',
        'eps-st',
        'WHATSAPP',
        'org1',
      );

      expect(r.success).toBe(true);
    });

    it('una EPS sin NIT viaja como particular al HIS: no se exige régimen', async () => {
      const { svc } = await construir({ ...saludTotal, nit: null });

      const r = await svc.bookAppointment(
        'p1',
        's1',
        'eps-st',
        'WHATSAPP',
        'org1',
      );

      expect(r.success).toBe(true);
    });

    describe('antes de frenar, el padrón de ESA EPS (solo si no hay duda)', () => {
      it('una sola EPS en el padrón, la de la cita, con régimen: completa la ficha y reserva', async () => {
        const { svc, tx } = await construir({
          ...saludTotal,
          padron: [{ epsId: 'eps-st', regime: 'SUBSIDIADO' }],
        });

        const r = await svc.bookAppointment(
          'p1',
          's1',
          'eps-st',
          'WHATSAPP',
          'org1',
        );

        expect(r.success).toBe(true);
        expect(tx.patientProfile.update).toHaveBeenCalledWith({
          where: { id: 'p1' },
          data: { regime: 'SUBSIDIADO' },
        });
        expect(tx.appointment.create).toHaveBeenCalled();
        // El padrón se lee dentro de la transacción, en la clínica de la cita.
        expect(tx.epsEnrolledPatient.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              organizationId: 'org1',
              isActive: true,
            }),
          }),
        );
      });

      it.each([
        [
          'el padrón es de OTRA EPS',
          [{ epsId: 'eps-sura', regime: 'SUBSIDIADO' }],
        ],
        [
          'el documento está en dos EPS',
          [
            { epsId: 'eps-st', regime: 'SUBSIDIADO' },
            { epsId: 'eps-sura', regime: 'SUBSIDIADO' },
          ],
        ],
        [
          'las filas se contradicen',
          [
            { epsId: 'eps-st', regime: 'SUBSIDIADO' },
            { epsId: 'eps-st', regime: 'CONTRIBUTIVO' },
          ],
        ],
        ['el padrón no tiene régimen', [{ epsId: 'eps-st', regime: null }]],
        ['no está en el padrón', []],
      ])('%s → frena igual, sin tocar la ficha', async (_caso, padron) => {
        const { svc, tx } = await construir({ ...saludTotal, padron });

        const r = await svc.bookAppointment(
          'p1',
          's1',
          'eps-st',
          'WHATSAPP',
          'org1',
        );

        expect(r.reason).toBe('PATIENT_REGIME_MISSING');
        expect(tx.patientProfile.update).not.toHaveBeenCalled();
        expect(tx.appointment.create).not.toHaveBeenCalled();
      });

      it('el régimen tomado del padrón pasa también por las combinaciones bloqueadas', async () => {
        const { svc, tx } = await construir({
          ...saludTotal,
          padron: [{ epsId: 'eps-st', regime: 'CONTRIBUTIVO' }],
          bloqueadas: [{ epsName: 'Salud Total', regime: 'CONTRIBUTIVO' }],
        });

        const r = await svc.bookAppointment(
          'p1',
          's1',
          'eps-st',
          'WHATSAPP',
          'org1',
        );

        expect(r.reason).toBe('EPS_REGIME_NOT_BILLABLE');
        expect(tx.appointment.create).not.toHaveBeenCalled();
      });
    });

    it('origin=MIRROR no se frena: la cita nació en el HIS, que ya la tiene', async () => {
      const { svc } = await construir(saludTotal);

      const r = await svc.bookAppointment(
        'p1',
        's1',
        'eps-st',
        'MIRROR',
        'org1',
      );

      expect(r.success).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🪞 Asistencia que llega del hospital: tiene que escribirse con origen
  // MIRROR. Sin eso el disparador la registraba como cambio de AgenIA y cada
  // «atendida» del hospital dejaba un evento en la cola de vuelta al HIS.
  // ══════════════════════════════════════════════════════════════════════
  describe('updateAttendance — origen de la escritura', () => {
    const armar = async () => {
      const tx = {
        $executeRawUnsafe: jest.fn(async () => 0),
        appointment: { update: jest.fn(async () => ({ id: 'apt-1' })) },
      };
      const prisma = {
        appointment: {
          findFirst: jest.fn(async () => ({ id: 'apt-1' })),
          update: jest.fn(async () => ({ id: 'apt-1' })),
        },
        $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
      };
      const m = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      return { svc: m.get(AppointmentsService), prisma, tx };
    };

    it('desde el hospital: marca la transacción como MIRROR ANTES de escribir', async () => {
      const { svc, prisma, tx } = await armar();

      await svc.updateAttendance('apt-1', 'ATTENDED' as never, 'org-1', {
        origen: 'MIRROR',
      });

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        `SET LOCAL agenia.sync_origin = 'MIRROR'`,
      );
      expect(tx.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'apt-1' },
          data: { attendanceStatus: 'ATTENDED' },
        }),
      );
      expect(tx.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
        tx.appointment.update.mock.invocationCallOrder[0],
      );
      // Fuera de la transacción no se escribe nada.
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('desde el panel (sin origen): escritura normal, sin marca MIRROR', async () => {
      const { svc, prisma, tx } = await armar();

      await svc.updateAttendance('apt-1', 'NO_SHOW' as never, 'org-1');

      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attendanceStatus: 'NO_SHOW' } }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('una cita de otra clínica no se toca, venga de donde venga', async () => {
      const { svc, prisma, tx } = await armar();
      prisma.appointment.findFirst.mockResolvedValue(null as never);

      await expect(
        svc.updateAttendance('apt-1', 'ATTENDED' as never, 'otra-org', {
          origen: 'MIRROR',
        }),
      ).rejects.toThrow('no pertenece');
      expect(tx.appointment.update).not.toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚦 LÍMITE DE CITAS POR PACIENTE (/dashboard/limites-citas)
//
// La reserva es la palabra final del límite: el chatbot ya lo revisa antes de
// pedir datos, pero aquí, dentro de la transacción, se cubre todo camino que
// llegue a reservar (la lista de espera incluida). Solo para el bot: el
// personal (MANUAL) y el hospital (MIRROR) no tienen límite.
// ═══════════════════════════════════════════════════════════════════════════
describe('bookAppointment — límite de citas por paciente', () => {
  const superado = {
    tipo: 'DAILY' as const,
    limite: 1,
    limiteBase: 1,
    citas: 1,
    periodo: {
      tipo: 'DAILY' as const,
      clave: '2026-10-20',
      desde: new Date('2026-10-20T05:00:00.000Z'),
      hasta: new Date('2026-10-21T05:00:00.000Z'),
    },
    paciente: { id: 'p1', cedula: '1088123456', fullName: 'Ana Ruiz' },
  };
  const INICIO = new Date('2030-10-20T14:37:00.000Z');

  const conLimite = async (respuesta: typeof superado | null) => {
    const tx = {
      scheduleSlot: {
        findUnique: jest.fn(() => ({
          id: 's1',
          isAvailable: true,
          organizationId: 'org1',
          startTime: INICIO,
          doctor: { whatsappBookingEnabled: true },
        })),
        update: jest.fn(),
      },
      patientProfile: {
        findUnique: jest.fn(() => ({ cedula: '1088123456' })),
      },
      appointment: { create: jest.fn(() => ({ id: 'apt1' })) },
      $executeRawUnsafe: jest.fn(),
    };
    const limiteCitas = { evaluar: jest.fn(async () => respuesta) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        {
          provide: PrismaService,
          useValue: { $transaction: jest.fn((cb: any) => cb(tx)) },
        },
        { provide: LimiteCitasService, useValue: limiteCitas },
      ],
    }).compile();
    return {
      svc: module.get<AppointmentsService>(AppointmentsService),
      tx,
      limiteCitas,
    };
  };

  it.each(['WHATSAPP', 'TELEGRAM'] as const)(
    '%s: con el límite alcanzado no reserva y devuelve el detalle',
    async (origin) => {
      const { svc, tx, limiteCitas } = await conLimite(superado);

      const r = await svc.bookAppointment('p1', 's1', null, origin, 'org1');

      expect(r).toEqual(
        expect.objectContaining({
          success: false,
          reason: 'PATIENT_LIMIT_REACHED',
          limite: superado,
        }),
      );
      expect(tx.appointment.create).not.toHaveBeenCalled();
      expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
      // Se revisa con la cédula del paciente y la hora del cupo, DENTRO de la
      // transacción (recibe el cliente `tx`).
      expect(limiteCitas.evaluar).toHaveBeenCalledWith(
        { organizationId: 'org1', cedula: '1088123456', fecha: INICIO },
        tx,
      );
    },
  );

  it('sin límite alcanzado, la reserva pasa', async () => {
    const { svc, tx } = await conLimite(null);

    const r = await svc.bookAppointment('p1', 's1', null, 'WHATSAPP', 'org1');

    expect(r.success).toBe(true);
    expect(tx.appointment.create).toHaveBeenCalled();
  });

  it.each(['MANUAL', 'MIRROR'] as const)(
    '%s no tiene límite: ni siquiera se consulta',
    async (origin) => {
      const { svc, tx, limiteCitas } = await conLimite(superado);

      const r = await svc.bookAppointment('p1', 's1', null, origin, 'org1');

      expect(r.success).toBe(true);
      expect(tx.appointment.create).toHaveBeenCalled();
      expect(limiteCitas.evaluar).not.toHaveBeenCalled();
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 📅 Días y horas sin citas por el asistente (2026-10-22). El hospital pidió
// apagar los sábados: el asistente no ofrece ni reserva citas que empiecen en
// un día u hora bloqueados. El personal (MANUAL) y el hospital (MIRROR) sí.
// ═══════════════════════════════════════════════════════════════════════════
describe('AppointmentsService — días y horas sin citas por el asistente', () => {
  // El próximo sábado que esté al menos a dos días (zona de Bogotá).
  const { diaLocal, sumarDiasAFecha, diaDeLaSemana } =
    jest.requireActual('@agenia/shared');
  let sabado: string = sumarDiasAFecha(diaLocal(new Date()), 2);
  while (diaDeLaSemana(sabado) !== 6) sabado = sumarDiasAFecha(sabado, 1);
  const viernes: string = sumarDiasAFecha(sabado, -1);
  const a = (fecha: string, hhmm: string) =>
    new Date(`${fecha}T${hhmm}:00-05:00`);
  const SABADOS = {
    date: sabado,
    repeatWeekly: true,
    startMinute: null,
    endMinute: null,
  };
  const slotRow = (id: string, inicio: Date) => ({
    id,
    startTime: inicio,
    isAvailable: true,
    organizationId: 'org1',
    doctor: { fullName: 'Ana Ruiz', whatsappBookingEnabled: true },
    service: { name: 'Medicina General' },
  });

  describe('getAvailableSlots', () => {
    const conReglas = async (reglas: any[], filas: any[]) => {
      const findMany = jest.fn(() => filas);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          {
            provide: PrismaService,
            useValue: {
              scheduleSlot: { findMany },
              hospitalMirrorConfig: { findUnique: jest.fn(() => null) },
              mirrorEntityMap: { findMany: jest.fn(() => []) },
              bookingBlock: { findMany: jest.fn(() => reglas) },
              organization: {
                findUnique: jest.fn(() => ({
                  timezone: 'America/Bogota',
                  settings: null,
                })),
              },
            },
          },
        ],
      }).compile();
      return {
        svc: module.get<AppointmentsService>(AppointmentsService),
        findMany,
      };
    };

    it('el sábado bloqueado sale de la consulta misma y del resultado', async () => {
      const { svc, findMany } = await conReglas(
        [SABADOS],
        [
          slotRow('vie', a(viernes, '09:00')),
          slotRow('sab', a(sabado, '09:00')),
        ],
      );
      const r = await svc.getAvailableSlots('Medicina', null, 'org1');

      expect(r.map((s) => s.slotId)).toEqual(['vie']);
      const not = (findMany.mock.calls[0] as any)[0].where.NOT;
      expect(not).toContainEqual({
        startTime: {
          gte: a(sabado, '00:00'),
          lt: a(sumarDiasAFecha(sabado, 1), '00:00'),
        },
      });
    });

    it('un rango de horas: la de las 8:00 no, la de las 10:00 sí', async () => {
      const { svc } = await conReglas(
        [
          {
            date: viernes,
            repeatWeekly: false,
            startMinute: 480,
            endMinute: 600,
          },
        ],
        [
          slotRow('8', a(viernes, '08:00')),
          slotRow('940', a(viernes, '09:40')),
          slotRow('10', a(viernes, '10:00')),
        ],
      );
      const r = await svc.getAvailableSlots('Medicina', null, 'org1', {
        desde: a(viernes, '00:00'),
        hasta: a(viernes, '23:59'),
      });
      expect(r.map((s) => s.slotId)).toEqual(['10']);
    });

    it('sin bloqueos, la consulta es la de siempre (sin NOT)', async () => {
      const { svc, findMany } = await conReglas(
        [],
        [slotRow('sab', a(sabado, '09:00'))],
      );
      const r = await svc.getAvailableSlots('Medicina', null, 'org1');
      expect(r.map((s) => s.slotId)).toEqual(['sab']);
      expect((findMany.mock.calls[0] as any)[0].where).not.toHaveProperty(
        'NOT',
      );
    });
  });

  describe('bookAppointment — revalida al reservar', () => {
    const reservar = async (inicio: Date, origin: any) => {
      const tx = {
        scheduleSlot: {
          findUnique: jest.fn(() => ({
            id: 's1',
            isAvailable: true,
            organizationId: 'org1',
            startTime: inicio,
            doctor: { whatsappBookingEnabled: true },
          })),
          update: jest.fn(),
        },
        appointment: { create: jest.fn(() => ({ id: 'apt1' })) },
        bookingBlock: { findMany: jest.fn(() => [SABADOS]) },
        organization: {
          findUnique: jest.fn(() => ({ timezone: 'America/Bogota' })),
        },
        $executeRawUnsafe: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          {
            provide: PrismaService,
            useValue: { $transaction: jest.fn((cb: any) => cb(tx)) },
          },
        ],
      }).compile();
      const r = await module
        .get<AppointmentsService>(AppointmentsService)
        .bookAppointment('p1', 's1', null, origin, 'org1');
      return { r, tx };
    };

    it.each(['WHATSAPP', 'TELEGRAM'] as const)(
      'por el bot (%s), una cita de sábado ya no se reserva: es un cupo que ya no está',
      async (origin) => {
        const { r, tx } = await reservar(a(sabado, '09:00'), origin);
        expect(r.success).toBe(false);
        expect(r.reason).toBe('SLOT_TAKEN');
        expect(tx.appointment.create).not.toHaveBeenCalled();
      },
    );

    it('por el bot, el viernes sí', async () => {
      const { r } = await reservar(a(viernes, '09:00'), 'WHATSAPP');
      expect(r.success).toBe(true);
    });

    it.each(['MANUAL', 'MIRROR'] as const)(
      '%s (el personal o el hospital) agenda el sábado como siempre',
      async (origin) => {
        const { r } = await reservar(a(sabado, '09:00'), origin);
        expect(r.success).toBe(true);
      },
    );
  });
});

describe('AppointmentsService — plazo máximo para agendar por el asistente', () => {
  // Con 3 días: hoy, mañana y pasado mañana (zona de Bogotá).
  const { diaLocal, sumarDiasAFecha } = jest.requireActual('@agenia/shared');
  const hoy: string = diaLocal(new Date());
  const pasadoManiana: string = sumarDiasAFecha(hoy, 2);
  const tercerDia: string = sumarDiasAFecha(hoy, 3);
  const a = (fecha: string, hhmm: string) =>
    new Date(`${fecha}T${hhmm}:00-05:00`);
  const slotRow = (id: string, inicio: Date) => ({
    id,
    startTime: inicio,
    isAvailable: true,
    organizationId: 'org1',
    doctor: { fullName: 'Ana Ruiz', whatsappBookingEnabled: true },
    service: { name: 'Medicina General' },
  });

  describe('getAvailableSlots', () => {
    const conPlazo = async (dias: number | null) => {
      const findMany = jest.fn(() => [
        slotRow('s1', a(pasadoManiana, '09:00')),
      ]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          {
            provide: PrismaService,
            useValue: {
              scheduleSlot: { findMany },
              hospitalMirrorConfig: { findUnique: jest.fn(() => null) },
              mirrorEntityMap: { findMany: jest.fn(() => []) },
              bookingBlock: { findMany: jest.fn(() => []) },
              organizationSettings: {
                findUnique: jest.fn(() => ({ bookingMaxDaysAhead: dias })),
              },
              organization: {
                findUnique: jest.fn(() => ({
                  timezone: 'America/Bogota',
                  settings: null,
                })),
              },
            },
          },
        ],
      }).compile();
      return {
        svc: module.get<AppointmentsService>(AppointmentsService),
        findMany,
      };
    };
    const filtroDeHora = (findMany: jest.Mock) =>
      findMany.mock.calls[0][0].where.startTime;

    it('con 3 días, la consulta no trae nada desde la medianoche del tercer día', async () => {
      const { svc, findMany } = await conPlazo(3);
      const r = await svc.getAvailableSlots('Medicina', null, 'org1');
      expect(r.map((s) => s.slotId)).toEqual(['s1']);
      expect(filtroDeHora(findMany).lt).toEqual(a(tercerDia, '00:00'));
    });

    it('con una fecha pedida, se respetan las dos: la fecha y el plazo', async () => {
      const { svc, findMany } = await conPlazo(3);
      const desde = a(sumarDiasAFecha(hoy, 10), '00:00');
      const hasta = a(sumarDiasAFecha(hoy, 10), '23:59');
      await svc.getAvailableSlots('Medicina', null, 'org1', { desde, hasta });
      // Una fecha más allá del plazo: gte > lt, la consulta no trae cupos.
      expect(filtroDeHora(findMany)).toEqual({
        gte: desde,
        lte: hasta,
        lt: a(tercerDia, '00:00'),
      });
    });

    it('sin límite (lo de siempre), la consulta no cambia', async () => {
      const { svc, findMany } = await conPlazo(null);
      await svc.getAvailableSlots('Medicina', null, 'org1');
      expect(filtroDeHora(findMany)).not.toHaveProperty('lt');
      expect(filtroDeHora(findMany)).not.toHaveProperty('lte');
    });
  });

  describe('bookAppointment — revalida al reservar', () => {
    const reservar = async (inicio: Date, origin: any) => {
      const tx = {
        scheduleSlot: {
          findUnique: jest.fn(() => ({
            id: 's1',
            isAvailable: true,
            organizationId: 'org1',
            startTime: inicio,
            doctor: { whatsappBookingEnabled: true },
          })),
          update: jest.fn(),
        },
        appointment: { create: jest.fn(() => ({ id: 'apt1' })) },
        organizationSettings: {
          findUnique: jest.fn(() => ({ bookingMaxDaysAhead: 3 })),
        },
        organization: {
          findUnique: jest.fn(() => ({ timezone: 'America/Bogota' })),
        },
        $executeRawUnsafe: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          {
            provide: PrismaService,
            useValue: { $transaction: jest.fn((cb: any) => cb(tx)) },
          },
        ],
      }).compile();
      const r = await module
        .get<AppointmentsService>(AppointmentsService)
        .bookAppointment('p1', 's1', null, origin, 'org1');
      return { r, tx };
    };

    it.each(['WHATSAPP', 'TELEGRAM'] as const)(
      'por el bot (%s), una cita del tercer día ya no se reserva: es un cupo que ya no está',
      async (origin) => {
        const { r, tx } = await reservar(a(tercerDia, '09:00'), origin);
        expect(r.success).toBe(false);
        expect(r.reason).toBe('SLOT_TAKEN');
        expect(tx.appointment.create).not.toHaveBeenCalled();
      },
    );

    it('por el bot, pasado mañana sí', async () => {
      const { r } = await reservar(a(pasadoManiana, '09:00'), 'WHATSAPP');
      expect(r.success).toBe(true);
    });

    it.each(['MANUAL', 'MIRROR'] as const)(
      '%s (el personal o el hospital) agenda a cualquier fecha, como siempre',
      async (origin) => {
        const { r } = await reservar(
          a(sumarDiasAFecha(hoy, 40), '09:00'),
          origin,
        );
        expect(r.success).toBe(true);
      },
    );
  });
});

describe('AppointmentsService — cupoMasAllaDelPlazo (no es agenda llena, es el plazo)', () => {
  const { diaLocal, sumarDiasAFecha } = jest.requireActual('@agenia/shared');
  const hoy: string = diaLocal(new Date());
  const a = (fecha: string, hhmm: string) =>
    new Date(`${fecha}T${hhmm}:00-05:00`);
  const slotRow = (id: string, inicio: Date) => ({
    id,
    startTime: inicio,
    isAvailable: true,
    organizationId: 'org1',
    doctor: { fullName: 'Ana Ruiz', whatsappBookingEnabled: true },
    service: { name: 'Medicina General' },
  });

  const conPlazo = async (dias: number | null, filas: any[]) => {
    const findMany = jest.fn(() => filas);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        {
          provide: PrismaService,
          useValue: {
            scheduleSlot: { findMany },
            hospitalMirrorConfig: { findUnique: jest.fn(() => null) },
            mirrorEntityMap: { findMany: jest.fn(() => []) },
            bookingBlock: { findMany: jest.fn(() => []) },
            organizationSettings: {
              findUnique: jest.fn(() => ({ bookingMaxDaysAhead: dias })),
            },
            organization: {
              findUnique: jest.fn(() => ({
                timezone: 'America/Bogota',
                settings: null,
              })),
            },
          },
        },
      ],
    }).compile();
    return {
      svc: module.get<AppointmentsService>(AppointmentsService),
      findMany,
    };
  };

  it('con 2 días y el primer cupo en 4 días: hasta mañana, el cupo, y desde el día anterior', async () => {
    const enCuatro = sumarDiasAFecha(hoy, 3);
    const { svc, findMany } = await conPlazo(2, [
      slotRow('s1', a(enCuatro, '08:20')),
    ]);
    expect(await svc.cupoMasAllaDelPlazo('Medicina', null, 'org1')).toEqual({
      ultimoDia: sumarDiasAFecha(hoy, 1),
      primerDia: enCuatro,
      desde: sumarDiasAFecha(hoy, 2),
    });
    // Mira SIN el plazo: si no, nunca vería el cupo de más adelante.
    expect(
      (findMany.mock.calls[0] as any)[0].where.startTime,
    ).not.toHaveProperty('lt');
  });

  it('sin plazo: null (la agenda sí está llena)', async () => {
    const { svc, findMany } = await conPlazo(null, [
      slotRow('s1', a(sumarDiasAFecha(hoy, 3), '08:20')),
    ]);
    expect(await svc.cupoMasAllaDelPlazo('Medicina', null, 'org1')).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('sin cupos ni más adelante: null', async () => {
    const { svc } = await conPlazo(2, []);
    expect(await svc.cupoMasAllaDelPlazo('Medicina', null, 'org1')).toBeNull();
  });

  it('un cupo dentro del plazo no es «más allá»: null', async () => {
    const { svc } = await conPlazo(3, [
      slotRow('s1', a(sumarDiasAFecha(hoy, 1), '10:17')),
    ]);
    expect(await svc.cupoMasAllaDelPlazo('Medicina', null, 'org1')).toBeNull();
  });
});
