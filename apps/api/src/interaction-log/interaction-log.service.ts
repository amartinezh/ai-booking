// @ts-nocheck
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ══════════════════════════════════════════════════════════════
// 📊 ESTADOS POSIBLES DE UNA INTERACCIÓN REGISTRADA
// ══════════════════════════════════════════════════════════════
export enum InteractionStatus {
    SUCCESS = 'SUCCESS',                       // Procesamiento exitoso
    FAILED = 'FAILED',                         // Falló por alguna razón
    ABANDONED = 'ABANDONED',                   // Usuario excedió reintentos
    OUTBOUND = 'OUTBOUND',                     // Mensaje saliente desde dashboard
    WAITLIST_NOTIFIED = 'WAITLIST_NOTIFIED',   // Notificación automática de waitlist
    ESCAPED = 'ESCAPED',                       // Usuario reinició con "salir" / "hola"
    CANCELLATION_FLOW = 'CANCELLATION_FLOW',   // Inicio de flujo de cancelación
    BOOKING_CONFIRMED = 'BOOKING_CONFIRMED',   // Cita agendada exitosamente
    WAITLIST_JOINED = 'WAITLIST_JOINED',       // Paciente entró a waitlist
    REMINDER_SENT = 'REMINDER_SENT',           // Recordatorio automático de cita enviado
}

// ══════════════════════════════════════════════════════════════
// 📋 RAZONES DE FALLO ESTANDARIZADAS
// ══════════════════════════════════════════════════════════════
export enum FailureReason {
    GEMINI_DOWN = 'GEMINI_DOWN',
    TOKEN_EXPIRED = 'TOKEN_EXPIRED',
    META_API_ERROR = 'META_API_ERROR',
    PHONE_ID_MISSING = 'PHONE_ID_MISSING',
    UNINTELLIGIBLE_AUDIO = 'UNINTELLIGIBLE_AUDIO',
    OUT_OF_CONTEXT = 'OUT_OF_CONTEXT',
    NO_AGENDA = 'NO_AGENDA',
    EPS_NOT_FOUND = 'EPS_NOT_FOUND',
    EPS_INACTIVE = 'EPS_INACTIVE',
    DOCTOR_NOT_FOUND = 'DOCTOR_NOT_FOUND',
    SLOT_TAKEN = 'SLOT_TAKEN',
    SESSION_EXPIRED = 'SESSION_EXPIRED',
    MAX_RETRIES = 'MAX_RETRIES',
    PATIENT_NOT_FOUND = 'PATIENT_NOT_FOUND',
    NO_APPOINTMENTS_TO_CANCEL = 'NO_APPOINTMENTS_TO_CANCEL',
    CANCEL_ERROR = 'CANCEL_ERROR',
    UNHANDLED_ERROR = 'UNHANDLED_ERROR',
    ORG_INACTIVE = 'ORG_INACTIVE',
    NO_TENANT = 'NO_TENANT',
    // El RAG de FAQ afirmó disponibilidad de citas/cupos (dato que NO vive en la
    // base de conocimiento, sino en los Slots) → respuesta interceptada.
    FAQ_HALLUCINATION = 'FAQ_HALLUCINATION',
}

export interface LogParams {
    whatsappId: string;
    status: InteractionStatus;
    failureReason?: FailureReason | null;
    userMessage?: string | null;
    botReply?: string | null;
    organizationId?: string | null;
    patientUserId?: string | null;
    metadata?: any;
}

/**
 * 🕵️ SERVICIO DE AUDITORÍA "CAJA NEGRA"
 *
 * Escribe cada interacción del bot en la tabla InteractionLog.
 * Es fire-and-forget: nunca bloquea ni crashea el flujo principal.
 * Si falla la escritura del log, el bot sigue funcionando normalmente.
 *
 * Cumple con requisitos de auditoría legal (Ley 2015/2020 Colombia HealthTech)
 * y permite reconstruir conversaciones para reclamaciones o disputas.
 */
@Injectable()
export class InteractionLogService {
    private readonly logger = new Logger(InteractionLogService.name);

    constructor(private prisma: PrismaService) { }

    /**
     * Registra una interacción de forma asíncrona.
     * NUNCA propaga errores al caller (fire-and-forget).
     */
    async log(params: LogParams): Promise<void> {
        try {
            const userMessage = params.userMessage
                ? this.truncate(params.userMessage, 4000)
                : null;
            const botReply = params.botReply
                ? this.truncate(params.botReply, 4000)
                : null;

            await this.prisma.interactionLog.create({
                data: {
                    whatsappId: params.whatsappId,
                    status: params.status,
                    failureReason: params.failureReason || null,
                    userMessage,
                    botReply,
                    organizationId: params.organizationId || null,
                    patientId: params.patientUserId || null,
                    metadata: params.metadata || null,
                },
            });
        } catch (error) {
            this.logger.error(
                `Error escribiendo InteractionLog (no afecta el flujo): ${error.message}`,
            );
        }
    }

