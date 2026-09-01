import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsService } from './appointments.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let findMany: jest.Mock;
  let mirrorConfig: { findUnique: jest.Mock };
  let entityMap: { findMany: jest.Mock };

  beforeEach(async () => {
    findMany = jest.fn(async () => []);
    // Por defecto: organización SIN espejo. Es el caso de cualquier clínica
    // normal, y el que no debe cambiar de comportamiento.
    mirrorConfig = { findUnique: jest.fn(async () => null) };
    entityMap = { findMany: jest.fn(async () => []) };
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
          findUnique: jest.fn(async () => conMedico(slot)),
          update: jest.fn(),
        },
        appointment: { create: jest.fn(async () => ({ id: 'apt1' })) },
        $executeRawUnsafe: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          {
            provide: PrismaService,
            useValue: {
              $transaction: jest.fn(async (cb: any) => cb(tx)),
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
          findUnique: jest.fn(async () => conMedico(slot)),
          update: jest.fn(),
        },
        appointment: { create: jest.fn(async () => ({ id: 'apt1' })) },
        $executeRawUnsafe: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          {
            provide: PrismaService,
            useValue: {
              $transaction: jest.fn(async (cb: any) => cb(tx)),
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
        });

        await svc.bookAppointment('p1', 's1', null, origin, 'org1');

        expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
      },
    );
  });

  describe('getAvailableSlots — filtro de fecha', () => {
    const whereOf = () => findMany.mock.calls[0][0].where;

    it('sin dateWindow → startTime { gt: now } (regresión: conducta histórica)', async () => {
      await service.getAvailableSlots('Medicina', null, 'org1');
      const startTime = whereOf().startTime;
      expect(startTime).toHaveProperty('gt');
      expect(startTime).not.toHaveProperty('lte');
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
            hospitalMirrorConfig: mirrorConfig,
            mirrorEntityMap: entityMap,
          },
        },
      ],
    }).compile();
    return module.get<AppointmentsService>(AppointmentsService);
  };

  beforeEach(async () => {
    slotFindMany = jest.fn(async () => []);
    mirrorConfig = { findUnique: jest.fn(async () => null) };
    entityMap = { findMany: jest.fn(async () => []) };
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
      mirrorConfig.findUnique = jest.fn(async () => ({ enabled: true }));
      entityMap.findMany = jest.fn(async () => [
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
      entityMap.findMany = jest.fn(async () => []);
      service = await construir();

      await service.getAvailableSlots('Medicina General', null, 'org1');

      expect(whereDeLaConsulta().doctor.id).toEqual({ in: [] });
    });

    it('un espejo configurado pero APAGADO se comporta como sin espejo', async () => {
      mirrorConfig.findUnique = jest.fn(async () => ({ enabled: false }));
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
      scheduleSlot: { findUnique: jest.fn(async () => slot), update: jest.fn() },
      appointment: { create: jest.fn(async () => ({ id: 'apt1' })) },
      $executeRawUnsafe: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        {
          provide: PrismaService,
          useValue: { $transaction: jest.fn(async (cb: any) => cb(tx)) },
        },
      ],
    }).compile();
    return { svc: module.get<AppointmentsService>(AppointmentsService), tx };
  };

  const cupoLibre = (whatsappBookingEnabled: boolean) => ({
    id: 's1',
    isAvailable: true,
    organizationId: 'org1',
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
