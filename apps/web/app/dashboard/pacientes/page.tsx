import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';
import PatientClientView from './PatientClientView';

export const dynamic = 'force-dynamic';

export default async function PacientesPage() {
    const session = await getSession();

    // Solo permitimos el acceso a administradores
    if (!session || session.role !== 'ORG_ADMIN') {
        redirect('/dashboard');
    }

    const patients = await prisma.patientProfile.findMany({
        where: { organizationId: session.organizationId },
        orderBy: { createdAt: 'desc' },
        include: { user: true }
    });

    return <PatientClientView patients={patients} />;
}