    /**
     * Helper: registrar éxito en una conversación
     */
    async logSuccess(params: Omit<LogParams, 'status'>): Promise<void> {
        await this.log({ ...params, status: InteractionStatus.SUCCESS });
    }

    /**
     * Helper: registrar fallo con razón estructurada
     */
    async logFailure(
        params: Omit<LogParams, 'status'> & { reason: FailureReason },
    ): Promise<void> {
        await this.log({
            ...params,
            status: InteractionStatus.FAILED,
            failureReason: params.reason,
        });
    }

    /**
     * Helper: registrar cita agendada (evento de negocio crítico)
     */
    async logBookingConfirmed(params: {
        whatsappId: string;
        organizationId: string;
        appointmentId: string;
        patientCedula: string;
        serviceName: string;
        doctorName: string;
        slotDate: Date;
        epsName?: string;
        userMessage?: string;
        botReply?: string;
    }): Promise<void> {
        await this.log({
            whatsappId: params.whatsappId,
            organizationId: params.organizationId,
            status: InteractionStatus.BOOKING_CONFIRMED,
            userMessage: params.userMessage,
            botReply: params.botReply,
            metadata: {
                appointmentId: params.appointmentId,
                patientCedula: params.patientCedula,
                serviceName: params.serviceName,
                doctorName: params.doctorName,
                slotDate: params.slotDate.toISOString(),
                epsName: params.epsName,
            },
        });
    }

    /**
     * Helper: registrar entrada a waitlist (evento de negocio)
     */
    async logWaitlistJoined(params: {
        whatsappId: string;
        organizationId: string;
        waitlistEntryId: string;
        patientCedula: string;
        serviceName: string;
        epsName?: string;
        position: number;
        userMessage?: string;
        botReply?: string;
    }): Promise<void> {
        await this.log({
            whatsappId: params.whatsappId,
            organizationId: params.organizationId,
            status: InteractionStatus.WAITLIST_JOINED,
            userMessage: params.userMessage,
            botReply: params.botReply,
            metadata: {
                waitlistEntryId: params.waitlistEntryId,
                patientCedula: params.patientCedula,
                serviceName: params.serviceName,
                epsName: params.epsName,
                position: params.position,
            },
        });
    }

    /**
     * Helper: registrar mensaje saliente desde el dashboard
     */
    async logOutbound(params: {
        whatsappId: string;
        organizationId?: string;
        botReply: string;
        success: boolean;
        error?: string;
    }): Promise<void> {
        await this.log({
            whatsappId: params.whatsappId,
            organizationId: params.organizationId,
            status: params.success
                ? InteractionStatus.OUTBOUND
                : InteractionStatus.FAILED,
            failureReason: params.success ? null : FailureReason.META_API_ERROR,
            botReply: params.botReply,
            metadata: {
                outbound: true,
                error: params.error || null,
            },
        });
    }

    /**
     * Helper: registrar recordatorio automático de cita enviado al paciente.
     * Lo invoca AppointmentReminderCronService al completar cada envío
     * (éxito o falla) para que quede traza en la Caja Negra.
     */
    async logReminderSent(params: {
        whatsappId: string;
        organizationId: string;
        appointmentId: string;
        patientCedula?: string | null;
        doctorName?: string | null;
        serviceName?: string | null;
        slotDate: Date;
        businessHoursBefore: number;
        success: boolean;
        botReply: string;
        error?: string | null;
    }): Promise<void> {
        await this.log({
            whatsappId: params.whatsappId,
            organizationId: params.organizationId,
            status: params.success
                ? InteractionStatus.REMINDER_SENT
                : InteractionStatus.FAILED,
            failureReason: params.success ? null : FailureReason.META_API_ERROR,
            botReply: params.botReply,
            metadata: {
                appointmentId: params.appointmentId,
                patientCedula: params.patientCedula || null,
                doctorName: params.doctorName || null,
                serviceName: params.serviceName || null,
                slotDate: params.slotDate.toISOString(),
                businessHoursBefore: params.businessHoursBefore,
                reminderAutomatic: true,
                error: params.error || null,
            },
        });
    }

    /**
     * Helper: registrar notificación automática de waitlist al paciente
     */
    async logWaitlistNotification(params: {
        whatsappId: string;
        organizationId: string;
        patientCedula: string;
        slotId: string;
        doctorName: string;
        slotDate: Date;
        botReply: string;
    }): Promise<void> {
        await this.log({
            whatsappId: params.whatsappId,
            organizationId: params.organizationId,
            status: InteractionStatus.WAITLIST_NOTIFIED,
            botReply: params.botReply,
            metadata: {
                patientCedula: params.patientCedula,
                slotId: params.slotId,
                doctorName: params.doctorName,
                slotDate: params.slotDate.toISOString(),
            },
        });
    }

    // ──────────────────────────────────────────────────────
    // Helpers privados
    // ──────────────────────────────────────────────────────
    private truncate(text: string, maxLen: number): string {
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen - 3) + '...';
    }
}