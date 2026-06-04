import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Prisma } from '@antigravity/database';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AuditActor,
  PurgeResult,
  QuickStats,
} from './dto/organizations.types';

/**
 * 🏢 OrganizationsService — acciones críticas del Super Admin sobre tenants.
 *
 * Dos operaciones:
 *   1. purge()      → HARD DELETE transaccional e irreversible de una clínica
 *                     y TODOS sus datos dependientes, dejando una entrada
 *                     inmutable en GlobalAuditLog.
 *   2. quickStats() → resumen estadístico (solo agregaciones _count, jamás
 *                     registros crudos).
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // 🧨 PURGE — Hard delete transaccional + auditoría inmutable
  // ────────────────────────────────────────────────────────────
  async purge(
    organizationId: string,
    purgePassword: string | undefined,
    actor: AuditActor,
  ): Promise<PurgeResult> {
    // 1. Validar el segundo factor en tiempo constante (anti timing-attack).
    this.assertPurgePassword(purgePassword);

    // 2. Confirmar que la clínica existe ANTES de abrir la transacción.
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    if (!org) {
      throw new NotFoundException(
        `La organización ${organizationId} no existe o ya fue purgada.`,
      );
    }

    // 3. Transacción explícita: borramos hijos antes que padres para no
    //    violar llaves foráneas. Acumulamos los conteos para auditoría/UX.
    const purged: Record<string, number> = {};

    const auditLogId = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // ⚠️ Los campos `organizationId` del esquema son OPCIONALES (String?)
        // y, en la práctica, no siempre están poblados (p.ej. una HC creada
        // sin setear el tenant). Por eso NO podemos confiar solo en ese
        // escalar: borraríamos parcialmente y reventaríamos las FKs (que fue
        // exactamente el error `ClinicalRecord_appointmentId_fkey`).
        //
        // Estrategia robusta: resolvemos el GRAFO real de la clínica por IDs
        // (usuarios → perfiles → catálogos → slots → citas) y luego borramos
        // por esos IDs + por el escalar, en orden de dependencias.

        // ── Resolución de IDs raíz de la clínica ──────────────────
        const orgUsers = await tx.user.findMany({
          where: { organizationId },
          select: { id: true },
        });
        const userIds = orgUsers.map((u) => u.id);

        const patientRows = await tx.patientProfile.findMany({
          where: { OR: [{ organizationId }, { userId: { in: userIds } }] },
          select: { id: true },
        });
        const patientIds = patientRows.map((p) => p.id);

        const doctorRows = await tx.doctorProfile.findMany({
          where: { OR: [{ organizationId }, { userId: { in: userIds } }] },
          select: { id: true },
        });
        const doctorIds = doctorRows.map((d) => d.id);

        const serviceRows = await tx.medicalService.findMany({
          where: { organizationId },
          select: { id: true },
        });
        const serviceIds = serviceRows.map((s) => s.id);

        const epsRows = await tx.eps.findMany({
          where: { organizationId },
          select: { id: true },
        });
        const epsIds = epsRows.map((e) => e.id);

        // Slots: por escalar, o por doctor/servicio de la clínica.
        const slotRows = await tx.scheduleSlot.findMany({
          where: {
            OR: [
              { organizationId },
              { doctorId: { in: doctorIds } },
              { serviceId: { in: serviceIds } },
            ],
          },
          select: { id: true },
        });
        const slotIds = slotRows.map((s) => s.id);

        // Citas: por escalar, o por paciente/slot de la clínica.
        const apptRows = await tx.appointment.findMany({
          where: {
            OR: [
              { organizationId },
              { patientId: { in: patientIds } },
              { scheduleSlotId: { in: slotIds } },
            ],
          },
          select: { id: true },
        });
        const apptIds = apptRows.map((a) => a.id);

        // ── Borrado en orden de dependencias (hijos → padres) ─────
        // 3.1 EHR primero: ClinicalRecord arrastra (CASCADE) VitalSigns,
        //     Diagnosis, MedicalPrescription, DigitalSignature y Addendum.
        //     Lo atrapamos por CUALQUIER vínculo con la clínica para no dejar
        //     historias huérfanas apuntando a citas que vamos a borrar.
        purged.clinicalRecords = (
          await tx.clinicalRecord.deleteMany({
            where: {
              OR: [
                { organizationId },
                { appointmentId: { in: apptIds } },
                { patientId: { in: patientIds } },
                { doctorId: { in: doctorIds } },
              ],
            },
          })
        ).count;

        // 3.2 Citas (ya sin HC asociada).
        purged.appointments = (
          await tx.appointment.deleteMany({ where: { id: { in: apptIds } } })
        ).count;

        // 3.3 Agenda física.
        purged.scheduleSlots = (
          await tx.scheduleSlot.deleteMany({ where: { id: { in: slotIds } } })
        ).count;

        // 3.4 Lista de espera (antes de servicios/eps/pacientes).
        purged.waitlistEntries = (
          await tx.waitlistEntry.deleteMany({
            where: {
              OR: [{ organizationId }, { patientId: { in: patientIds } }],
            },
          })
        ).count;

        // 3.5 Caja negra del chatbot de ESTA clínica (patientId → User).
        purged.interactionLogs = (
          await tx.interactionLog.deleteMany({
            where: {
              OR: [{ organizationId }, { patientId: { in: userIds } }],
            },
          })
        ).count;

        // 3.6 Perfiles de agendador (referencian eps/doctor/user).
        purged.agentProfiles = (
          await tx.agentProfile.deleteMany({
            where: {
              OR: [{ organizationId }, { userId: { in: userIds } }],
            },
          })
        ).count;

        // 3.7 Pacientes (CASCADE → InformedConsent). Antes de eps.
        purged.patients = (
          await tx.patientProfile.deleteMany({
            where: { id: { in: patientIds } },
          })
        ).count;

        // 3.8 Médicos (antes de servicios). Sus addendums ya cayeron en 3.1.
        purged.doctors = (
          await tx.doctorProfile.deleteMany({
            where: { id: { in: doctorIds } },
          })
        ).count;

        // 3.9 Catálogos por tenant.
        purged.eps = (
          await tx.eps.deleteMany({ where: { id: { in: epsIds } } })
        ).count;
        purged.medicalServices = (
          await tx.medicalService.deleteMany({
            where: { id: { in: serviceIds } },
          })
        ).count;

        // 3.10 Tickets de soporte (CASCADE por org, pero explícito).
        purged.supportTickets = (
          await tx.supportTicket.deleteMany({ where: { organizationId } })
        ).count;

        // 3.11 Usuarios del tenant (sus perfiles 1:1 ya fueron borrados).
        purged.users = (
          await tx.user.deleteMany({ where: { organizationId } })
        ).count;

        // 3.12 Configuraciones 1:1 (CASCADE al borrar org, pero explícito).
        purged.settings = (
          await tx.organizationSettings.deleteMany({
            where: { organizationId },
          })
        ).count;
        purged.aiProviderConfig = (
          await tx.aiProviderConfig.deleteMany({ where: { organizationId } })
        ).count;
        purged.whatsappConfig = (
          await tx.whatsappAccountConfig.deleteMany({
            where: { organizationId },
          })
        ).count;

        // 3.13 Finalmente, la organización.
        await tx.organization.delete({ where: { id: organizationId } });

        // 3.14 Auditoría Enterprise — inmutable y FUERA del tenant.
        //      Va dentro de la MISMA transacción: si algo falla, el rollback
        //      revierte tanto el borrado como el registro (atomicidad total);
        //      si todo confirma, la evidencia legal queda persistida.
        const audit = await tx.globalAuditLog.create({
          data: {
            action: 'ORGANIZATION_PURGED',
            message:
              `SuperAdmin ID ${actor.actorId ?? 'desconocido'} purgó todos los ` +
              `datos médicos y administrativos de la Clínica ID ${org.id} y ` +
              `Nombre "${org.name}".`,
            actorId: actor.actorId,
            actorEmail: actor.actorEmail,
            organizationId: org.id,
            organizationName: org.name,
            ipAddress: actor.ipAddress,
            metadata: { purged } as Prisma.InputJsonValue,
          },
          select: { id: true },
        });

        return audit.id;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    this.logger.warn(
      `🧨 PURGE: clínica "${org.name}" (${org.id}) eliminada por ` +
        `${actor.actorEmail ?? actor.actorId}. Auditoría=${auditLogId}.`,
    );

    return {
      success: true,
      organizationId: org.id,
      organizationName: org.name,
      purged,
      auditLogId,
    };
  }

  // ────────────────────────────────────────────────────────────
  // 📊 QUICK STATS — Solo agregaciones (_count). Cero registros crudos.
  // ────────────────────────────────────────────────────────────
  async quickStats(organizationId: string): Promise<QuickStats> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    if (!org) {
      throw new NotFoundException(
        `La organización ${organizationId} no existe.`,
      );
    }

    // Todas las agregaciones en paralelo: cada una devuelve un escalar y
    // pega contra un índice. El payload final es minúsculo.
    const [
      totalDoctors,
      totalPatients,
      totalSchedulers,
      totalScheduledAppointments,
      closedAppointmentsWithRecord,
      closedAppointmentsWithoutRecord,
      aiMessagesProcessed,
    ] = await Promise.all([
      this.prisma.user.count({
        where: { organizationId, role: 'DOCTOR' },
      }),
      this.prisma.patientProfile.count({ where: { organizationId } }),
      this.prisma.user.count({
        where: { organizationId, role: 'BOOKING_AGENT' },
      }),
      this.prisma.appointment.count({
        where: { organizationId, status: 'SCHEDULED' },
      }),
      this.prisma.appointment.count({
        where: {
          organizationId,
          status: 'COMPLETED',
          clinicalRecord: { isNot: null },
        },
      }),
      this.prisma.appointment.count({
        where: {
          organizationId,
          status: 'COMPLETED',
          clinicalRecord: { is: null },
        },
      }),
      this.prisma.systemLog.count({
        where: { organizationId, action: 'AI_MESSAGE_PROCESSED' },
      }),
    ]);

    return {
      organizationId: org.id,
      organizationName: org.name,
      metrics: {
        totalDoctors,
        totalPatients,
        totalSchedulers,
        totalScheduledAppointments,
        closedAppointmentsWithRecord,
        closedAppointmentsWithoutRecord,
        aiMessagesProcessed,
      },
    };
  }

  // ────────────────────────────────────────────────────────────
  // 🔐 Validación de la clave de purga (comparación de tiempo constante)
  // ────────────────────────────────────────────────────────────
  private assertPurgePassword(provided: string | undefined): void {
    const expected = this.config.get<string>('SUPERADMIN_PURGE_PASSWORD');

    if (!expected) {
      // Fail-closed: si el operador olvidó configurar la clave, NUNCA
      // permitimos purgar. Es un error de configuración, no del usuario.
      this.logger.error(
        'SUPERADMIN_PURGE_PASSWORD no está configurada en el .env. ' +
          'Se rechaza toda purga por seguridad.',
      );
      throw new UnauthorizedException(
        'La purga está deshabilitada: falta configurar la clave en el servidor.',
      );
    }

    if (typeof provided !== 'string' || provided.length === 0) {
      throw new UnauthorizedException('Debe ingresar la clave de purga.');
    }

    if (!this.constantTimeEquals(provided, expected)) {
      throw new UnauthorizedException('Clave de purga incorrecta.');
    }
  }

  /** Comparación en tiempo constante para no filtrar info por timing. */
  private constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    // timingSafeEqual exige longitudes iguales; si difieren, comparamos
    // contra sí mismo para no cortocircuitar y luego devolvemos false.
    if (bufA.length !== bufB.length) {
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
