import Link from 'next/link';
import { limitesDeLaClinica } from '@agenia/shared';
import { getMyOrgSettings } from '@/app/actions/settings';
import { prisma } from '@/lib/prisma';
import { textoLimites } from '@/lib/configuracion/resumen';
import BookingToggle from '../../BookingToggle';
import CancelToggle from '../../CancelToggle';
import RescheduleToggle from '../../RescheduleToggle';
import { Ajuste, Seccion, SectionLoadError, Separador, exigirAdministrador, motivoDelFallo } from '../../comunes';

export const dynamic = 'force-dynamic';

/** 🤖 Qué puede hacer el asistente: agendar, cancelar y cambiar la fecha, y el límite de citas por paciente. */
export default async function QuePuedeHacerPage() {
    const session = await exigirAdministrador();
    const [ajustes, limites] = await Promise.allSettled([
        getMyOrgSettings(),
        prisma.organizationSettings.findUnique({
            where: { organizationId: session.organizationId! },
            select: {
                dailyAppointmentLimitEnabled: true,
                maxAppointmentsPerDay: true,
                monthlyAppointmentLimitEnabled: true,
                maxAppointmentsPerMonth: true,
            },
        }),
    ]);

    return (
        <Seccion
            titulo="Qué puede hacer el asistente"
            icono="🤖"
            descripcion="Lo que el paciente puede hacer por WhatsApp o Telegram. Cada interruptor se guarda al instante y aplica desde el siguiente mensaje."
        >
            {ajustes.status === 'fulfilled' ? (
                <>
                    <Ajuste id="agendar">
                        <BookingToggle initialEnabled={ajustes.value.bookingEnabled} />
                    </Ajuste>
                    <Separador />
                    <Ajuste id="cancelar">
                        <CancelToggle initialEnabled={ajustes.value.cancelEnabled} />
                    </Ajuste>
                    <Separador />
                    <Ajuste id="cambiar-fecha">
                        <RescheduleToggle initialEnabled={ajustes.value.rescheduleEnabled} />
                    </Ajuste>
                </>
            ) : (
                <SectionLoadError
                    title="No pudimos cargar los interruptores del asistente"
                    detail={motivoDelFallo(ajustes.reason, 'Error desconocido.')}
                />
            )}
            <Separador />
            <Ajuste id="limite">
                <section>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">🚦 Límite de citas por paciente</h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Cuántas citas puede tener un paciente el mismo día y en el mismo mes por el asistente. Pasado el
                        límite, el asistente se disculpa y le ofrece pedir una revisión.
                    </p>
                    <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
                        <p className="font-semibold text-zinc-900 dark:text-white">
                            {limites.status === 'fulfilled' ? textoLimites(limitesDeLaClinica(limites.value)) : 'No se pudo leer'}
                        </p>
                        <Link href="/dashboard/limites-citas" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                            Cambiar en Límite de citas →
                        </Link>
                    </div>
                </section>
            </Ajuste>
        </Seccion>
    );
}
