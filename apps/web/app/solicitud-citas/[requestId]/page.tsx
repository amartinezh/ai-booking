import { redirect } from 'next/navigation';
import { etiquetaPeriodo } from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { esIdDeSolicitud } from '@/lib/limite-citas/validacion';
import LimitRequestForm from './LimitRequestForm';

// Página PÚBLICA: el asistente remite aquí al paciente que llegó al límite de
// citas del día o del mes. El `requestId` (UUID v4) es el token del enlace. No
// debe cachearse: lo que se muestra depende del estado actual de la solicitud.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
    title: 'Solicitud de más citas',
    robots: { index: false, follow: false },
};

export default async function SolicitudCitasPage(props: { params: Promise<{ requestId: string }> }) {
    const { requestId } = await props.params;

    // Mismo patrón que la encuesta: un enlace que no existe (o de una clínica
    // suspendida) no muestra nada → al Home.
    const solicitud = esIdDeSolicitud(requestId)
        ? await prisma.appointmentLimitRequest.findUnique({
              where: { id: requestId },
              select: {
                  id: true,
                  status: true,
                  expiresAt: true,
                  kind: true,
                  periodKey: true,
                  limitAtRequest: true,
                  countAtRequest: true,
                  fullName: true,
                  phone: true,
                  serviceName: true,
                  operation: true,
                  extraGranted: true,
                  organization: { select: { name: true, isActive: true, supportPhone: true, timezone: true } },
              },
          })
        : null;

    if (!solicitud || !solicitud.organization.isActive) {
        redirect('/');
    }

    const org = solicitud.organization;
    const estado =
        solicitud.status === 'INVITED'
            ? solicitud.expiresAt > new Date()
                ? 'FORMULARIO'
                : 'VENCIDA'
            : solicitud.status;

    return (
        <LimitRequestForm
            requestId={solicitud.id}
            estado={estado}
            clinicName={org.name}
            telefonoHospital={org.supportPhone}
            // Solo el primer nombre: el enlace puede reenviarse.
            primerNombre={solicitud.fullName.split(/\s+/)[0] ?? ''}
            tipo={solicitud.kind}
            periodo={etiquetaPeriodo(solicitud.kind, solicitud.periodKey, org.timezone ?? undefined)}
            limite={solicitud.limitAtRequest}
            citas={solicitud.countAtRequest}
            servicio={solicitud.serviceName}
            esCambio={solicitud.operation === 'RESCHEDULE'}
            telefonoInicial={solicitud.phone ?? ''}
            adicionalesConcedidas={solicitud.extraGranted}
        />
    );
}
