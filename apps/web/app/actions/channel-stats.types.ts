/** Tipos de «Canales en vivo» (espejo de apps/api/src/channel-stats). */

export type ChannelRange = 'TODAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';
export type Canal = 'WHATSAPP' | 'TELEGRAM';
export type Granularidad = 'hour' | 'day' | 'month';

export interface ChannelStatsQuery {
    range: ChannelRange;
    startDate?: string;
    endDate?: string;
    /** Solo Super Admin; vacío = todas las clínicas. */
    organizationId?: string | null;
}

export interface PuntoSerie {
    bucket: string;
    writers: number;
    messages: number;
    appointments: number;
    noBooking: number;
    problems: number;
}

export interface TotalesCanal {
    writers: number;
    messages: number;
    appointmentsRequested: number;
    bookedWriters: number;
    managedWriters: number;
    noBooking: number;
    problemWriters: number;
    conversionPct: number | null;
    messagesPerWriter: number | null;
    newWriters: number;
    returningWriters: number;
    activeNow: number;
}

export interface EstadoCitas {
    scheduled: number;
    completed: number;
    cancelled: number;
    noShow: number;
}

export interface ChannelStatsResponse {
    filters: {
        organizationId: string | null;
        range: ChannelRange;
        startDate: string;
        endDate: string;
        granularity: Granularidad;
        timeZone: string;
    };
    generatedAt: string;
    channels: Record<Canal, { series: PuntoSerie[]; totals: TotalesCanal }>;
    details: {
        appointmentsByStatus: Record<Canal, EstadoCitas>;
        peakHours: { channel: Canal; dow: number; hour: number; messages: number }[];
        messageTypes: { channel: Canal; type: string; messages: number }[];
        failureReasons: { channel: Canal; reason: string; count: number }[];
        flows: Record<Canal, Record<string, number>>;
        delivery: Record<Canal, Record<string, number>>;
        interactionLogRetentionDays: number;
    };
}
