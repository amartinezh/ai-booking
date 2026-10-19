// Tipos compartidos entre las server actions de las alertas técnicas y su página.
// Sin directiva 'use server' — Next.js 16 sólo permite exportar funciones async
// desde archivos con esa directiva. Ver docs/PLAN_ALERTAS_TECNICAS.md §3.8.

/** Vista segura del canal: nunca trae el token. Fechas como ISO. */
export interface PublicTechAlertConfig {
    connected: boolean;
    botUsername: string | null;
    botLink: string | null;
    botTokenLast4: string | null;
    chatLinked: boolean;
    chatTitle: string | null;
    linkPending: { code: string; command: string; expiresAt: string } | null;
    enabled: boolean;
    mutedUntil: string | null;
    categories: Record<string, boolean>;
    reminderMinutes: number;
    maxReminders: number;
    quietHoursEnabled: boolean;
    quietFromHour: number;
    quietToHour: number;
    dailySummaryEnabled: boolean;
    panelBaseUrl: string | null;
    panelBaseEffective: string | null;
    lastOkAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
    updatedAt: string | null;
    updatedByEmail: string | null;
}

export interface TechAlertSettings {
    enabled?: boolean;
    categories?: Record<string, boolean>;
    reminderMinutes?: number;
    maxReminders?: number;
    quietHoursEnabled?: boolean;
    quietFromHour?: number;
    quietToHour?: number;
    dailySummaryEnabled?: boolean;
    panelBaseUrl?: string;
}

/** Una fila de la bitácora. Título y detalle llegan ya sanitizados. */
export interface TechAlertRow {
    id: string;
    kind: string;
    category: string;
    severity: string;
    status: string;
    title: string;
    detail: string | null;
    organizationName: string | null;
    occurrences: number;
    firstSeenAt: string;
    lastSeenAt: string;
    resolvedAt: string | null;
    notifiedAt: string | null;
    resolutionNotifiedAt: string | null;
    reminderCount: number;
    sendAttempts: number;
    lastSendError: string | null;
    meta: unknown;
}

export interface TechAlertListResult {
    rows: TechAlertRow[];
    total: number;
}

export type TechAlertLinkResult =
    | { found: true; config: PublicTechAlertConfig }
    | { found: false; reason: string; message: string };

export type TechAlertActionResult<T> =
    | { success: true; data: T }
    | { success: false; error: string };
