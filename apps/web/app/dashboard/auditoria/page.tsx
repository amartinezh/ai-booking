// app/(dashboard)/auditoria/page.tsx
import AuditoriaClientView from './AuditoriaClientView';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';
import { prisma } from '../../../lib/prisma';

export default async function AuditoriaPage() {
    // Obtenemos la sesión actual
    const session = await getSession();

    // Validamos que exista la sesión y tenga permisos
    if (!session || !session.organizationId || session.role !== 'ORG_ADMIN') {
        redirect('/dashboard');
    }

    const organizationId = session.organizationId;
    
    // Obtenemos los logs DIRECTAMENTE de la base de datos
    // Esto elimina la necesidad de conectarse a la API de NestJS por red
    const [logs, waitlistCount, organization] = await Promise.all([
        prisma.interactionLog.findMany({
            where: {
                organizationId,
                status: { in: ['FAILED', 'ABANDONED'] },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
        }),
        // Pacientes que eligieron quedar en lista de espera (cupo) y siguen pendientes.
        prisma.waitlistEntry.count({
            where: { organizationId, status: 'WAITING' },
        }),
        // Nombre de la clínica para personalizar los saludos de WhatsApp.
        prisma.organization.findUnique({
            where: { id: organizationId },
            select: { name: true },
        }),
    ]);

    return (
        <AuditoriaClientView
            logs={logs}
            waitlistCount={waitlistCount}
            organizationName={organization?.name ?? 'nuestra clínica'}
        />
    );
}