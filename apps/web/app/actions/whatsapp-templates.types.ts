// Tipos puros — las server actions viven en `./whatsapp-templates.ts`.

/** Tipos de plantilla que el backend sabe enviar. */
export type WhatsappTemplateKind =
    | 'APPOINTMENT_REMINDER'
    | 'WAITLIST_SLOT_OFFER';

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
 */
export const TEMPLATE_CONTRACTS: Record<
    WhatsappTemplateKind,
    { label: string; description: string; variables: string[] }
> = {
    APPOINTMENT_REMINDER: {
        label: 'Recordatorio de cita',
        description:
            'Se envía antes de la cita. Casi siempre cae fuera de la ventana de 24 h, así que sin esta plantilla el recordatorio no sale.',
        variables: ['Nombre del paciente', 'Servicio', 'Médico', 'Fecha y hora'],
    },
    WAITLIST_SLOT_OFFER: {
        label: 'Oferta de cupo (lista de espera)',
        description:
            'Avisa a un paciente en lista de espera que se liberó un cupo.',
        variables: ['Nombre del paciente', 'Servicio', 'Fecha y hora'],
    },
};
