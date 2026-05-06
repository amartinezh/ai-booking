// app/(dashboard)/auditoria/page.tsx
import AuditoriaClientView from './AuditoriaClientView';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';

async function getLogs(organizationId: string) {
    try {
        // En Docker, la app web (NextJS) se comunica con la API (NestJS)
        // a través de la red interna 'https://api:3000'. Si process.env.API_URL
        // apunta al dominio público de NextJS (ej. https://agendamiento-ia.com/)
        // esto causará un ciclo infinito o un 404.

        let baseUrl = process.env.API_URL || 'https://api:3000';
        // Limpiamos el slash final si existe para evitar //auditoria
        baseUrl = baseUrl.replace(/\/$/, '');

        // Fallback de seguridad: si API_URL apunta por error a la misma app web, forzamos interno.
        if (baseUrl.includes('agendamiento-ia.com') && !baseUrl.includes('api.')) {
            console.warn('⚠️ API_URL apunta al frontend. Forzando ruta interna Docker.');
            baseUrl = 'https://api:3000';
        }

        const url = `${baseUrl}/auditoria?organizationId=${organizationId}`;
        console.log('🔍 Auditoría - fetching:', url);

        const res = await fetch(url, { cache: 'no-store' });

        if (!res.ok) {
            console.error(
                `❌ Auditoría - endpoint respondió ${res.status}: ${res.statusText}`,
            );
            return [];
        }

        const data = await res.json();
        console.log(`✅ Auditoría - cargados ${data.length} logs`);
        return data;
    } catch (error) {
        console.error('❌ Auditoría - error fetching logs:', error);
        return [];
    }
}

export default async function AuditoriaPage() {
    // Obtenemos la sesión actual
    const session = await getSession();

    // Validamos que exista la sesión y tenga permisos
    if (!session || !session.organizationId || session.role !== 'ORG_ADMIN') {
        redirect('/dashboard');
    }

    // Usamos el ID dinámico de la organización de la sesión
    const organizationId = session.organizationId;
    const logs = await getLogs(organizationId);

    return <AuditoriaClientView logs={logs} />;
}