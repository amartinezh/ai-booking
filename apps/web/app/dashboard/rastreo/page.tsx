import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { permisosDeRol } from '@/lib/rastreo/acceso';
import { getTenantMirrorFlags } from '@/lib/mirror-flags';
import RastreoClient from './RastreoClient';

/**
 * Rastreo de paciente para los roles de una clínica (ORG_ADMIN, BOOKING_AGENT y
 * DOCTOR). Este `redirect` es solo cortesía: quien de verdad decide qué se puede
 * hacer es el servidor en cada acción (`lib/rastreo/acceso.ts`).
 * SUPER_ADMIN tiene su propia ruta en /super-admin/rastreo.
 */
export default async function RastreoPage() {
    const session = await getSession();
    const permisos = permisosDeRol(session?.role);
    if (!session || !session.organizationId || !permisos.buscar || session.role === 'SUPER_ADMIN') {
        redirect('/dashboard');
    }

    const { conEspejo } = await getTenantMirrorFlags(session.organizationId);

    return (
        <div className="p-2 md:p-4">
            <RastreoClient
                esSuperAdmin={false}
                conEspejo={conEspejo}
                puedeModoB={permisos.modoB}
                hrefConsultas={permisos.verConsultas ? '/dashboard/rastreo/consultas' : null}
            />
        </div>
    );
}
