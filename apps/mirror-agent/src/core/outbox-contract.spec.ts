import { translateOutboxAppointment } from './engine';
import type { OutboxEventDto } from '@agenia/shared';

// ═══════════════════════════════════════════════════════════════════════════
// PRUEBA DE CONTRATO — el nivel que no existía.
//
// El protocolo de @agenia/shared lo hablan dos procesos distintos (apps/api y
// este agente) y nadie verificaba que coincidieran. Por eso pasó desapercibido
// que el evento salía SIN fecha, SIN médico y SIN servicio: los 11 tests del
// motor comprobaban el despacho, ninguno miraba si el payload servía para algo.
//
// Este archivo fija la forma del evento tal como lo entrega el servidor y
// afirma que trae todo lo que el HIS exige para dar de alta una cita.
// ═══════════════════════════════════════════════════════════════════════════

/** Evento tal como sale hoy de GET /mirror/events, con su contexto resuelto. */
const eventoEntregado = (over: Partial<OutboxEventDto> = {}): OutboxEventDto => ({
  seq: '42',
  eventId: 'evt-42',
  entityType: 'APPOINTMENT',
  entityId: 'apt-1',
  op: 'INSERT',
  payload: {
    id: 'apt-1',
    patientId: 'pat-1',
    scheduleSlotId: 'slot-1',
    epsId: 'eps-1',
    attendanceStatus: 'PENDING',
  },
  context: {
    startTimeIso: '2026-09-03T12:20:00.000Z',
    endTimeIso: '2026-09-03T12:40:00.000Z',
    patientDocument: '9696544',
    patientFullName: 'PACIENTE DE PRUEBA UNO',
    patientBirthDateIso: '1980-05-12T00:00:00.000Z',
    patientGender: 'M',
    epsNit: '800088702',
    epsName: 'Nueva EPS',
    doctorExternalKey: '76',
    serviceExternalKey: 'S39141-1',
  },
  createdAt: '2026-08-31T03:48:16.919Z',
  ...over,
});

describe('contrato del evento de cita', () => {
  it('lleva TODO lo que el HIS necesita para insertar la cita', () => {
    const canonical = translateOutboxAppointment(eventoEntregado());

    // Cada campo aquí corresponde a una columna NOT NULL o de negocio del
    // INSERT en CITAS_MEDICAS. Si alguno vuelve a desaparecer del contrato,
    // este test lo dice antes de que el hospital se quede sin la cita.
    expect(canonical.payload.startTimeIso).toBe('2026-09-03T12:20:00.000Z');
    expect(canonical.payload.doctorExternalKey).toBe('76');
    expect(canonical.payload.serviceExternalKey).toBe('S39141-1');
    expect(canonical.payload.patientDocument).toBe('9696544');
  });

  it('lleva lo necesario para dar de alta a un paciente que el HIS no conoce', () => {
    // PACIENTES exige nacimiento y sexo NOT NULL: sin estos campos el driver
    // no podría crear al paciente y la cita fallaría por FK.
    const canonical = translateOutboxAppointment(eventoEntregado());

    expect(canonical.payload.patientFullName).toBe('PACIENTE DE PRUEBA UNO');
    expect(canonical.payload.patientBirthDateIso).toBe(
      '1980-05-12T00:00:00.000Z',
    );
    expect(canonical.payload.patientGender).toBe('M');
  });

  it('lleva el NIT de la EPS, de donde el driver deriva el convenio', () => {
    const canonical = translateOutboxAppointment(eventoEntregado());
    expect(canonical.payload.epsNit).toBe('800088702');
  });

  it('las horas viajan en UTC ISO-8601: la conversión es cosa del driver', () => {
    const canonical = translateOutboxAppointment(eventoEntregado());

    // El protocolo es UTC de punta a punta (plan §8). 12:20 UTC son las 07:20
    // en Bogotá, que es la hora que el paciente vio por WhatsApp.
    expect(canonical.payload.startTimeIso).toMatch(/Z$/);
    expect(new Date(canonical.payload.startTimeIso!).toISOString()).toBe(
      canonical.payload.startTimeIso,
    );
  });

  it('conserva la identidad de AgenIA además del contexto resuelto', () => {
    const canonical = translateOutboxAppointment(eventoEntregado());

    expect(canonical.payload.agenIAAppointmentId).toBe('apt-1');
    expect(canonical.payload.agenIAPatientId).toBe('pat-1');
    expect(canonical.payload.agenIAScheduleSlotId).toBe('slot-1');
    expect(canonical.eventId).toBe('evt-42');
  });

  it('un evento sin contexto no revienta: los campos quedan indefinidos', () => {
    // Compatibilidad hacia atrás: un servidor viejo (o un evento que no es de
    // cita) no manda `context`. Debe degradar, no lanzar.
    const canonical = translateOutboxAppointment(
      eventoEntregado({ context: undefined }),
    );

    expect(canonical.payload.agenIAAppointmentId).toBe('apt-1');
    expect(canonical.payload.doctorExternalKey).toBeUndefined();
  });

  it('sin id en la fila cruda, la identidad cae al entityId del outbox', () => {
    const canonical = translateOutboxAppointment(
      eventoEntregado({ payload: { patientId: 'pat-1' } }),
    );
    expect(canonical.payload.agenIAAppointmentId).toBe('apt-1');
  });
});
