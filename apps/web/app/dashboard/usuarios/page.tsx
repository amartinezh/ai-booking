import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';
import UserClientView from './UserClientView';

export const dynamic = 'force-dynamic';

export default async function UsuariosPage() {
    const session = await getSession();

    // Solo permitimos el acceso a administradores
    if (!session || session.role !== 'ORG_ADMIN') {
        redirect('/dashboard');
    }

    const users = await prisma.user.findMany({
        where: { organizationId: session.organizationId, role: { not: 'SUPER_ADMIN' } },
        orderBy: { createdAt: 'desc' },
        include: {
            patientProfile: true,
            doctorProfile: true,
            agentProfile: {
                include: {
                    eps: true,
                    doctor: true
                }
            }
        }
    });

    const epsList = await prisma.eps.findMany({ where: { organizationId: session.organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const doctorList = await prisma.doctorProfile.findMany({ where: { organizationId: session.organizationId }, select: { id: true, fullName: true, cedula: true }, orderBy: { fullName: 'asc' } });

    return <UserClientView users={users} epsList={epsList} doctorList={doctorList} />;
}
