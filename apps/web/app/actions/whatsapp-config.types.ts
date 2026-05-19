// Tipos compartidos entre server actions y componentes cliente.
// Sin directiva 'use server' — Next.js 16 sólo permite exportar funciones async
// desde archivos con esa directiva.

export interface PublicWhatsappConfig {
    phoneNumberId: string | null;
    businessAccountId: string | null;
    displayPhoneNumber: string | null;
    verifyToken: string | null;
    hasAccessToken: boolean;
    accessTokenLast4: string | null;
    isActive: boolean;
    webhookCallbackUrl: string;
    updatedAt: string | null;
}

export interface SaveWhatsappConfigInput {
    phoneNumberId?: string | null;
    businessAccountId?: string | null;
    displayPhoneNumber?: string | null;
    verifyToken?: string | null;
    accessToken?: string | null;
    isActive?: boolean;
}
