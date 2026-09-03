import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, AttendanceStatus } from '@agenia/database';

/** Forma reducida de un cupo que `getAvailableSlots` le entrega al chatbot. */
export interface AvailableSlot {
  slotId: string;
  fecha: Date;
  doctor: string;
  servicio: string;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(private prisma: PrismaService) {}

  // 1. LÓGICA DE BÚSQUEDA H.I.S
  // `organizationId` es OBLIGATORIO: con el parámetro opcional, un caller que
  // lo omitiera generaba `where: { organizationId: undefined }`, que Prisma
  // interpreta como "sin filtro" y devolvía cupos de TODAS las clínicas.
  async getAvailableSlots(
    serviceName: string,
    epsId: string | null,
    organizationId: string,
    // Ventana de fecha preferida por el paciente ("mañana", "el lunes"...).
    // Opcional: sin ella, la consulta es idéntica a la histórica (próximos cupos).
    dateWindow?: { desde: Date; hasta: Date } | null,
  ): Promise<AvailableSlot[]> {
    const now = new Date();

    // Con ventana, acotamos a [max(desde, ahora) .. hasta] para no ofrecer
    // horas pasadas si el paciente pidió "hoy". Sin ventana, conducta de siempre.
    const startTimeFilter = dateWindow
      ? {
          gte: dateWindow.desde > now ? dateWindow.desde : now,
          lte: dateWindow.hasta,
        }
      : { gt: now };

    // 🚦 ACTIVACIÓN POR MÉDICO. `whatsappBookingEnabled` existía en el schema
    // desde la Fase 1 del espejo pero NO SE LEÍA EN NINGÚN SITIO: era una
    // columna muerta, y la activación gradual médico por médico que el
    // hospital pidió (plan §5.4) simplemente no existía — todo médico en la
    // base era reservable desde el momento en que se creaba. El default sigue
    // siendo `true`, así que para una clínica sin espejo esto no cambia nada.
    const doctorFilter = await this.buildDoctorFilter(organizationId);

    const rawSlots = await this.prisma.scheduleSlot.findMany({
      where: {
        organizationId: organizationId, // 🏢 AISLAMIENTO DE TENANT
        isAvailable: true,
        startTime: startTimeFilter,
        service: {
          name: { contains: serviceName, mode: 'insensitive' },
        },
        doctor: doctorFilter,
        // Filtro clave: El slot debe ser universal (null) o ser exclusivo para la EPS del paciente
        OR: [{ allowedEpsId: null }, { allowedEpsId: epsId }],
      },
      include: { doctor: true, service: true },
      orderBy: { startTime: 'asc' },
      take: 10, // Retornamos los próximos 10 cupos
    });

    // Mapeamos para que Gemini lo pueda entender fácil
    return rawSlots.map((slot) => ({
      slotId: slot.id,
      fecha: slot.startTime,
      doctor: slot.doctor.fullName,
      servicio: slot.service.name,
    }));
  }

