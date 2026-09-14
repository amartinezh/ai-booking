// Tipos puros — las server actions viven en `./whatsapp-templates.ts`.

/** Tipos de plantilla que el backend sabe enviar. */
export type WhatsappTemplateKind =
    | 'APPOINTMENT_REMINDER'
    | 'WAITLIST_SLOT_OFFER'
    | 'APPOINTMENT_CANCELLED_MASS'
    | 'APPOINTMENT_REMINDER_MASS';

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
    APPOINTMENT_CANCELLED_MASS: {
        label: 'Aviso de cancelación (avisos masivos)',
        description:
            'EXCLUSIVA del driver cnt-sanvicente-anserma — ver PLAN_AVISOS_MASIVOS.md §7.1. Se usa desde Avisos de cancelación (/dashboard/espejo/avisos) cuando un especialista no puede asistir. El 100% de estos envíos cae fuera de la ventana de 24 h, así que sin esta plantilla el aviso no sale nunca.',
        variables: [
            'Nombre del paciente',
            'Servicio',
            'Médico',
            'Fecha y hora',
            'Nota adicional (o la frase por defecto si el operador la deja vacía)',
        ],
    },
    APPOINTMENT_REMINDER_MASS: {
        label: 'Recordatorio masivo (avisos masivos)',
        description:
            'EXCLUSIVA del driver cnt-sanvicente-anserma — mismo motor que el aviso de cancelación (PLAN_AVISOS_MASIVOS.md §10, Fase 3), otro tipo de lote. Se usa desde Avisos de cancelación cuando el hospital quiere recordar por adelantado un día de agenda del especialista, no cancelarlo.',
        variables: [
            'Nombre del paciente',
            'Servicio',
            'Médico',
            'Fecha y hora',
            'Nota adicional (o la frase por defecto si el operador la deja vacía)',
        ],
    },
};
