import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMyHomologacionAutomatica } from '@/app/actions/settings';
import { prisma } from '@/lib/prisma';
import { getTenantMirrorFlags } from '@/lib/mirror-flags';
import { resolverActorBandeja } from '@/lib/bandeja/acceso';
import { estadoAvisos } from '@/lib/bandeja/avisos';
import PanelAvisos from '@/app/dashboard/bandeja/PanelAvisos';
import HomologacionAutomatica from '../../HomologacionAutomatica';
import ModoAgendaSetting from '../../ModoAgendaSetting';
import { Ajuste, Seccion, SectionLoadError, Separador, exigirAdministrador, motivoDelFallo } from '../../comunes';

export const dynamic = 'force-dynamic';

/**
 * 🏥 Hospital (espejo): solo en las clínicas con espejo. Aquí se configuran el
 * modo de agenda (antes, botones en el Espejo), los avisos a los agendadores
 * (antes, «Configurar avisos» en la Bandeja) y los médicos nuevos del hospital
 * (docs/PLAN_NAVEGACION.md, Fases 2 y 3). El Espejo y la Bandeja siguen mostrando
 * cómo está cada uno, con el enlace hasta aquí. El resumen de la atención y la
 * lista de los avisos masivos siguen en su pantalla (N8): desde aquí se llega.
 * Cada lectura va aislada: si una falla, lo demás se muestra igual.
 */
export default async function HospitalPage() {
    const session = await exigirAdministrador();
    const banderas = await getTenantMirrorFlags(session.organizationId);
    if (!banderas.conEspejo) redirect('/dashboard/configuracion');

    const actor = await resolverActorBandeja(prisma, session);
    const [homologacion, espejo, avisos] = await Promise.allSettled([
        getMyHomologacionAutomatica(),
        prisma.hospitalMirrorConfig.findUnique({
            where: { organizationId: session.organizationId! },
            select: { enabled: true, availabilityMode: true },
        }),
        actor.ok ? estadoAvisos(prisma, actor.actor) : Promise.reject(new Error(actor.error)),
    ]);
    const encendido = espejo.status === 'fulfilled' && espejo.value?.enabled === true;

    const enOtraPantalla = [
        ...(banderas.conResumen
            ? [
                  {
                      id: 'resumen-atencion',
                      titulo: 'Resumen de la atención',
                      texto: 'Leer del hospital los documentos de la consulta y enviárselos al paciente: los interruptores, el piloto y la revisión.',
                      href: '/dashboard/espejo/resumen-atencion',
                      enlace: 'Abrir Resumen de la atención →',
                  },
              ]
            : []),
        ...(banderas.conAvisosDriver
            ? [
                  {
                      id: 'avisos-masivos',
                      titulo: 'Lista de los avisos masivos',
                      texto: 'Cómo se arma la lista de pacientes de un aviso o recordatorio para el día de agenda de un especialista.',
                      href: '/dashboard/espejo/avisos',
                      enlace: 'Abrir Avisos masivos →',
                  },
              ]
            : []),
    ];

    return (
        <Seccion
            titulo="Hospital (espejo)"
            icono="🏥"
            descripcion="Lo que se configura de la conexión con el sistema del hospital (HIS). Cómo está el agente, la cola y los eventos se ve en Espejo con el HIS."
        >
            <Ajuste id="modo-agenda">
                {espejo.status === 'fulfilled' && espejo.value ? (
                    <ModoAgendaSetting inicial={espejo.value.availabilityMode} />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar el modo de agenda"
                        detail={espejo.status === 'rejected' ? motivoDelFallo(espejo.reason, 'Error desconocido.') : null}
                    />
                )}
            </Ajuste>
            <Separador />
            <Ajuste id="avisos-agendadores">
                <section className="space-y-4">
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Avisos a los agendadores</h2>
                        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                            A quiénes les llega por WhatsApp el aviso de una cita que no llegó al hospital o de un pedido de
                            un paciente, y a qué horas. Los casos se atienden en la{' '}
                            <Link href="/dashboard/bandeja" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                                Bandeja de sincronización
                            </Link>
                            .
                        </p>
                    </div>
                    {avisos.status === 'fulfilled' && avisos.value.success ? (
                        <PanelAvisos avisos={avisos.value.data} puedeConfigurar={actor.ok && actor.actor.permisos.configurarAvisos} enConfiguracion />
                    ) : (
                        <SectionLoadError
                            title="No pudimos cargar los avisos a los agendadores"
                            detail={
                                avisos.status === 'rejected'
                                    ? motivoDelFallo(avisos.reason, 'Error desconocido.')
                                    : avisos.value.success
                                      ? null
                                      : avisos.value.error
                            }
                        />
                    )}
                </section>
            </Ajuste>
            <Separador />
            <Ajuste id="medicos-nuevos">
                {homologacion.status === 'rejected' ? (
                    <SectionLoadError
                        title="No pudimos cargar los médicos nuevos del hospital"
                        detail={motivoDelFallo(homologacion.reason, 'Error desconocido.')}
                    />
                ) : homologacion.value.espejo ? (
                    <HomologacionAutomatica auto={homologacion.value.auto} whatsappOn={homologacion.value.whatsappOn} />
                ) : (
                    <p className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                        El espejo con el hospital está {encendido ? 'encendido' : 'apagado'}: «Agregar solos los médicos nuevos
                        del hospital» aparece cuando está encendido.{' '}
                        <Link href="/dashboard/espejo" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                            Ver Espejo con el HIS →
                        </Link>
                    </p>
                )}
            </Ajuste>
            {enOtraPantalla.map((c) => (
                <div key={c.id} className="space-y-12">
                    <Separador />
                    <Ajuste id={c.id}>
                        <section>
                            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{c.titulo}</h2>
                            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{c.texto}</p>
                            <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
                                <p className="font-semibold text-zinc-900 dark:text-white">Se configura en su pantalla</p>
                                <Link href={c.href} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                                    {c.enlace}
                                </Link>
                            </div>
                        </section>
                    </Ajuste>
                </div>
            ))}
        </Seccion>
    );
}
