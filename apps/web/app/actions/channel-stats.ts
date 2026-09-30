'use server';

import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';
import type { ChannelStatsQuery, ChannelStatsResponse } from './channel-stats.types';

const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

/**
 * «Canales en vivo»: WhatsApp y Telegram en cifras. Solo lee agregados de la
 * base (la API no llama a IA, ni a Meta, ni a Telegram): refrescar cada 30 s
 * no cuesta un token.
 *
 * Super Admin → vista global o de una clínica. Admin/observador → su clínica
 * (el tenant sale del JWT en la API; aquí no se puede elegir otra).
 */
export async function getChannelStats(q: ChannelStatsQuery): Promise<ChannelStatsResponse> {
    const session = await getSession();
    if (!session) throw new Error('Sesión expirada');
    const esSuper = session.role === 'SUPER_ADMIN';
    if (!esSuper && session.role !== 'ORG_ADMIN' && session.role !== 'GENERAL_OBSERVER') {
        throw new Error('Acceso denegado');
    }

    const params = new URLSearchParams();
    params.set('range', q.range);
    if (q.range === 'CUSTOM') {
        if (q.startDate) params.set('startDate', q.startDate);
        if (q.endDate) params.set('endDate', q.endDate);
    }
    if (esSuper && q.organizationId) params.set('organizationId', q.organizationId);

    const token = (await cookies()).get('auth_token')?.value;
    const res = await fetch(
        `${INTERNAL_API_URL}/channel-stats${esSuper ? '/global' : ''}?${params.toString()}`,
        {
            headers: token ? { Cookie: `auth_token=${token}` } : {},
            cache: 'no-store',
        },
    );
    if (!res.ok) throw new Error(`No se pudieron cargar las cifras de canales (${res.status}).`);
    return (await res.json()) as ChannelStatsResponse;
}
