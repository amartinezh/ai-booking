import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import RastreoClient from '@/app/dashboard/rastreo/RastreoClient';

/**
 * Rastreo de paciente para SUPER_ADMIN. No pertenece a ninguna clínica: elige
 * UNA (obligatorio) y cada consulta queda en la bitácora de esa clínica con su
 * rol. No existe la búsqueda entre organizaciones.
 */
export default async function SuperAdminRastreoPage() {
    const session = await getSession();
    if (session?.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const [organizaciones, espejos] = await Promise.all([
        prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.hospitalMirrorConfig.findMany({ select: { organizationId: true } }),
    ]);
    const conEspejo = new Set(espejos.map((e) => e.organizationId));

    return (
        <RastreoClient
            esSuperAdmin
            organizaciones={organizaciones.map((o) => ({ id: o.id, name: o.name, conEspejo: conEspejo.has(o.id) }))}
            conEspejo={false}
            puedeModoB
            hrefConsultas="/super-admin/rastreo/consultas"
        />
    );
}
