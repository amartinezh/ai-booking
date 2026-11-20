import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';
import PatientClientView from './PatientClientView';
import { autorizacionesDePacientes } from '../../../lib/autorizacion-datos/pacientes';

export const dynamic = 'force-dynamic';

export default async function PacientesPage() {
    const session = await getSession();

    // Solo permitimos el acceso a administradores de clínica (con tenant).
    if (!session?.organizationId || session.role !== 'ORG_ADMIN') {
        redirect('/dashboard');
    }

    const patients = await prisma.patientProfile.findMany({
        where: { organizationId: session.organizationId },
        orderBy: { createdAt: 'desc' },
        include: { user: true }
    });

    // 🔒 La autorización de datos con que cada paciente se registró por el chat
    // (docs/PLAN_AUTORIZACION_DATOS.md). Si falla, el directorio sale igual.
    let autorizaciones: ReturnType<typeof autorizacionesDePacientes> = {};
    try {
        const [aceptadas, retiros] = await Promise.all([
            prisma.dataConsent.findMany({
                where: { organizationId: session.organizationId, status: 'ACCEPTED', NOT: { patientIds: { isEmpty: true } } },
                select: { patientIds: true, senderKey: true, channel: true, policyVersion: true, answeredAt: true },
            }),
            prisma.dataConsent.findMany({
                where: { organizationId: session.organizationId, status: 'REVOKED' },
                select: { senderKey: true, answeredAt: true },
            }),
        ]);
        autorizaciones = autorizacionesDePacientes(aceptadas, retiros);
    } catch (e) {
        console.error('[pacientes] no se pudieron cargar las autorizaciones de datos', e);
    }

    return <PatientClientView patients={patients} autorizaciones={autorizaciones} />;
}
