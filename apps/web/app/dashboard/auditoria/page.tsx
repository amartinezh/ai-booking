// app/(dashboard)/auditoria/page.tsx
import AuditoriaClientView from './AuditoriaClientView';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';

async function getLogs(organizationId: string) {
    try {
        const url = `${process.env.API_URL}/auditoria?organizationId=${organizationId}`;
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