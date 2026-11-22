import Link from 'next/link';
import { CAMPOS_POLITICA } from '@/lib/politica-datos/datos';
import { getMyPaginaPoliticaDatos } from '@/app/actions/politica-datos';
import { prisma } from '@/lib/prisma';
import { cargarAlertasEmergencia } from '@/lib/configuracion/alertas-emergencia';
import TelefonoSoporteForm from '../../TelefonoSoporteForm';
import AlertasEmergenciaForm from '../../AlertasEmergenciaForm';
import { Ajuste, Seccion, SectionLoadError, Separador, exigirAdministrador, motivoDelFallo } from '../../comunes';

export const dynamic = 'force-dynamic';

/**
 * 🏢 Datos de la clínica (docs/PLAN_NAVEGACION.md, N9): el teléfono de soporte, que
 * cambia el administrador; quién recibe las alertas de posible emergencia
 * (docs/GUARDRAIL_EMERGENCIAS.md, 2026-11-22); el nombre y el logo, que los registra
 * el equipo de AgenIA; y los datos del responsable, que se editan con la página de la
 * política.
 */
export default async function DatosDeLaClinicaPage() {
    const session = await exigirAdministrador();
    const [org, pagina, alertas] = await Promise.allSettled([
        prisma.organization.findUnique({
            where: { id: session.organizationId! },
            select: { name: true, logoUrl: true, supportPhone: true, timezone: true },
        }),
        getMyPaginaPoliticaDatos(),
        cargarAlertasEmergencia(prisma, session.organizationId!),
    ]);
    const o = org.status === 'fulfilled' ? org.value : null;
    const responsable =
        pagina.status === 'fulfilled'
            ? CAMPOS_POLITICA.filter((d) => pagina.value.datos[d.campo]?.trim()).map((d) => ({
                  etiqueta: d.etiqueta,
                  valor: pagina.value.datos[d.campo],
              }))
            : null;

    return (
        <Seccion
            titulo="Datos de la clínica"
            icono="🏢"
            descripcion="El teléfono que el asistente les da a los pacientes, quién recibe las alertas de posible emergencia, el nombre y el logo, y los datos del responsable del tratamiento de datos."
        >
            <Ajuste id="telefono">
                {o ? (
                    <TelefonoSoporteForm inicial={o.supportPhone} />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar los datos de la clínica"
                        detail={org.status === 'rejected' ? motivoDelFallo(org.reason, 'Error desconocido.') : null}
                    />
                )}
            </Ajuste>
            <Separador />
            <Ajuste id="alertas-emergencia">
                {alertas.status === 'fulfilled' ? (
                    <AlertasEmergenciaForm
                        // Tras guardar, la página vuelve con los ids nuevos: se monta de nuevo.
                        key={alertas.value.personas.map((p) => `${p.id}:${p.phone}:${p.isActive}:${p.label}`).join('|')}
                        personas={alertas.value.personas}
                        plantilla={alertas.value.plantilla}
                        telefonoSoporte={o?.supportPhone ?? null}
                    />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar las alertas de posible emergencia"
                        detail={motivoDelFallo(alertas.reason, 'Error desconocido.')}
                    />
                )}
            </Ajuste>
            <Separador />
            <Ajuste id="nombre-logo">
                <section>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Nombre y logo</h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Los que se ven en el panel. Para cambiarlos, pídelo en{' '}
                        <Link href="/dashboard/soporte" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                            Soporte y ayuda
                        </Link>
                        .
                    </p>
                    <div className="mt-4 flex items-center gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                        {o?.logoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element -- el logo es una URL externa de cada clínica, igual que en el menú.
                            <img src={o.logoUrl} alt="" className="h-10 w-10 rounded-lg bg-white object-contain ring-1 ring-zinc-200 dark:ring-zinc-800" />
                        )}
                        <p className="font-semibold text-zinc-900 dark:text-white">{o?.name ?? 'No se pudo leer'}</p>
                    </div>
                </section>
            </Ajuste>
            <Separador />
            <Ajuste id="responsable">
                <section>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Responsable del tratamiento de datos</h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Los que aparecen en la página pública de la política de datos. Se editan junto con ella.
                    </p>
                    <div className="mt-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                        {responsable === null ? (
                            <p className="text-sm text-zinc-600 dark:text-zinc-300">No se pudo leer.</p>
                        ) : responsable.length === 0 ? (
                            <p className="text-sm text-zinc-600 dark:text-zinc-300">Todavía no están escritos.</p>
                        ) : (
                            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                                {responsable.map((d) => (
                                    <div key={d.etiqueta}>
                                        <dt className="text-zinc-500 dark:text-zinc-400">{d.etiqueta}</dt>
                                        <dd className="font-medium text-zinc-900 dark:text-white">{d.valor}</dd>
                                    </div>
                                ))}
                            </dl>
                        )}
                        <Link
                            href="/dashboard/configuracion/privacidad#politica"
                            className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                            Cambiarlos en Privacidad (Ley 1581) →
                        </Link>
                    </div>
                </section>
            </Ajuste>
        </Seccion>
    );
}
