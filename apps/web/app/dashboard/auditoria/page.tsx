// app/(dashboard)/auditoria/page.tsx
import AuditoriaClientView from './AuditoriaClientView';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';

async function getLogs(organizationId: string) {
    const res = await fetch(
        `${process.env.API_URL}/auditoria?organizationId=${organizationId}`,
        { cache: 'no-store' }, // siempre fresco
    );
    if (!res.ok) return [];
    return res.json();
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