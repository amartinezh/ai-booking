import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { normalizarVersionPolitica } from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { esIdDeClinica } from '@/lib/estadisticas/clave';
import { datosPublicables } from '@/lib/politica-datos/datos';
import { TITULO_POLITICA, documentoPolitica } from '@/lib/politica-datos/documento';
import Politica from './Politica';

// Página PÚBLICA (2026-11-20): la política de tratamiento de datos personales de
// la clínica (Ley 1581 de 2012), la que enlazan el asistente y los formularios.
// La identificación del responsable la escribe el administrador en Configuración
// › Asistente Virtual; mientras falte un dato obligatorio, la página no existe
// (404). Sin caché: lo que se corrija en Configuración se ve al instante.
export const dynamic = 'force-dynamic';

const cargarPolitica = cache(async (organizationId: string) => {
    if (!esIdDeClinica(organizationId)) return null;
    const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
            isActive: true,
            settings: { select: { botName: true, dataPolicyVersion: true, dataPolicyPage: true } },
        },
    });
    if (!org?.isActive) return null;
    const datos = datosPublicables(org.settings?.dataPolicyPage);
    if (!datos) return null;
    return documentoPolitica({
        datos,
        version: normalizarVersionPolitica(org.settings?.dataPolicyVersion),
        asistente: org.settings?.botName?.trim() || 'AgenIA',
    });
});

type Props = { params: Promise<{ organizationId: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
    const { organizationId } = await props.params;
    const documento = await cargarPolitica(organizationId);
    if (!documento) return { title: TITULO_POLITICA, robots: { index: false, follow: false } };
    return {
        title: `${TITULO_POLITICA} · ${documento.responsable}`,
        description: `Cómo ${documento.responsable} trata los datos personales de sus usuarios en sus canales digitales de atención (Ley 1581 de 2012).`,
    };
}

export default async function PoliticaDeDatosPage(props: Props) {
    const { organizationId } = await props.params;
    const documento = await cargarPolitica(organizationId);
    if (!documento) notFound();
    return <Politica documento={documento} />;
}
