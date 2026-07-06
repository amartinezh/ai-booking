import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import EnrollmentRequestForm from './EnrollmentRequestForm';

// Página PÚBLICA: el chatbot remite aquí a los pacientes cuya cédula no está
// en el padrón EPS. No debe cachearse (el estado de la organización manda).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
    title: 'Solicitud de alta EPS',
    robots: { index: false, follow: false },
};

export default async function SolicitudAltaPage(props: {
    params: Promise<{ orgId: string }>;
}) {
    const { orgId } = await props.params;

    // Mismo patrón server-side que la encuesta: si la organización no existe
    // o está suspendida, no se renderiza nada → al Home.
    const organization = orgId
        ? await prisma.organization.findUnique({
              where: { id: orgId },
              select: { id: true, name: true, isActive: true },
          })
        : null;

    if (!organization || !organization.isActive) {
        redirect('/');
    }

    // EPS activas de la clínica para que el ciudadano indique la suya.
    const epsList = await prisma.eps.findMany({
        where: { organizationId: organization.id, isActive: true, name: { not: 'Particular' } },
        select: { name: true },
        orderBy: { name: 'asc' },
    });

    return (
        <EnrollmentRequestForm
            orgId={organization.id}
            clinicName={organization.name}
            epsNames={epsList.map((eps) => eps.name)}
        />
    );
}
