import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';
import AuditoriaClientView from './AuditoriaClientView';

export const dynamic = 'force-dynamic';

export default async function AuditoriaPage() {
    const session = await getSession();

    if (!session || session.role !== 'ADMIN') {
        redirect('/dashboard');
    }

    const logs = await prisma.interactionLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100 // Límite para no saturar al inicio
    });

    return <AuditoriaClientView logs={logs} />;
}
