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
    const where = { organizationId };
    const purged: Record<string, number> = {};

    const auditLogId = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 3.1 EHR primero: ClinicalRecord arrastra (CASCADE) VitalSigns,
        //     Diagnosis, MedicalPrescription, DigitalSignature y Addendum.
        purged.clinicalRecords = (
          await tx.clinicalRecord.deleteMany({ where })
        ).count;

        // 3.2 Citas (referencian slot/paciente/eps; ya sin HC asociada).
        purged.appointments = (await tx.appointment.deleteMany({ where })).count;

        // 3.3 Agenda física.
        purged.scheduleSlots = (
          await tx.scheduleSlot.deleteMany({ where })
        ).count;

        // 3.4 Lista de espera (antes de servicios/eps/pacientes).
        purged.waitlistEntries = (
          await tx.waitlistEntry.deleteMany({ where })
        ).count;

        // 3.5 Caja negra del chatbot de ESTA clínica.
        purged.interactionLogs = (
          await tx.interactionLog.deleteMany({ where })
        ).count;

        // 3.6 Perfiles de agendador (referencian eps/doctor/user).
        purged.agentProfiles = (
          await tx.agentProfile.deleteMany({ where })
        ).count;

        // 3.7 Pacientes (CASCADE → InformedConsent). Antes de eps.
        purged.patients = (await tx.patientProfile.deleteMany({ where })).count;

        // 3.8 Médicos (antes de servicios). Sus addendums ya cayeron en 3.1.
        purged.doctors = (await tx.doctorProfile.deleteMany({ where })).count;

        // 3.9 Catálogos por tenant.
        purged.eps = (await tx.eps.deleteMany({ where })).count;
        purged.medicalServices = (
          await tx.medicalService.deleteMany({ where })
        ).count;

        // 3.10 Tickets de soporte (CASCADE por org, pero explícito).
        purged.supportTickets = (
          await tx.supportTicket.deleteMany({ where })
        ).count;

        // 3.11 Usuarios del tenant (sus perfiles 1:1 ya fueron borrados).
        purged.users = (await tx.user.deleteMany({ where })).count;

        // 3.12 Configuraciones 1:1 (CASCADE al borrar org, pero explícito).
        purged.settings = (
          await tx.organizationSettings.deleteMany({ where })
        ).count;
        purged.aiProviderConfig = (
          await tx.aiProviderConfig.deleteMany({ where })
        ).count;
        purged.whatsappConfig = (
          await tx.whatsappAccountConfig.deleteMany({ where })
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
