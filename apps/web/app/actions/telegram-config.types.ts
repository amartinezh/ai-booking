// Tipos compartidos entre las server actions de Telegram y su tarjeta.
// Sin directiva 'use server' — Next.js 16 sólo permite exportar funciones async
// desde archivos con esa directiva. Ver docs/PLAN_TELEGRAM.md §4.4.

/** Vista segura del canal: nunca trae el token ni el secreto. */
export interface PublicTelegramConfig {
    connected: boolean;
    isActive: boolean;
    botUsername: string | null;
    botLink: string | null;
    botTokenLast4: string | null;
    lastWebhookSetAt: string | null;
    lastError: string | null;
    updatedAt: string | null;
}

/** Lo que devuelve «Verificar conexión». */
export interface TelegramWebhookStatus extends PublicTelegramConfig {
    webhookOk: boolean;
    pendingUpdateCount: number | null;
    telegramLastError: string | null;
}

/**
 * Estado de la tarjeta. `enabled: false` NO es un error: el servidor tiene
 * TELEGRAM_ENABLED apagado y la API ni siquiera expone las rutas (404).
 */
export type TelegramCardState =
    | { enabled: false }
    | { enabled: true; config: PublicTelegramConfig };

export type TelegramActionResult<T> =
    | { success: true; data: T }
    | { success: false; error: string };
