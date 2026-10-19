/**
 * Tipos de las alertas técnicas por Telegram (docs/PLAN_ALERTAS_TECNICAS.md).
 * Las reglas (gravedades, claves, antirruido, textos) viven en @agenia/shared.
 */
import type {
  CategoriaAlerta,
  ConfigAntirruido,
  GravedadAlerta,
  TipoAlerta,
} from '@agenia/shared';

/** Quién hizo el cambio: sale SIEMPRE del token, nunca del body. */
export interface TechAlertActor {
  userId: string | null;
  email: string | null;
  ip: string | null;
}

/** Lo que ve el panel. Nunca el token en claro. */
export interface PublicTechAlertConfig {
  connected: boolean;
  botUsername: string | null;
  botLink: string | null;
  botTokenLast4: string | null;
  chatLinked: boolean;
  chatTitle: string | null;
  /** El código pendiente, con el comando tal como hay que escribirlo en el grupo. */
  linkPending: { code: string; command: string; expiresAt: Date } | null;
  enabled: boolean;
  mutedUntil: Date | null;
  categories: Record<CategoriaAlerta, boolean>;
  reminderMinutes: number;
  maxReminders: number;
  quietHoursEnabled: boolean;
  quietFromHour: number;
  quietToHour: number;
  dailySummaryEnabled: boolean;
  panelBaseUrl: string | null;
  /** La base que de verdad se usa en los enlaces (la escrita o la de la API). */
  panelBaseEffective: string | null;
  lastOkAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  updatedAt: Date | null;
  updatedByEmail: string | null;
}

export interface TechAlertSettingsInput {
  enabled?: unknown;
  categories?: unknown;
  reminderMinutes?: unknown;
  maxReminders?: unknown;
  quietHoursEnabled?: unknown;
  quietFromHour?: unknown;
  quietToHour?: unknown;
  dailySummaryEnabled?: unknown;
  panelBaseUrl?: unknown;
}

/** Resultado de «Buscar el grupo». */
export type TechAlertLinkResult =
  | { found: true; config: PublicTechAlertConfig }
  | {
      found: false;
      reason: 'SIN_CODIGO' | 'VENCIDO' | 'NO_LLEGO' | 'CHAT_PRIVADO';
      message: string;
    };

/**
 * Lo que el envío necesita, en memoria: si la base se cae, se sigue pudiendo
 * avisar con la última copia (docs/PLAN_ALERTAS_TECNICAS.md §3.5).
 */
export interface TechAlertChannel {
  token: string;
  chatId: string;
  enabled: boolean;
  mutedUntilIso: string | null;
  antirruido: ConfigAntirruido;
  dailySummaryEnabled: boolean;
  lastDailySummaryIso: string | null;
  panelBase: string | null;
}

export type TechAlertSendResult =
  | { ok: true }
  | { ok: false; errorCode: number | null; error: string };

/**
 * Lo que un chequeo le pasa a `TechAlertService.avisar`. 🔒 Nunca nombres ni datos
 * de pacientes: título y detalle se sanitizan, pero un nombre no se reconoce.
 */
export interface TechAlertInput {
  kind: TipoAlerta;
  dedupeKey: string;
  title: string;
  detail?: string | null;
  /** Por defecto la del catálogo (o la que dicta `gravedadDeAlerta`). */
  severity?: GravedadAlerta;
  /** Por defecto la del catálogo. */
  category?: CategoriaAlerta;
  organizationId?: string | null;
  organizationName?: string | null;
  serviceIncidentId?: string | null;
  /** Quién lo detectó, para el mensaje: «centinela del monitor». */
  fuente?: string | null;
}
