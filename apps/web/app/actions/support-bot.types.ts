// Tipos del asistente de soporte por Telegram (docs/PLAN_BOT_SOPORTE.md). Viven
// aparte porque un archivo 'use server' solo puede exportar funciones async.
// Son el espejo de apps/api/src/support-bot/support-bot.types.ts.

/** Lo que la tarjeta de Soporte sabe del asistente para quien la mira. */
export interface EstadoAsistente {
    disponible: boolean;
    botUsername: string | null;
    /** Minutos sin mensajes que cierran una conversación. */
    conversacionMinutos: number;
    conversacion: {
        telegramName: string | null;
        desde: string;
        ultimoMensaje: string;
    } | null;
    avisos: {
        activos: boolean;
        destino: string | null;
    };
}

export interface CodigoAsistente {
    codigo: string;
    enlace: string;
    botUsername: string;
    venceEn: string;
}

export interface ConfigAsistente {
    conectado: boolean;
    botUsername: string | null;
    enabled: boolean;
    webhook: { ok: boolean; pendientes: number | null; ultimoError: string | null } | null;
    horario: { dias: number[]; desdeHora: number; hastaHora: number; zona: string };
    conversacionMinutos: number;
    limites: {
        mensajesPorHora: number;
        caracteresPorMensaje: number;
        turnosIaPorClinicaAlDia: number;
    };
    ultimoError: string | null;
    ultimoErrorEn: string | null;
    actualizadoPor: string | null;
    actualizadoEn: string | null;
}

export interface AjustesAsistente {
    enabled?: boolean;
    teamDays?: number[];
    teamFromHour?: number;
    teamToHour?: number;
    conversationIdleMinutes?: number;
    maxMessagesPerHour?: number;
    maxMessageChars?: number;
    maxAiTurnsPerOrgPerDay?: number;
}

export type ResultadoAsistente<T> = { ok: true; data: T } | { ok: false; error: string };

/** La configuración del super admin: `apagado` = SUPPORT_BOT_ENABLED no está en `true`. */
export type ResultadoConfigAsistente =
    | { ok: true; config: ConfigAsistente }
    | { ok: false; apagado: boolean; error: string };
