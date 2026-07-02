/**
 * Tipos compartidos del módulo de configuración de WhatsApp.
 * Se mantienen como interfaces puras (sin decoradores) para no romper la
 * metadata cuando se usan en @Body() con `isolatedModules`.
 */

export interface SaveWhatsappConfigInput {
  phoneNumberId?: string | null;
  businessAccountId?: string | null;
  displayPhoneNumber?: string | null;
  verifyToken?: string | null;
  accessToken?: string | null;
  // App Secret de la app de Meta: activa la verificación de la firma
  // X-Hub-Signature-256 del webhook. Vacío = conservar el actual.
  appSecret?: string | null;
  isActive?: boolean;
}

/** Vista segura para el frontend: nunca expone secretos en claro. */
export interface PublicWhatsappConfig {
  phoneNumberId: string | null;
  businessAccountId: string | null;
  displayPhoneNumber: string | null;
  verifyToken: string | null;
  hasAccessToken: boolean;
  accessTokenLast4: string | null;
  hasAppSecret: boolean;
  isActive: boolean;
  webhookCallbackUrl: string;
  updatedAt: Date | null;
}

/** Credenciales en claro — sólo se materializan dentro del backend. */
export interface ResolvedWhatsappCredentials {
  organizationId: string;
  phoneNumberId: string;
  accessToken: string;
  isActive: boolean;
}
