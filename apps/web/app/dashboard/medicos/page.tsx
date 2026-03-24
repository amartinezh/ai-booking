import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';
import DoctorClientView from './DoctorClientView';

export const dynamic = 'force-dynamic';

export default async function MedicosPage() {
    const session = await getSession();

    // Solo permitimos el acceso a administradores
    if (!session || session.role !== 'ORG_ADMIN') {
        redirect('/dashboard');
    }

    const doctors = await prisma.doctorProfile.findMany({
        where: { organizationId: session.organizationId },
        orderBy: { createdAt: 'desc' },
        include: { user: true, service: true }
    });

    const services = await prisma.medicalService.findMany({
        where: { organizationId: session.organizationId, isActive: true },
        orderBy: { name: 'asc' }
    });

    return <DoctorClientView doctors={doctors} services={services} />;
}