  /**
   * Qué médicos pueden recibir reservas por WhatsApp en esta organización.
   *
   * Dos condiciones, y la segunda solo aplica con espejo:
   *
   * 1. **`whatsappBookingEnabled`** — el interruptor comercial. El hospital
   *    activa médico por médico al ritmo que decida su piloto, y puede
   *    apagarlos sin tocar la agenda.
   *
   * 2. **Homologado con el HIS** — el interruptor técnico. Si la organización
   *    tiene espejo activo y el médico no está en `MirrorEntityMap`, su cita
   *    NUNCA podrá escribirse en el HIS: se quedaría rebotando hasta
   *    dead-letter y el hospital no la vería jamás. Ofrecer ese cupo es
   *    prometerle al paciente una cita que no va a existir, así que no se
   *    ofrece. Es la misma sobreventa que encontró la prueba de punta a
   *    punta, vista desde el otro lado.
   *
   * Sin espejo la condición 2 no se evalúa y la consulta queda igual que
   * siempre — una clínica normal no sabe qué es una homologación.
   */
  private async buildDoctorFilter(
    organizationId: string,
  ): Promise<Prisma.DoctorProfileWhereInput> {
    const base: Prisma.DoctorProfileWhereInput = {
      whatsappBookingEnabled: true,
    };

    const espejo = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: { enabled: true },
    });
    if (!espejo?.enabled) return base;

    const homologados = await this.prisma.mirrorEntityMap.findMany({
      where: { organizationId, entityType: 'DOCTOR' },
      select: { agenIAId: true },
    });

    return { ...base, id: { in: homologados.map((m) => m.agenIAId) } };
  }

  // 2. LÓGICA DE TRANSACCIÓN
  // `organizationId` es OBLIGATORIO: el chequeo de tenant del slot ya no es
  // condicional — sin él, un slotId de otra clínica se podía reservar.
  async bookAppointment(
    patientId: string,
    scheduleSlotId: string,
    epsId: string | null,
    origin: 'WHATSAPP' | 'MANUAL' | 'MIRROR',
    organizationId: string,
  ): Promise<{
    success: boolean;
    message?: string;
    appointmentId?: string;
    /**
     * Motivo del fallo, para que el llamador elija el mensaje al paciente.
     * El texto vive en el pool de MSGS (que tiene estilos de comunicación por
     * clínica), no aquí: este servicio no debería estar redactando WhatsApp.
     */
    reason?: 'SLOT_TAKEN' | 'DOCTOR_NOT_BOOKABLE';
  }> {
    try {
      let appointmentId: string | undefined;
      await this.prisma.$transaction(async (tx) => {
        // 🪞 ANTI-ECO ESPEJO: cuando esta cita la origina el módulo mirror
        // (una cita creada/reflejada desde el HIS de un hospital), marcamos
        // la transacción para que el trigger fn_sync_outbox() registre el
        // evento con origin='MIRROR' — el dispatcher del mirror no lo
        // reenvía de vuelta al HIS que lo originó. Ver PLAN_ESPEJO_HOSPITAL.md
        // §5.1b. `SET LOCAL` solo dura mientras dure esta transacción.
        if (origin === 'MIRROR') {
          await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);
        }

        const slot = await tx.scheduleSlot.findUnique({
          where: { id: scheduleSlotId },
          include: { doctor: { select: { whatsappBookingEnabled: true } } },
        });

        // `!slot.doctor` no deberia pasar nunca: `doctorId` es NOT NULL con FK
        // y la consulta lo incluye. Si aun asi falta, el cupo esta corrupto y
        // se trata como invalido — fallar cerrado, no reservar a ciegas.
        if (
          !slot ||
          !slot.doctor ||
          !slot.isAvailable ||
          slot.organizationId !== organizationId
        ) {
          throw new Error('SLOT_TAKEN_OR_INVALID');
        }

        // 🚦 Revalidación del interruptor del médico, aquí y no solo al
        // ofrecer el cupo. Entre que el paciente ve el menú y responde "SÍ"
        // pasan minutos: al hospital le basta con apagar a un médico en ese
        // rato para que la reserva ya no deba entrar. Sin esto, el filtro de
        // `getAvailableSlots` era una sugerencia, no una regla.
        //
        // Las citas de origen MIRROR se saltan el chequeo a propósito: vienen
        // del HIS, que es la fuente de verdad de este hospital. Rechazar algo
        // que el hospital ya agendó dejaría los dos sistemas divergiendo, que
        // es exactamente lo que el espejo existe para evitar.
        if (origin !== 'MIRROR' && !slot.doctor.whatsappBookingEnabled) {
          throw new Error('DOCTOR_NOT_BOOKABLE');
        }

        // 2. Marcar slot como Ocupado
        await tx.scheduleSlot.update({
          where: { id: scheduleSlotId },
          data: { isAvailable: false },
        });

        // 3. Crear el record de Cita conectado al Slot
        const appointment = await tx.appointment.create({
          data: {
            scheduleSlotId,
            patientId,
            epsId,
            origin,
            organizationId, // 🏢 TENANT ISOLATION (ya validado contra el slot)
          },
        });
        appointmentId = appointment.id;
      });

      return { success: true, appointmentId };
    } catch (error: unknown) {
      // El catch atrapa la colisión de cupo, sea cual sea su forma:
      //   - 'SLOT_TAKEN_OR_INVALID': lo lanzamos arriba cuando el slot ya no está
      //     disponible / no existe / es de otro tenant (caso MÁS común: el paciente
      //     confirma segundos después de que otro ganó el cupo).
      //   - 'SLOT_TAKEN': alias histórico conservado por compatibilidad.
      //   - P2002: choque del @unique de scheduleSlotId (dos reservas simultáneas).
      // Sin incluir 'SLOT_TAKEN_OR_INVALID' aquí, el error se relanzaba, el paciente
      // no recibía respuesta y quedaba atascado en AWAITING_CONFIRMATION.
      // El médico dejó de aceptar reservas por WhatsApp mientras el paciente
      // decidía. No es una colisión de cupo: el horario sigue libre, pero ya
      // no por este canal. Merece su propio mensaje, no el de "se lo llevó
      // otro paciente", que sería mentira.
      const message = error instanceof Error ? error.message : undefined;

      if (message === 'DOCTOR_NOT_BOOKABLE') {
        this.logger.warn(
          `Reserva rechazada: el médico del cupo ${scheduleSlotId} ya no acepta reservas por WhatsApp.`,
        );
        return {
          success: false,
          reason: 'DOCTOR_NOT_BOOKABLE',
          message:
            'Ese horario dejó de estar disponible para agendamiento por este medio.',
        };
      }

      if (
        message === 'SLOT_TAKEN_OR_INVALID' ||
        message === 'SLOT_TAKEN' ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002')
      ) {
        this.logger.warn(
          `Colisión detectada: El slot ${scheduleSlotId} acaba de ser tomado.`,
        );
        return {
          success: false,
          reason: 'SLOT_TAKEN',
          message:
            'Lo sentimos, el horario acaba de ser reservado por otro paciente.',
        };
      }
      this.logger.error('Error crítico al guardar la cita', error);
      throw error;
    }
  }

  // 3. CONTROL DE ASISTENCIA
  // `organizationId` obligatorio: el controller solo admite roles clínicos,
  // que siempre traen tenant en el token.
  async updateAttendance(
    appointmentId: string,
    status: AttendanceStatus,
    organizationId: string,
  ) {
    // Verificamos antes para evitar NotFoundExceptions por isolation o seguridad
    const apt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
    });
    if (!apt)
      throw new Error('Cita no encontrada o no pertenece a tu Organización.');

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { attendanceStatus: status },
      include: {
        patient: true,
        scheduleSlot: { include: { doctor: true, service: true } },
      },
    });

    return {
      success: true,
      data: updated,
    };
  }
}
