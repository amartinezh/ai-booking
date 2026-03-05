import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';
import UserClientView from './UserClientView';

export const dynamic = 'force-dynamic';

export default async function UsuariosPage() {
    const session = await getSession();

    // Solo permitimos el acceso a administradores
    if (!session || session.role !== 'ADMIN') {
        redirect('/dashboard');
    }

    const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
            patientProfile: true,
            doctorProfile: true
        }
    });

    return <UserClientView users={users} />;
}
