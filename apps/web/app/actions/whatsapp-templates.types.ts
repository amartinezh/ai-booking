// Tipos puros — las server actions viven en `./whatsapp-templates.ts`.

import type { TemplateKind } from '@agenia/shared';

/** Tipos de plantilla que el backend sabe enviar. */
export type WhatsappTemplateKind = TemplateKind;

export interface WhatsappTemplateDto {
    id: string;
    kind: WhatsappTemplateKind;
    name: string;
    language: string;
    requestsContactInfo: boolean;
    isActive: boolean;
}

export interface SaveWhatsappTemplateInput {
    kind: WhatsappTemplateKind;
    name: string;
    language?: string;
    requestsContactInfo?: boolean;
    isActive?: boolean;
}

/**
 * Contrato de variables de cada plantilla: los marcadores `{{n}}` del cuerpo
 * DEBEN aprobarse en Meta en este orden. Se muestra en la UI para que quien
 * configure no tenga que adivinarlo.
 *
 * Vive en `@agenia/shared` porque la API lo necesita para RECHAZAR una
 * configuración imposible (dos tipos con distinta cantidad de variables
 * apuntando al mismo nombre de plantilla). Estaba aquí solo, de adorno, y por
 * eso los cinco tipos acabaron apuntando a `recordatorio_cita`.
 */
export { TEMPLATE_CONTRACTS } from '@agenia/shared';
