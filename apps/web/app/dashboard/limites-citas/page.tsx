import Link from 'next/link';
import { redirect } from 'next/navigation';
import { limitesDeLaClinica } from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { formatAppointmentCompact } from '@/lib/date';
import { puedeGestionarLimiteCitas } from '@/lib/limite-citas/acceso';
import LimitesCitasForm from './LimitesCitasForm';

export const dynamic = 'force-dynamic';

const DIAS_RESUMEN = 30;

/** Inicio de la ventana del resumen; fuera del render, como pide la regla de pureza de React. */
function inicioDelResumen(): Date {
    return new Date(Date.now() - DIAS_RESUMEN * 24 * 60 * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────
// LÍMITE DE CITAS POR PACIENTE — cuántas citas puede tener un paciente el
// mismo día y en el mismo mes por el asistente (WhatsApp y Telegram). Lo
// configuran ORG_ADMIN y BOOKING_AGENT. Pasado el límite, el asistente se
// disculpa, remite al teléfono del hospital y ofrece pedir una revisión
// (/dashboard/solicitudes-citas). La regla: @agenia/shared limite-citas.ts.
// ─────────────────────────────────────────────────────────────
export default async function LimitesCitasPage() {
    const session = await getSession();
    if (!session) redirect('/login');
    if (!puedeGestionarLimiteCitas(session)) redirect('/dashboard');

    const organizationId = session.organizationId;
    const desde = inicioDelResumen();

    const [settings, org, frenos, radicadas, pendientes] = await Promise.all([
        prisma.organizationSettings.findUnique({
            where: { organizationId },
            select: {
                dailyAppointmentLimitEnabled: true,
                maxAppointmentsPerDay: true,
                monthlyAppointmentLimitEnabled: true,
                maxAppointmentsPerMonth: true,
                appointmentLimitsUpdatedAt: true,
                appointmentLimitsUpdatedBy: true,
            },
        }),
        prisma.organization.findUnique({ where: { id: organizationId }, select: { supportPhone: true } }),
        prisma.interactionLog.count({
            where: { organizationId, failureReason: 'APPOINTMENT_LIMIT_REACHED', createdAt: { gte: desde } },
        }),
        prisma.appointmentLimitRequest.count({ where: { organizationId, submittedAt: { gte: desde } } }),
        prisma.appointmentLimitRequest.count({ where: { organizationId, status: 'PENDING' } }),
    ]);

    const limites = limitesDeLaClinica(settings);

    return (
        <div className="max-w-5xl mx-auto animate-fade-in space-y-8">
            <header>
                <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    🚦 Límite de citas
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
                    Cuántas citas puede tener un mismo paciente por el asistente virtual (WhatsApp y Telegram). Si ya
                    tiene el máximo, el asistente no le agenda otra, le pide disculpas, le da el teléfono del hospital y
                    le ofrece pedir una revisión en{' '}
                    <Link href="/dashboard/solicitudes-citas" className="text-teal-600 hover:underline font-medium">
                        Solicitudes de más citas
                    </Link>
                    .
                </p>
            </header>

            {/* Resumen de los últimos 30 días */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Cifra
                    valor={frenos}
                    titulo="Veces que se aplicó el límite"
                    detalle={`Últimos ${DIAS_RESUMEN} días, al agendar o cambiar una cita`}
                />
                <Cifra valor={radicadas} titulo="Solicitudes radicadas" detalle={`Últimos ${DIAS_RESUMEN} días`} />
                <Link href="/dashboard/solicitudes-citas" className="block">
                    <Cifra
                        valor={pendientes}
                        titulo="Pendientes por revisar"
                        detalle="Ir a Solicitudes de más citas →"
                        resaltar={pendientes > 0}
                    />
                </Link>
            </div>

            {!org?.supportPhone && (
                <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200">
                    ⚠️ La clínica no tiene un teléfono de soporte configurado: el asistente le dirá al paciente que se
                    comunique «con el hospital», sin número. Pídale a soporte de la plataforma que lo registre.
                </div>
            )}

            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 p-6 md:p-8">
                <LimitesCitasForm initial={limites} telefonoHospital={org?.supportPhone ?? null} />
            </div>

            <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-5 text-sm text-zinc-600 dark:text-zinc-300 space-y-2">
                <h2 className="font-bold text-zinc-900 dark:text-white">Cómo se cuenta</h2>
                <ul className="list-disc pl-5 space-y-1">
                    <li>
                        Por la <strong>fecha de la cita</strong>, no por el día en que se pidió: «una cita al día» es una cita
                        para el mismo día.
                    </li>
                    <li>
                        Cuentan todas las citas vigentes del paciente en la clínica (agendadas o atendidas), sin importar
                        quién las agendó: el asistente, el personal o el hospital. Las canceladas no cuentan.
                    </li>
                    <li>
                        Aplica al agendar, al aceptar un cupo de la lista de espera y al cambiar una cita de fecha por el
                        asistente. El personal agenda sin límite desde{' '}
                        <Link href="/dashboard/agendamiento" className="text-teal-600 hover:underline">
                            Agendamiento
                        </Link>
                        .
                    </li>
                    <li>
                        Una solicitud aprobada le da al paciente citas adicionales solo para ese día o ese mes.
                    </li>
                </ul>
                {settings?.appointmentLimitsUpdatedAt && (
                    <p className="text-xs text-zinc-400 pt-2">
                        Último cambio: {formatAppointmentCompact(settings.appointmentLimitsUpdatedAt)}
                        {settings.appointmentLimitsUpdatedBy ? ` por ${settings.appointmentLimitsUpdatedBy}` : ''}.
                    </p>
                )}
            </section>
        </div>
    );
}

function Cifra({
    valor,
    titulo,
    detalle,
    resaltar = false,
}: {
    valor: number;
    titulo: string;
    detalle: string;
    resaltar?: boolean;
}) {
    return (
        <div
            className={`rounded-2xl border p-5 h-full ${
                resaltar
                    ? 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
            }`}
        >
            <p className="text-3xl font-extrabold text-zinc-900 dark:text-white">
                {new Intl.NumberFormat('es-CO').format(valor)}
            </p>
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mt-1">{titulo}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{detalle}</p>
        </div>
    );
}
