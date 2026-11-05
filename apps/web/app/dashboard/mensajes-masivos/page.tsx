import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { puedeUsarMensajesMasivos } from '@/lib/mensajes-masivos/acceso';
import { estadoMensajesMasivos, listarEnvios, listarListas, verBorrador } from '@/app/actions/mensajes-masivos';
import MensajesMasivosClient from './components/MensajesMasivosClient';

export const dynamic = 'force-dynamic';

// ─────────────────────────────────────────────────────────────
// 📢 MENSAJES MASIVOS — comunicados de la clínica por WhatsApp a una lista de
// contactos o a sus pacientes. Solo ORG_ADMIN. Ver docs/PLAN_MENSAJES_MASIVOS.md.
// ─────────────────────────────────────────────────────────────
export default async function MensajesMasivosPage({ searchParams }: { searchParams: Promise<{ borrador?: string }> }) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (!puedeUsarMensajesMasivos(session)) redirect('/dashboard');
    const { borrador } = await searchParams;

    const [org, listas, envios, eps, pacientesConWhatsapp, estado, retomado] = await Promise.all([
        prisma.organization.findUnique({ where: { id: session.organizationId }, select: { name: true } }),
        listarListas(),
        listarEnvios(),
        prisma.eps.findMany({ where: { organizationId: session.organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.patientProfile.count({ where: { organizationId: session.organizationId, whatsappId: { not: null } } }),
        estadoMensajesMasivos(),
        borrador ? verBorrador(borrador) : Promise.resolve(null),
    ]);

    return (
        <div className="mx-auto max-w-7xl animate-fade-in space-y-6">
            <header>
                <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white">📢 Mensajes masivos</h1>
                <p className="max-w-3xl text-lg leading-relaxed text-zinc-500 dark:text-zinc-400">
                    Comunicados de la clínica por WhatsApp: jornadas, cambios de horario, campañas de salud. Importe sus contactos (o use sus
                    pacientes), escriba el mensaje, agregue una imagen si quiere, revíselo y envíelo. Cada paso se revisa antes de que salga.
                </p>
            </header>
            <MensajesMasivosClient
                clinica={org?.name ?? 'Clínica'}
                listas={listas.success ? listas.listas : []}
                envios={envios.success ? envios.envios : []}
                eps={eps.map((e) => ({ id: e.id, nombre: e.name }))}
                pacientesConWhatsapp={pacientesConWhatsapp}
                estado={estado.success ? estado.estado : null}
                errorEstado={estado.success ? null : estado.error}
                borradorInicial={retomado && retomado.success ? retomado.borrador : null}
            />
        </div>
    );
}
