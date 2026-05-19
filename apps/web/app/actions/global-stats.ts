'use server';

import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

export type StatsTimeRange = 'TODAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';

export interface StatsFilters {
    organizationId?: string | null;
    range: StatsTimeRange;
    startDate?: string;
    endDate?: string;
}

export interface TrendPoint {
    date: string;
    count: number;
}

export interface GlobalStatsResponse {
    filters: {
        organizationId: string | null;
        range: StatsTimeRange;
        startDate: string;
        endDate: string;
    };
    metrics: {
        loginsClinicAdmin: number;
        loginsDoctor: number;
        loginsScheduler: number;
        appointmentsScheduled: number;
        appointmentsFailed: number;
        whatsappEscalations: number;
        newPatients: number;
        signedClinicalRecords: number;
        legalAddendums: number;
        aiMessagesProcessed: number;
        activeOrganizations: number;
    };
    trends: {
        appointmentsScheduled: TrendPoint[];
        newPatients: TrendPoint[];
        aiMessagesProcessed: TrendPoint[];
        signedClinicalRecords: TrendPoint[];
    };
}

export interface OrgOption {
    id: string;
    name: string;
    isActive: boolean;
}

async function authedHeaders() {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    return {
        'Content-Type': 'application/json',
        ...(token ? { Cookie: `auth_token=${token}` } : {}),
    };
}

async function ensureSuperAdmin() {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') {
        throw new Error('Acceso denegado');
    }
}

export async function listStatsOrganizations(): Promise<OrgOption[]> {
    await ensureSuperAdmin();
    const headers = await authedHeaders();
    const res = await fetch(`${INTERNAL_API_URL}/global-stats/organizations`, {
        headers,
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    return res.json();
}

export async function getGlobalStats(filters: StatsFilters): Promise<GlobalStatsResponse> {
    await ensureSuperAdmin();
    const headers = await authedHeaders();

    const qs = new URLSearchParams();
    if (filters.organizationId) qs.set('organizationId', filters.organizationId);
    qs.set('range', filters.range);
    if (filters.range === 'CUSTOM') {
        if (filters.startDate) qs.set('startDate', filters.startDate);
        if (filters.endDate) qs.set('endDate', filters.endDate);
    }

    const res = await fetch(`${INTERNAL_API_URL}/global-stats?${qs.toString()}`, {
        headers,
        cache: 'no-store',
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Backend ${res.status}: ${errText}`);
    }
    return res.json();
}
