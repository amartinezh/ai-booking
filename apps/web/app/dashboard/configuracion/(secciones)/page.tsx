import Link from 'next/link';
import { redirect } from 'next/navigation';
import { diaLocal, limitesDeLaClinica } from '@agenia/shared';
import { getMyOrgSettings } from '@/app/actions/settings';
import { obtenerBloqueosAgenda } from '@/app/actions/bloqueos-agenda';
import { getMyKnowledgeBase } from '@/app/actions/knowledge-base';
import { getMyAiConfig } from '@/app/actions/ai-config';
import { getMyWhatsappConfig } from '@/app/actions/whatsapp-config';
import { getMyTelegramConfig } from '@/app/actions/telegram-config';
import { getMyAudioConfig } from '@/app/actions/audio-config';
import { getMyPaginaPoliticaDatos } from '@/app/actions/politica-datos';
import { prisma } from '@/lib/prisma';
import { getTenantMirrorFlags } from '@/lib/mirror-flags';
import { resolverActorBandeja } from '@/lib/bandeja/acceso';
import { estadoAvisos } from '@/lib/bandeja/avisos';
import {
    AVISO_DE_LAS_PESTANAS_HASTA,
    armarResumen,
    destinoDePestanaVieja,
    type DatosDelResumen,
    type EstadoFila,
} from '@/lib/configuracion/resumen';
import { exigirAdministrador } from '../comunes';

export const dynamic = 'force-dynamic';

const valor = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

const PUNTO: Record<EstadoFila, string> = {
    encendido: 'bg-emerald-500',
    apagado: 'bg-zinc-300 dark:bg-zinc-600',
    falta: 'bg-amber-500',
    neutro: '',
};

/**
 * 🏠 El Resumen de Configuración (docs/PLAN_NAVEGACION.md §5.1): qué está
 * encendido y qué falta, de un vistazo, con un enlace al ajuste exacto. Solo lee
 * lo que ya existe; cada lectura va aislada y, si una falla, su línea lo dice.
 * También recibe las pestañas de antes (`?tab=…`) y las manda a su sección.
 */
