/**
 * Tipos del asistente de soporte por Telegram (docs/PLAN_BOT_SOPORTE.md).
 */

/** Quien cambia la configuración: sale SIEMPRE del token, nunca del body. */
export interface SupportBotActor {
  userId: string;
  email: string | null;
  ip: string | null;
}

/** Vista segura de la configuración para el super admin: nunca el token ni el secreto. */
export interface PublicSupportBotConfig {
  conectado: boolean;
  botUsername: string | null;
  /** El asistente atiende (además de `SUPPORT_BOT_ENABLED=true` en el servidor). */
  enabled: boolean;
  /** Lo que Telegram dice del webhook; `null` si no hay bot o no se pudo preguntar. */
  webhook: {
    ok: boolean;
    pendientes: number | null;
    ultimoError: string | null;
  } | null;
  horario: {
    dias: number[];
    desdeHora: number;
    hastaHora: number;
    zona: string;
  };
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

/** Ajustes que el super admin puede cambiar (todos opcionales). */
export interface SupportBotSettingsInput {
  enabled?: unknown;
  teamDays?: unknown;
  teamFromHour?: unknown;
  teamToHour?: unknown;
  conversationIdleMinutes?: unknown;
  maxMessagesPerHour?: unknown;
  maxMessageChars?: unknown;
  maxAiTurnsPerOrgPerDay?: unknown;
}

/** Lo que la configuración le entrega al resto del módulo (con el token en claro). */
export interface SupportBotRuntime {
  enabled: boolean;
  token: string;
  botUsername: string | null;
  routeKey: string;
  webhookSecret: string;
  conversationIdleMinutes: number;
  maxMessagesPerHour: number;
  maxMessageChars: number;
}

/** El código recién generado, para mostrarlo en el panel. */
export interface CodigoGenerado {
  /** Los 6 dígitos que se escriben en Telegram. */
  codigo: string;
  /** `https://t.me/<bot>?start=<código largo>`: el botón y el QR. */
  enlace: string;
  botUsername: string;
  venceEn: string;
}

/** Lo que la tarjeta de Soporte necesita saber del asistente para quien la mira. */
export interface EstadoAsistenteParaUsuario {
  disponible: boolean;
  botUsername: string | null;
  /** Minutos sin mensajes que cierran una conversación. */
  conversacionMinutos: number;
  /** La conversación abierta, si la hay y sigue vigente. */
  conversacion: {
    telegramName: string | null;
    desde: string;
    ultimoMensaje: string;
  } | null;
  avisos: {
    activos: boolean;
    /** Nombre en Telegram de la cuenta a la que llegarían los avisos; null si nunca conversó. */
    destino: string | null;
  };
}
