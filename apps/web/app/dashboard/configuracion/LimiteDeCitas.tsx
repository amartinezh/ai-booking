import Link from 'next/link';
import { limitesDeLaClinica } from '@agenia/shared';
import { prisma } from '@/lib/prisma';
import { formatAppointmentCompact } from '@/lib/date';
import LimitesCitasForm from './LimitesCitasForm';
import { SectionLoadError } from './comunes';

const DIAS_RESUMEN = 30;

/** Inicio de la ventana del resumen; fuera del render, como pide la regla de pureza de React. */
function inicioDelResumen(): Date {
    return new Date(Date.now() - DIAS_RESUMEN * 24 * 60 * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────
// 🚦 LÍMITE DE CITAS POR PACIENTE — cuántas citas puede tener un paciente el
// mismo día y en el mismo mes por el asistente (WhatsApp y Telegram). Lo
// configura solo ORG_ADMIN (2026-10-22). Pasado el límite, el asistente se
// disculpa, remite al teléfono del hospital y ofrece pedir una revisión
// (/dashboard/solicitudes-citas). La regla: @agenia/shared limite-citas.ts.
// Antes era su propia pantalla (/dashboard/limites-citas, que ahora redirige
// aquí: docs/PLAN_NAVEGACION.md, N5).
// ─────────────────────────────────────────────────────────────
export default async function LimiteDeCitas({ organizationId }: { organizationId: string }) {
    const desde = inicioDelResumen();
    let datos;
    try {
        datos = await Promise.all([
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
    } catch (e) {
        console.error('[configuracion] Límite de citas load failed:', e);
        return (
            <SectionLoadError
                title="No pudimos cargar el límite de citas por paciente"
                detail={e instanceof Error ? e.message : null}
            />
        );
    }
    const [settings, org, frenos, radicadas, pendientes] = datos;
    const limites = limitesDeLaClinica(settings);

    return (
        <section className="space-y-6">
            <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">🚦 Límite de citas por paciente</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Cuántas citas puede tener un mismo paciente por el asistente. Si ya tiene el máximo, el asistente no
                    le agenda otra, le pide disculpas, le da el teléfono del hospital y le ofrece pedir una revisión en{' '}
                    <Link href="/dashboard/solicitudes-citas" className="font-medium text-teal-600 hover:underline">
                        Solicitudes de más citas
                    </Link>
                    .
                </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                    ⚠️ La clínica no tiene un teléfono de soporte configurado: el asistente le dirá al paciente que se
                    comunique «con el hospital», sin número.{' '}
                    <Link href="/dashboard/configuracion/clinica#telefono" className="font-semibold underline">
                        Escribirlo en Datos de la clínica
                    </Link>
                    .
                </div>
            )}

            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
                <LimitesCitasForm initial={limites} telefonoHospital={org?.supportPhone ?? null} />
            </div>

            <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                <h3 className="font-bold text-zinc-900 dark:text-white">Cómo se cuenta</h3>
                <ul className="list-disc space-y-1 pl-5">
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
                    <li>Una solicitud aprobada le da al paciente citas adicionales solo para ese día o ese mes.</li>
                </ul>
                {settings?.appointmentLimitsUpdatedAt && (
                    <p className="pt-2 text-xs text-zinc-400">
                        Último cambio: {formatAppointmentCompact(settings.appointmentLimitsUpdatedAt)}
                        {settings.appointmentLimitsUpdatedBy ? ` por ${settings.appointmentLimitsUpdatedBy}` : ''}.
                    </p>
                )}
            </div>
        </section>
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
            className={`h-full rounded-2xl border p-5 ${
                resaltar
                    ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-900/20'
                    : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
            }`}
        >
            <p className="text-3xl font-extrabold text-zinc-900 dark:text-white">
                {new Intl.NumberFormat('es-CO').format(valor)}
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{titulo}</p>
            <p className="mt-0.5 text-xs text-zinc-400">{detalle}</p>
        </div>
    );
}