export default async function ResumenDeConfiguracionPage({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const { tab } = await searchParams;
    const destino = destinoDePestanaVieja(tab);
    if (destino) redirect(destino);

    const session = await exigirAdministrador();
    const organizationId = session.organizationId!;
    const banderas = await getTenantMirrorFlags(organizationId);

    const actorBandeja = banderas.conEspejo ? await resolverActorBandeja(prisma, session) : null;
    const [ajustes, limites, bloqueos, base, ia, whatsapp, telegram, voz, pagina, espejo, org, avisosAgendadores, alertas] = await Promise.allSettled([
        getMyOrgSettings(),
        prisma.organizationSettings.findUnique({
            where: { organizationId },
            select: {
                dailyAppointmentLimitEnabled: true,
                maxAppointmentsPerDay: true,
                monthlyAppointmentLimitEnabled: true,
                maxAppointmentsPerMonth: true,
            },
        }),
        obtenerBloqueosAgenda(),
        getMyKnowledgeBase(),
        getMyAiConfig(),
        getMyWhatsappConfig(),
        getMyTelegramConfig(),
        getMyAudioConfig(),
        getMyPaginaPoliticaDatos(),
        banderas.conEspejo
            ? prisma.hospitalMirrorConfig.findUnique({
                  where: { organizationId },
                  select: { enabled: true, autoHomologateDoctors: true, autoHomologateWhatsappOn: true, availabilityMode: true },
              })
            : Promise.resolve(null),
        prisma.organization.findUnique({ where: { id: organizationId }, select: { supportPhone: true, timezone: true } }),
        actorBandeja?.ok ? estadoAvisos(prisma, actorBandeja.actor) : Promise.resolve(null),
        // 🚑 Quién recibe la alerta de posible emergencia y si la plantilla está lista.
        Promise.all([
            prisma.emergencyAlertRecipient.count({ where: { organizationId, isActive: true } }),
            prisma.whatsappTemplate.count({ where: { organizationId, kind: 'EMERGENCY_ALERT', isActive: true } }),
        ]),
    ]);

    const s = valor(ajustes);
    const b = valor(bloqueos);
    const e = valor(espejo);
    const o = valor(org);
    const av = valor(avisosAgendadores);
    const datos: DatosDelResumen = {
        ajustes: s,
        limites: limites.status === 'fulfilled' ? limitesDeLaClinica(limites.value) : null,
        bloqueos: b && b.success ? b.bloqueos.length : null,
        baseDeConocimiento: valor(base),
        ia: valor(ia),
        whatsapp: valor(whatsapp),
        telegram: valor(telegram),
        voz: valor(voz),
        politicaPublicada: valor(pagina)?.publicada ?? null,
        hospital: !banderas.conEspejo
            ? undefined
            : espejo.status === 'rejected' || !e
              ? null
              : {
                    encendido: e.enabled,
                    auto: e.autoHomologateDoctors,
                    whatsappOn: e.autoHomologateWhatsappOn,
                    modoAgenda: e.availabilityMode,
                    avisos: av?.success ? { salen: av.data.salen, personas: av.data.cobertura.personas } : null,
                },
        telefonoSoporte: org.status === 'fulfilled' ? (o?.supportPhone?.trim() || null) : undefined,
        alertasEmergencia:
            alertas.status === 'fulfilled' ? { personas: alertas.value[0], plantilla: alertas.value[1] > 0 } : null,
    };
    const { avisos, bloques } = armarResumen(datos);
    const mostrarDondeQuedo = diaLocal(new Date(), o?.timezone || undefined) < AVISO_DE_LAS_PESTANAS_HASTA;

    return (
        <div className="space-y-6">
            <header>
                <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                    <span aria-hidden="true">🏠</span> Resumen
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Qué está encendido y qué falta. Cada línea lleva al ajuste para cambiarlo.
                </p>
            </header>

            {avisos.length > 0 && (
                <ul aria-label="Lo que falta" className="space-y-2">
                    {avisos.map((a) => (
                        <li
                            key={a.texto}
                            className="flex flex-col gap-1 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                        >
                            <span>⚠️ {a.texto}</span>
                            <Link href={a.href} className="shrink-0 font-semibold underline-offset-2 hover:underline">
                                {a.enlace} →
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {mostrarDondeQuedo && (
                <p className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-200">
                    ℹ️ Configuración ya no va en pestañas. Lo de «Asistente Virtual» quedó repartido en Qué puede hacer el
                    asistente, Agenda que ofrece el asistente, Recordatorios, Nombre, tono y voz, y Privacidad; «Días sin
                    citas» está en Agenda que ofrece el asistente; «Integraciones», en Canales e IA; y «Estadísticas», en{' '}
                    <Link href="/dashboard/analytics#compartir" className="font-semibold underline">
                        Analíticas
                    </Link>
                    .
                </p>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
                {bloques.map((bloque) => (
                    <section
                        key={bloque.titulo}
                        aria-labelledby={`resumen-${bloque.href.split('/').pop()}`}
                        className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                    >
                        <h3 id={`resumen-${bloque.href.split('/').pop()}`} className="mb-3">
                            <Link
                                href={bloque.href}
                                className="flex items-center justify-between gap-2 font-semibold text-zinc-900 hover:text-blue-700 dark:text-white dark:hover:text-blue-300"
                            >
                                <span>
                                    <span aria-hidden="true">{bloque.icono}</span> {bloque.titulo}
                                </span>
                                <span aria-hidden="true" className="text-zinc-400">
                                    →
                                </span>
                            </Link>
                        </h3>
                        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {bloque.filas.map((f) => (
                                <li key={f.nombre}>
                                    <Link
                                        href={f.href}
                                        className="flex items-baseline justify-between gap-3 py-2 text-sm hover:text-blue-700 dark:hover:text-blue-300"
                                    >
                                        <span className="text-zinc-600 dark:text-zinc-400">{f.nombre}</span>
                                        <span className="flex items-center gap-2 text-right font-medium text-zinc-900 dark:text-white">
                                            {PUNTO[f.estado] && (
                                                <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${PUNTO[f.estado]}`} />
                                            )}
                                            {f.valor}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}
