import { Test, TestingModule } from '@nestjs/testing';
import { MirrorApplyService } from './mirror-apply.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { MirrorPatientService } from './mirror-patient.service';
import { MirrorExceptionsService } from './mirror-exceptions.service';
import { CanonicalChangeEvent } from './dto/mirror.types';

describe('MirrorApplyService', () => {
  let service: MirrorApplyService;
  let prisma: {
    syncInbox: { findUnique: jest.Mock; create: jest.Mock };
    syncAudit: { create: jest.Mock };
    appointment: { findFirst: jest.Mock; update: jest.Mock };
    scheduleSlot: { update: jest.Mock; findFirst: jest.Mock };
    mirrorEntityMap: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let appointmentsService: {
    bookAppointment: jest.Mock;
    updateAttendance: jest.Mock;
  };

  const insertEvent = (
    overrides: Partial<CanonicalChangeEvent> = {},
  ): CanonicalChangeEvent => ({
    eventId: 'evt-1',
    entityType: 'APPOINTMENT',
    op: 'INSERT',
    occurredAtIso: new Date().toISOString(),
    payload: {
      agenIAPatientId: 'p1',
      agenIAScheduleSlotId: 's1',
    },
    ...overrides,
  });

  beforeEach(async () => {
    const tx = {
      appointment: { findFirst: jest.fn(), update: jest.fn() },
      scheduleSlot: { update: jest.fn(), findFirst: jest.fn() },
      $executeRawUnsafe: jest.fn(),
    };
    prisma = {
      syncInbox: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(),
      },
      syncAudit: { create: jest.fn() },
      appointment: tx.appointment,
      scheduleSlot: tx.scheduleSlot,
      mirrorEntityMap: { findFirst: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    appointmentsService = {
      bookAppointment: jest.fn(() =>
        Promise.resolve({ success: true, appointmentId: 'apt1' }),
      ),
      updateAttendance: jest.fn(() => Promise.resolve({ success: true })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorApplyService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppointmentsService, useValue: appointmentsService },
        {
          provide: WaitlistService,
          useValue: { notifyWaitlist: jest.fn() },
        },
        {
          provide: MirrorPatientService,
          useValue: {
            resolverOCrear: jest.fn(async () => ({
              pacienteId: null,
              motivo: 'SIN_NOMBRE',
              candidatos: [],
              nota: 'no se creó el paciente: el HIS no dio el nombre',
            })),
          },
        },
        {
          provide: MirrorExceptionsService,
          useValue: { registrar: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<MirrorApplyService>(MirrorApplyService);
  });

  describe('idempotencia', () => {
    it('event_id ya visto (en SyncInbox) → SKIPPED, nunca vuelve a llamar bookAppointment', async () => {
      prisma.syncInbox.findUnique.mockResolvedValueOnce({
        id: 'x',
        eventId: 'evt-1',
      });

      const result = await service.applyBatch('org1', [insertEvent()]);

      expect(result).toEqual({
        applied: 0,
        skipped: 1,
        conflicts: 0,
        errors: 0,
      });
      expect(appointmentsService.bookAppointment).not.toHaveBeenCalled();
    });

    it('event_id nuevo → se aplica UNA vez y se registra en SyncInbox', async () => {
      const result = await service.applyBatch('org1', [insertEvent()]);

      expect(result).toEqual({
        applied: 1,
        skipped: 0,
        conflicts: 0,
        errors: 0,
      });
      expect(appointmentsService.bookAppointment).toHaveBeenCalledTimes(1);
      expect(prisma.syncInbox.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org1',
          eventId: 'evt-1',
          entityType: 'APPOINTMENT',
        },
      });
    });
  });

  describe('orden — un evento fallido no bloquea el resto del lote', () => {
    it('procesa TODOS los eventos aunque el primero falle', async () => {
      appointmentsService.bookAppointment
        .mockImplementationOnce(() => Promise.reject(new Error('boom')))
        .mockImplementationOnce(() =>
          Promise.resolve({ success: true, appointmentId: 'apt2' }),
        );

      const result = await service.applyBatch('org1', [
        insertEvent({ eventId: 'evt-1' }),
        insertEvent({ eventId: 'evt-2' }),
      ]);

      expect(appointmentsService.bookAppointment).toHaveBeenCalledTimes(2);
      expect(result.applied).toBe(1);
      // El evento fallido queda auditado como ERROR, no silenciado.
      expect(prisma.syncAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outcome: 'ERROR', eventId: 'evt-1' }),
        }),
      );
    });
  });

  describe('conflicto de cupo', () => {
    it('bookAppointment success:false → CONFLICT auditado, no se pierde en silencio', async () => {
      appointmentsService.bookAppointment.mockResolvedValueOnce({
        success: false,
        message: 'Lo sentimos, el horario acaba de ser reservado.',
      });

      const result = await service.applyBatch('org1', [insertEvent()]);

      expect(result).toEqual({
        applied: 0,
        skipped: 0,
        conflicts: 1,
        errors: 0,
      });
      expect(prisma.syncAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outcome: 'CONFLICT' }),
        }),
      );
      // El conflicto SÍ se registra en SyncInbox (ya "vimos" este evento;
      // no se reintenta indefinidamente el mismo conflicto detectado).
      expect(prisma.syncInbox.create).toHaveBeenCalled();
    });
  });

  describe('cancelación', () => {
    it('CANCEL sin agenIAAppointmentId → error auditado, nunca intenta cancelar a ciegas', async () => {
      const event = insertEvent({
        op: 'CANCEL',
        payload: {},
      });

      const result = await service.applyBatch('org1', [event]);

      expect(result.applied).toBe(0);
      expect(prisma.syncAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outcome: 'ERROR' }),
        }),
      );
    });
  });

  describe('entidades no implementadas en Fase 1 (SLOT/DOCTOR/PATIENT/SERVICE/EPS)', () => {
    it.each(['SLOT', 'DOCTOR', 'PATIENT', 'SERVICE', 'EPS'] as const)(
      '%s → se registra pero NO se aplica todavía (Fase 2+), sin reventar el lote',
      async (entityType) => {
        const result = await service.applyBatch('org1', [
          insertEvent({ entityType, eventId: `evt-${entityType}` }),
        ]);

        expect(result.skipped).toBe(1);
        // No debe haber quedado marcado como idempotente-aplicado: sigue
        // pendiente de una implementación futura, no "ya resuelto".
        expect(prisma.syncInbox.create).not.toHaveBeenCalled();
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════════
  // Desenlace de atención entrante.
  //
  // Esto NUNCA se aplicó. El driver reporta la cita por médico y hora —no
  // conoce los ids de AgenIA— así que `agenIAAppointmentId` venía siempre
  // vacío y el método lanzaba. `applyBatch` se tragaba el error y el agente
  // recibía 200: ~235 eventos al día perdidos en silencio, y
  // `attendanceStatus` en PENDING para siempre.
  // ════════════════════════════════════════════════════════════════════════
  describe('desenlace de atención entrante', () => {
    const attendanceEvent = (
      payload: Record<string, unknown> = {},
    ): CanonicalChangeEvent => ({
      eventId: 'evt-att',
      entityType: 'APPOINTMENT',
      op: 'ATTENDANCE',
      occurredAtIso: new Date().toISOString(),
      payload: {
        doctorExternalKey: '76',
        startTimeIso: '2026-09-03T12:00:00.000Z',
        attendanceStatus: 'ATTENDED',
        ...payload,
      },
    });

    it('sin id de AgenIA, resuelve la cita por el cupo y la aplica', async () => {
      prisma.mirrorEntityMap.findFirst.mockResolvedValue({ agenIAId: 'doc-1' });
      prisma.scheduleSlot.findFirst.mockResolvedValue({ id: 'slot-1' });
      prisma.appointment.findFirst.mockResolvedValue({ id: 'apt-9' });

      const r = await service.applyBatch('org-1', [attendanceEvent()]);

      expect(appointmentsService.updateAttendance).toHaveBeenCalledWith(
        'apt-9',
        'ATTENDED',
        'org-1',
      );
      expect(r).toMatchObject({ applied: 1, errors: 0 });
    });

    it('un desenlace de una cita que AgenIA no tiene se omite, no falla', async () => {
      // La agendó el hospital por ventanilla. No hay nada que actualizar.
      prisma.mirrorEntityMap.findFirst.mockResolvedValue({ agenIAId: 'doc-1' });
      prisma.scheduleSlot.findFirst.mockResolvedValue({ id: 'slot-1' });
      prisma.appointment.findFirst.mockResolvedValue(null);

      const r = await service.applyBatch('org-1', [attendanceEvent()]);

      expect(appointmentsService.updateAttendance).not.toHaveBeenCalled();
      expect(r).toMatchObject({ skipped: 1, errors: 0 });
    });

    it('un desenlace que el modelo no conoce se rechaza, no se escribe', async () => {
      // El código crudo del HIS ('1') es justo lo que el driver mandaba antes.
      // `Appointment.attendanceStatus` es un enum: escribirlo reventaría.
      const r = await service.applyBatch('org-1', [
        attendanceEvent({ attendanceStatus: '1' }),
      ]);

      expect(appointmentsService.updateAttendance).not.toHaveBeenCalled();
      expect(r.errors).toBe(1);
      expect(prisma.syncAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outcome: 'ERROR' }),
        }),
      );
    });
  });

  // Sin este contador, un lote entero podía fracasar y el agente lo leía como
  // éxito: 200, `applied+skipped+conflicts` y ni rastro del fallo.
  describe('los fallos se cuentan, no solo se auditan', () => {
    it('un evento que revienta suma en `errors`', async () => {
      appointmentsService.bookAppointment.mockRejectedValue(new Error('boom'));

      const r = await service.applyBatch('org-1', [insertEvent()]);

      expect(r.errors).toBe(1);
      expect(r.applied).toBe(0);
    });

    it('un lote sano deja `errors` en cero', async () => {
      const r = await service.applyBatch('org-1', [insertEvent()]);

      expect(r).toMatchObject({ applied: 1, errors: 0 });
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// CITAS QUE NACEN EN EL HIS (dirección HIS → AgenIA).
//
// El driver no conoce los ids de AgenIA: reporta "el médico 76 a las 07:00".
// Toda la traducción ocurre en `resolverCupo`, y de ella depende que AgenIA
// deje de ofrecer por WhatsApp una hora que el hospital ya vendió — la
// sobreventa que encontró la prueba de punta a punta.
// ══════════════════════════════════════════════════════════════════════════
describe('MirrorApplyService — la cita la agendó el hospital', () => {
  let service: MirrorApplyService;
  let prisma: any;
  let tx: any;
  let appointments: { bookAppointment: jest.Mock; updateAttendance: jest.Mock };
  let waitlist: { notifyWaitlist: jest.Mock };
  /** El alta en caliente: por defecto NO consigue paciente (el caso de antes). */
  let pacientes: { resolverOCrear: jest.Mock };
  let excepciones: { registrar: jest.Mock };
  const sinPaciente = (motivo = 'SIN_NOMBRE', candidatos: string[] = []) => ({
    pacienteId: null,
    motivo,
    candidatos,
    nota: 'no se creó el paciente: el HIS no dio el nombre',
  });

  const ORG = 'org1';
  const CUPO = {
    id: 'slot-1',
    organizationId: ORG,
    doctorId: 'doc-1',
    isAvailable: true,
    startTime: new Date('2026-09-10T12:00:00.000Z'),
    // Lo que `avisarListaDeEspera` necesita para armar el aviso. `include:
    // { doctor: true }` en producción trae la relación; aquí se simula.
    serviceId: 'srv-1',
    allowedEpsId: null,
    doctor: { fullName: 'MEDICO DISPONIBLE HSVP 02' },
  };

  const evento = (
    over: Partial<CanonicalChangeEvent> = {},
  ): CanonicalChangeEvent => ({
    eventId: 'evt-his-1',
    entityType: 'APPOINTMENT',
    op: 'INSERT',
    occurredAtIso: '2026-09-02T10:00:00.000Z',
    payload: {
      doctorExternalKey: '76',
      startTimeIso: '2026-09-10T12:00:00.000Z',
      patientDocument: '9696544',
    },
    ...over,
  });

  const aplicar = (e: CanonicalChangeEvent) => service.applyBatch(ORG, [e]);

  beforeEach(async () => {
    tx = {
      appointment: { findFirst: jest.fn(), update: jest.fn() },
      scheduleSlot: { update: jest.fn() },
      $executeRawUnsafe: jest.fn(),
    };
    prisma = {
      syncInbox: { findUnique: jest.fn(async () => null), create: jest.fn() },
      syncAudit: { create: jest.fn() },
      appointment: { findFirst: jest.fn(async () => null), update: jest.fn() },
      scheduleSlot: { findFirst: jest.fn(async () => CUPO), update: jest.fn() },
      mirrorEntityMap: {
        findFirst: jest.fn(async () => ({ agenIAId: 'doc-1' })),
      },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    appointments = {
      bookAppointment: jest.fn(async () => ({
        success: true,
        appointmentId: 'apt-1',
      })),
      updateAttendance: jest.fn(async () => ({ success: true })),
    };
    waitlist = { notifyWaitlist: jest.fn(async () => undefined) };
    pacientes = { resolverOCrear: jest.fn(async () => sinPaciente()) };
    excepciones = { registrar: jest.fn(async () => 'CREADA') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MirrorApplyService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppointmentsService, useValue: appointments },
        { provide: WaitlistService, useValue: waitlist },
        { provide: MirrorPatientService, useValue: pacientes },
        { provide: MirrorExceptionsService, useValue: excepciones },
      ],
    }).compile();
    service = module.get(MirrorApplyService);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
  });

  describe('alta entrante que no consigue paciente', () => {
    it('OCUPA el cupo igual: lo que importa es no volver a venderlo', async () => {
      const r = await aplicar(evento());

      expect(r.applied).toBe(1);
      expect(tx.scheduleSlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
        data: { isAvailable: false },
      });
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
    });

    it('🪞 marca la transacción como MIRROR: el evento no rebota al HIS que lo originó', async () => {
      await aplicar(evento());

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        `SET LOCAL agenia.sync_origin = 'MIRROR'`,
      );
    });

    it('el cupo se busca por médico homologado + hora exacta, dentro de la org', async () => {
      await aplicar(evento());

      expect(prisma.mirrorEntityMap.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          entityType: 'DOCTOR',
          externalKey: '76',
        },
        select: { agenIAId: true },
      });
      expect(prisma.scheduleSlot.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          doctorId: 'doc-1',
          startTime: new Date('2026-09-10T12:00:00.000Z'),
        },
      });
    });

    it('un cupo que YA estaba ocupado no se vuelve a tocar', async () => {
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        ...CUPO,
        isAvailable: false,
      });

      const r = await aplicar(evento());

      expect(r.applied).toBe(1);
      expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
    });

    it('con el paciente ya homologado se agenda de verdad, con origen MIRROR', async () => {
      const r = await aplicar(
        evento({
          payload: {
            doctorExternalKey: '76',
            startTimeIso: '2026-09-10T12:00:00.000Z',
            agenIAPatientId: 'pac-1',
          },
        }),
      );

      expect(r.applied).toBe(1);
      expect(appointments.bookAppointment).toHaveBeenCalledWith(
        'pac-1',
        'slot-1',
        null,
        'MIRROR',
        ORG,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Alta en caliente (docs/PLAN_ALTA_EN_CALIENTE.md): con paciente, la cita del
  // hospital se crea de verdad — y desde ahí el bot la muestra y el cron le manda
  // el recordatorio. Sin paciente, se hace lo de antes: ocupar el cupo.
  // ══════════════════════════════════════════════════════════════════════
  describe('alta en caliente del paciente del hospital', () => {
    it('✅ el alta consigue paciente → se AGENDA de verdad, con origen MIRROR', async () => {
      pacientes.resolverOCrear.mockResolvedValueOnce({
        pacienteId: 'pac-nuevo',
        creado: true,
        nota: 'paciente creado desde el HIS, con WhatsApp',
      });

      const r = await aplicar(evento());

      expect(r.applied).toBe(1);
      expect(appointments.bookAppointment).toHaveBeenCalledWith(
        'pac-nuevo',
        'slot-1',
        null,
        'MIRROR',
        ORG,
      );
      // No se ocupa el cupo a mano: lo hace la reserva, en su transacción.
      expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
      // La nota del alta queda en la auditoría.
      expect(prisma.syncAudit.create.mock.calls[0][0].data.detail).toContain(
        'paciente creado desde el HIS',
      );
    });

    it('el alta recibe lo que manda el hospital (documento, nombre, teléfono)', async () => {
      await aplicar(
        evento({
          payload: {
            doctorExternalKey: '76',
            startTimeIso: '2026-09-10T12:00:00.000Z',
            patientDocument: '9696544',
            patientFullName: 'MARIA LOPEZ',
            patientPhone: '3001112233',
          },
        }),
      );

      expect(pacientes.resolverOCrear).toHaveBeenCalledWith(
        ORG,
        expect.objectContaining({
          patientDocument: '9696544',
          patientFullName: 'MARIA LOPEZ',
          patientPhone: '3001112233',
        }),
      );
    });

    it('un paciente que YA venía homologado no pasa por el alta', async () => {
      await aplicar(
        evento({
          payload: {
            doctorExternalKey: '76',
            startTimeIso: '2026-09-10T12:00:00.000Z',
            agenIAPatientId: 'pac-1',
          },
        }),
      );
      expect(pacientes.resolverOCrear).not.toHaveBeenCalled();
    });

    it('🚨 D3 documento ambiguo → NO se crea la cita, se ocupa el cupo y se abre la excepción', async () => {
      pacientes.resolverOCrear.mockResolvedValueOnce(
        sinPaciente('DOCUMENTO_AMBIGUO', ['pac-1', 'pac-2']),
      );

      const r = await aplicar(evento());

      expect(r.applied).toBe(1);
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
      expect(tx.scheduleSlot.update).toHaveBeenCalled();
      const arg = excepciones.registrar.mock.calls[0][1];
      expect(arg).toMatchObject({
        kind: 'IDENTIDAD_AMBIGUA',
        severity: 'MEDIA',
        entityId: 'slot-1',
        doctorId: 'doc-1',
        meta: { candidatos: 2 },
      });
      // 🔒 El detalle lleva el documento ENMASCARADO y los perfiles, nunca el número.
      expect(arg.detail).toContain('•••6544');
      expect(arg.detail).not.toContain('9696544');
      expect(arg.detail).toContain('pac-1, pac-2');
      // La misma clave para el mismo caso: no una fila por vuelta del agente.
      expect(arg.dedupeKey).toBe(
        'identidad:•••6544:76|2026-09-10T12:00:00.000Z',
      );
    });

    it('los demás motivos NO abren excepción: no hay nada que una persona pueda arreglar', async () => {
      for (const motivo of [
        'SIN_NOMBRE',
        'BAJA_SOLICITADA',
        'DOCUMENTO_INVALIDO',
      ]) {
        excepciones.registrar.mockClear();
        pacientes.resolverOCrear.mockResolvedValueOnce(sinPaciente(motivo));
        await aplicar(evento({ eventId: `evt-${motivo}` }));
        expect(excepciones.registrar).not.toHaveBeenCalled();
      }
    });

    it('🛡️ si la bandeja falla, la cita del hospital NO se pierde: el cupo queda ocupado', async () => {
      pacientes.resolverOCrear.mockResolvedValueOnce(
        sinPaciente('DOCUMENTO_AMBIGUO', ['pac-1', 'pac-2']),
      );
      excepciones.registrar.mockRejectedValueOnce(new Error('base caída'));

      const r = await aplicar(evento());

      expect(r.applied).toBe(1);
      expect(tx.scheduleSlot.update).toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Rastro en SyncAudit de los eventos nacidos en el HIS (rastreo de paciente,
  // docs/PLAN_RASTREO_PACIENTE.md §8 #5). Antes la fila decía "OK" con
  // entityId y detail nulos y el documento solo aparecía en el log del
  // contenedor: desde la base era imposible saber si el evento había llegado.
  // La clave `cupo=<médico>|<hora UTC>` no es un dato de salud.
  // ══════════════════════════════════════════════════════════════════════
  describe('auditoría de eventos del HIS: cupo=médico|hora', () => {
    const CLAVE = 'cupo=76|2026-09-10T12:00:00.000Z';
    const fila = () =>
      (prisma.syncAudit.create.mock.calls[0] as [{ data: any }])[0].data;

    it('alta sin paciente homologado: deja el cupo, el id del cupo y la nota de que NO se creó Appointment', async () => {
      await aplicar(evento());

      expect(fila()).toMatchObject({
        outcome: 'OK',
        direction: 'INBOUND',
        entityId: 'slot-1',
        detail: expect.stringContaining(CLAVE),
      });
      expect(fila().detail).toContain('no se creó la cita');
    });

    it('🔒 NO escribe el documento del paciente en la auditoría', async () => {
      await aplicar(evento());

      expect(JSON.stringify(fila())).not.toContain('9696544');
    });

    it('la hora se normaliza a ISO UTC aunque el driver la mande con otro formato', async () => {
      await aplicar(
        evento({
          payload: {
            doctorExternalKey: '76',
            startTimeIso: '2026-09-10T07:00:00-05:00',
            patientDocument: '9696544',
          },
        }),
      );

      expect(fila().detail).toContain(CLAVE);
    });

    it('médico no espejado → SKIPPED con la clave del cupo, para poder responder "por qué no está"', async () => {
      prisma.mirrorEntityMap.findFirst.mockResolvedValue(null);

      await aplicar(evento());

      expect(fila()).toMatchObject({
        outcome: 'SKIPPED',
        detail: expect.stringContaining(CLAVE),
      });
      expect(fila().detail).toContain('médico no espejado');
    });

    it('sin cupo → ERROR: la clave va DELANTE y el motivo original se conserva', async () => {
      prisma.scheduleSlot.findFirst.mockResolvedValue(null);

      await aplicar(evento());

      expect(fila().outcome).toBe('ERROR');
      expect(fila().detail.startsWith(CLAVE)).toBe(true);
      expect(fila().detail).toContain('falta generar el cupo');
    });

    it('un cupo que ya estaba ocupado también deja rastro', async () => {
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        ...CUPO,
        isAvailable: false,
      });

      await aplicar(evento());

      expect(fila().detail).toContain(CLAVE);
      expect(fila().detail).toContain('ya estaba ocupado');
    });

    it('cancelación del hospital resuelta a una cita de AgenIA: entityId es LA CITA', async () => {
      prisma.appointment.findFirst.mockResolvedValue({
        id: 'apt-9',
        scheduleSlotId: 'slot-1',
      });
      tx.appointment.findFirst.mockResolvedValue({
        id: 'apt-9',
        scheduleSlotId: 'slot-1',
      });

      await aplicar(evento({ op: 'CANCEL' }));

      expect(fila()).toMatchObject({ outcome: 'OK', entityId: 'apt-9' });
      expect(fila().detail).toContain(CLAVE);
      expect(fila().detail).toContain('cancelación aplicada');
    });

    it('cancelación de una cita que AgenIA nunca tuvo: deja el cupo y dice que se liberó', async () => {
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        ...CUPO,
        isAvailable: false,
      });

      await aplicar(evento({ op: 'CANCEL' }));

      expect(fila().entityId).toBe('slot-1');
      expect(fila().detail).toContain('cupo liberado');
    });

    it('un evento que YA trae sus ids de AgenIA conserva el suyo (no lo pisa el resuelto)', async () => {
      await aplicar(
        evento({
          payload: {
            doctorExternalKey: '76',
            startTimeIso: '2026-09-10T12:00:00.000Z',
            agenIAPatientId: 'pac-1',
            agenIAScheduleSlotId: 'slot-explicito',
          },
        }),
      );

      expect(fila().entityId).toBe('slot-explicito');
    });

    it('un evento que no es de una cita no lleva clave de cupo', async () => {
      await aplicar(evento({ entityType: 'SLOT' }));

      expect(fila().detail).not.toContain('cupo=');
    });
  });

  describe('🚨 lo que NO se puede resolver falla explícito, nunca a medias', () => {
    // ⚠️ Este caso cambió de ERROR a SKIPPED a propósito (2026-09-18).
    //
    // Espejamos A PROPÓSITO un subconjunto de la agenda del hospital: en
    // Anserma, solo el servicio contratado. El hospital crea ~235 citas
    // diarias, la mayoría con médicos que no vendemos. Tratar cada una como
    // error llenaba SyncAudit de ~200 filas ERROR diarias por algo que
    // funciona como se diseñó, y ahí dentro se perdía el error de verdad.
    //
    // Lo que NO cambió: si el médico SÍ está homologado y falta el cupo, eso
    // sigue siendo un error —es una laguna real del espejo— y lo cubre el
    // test siguiente.
    it('médico que no espejamos → SKIPPED, no error: no está roto nada', async () => {
      prisma.mirrorEntityMap.findFirst.mockResolvedValue(null);

      const r = await aplicar(evento());

      expect(r.errors).toBe(0);
      expect(r.applied).toBe(0);
      expect(r.skipped).toBe(1);
      expect(appointments.bookAppointment).not.toHaveBeenCalled();
    });

    it('y queda auditado como SKIPPED, no como OK', async () => {
      prisma.mirrorEntityMap.findFirst.mockResolvedValue(null);

      await aplicar(evento());

      expect(prisma.syncAudit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          outcome: 'SKIPPED',
          direction: 'INBOUND',
        }),
      });
    });

    it('médico homologado pero SIN cupo → sigue siendo error: eso sí es una laguna', async () => {
      prisma.scheduleSlot.findFirst.mockResolvedValue(null);

      const r = await aplicar(evento());

      expect(r.errors).toBe(1);
      expect(r.skipped).toBe(0);
      expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
      expect(prisma.syncAudit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          outcome: 'ERROR',
          detail: expect.stringContaining('falta generar el cupo'),
        }),
      });
    });

    it('una cancelación de un médico que no espejamos también se omite', async () => {
      prisma.mirrorEntityMap.findFirst.mockResolvedValue(null);

      const r = await aplicar(
        evento({
          eventId: 'evt-cancel-ajeno',
          op: 'CANCEL',
          payload: {
            doctorExternalKey: 'RU65',
            startTimeIso: '2026-09-10T12:00:00.000Z',
          },
        }),
      );

      expect(r.skipped).toBe(1);
      expect(r.errors).toBe(0);
      expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
    });

    it('un evento sin médico ni hora tampoco resuelve nada', async () => {
      const r = await aplicar(evento({ payload: {} }));

      expect(r.errors).toBe(1);
      expect(prisma.mirrorEntityMap.findFirst).not.toHaveBeenCalled();
    });

    it('una op que APPOINTMENT no soporta se rechaza', async () => {
      const r = await aplicar(evento({ op: 'DELETE' }));

      expect(r.errors).toBe(1);
      expect(prisma.syncAudit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          detail: expect.stringContaining('op no soportada'),
        }),
      });
    });

    it('un entityType que no existe se rechaza en vez de aplicarse a ciegas', async () => {
      const r = await aplicar(evento({ entityType: 'GALLETA' as never }));
      expect(r.errors).toBe(1);
    });
  });

  describe('cancelación hecha en el HIS', () => {
    const cancelacion = (payload: Record<string, unknown> = {}) =>
      evento({
        eventId: 'evt-cancel',
        op: 'CANCEL',
        payload: {
          doctorExternalKey: '76',
          startTimeIso: '2026-09-10T12:00:00.000Z',
          cancelReason: 'PACIENTE NO CONFIRMA',
          cancelObservations: 'llamó a las 8am',
          ...payload,
        },
      });

    it('la cita de AgenIA queda CANCELLED y su cupo vuelve a estar libre', async () => {
      prisma.appointment.findFirst.mockResolvedValue({
        id: 'apt-1',
        scheduleSlotId: 'slot-1',
      });
      tx.appointment.findFirst.mockResolvedValue({
        id: 'apt-1',
        scheduleSlotId: 'slot-1',
      });

      const r = await aplicar(cancelacion());

      expect(r.applied).toBe(1);
      expect(tx.appointment.update).toHaveBeenCalledWith({
        where: { id: 'apt-1' },
        data: {
          status: 'CANCELLED',
          metaLog: {
            cancelledBy: 'MIRROR',
            reason: 'PACIENTE NO CONFIRMA',
            observations: 'llamó a las 8am',
            eventId: 'evt-cancel',
          },
        },
      });
      expect(tx.scheduleSlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
        data: { isAvailable: true },
      });
    });

    it('si AgenIA nunca tuvo esa cita, solo libera el cupo', async () => {
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        ...CUPO,
        isAvailable: false,
      });

      const r = await aplicar(cancelacion());

      expect(r.applied).toBe(1);
      expect(tx.scheduleSlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
        data: { isAvailable: true },
      });
      expect(tx.appointment.update).not.toHaveBeenCalled();
    });

    it('cupo ya libre y sin cita: no hay nada que hacer y no es un fallo', async () => {
      prisma.appointment.findFirst.mockResolvedValue(null);

      const r = await aplicar(cancelacion());

      expect(r.applied).toBe(1);
      expect(r.errors).toBe(0);
      expect(tx.scheduleSlot.update).not.toHaveBeenCalled();
    });

    it('con el id de AgenIA ya resuelto no hace falta el cupo', async () => {
      tx.appointment.findFirst.mockResolvedValue({
        id: 'apt-7',
        scheduleSlotId: 'slot-7',
      });

      const r = await aplicar(cancelacion({ agenIAAppointmentId: 'apt-7' }));

      expect(r.applied).toBe(1);
      expect(prisma.mirrorEntityMap.findFirst).not.toHaveBeenCalled();
    });

    it('🏢 una cita de OTRA clínica no se puede cancelar desde este agente', async () => {
      tx.appointment.findFirst.mockResolvedValue(null); // el where lleva la org

      const r = await aplicar(
        cancelacion({ agenIAAppointmentId: 'apt-ajena' }),
      );

      expect(r.errors).toBe(1);
      expect(tx.appointment.update).not.toHaveBeenCalled();
      expect(tx.appointment.findFirst).toHaveBeenCalledWith({
        where: { id: 'apt-ajena', organizationId: ORG },
      });
    });

    it('sin motivo ni observaciones se guardan como null, no como undefined', async () => {
      tx.appointment.findFirst.mockResolvedValue({
        id: 'apt-1',
        scheduleSlotId: 'slot-1',
      });

      await aplicar(
        evento({
          op: 'CANCEL',
          payload: { agenIAAppointmentId: 'apt-1' },
        }),
      );

      expect(tx.appointment.update.mock.calls[0][0].data.metaLog).toMatchObject(
        { reason: null, observations: null },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 🔔 Lo que cancela el HOSPITAL también tiene que llegarle a quien espera.
  //
  // Hasta aquí solo avisaba el chatbot, en la cancelación por WhatsApp. La
  // rama del espejo liberaba el cupo en silencio — y es la rama por la que
  // entra la mayoría de las cancelaciones reales.
  // ═══════════════════════════════════════════════════════════════════════
  describe('cancelación del HIS → aviso a la lista de espera', () => {
    const cancelacion = (payload: Record<string, unknown> = {}) =>
      evento({
        eventId: 'evt-cancel-wl',
        op: 'CANCEL',
        payload: {
          doctorExternalKey: '76',
          startTimeIso: '2026-09-10T12:00:00.000Z',
          ...payload,
        },
      });

    const citaViva = { id: 'apt-1', scheduleSlotId: 'slot-1' };

    it('cancelada una cita de AgenIA, se avisa al primero de la lista', async () => {
      prisma.appointment.findFirst.mockResolvedValue(citaViva);
      tx.appointment.findFirst.mockResolvedValue(citaViva);

      const r = await aplicar(cancelacion());

      expect(r.applied).toBe(1);
      expect(waitlist.notifyWaitlist).toHaveBeenCalledWith({
        slotId: 'slot-1',
        serviceId: 'srv-1',
        epsId: null,
        organizationId: ORG,
        doctorName: 'MEDICO DISPONIBLE HSVP 02',
        slotDate: CUPO.startTime,
      });
    });

    it('también cuando la cita era del hospital y AgenIA nunca la tuvo', async () => {
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.scheduleSlot.findFirst
        .mockResolvedValueOnce({ ...CUPO, isAvailable: false }) // resolverCupo
        .mockResolvedValueOnce(CUPO); // relectura ya liberado

      const r = await aplicar(cancelacion());

      expect(r.applied).toBe(1);
      expect(waitlist.notifyWaitlist).toHaveBeenCalledTimes(1);
    });

    it('🛡️ si alguien tomó el cupo entre medias, no se ofrece una hora que ya no está', async () => {
      prisma.appointment.findFirst.mockResolvedValue(citaViva);
      tx.appointment.findFirst.mockResolvedValue(citaViva);
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        ...CUPO,
        isAvailable: false,
      });

      await aplicar(cancelacion());

      expect(waitlist.notifyWaitlist).not.toHaveBeenCalled();
    });

    it('🛡️ si el aviso falla, la cancelación NO se deshace ni se cuenta como error', async () => {
      prisma.appointment.findFirst.mockResolvedValue(citaViva);
      tx.appointment.findFirst.mockResolvedValue(citaViva);
      waitlist.notifyWaitlist.mockRejectedValue(new Error('WhatsApp caído'));

      const r = await aplicar(cancelacion());

      expect(r.applied).toBe(1);
      expect(r.errors).toBe(0);
      expect(tx.appointment.update).toHaveBeenCalled();
      expect(tx.scheduleSlot.update).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
        data: { isAvailable: true },
      });
    });

    it('🚨 la cita que se busca en el cupo tiene que ser la VIGENTE, no una ya cancelada', async () => {
      // Un cupo puede arrastrar citas canceladas como historia y tener encima
      // una viva de OTRO paciente. Sin el filtro de estado, `findFirst` podía
      // devolver cualquiera de las dos — y cancelarle la cita a quien no era.
      prisma.appointment.findFirst.mockResolvedValue(null);
      prisma.scheduleSlot.findFirst.mockResolvedValue({
        ...CUPO,
        isAvailable: false,
      });

      await aplicar(cancelacion());

      expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
        where: {
          scheduleSlotId: 'slot-1',
          organizationId: ORG,
          status: { not: 'CANCELLED' },
        },
      });
    });
  });

  describe('desenlace de atención', () => {
    it('sin desenlace se rechaza', async () => {
      const r = await aplicar(
        evento({ op: 'ATTENDANCE', payload: { agenIAAppointmentId: 'apt-1' } }),
      );
      expect(r.errors).toBe(1);
    });

    it('un valor fuera del vocabulario se rechaza con la lista de válidos', async () => {
      const r = await aplicar(
        evento({
          op: 'ATTENDANCE',
          payload: { agenIAAppointmentId: 'apt-1', attendanceStatus: 'VINO' },
        }),
      );

      expect(r.errors).toBe(1);
      expect(prisma.syncAudit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          detail: expect.stringContaining('PENDING, ATTENDED, NO_SHOW'),
        }),
      });
    });

    it.each(['PENDING', 'ATTENDED', 'NO_SHOW'])('%s se aplica', async (v) => {
      const r = await aplicar(
        evento({
          op: 'ATTENDANCE',
          payload: { agenIAAppointmentId: 'apt-1', attendanceStatus: v },
        }),
      );

      expect(r.applied).toBe(1);
      expect(appointments.updateAttendance).toHaveBeenCalledWith(
        'apt-1',
        v,
        ORG,
      );
    });

    it('🚨 resuelto por médico+hora, la cita buscada en el cupo tiene que ser la VIGENTE, no una ya cancelada', async () => {
      // Mismo defecto que ya se corrigió en la cancelación entrante y por la
      // misma razón: un cupo puede tener una cita CANCELLED como historia y
      // una vigente encima (la campaña de certificación dejó tres así). Sin
      // el filtro, el desenlace de atención podía escribirse sobre la cita
      // equivocada.
      prisma.appointment.findFirst.mockResolvedValue({
        id: 'apt-vigente',
        scheduleSlotId: 'slot-1',
      });

      await aplicar(
        evento({
          op: 'ATTENDANCE',
          payload: {
            doctorExternalKey: '76',
            startTimeIso: '2026-09-10T12:00:00.000Z',
            attendanceStatus: 'ATTENDED',
          },
        }),
      );

      expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
        where: {
          scheduleSlotId: 'slot-1',
          organizationId: ORG,
          status: { not: 'CANCELLED' },
        },
      });
      expect(appointments.updateAttendance).toHaveBeenCalledWith(
        'apt-vigente',
        'ATTENDED',
        ORG,
      );
    });
  });

  describe('auditoría e idempotencia del lote', () => {
    it('un lote mixto reporta cada categoría por separado', async () => {
      prisma.syncInbox.findUnique
        .mockResolvedValueOnce({ id: 'x' }) // ya visto
        .mockResolvedValue(null);
      appointments.bookAppointment
        .mockResolvedValueOnce({ success: false }) // conflicto
        .mockResolvedValue({ success: true, appointmentId: 'a' });

      const r = await service.applyBatch(ORG, [
        evento({ eventId: 'ya-visto' }),
        evento({
          eventId: 'conflicto',
          payload: { agenIAPatientId: 'p', agenIAScheduleSlotId: 's' },
        }),
        evento({
          eventId: 'bueno',
          payload: { agenIAPatientId: 'p', agenIAScheduleSlotId: 's' },
        }),
        evento({ eventId: 'roto', op: 'DELETE' }),
      ]);

      expect(r).toEqual({ applied: 1, skipped: 1, conflicts: 1, errors: 1 });
    });

    it('la fila de idempotencia se escribe DESPUÉS de aplicar, nunca antes', async () => {
      const orden: string[] = [];
      appointments.bookAppointment.mockImplementation(async () => {
        orden.push('aplicar');
        return { success: true, appointmentId: 'a' };
      });
      prisma.syncInbox.create.mockImplementation(async () => {
        orden.push('inbox');
      });

      await aplicar(
        evento({
          payload: { agenIAPatientId: 'p', agenIAScheduleSlotId: 's' },
        }),
      );

      expect(orden).toEqual(['aplicar', 'inbox']);
    });

    it('la auditoría de un conflicto se marca CONFLICT, no OK', async () => {
      appointments.bookAppointment.mockResolvedValue({ success: false });

      await aplicar(
        evento({
          payload: { agenIAPatientId: 'p', agenIAScheduleSlotId: 's' },
        }),
      );

      expect(prisma.syncAudit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ outcome: 'CONFLICT' }),
      });
    });
  });
});
