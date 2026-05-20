/**
 * Tipos compartidos del módulo de Organizaciones (Super Admin).
 *
 * Se mantienen como interfaces puras (sin decoradores class-validator) para
 * ser consistentes con el resto del proyecto, que valida manualmente en el
 * controller/service en lugar de depender de un ValidationPipe global.
 */

/** Body del endpoint POST /organizations/:id/purge. */
export interface PurgeOrganizationInput {
  /** Segundo factor: clave de purga del Super Admin (NUNCA es la de login). */
  purgePassword?: string;
}

/** Datos del actor (Super Admin) extraídos del JWT por el RolesGuard. */
export interface AuditActor {
  actorId: string | null;
  actorEmail: string | null;
  ipAddress: string | null;
}

/** Resultado del hard delete transaccional. */
export interface PurgeResult {
  success: true;
  organizationId: string;
  organizationName: string;
  /** Conteo de registros eliminados por entidad (para auditoría/UX). */
  purged: Record<string, number>;
  /** ID de la entrada inmutable creada en GlobalAuditLog. */
  auditLogId: string;
}

/** Resumen estadístico optimizado de una clínica (solo agregaciones). */
export interface QuickStats {
  organizationId: string;
  organizationName: string;
  metrics: {
    /** Usuarios con rol DOCTOR. */
    totalDoctors: number;
    /** Perfiles de paciente registrados en la clínica. */
    totalPatients: number;
    /** Usuarios agendadores (rol BOOKING_AGENT). */
    totalSchedulers: number;
    /** Citas en estado SCHEDULED (aún abiertas). */
    totalScheduledAppointments: number;
    /** Citas cerradas (COMPLETED) CON historia clínica asociada. */
    closedAppointmentsWithRecord: number;
    /** Citas cerradas (COMPLETED) SIN historia clínica asociada. */
    closedAppointmentsWithoutRecord: number;
    /** Mensajes procesados por la IA (SystemLog: AI_MESSAGE_PROCESSED). */
    aiMessagesProcessed: number;
  };
}
