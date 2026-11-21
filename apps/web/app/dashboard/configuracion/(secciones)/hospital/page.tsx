import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMyHomologacionAutomatica } from '@/app/actions/settings';
import { prisma } from '@/lib/prisma';
import { getTenantMirrorFlags } from '@/lib/mirror-flags';
import HomologacionAutomatica from '../../HomologacionAutomatica';
import { Ajuste, Seccion, SectionLoadError, Separador, exigirAdministrador, motivoDelFallo } from '../../comunes';

export const dynamic = 'force-dynamic';

const MODO_AGENDA: Record<string, string> = {
    OFF: 'OFF: la agenda es la de AgenIA',
    SHADOW: 'SHADOW: se compara con la del hospital, sin escribir nada',
    ON: 'ON: la agenda es la del hospital',
};

/**
 * 🏥 Hospital (espejo): solo en las clínicas con espejo. Los médicos nuevos del
 * hospital se configuran aquí; el modo de agenda, los avisos a los agendadores,
 * el resumen de la atención y los avisos masivos siguen en su pantalla, y desde
 * aquí se llega a ellos (la Fase 3 de docs/PLAN_NAVEGACION.md trae los dos primeros).
 */
export default async function HospitalPage() {
    const session = await exigirAdministrador();
    const banderas = await getTenantMirrorFlags(session.organizationId);
    if (!banderas.conEspejo) redirect('/dashboard/configuracion');

    const [homologacion, espejo] = await Promise.allSettled([
        getMyHomologacionAutomatica(),
        prisma.hospitalMirrorConfig.findUnique({
            where: { organizationId: session.organizationId! },
            select: { enabled: true, availabilityMode: true },
        }),
    ]);
    const encendido = espejo.status === 'fulfilled' && espejo.value?.enabled === true;
    const modo = espejo.status === 'fulfilled' ? (espejo.value?.availabilityMode ?? null) : null;

    const enOtraPantalla: { id: string; titulo: string; valor: string | null; texto: string; href: string; enlace: string }[] = [
        {
            id: 'modo-agenda',
            titulo: 'Modo de agenda',
            valor: modo ? (MODO_AGENDA[modo] ?? modo) : null,
            texto: 'OFF → SHADOW → ON. El paso a ON es una decisión de negocio: se toma después de comparar en SHADOW durante al menos una semana.',
            href: '/dashboard/espejo',
            enlace: 'Cambiarlo en Espejo con el HIS →',
        },
        {
            id: 'avisos-agendadores',
            titulo: 'Avisos a los agendadores',
            valor: null,
            texto: 'A quiénes les llega por WhatsApp el aviso de una cita que no llegó al hospital o de un pedido de un paciente, y a qué horas.',
            href: '/dashboard/bandeja',
            enlace: 'Configurarlos en la Bandeja › Configurar avisos →',
        },
        ...(banderas.conResumen
            ? [
                  {
                      id: 'resumen-atencion',
                      titulo: 'Resumen de la atención',
                      valor: null,
                      texto: 'Leer del hospital los documentos de la consulta y enviárselos al paciente.',
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
                      valor: null,
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
            descripcion="Lo que se configura de la conexión con el sistema del hospital (HIS)."
        >
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
                                <p className="font-semibold text-zinc-900 dark:text-white">{c.valor ?? 'Se configura en su pantalla'}</p>
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
