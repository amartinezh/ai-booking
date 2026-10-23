import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';
import DoctorClientView from './DoctorClientView';
import { INCLUDE_MEDICO_VISTA } from '../../../lib/medicos/buscar';

export const dynamic = 'force-dynamic';

export default async function MedicosPage() {
    const session = await getSession();

    // Solo permitimos el acceso a administradores de clínica (con tenant).
    if (!session?.organizationId || session.role !== 'ORG_ADMIN') {
        redirect('/dashboard');
    }

    // Del usuario solo el correo: el registro completo lleva la clave cifrada y no
    // tiene por qué viajar al navegador (2026-10-23).
    const doctors = await prisma.doctorProfile.findMany({
        where: { organizationId: session.organizationId },
        orderBy: { createdAt: 'desc' },
        include: INCLUDE_MEDICO_VISTA,
    });

    // 🔎 El código de cada médico en el sistema del hospital (p. ej. «RU69»), para
    // mostrarlo y buscarlo. Solo existe si la clínica está conectada al hospital.
    const homologados = await prisma.mirrorEntityMap.findMany({
        where: { organizationId: session.organizationId, entityType: 'DOCTOR' },
        select: { agenIAId: true, externalKey: true },
    });
    const codigosHis = Object.fromEntries(homologados.map((h) => [h.agenIAId, h.externalKey]));

    const services = await prisma.medicalService.findMany({
        where: { organizationId: session.organizationId, isActive: true },
        orderBy: { name: 'asc' }
    });

    return <DoctorClientView doctors={doctors} services={services} codigosHis={codigosHis} />;
}
