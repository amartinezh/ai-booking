import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { DEFAULT_TIMEZONE } from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { accesoValido } from '@/lib/estadisticas/acceso';
import { ACCESO_ESTADISTICAS, esIdDeClinica } from '@/lib/estadisticas/clave';
import { estadisticasDelCorte } from '@/lib/estadisticas/consultas';
import { armarInforme } from '@/lib/estadisticas/informe';
import { corteDeEstadisticas } from '@/lib/estadisticas/periodo';
import FormularioClave from './FormularioClave';
import Informe from './Informe';

// Página PÚBLICA (2026-10-26): las estadísticas de la clínica para compartir, sin
// datos de pacientes, detrás de la clave que pone el administrador en
// Configuración › Estadísticas. Sin clave guardada, la página no existe (404).
// Las cifras se recalculan una vez al día (lib/estadisticas/periodo.ts); lo que
// depende de la visita (la cookie) no se cachea.
export const dynamic = 'force-dynamic';

export const metadata = {
    title: 'Estadísticas de AgenIA',
    robots: { index: false, follow: false },
};

export default async function EstadisticasPage(props: { params: Promise<{ organizationId: string }> }) {
    const { organizationId } = await props.params;
    if (!esIdDeClinica(organizationId)) notFound();

    const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
            name: true,
            isActive: true,
            timezone: true,
            settings: { select: { publicStatsKeyHash: true } },
            hospitalMirrorConfig: { select: { enabled: true } },
        },
    });
    const hash = org?.settings?.publicStatsKeyHash;
    if (!org || !org.isActive || !hash) notFound();

    const cookie = (await cookies()).get(ACCESO_ESTADISTICAS.COOKIE)?.value;
    if (!accesoValido(cookie, organizationId, hash)) {
        return <FormularioClave organizationId={organizationId} clinica={org.name} />;
    }

    const timeZone = org.timezone || DEFAULT_TIMEZONE;
    const corte = corteDeEstadisticas(new Date(), timeZone);
    const informe = armarInforme(await estadisticasDelCorte(organizationId, corte, timeZone), corte, {
        conHospital: org.hospitalMirrorConfig?.enabled === true,
    });

    if (!informe) {
        return (
            <main className="min-h-screen bg-[#f4f6f9] text-[#101a2a] flex items-center justify-center px-4">
                <p className="max-w-md text-center text-[#586378]">
                    Todavía no hay estadísticas de {org.name}: aparecen el día siguiente al primer recordatorio o mensaje.
                </p>
            </main>
        );
    }
    return <Informe informe={informe} clinica={org.name} organizationId={organizationId} />;
}
