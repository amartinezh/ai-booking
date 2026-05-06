// app/(dashboard)/auditoria/page.tsx (o donde tengas la página)
import AuditoriaClientView from './AuditoriaClientView';

async function getLogs(organizationId: string) {
    const res = await fetch(
        `${process.env.API_URL}/auditoria?organizationId=${organizationId}`,
        { cache: 'no-store' }, // siempre fresco
    );
    if (!res.ok) return [];
    return res.json();
}

export default async function AuditoriaPage() {
    // Asume que tienes el organizationId desde la sesión
    const organizationId = '92b268d0-fae5-425f-8478-0b5ed528326a';
    const logs = await getLogs(organizationId);

    return <AuditoriaClientView logs={logs} />;
}