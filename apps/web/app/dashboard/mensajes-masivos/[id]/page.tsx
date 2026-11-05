import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { puedeUsarMensajesMasivos } from '@/lib/mensajes-masivos/acceso';
import { seguimientoDelEnvio } from '@/app/actions/mensajes-masivos';
import SeguimientoEnvio from '../components/SeguimientoEnvio';

export const dynamic = 'force-dynamic';

/** 📢 Seguimiento de un envío de Mensajes masivos (docs/PLAN_MENSAJES_MASIVOS.md §8.4). */
export default async function SeguimientoPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) redirect('/login');
    if (!puedeUsarMensajesMasivos(session)) redirect('/dashboard');
    const { id } = await params;
    const r = await seguimientoDelEnvio(id);
    if (!r.success) notFound();
    if (r.seguimiento.envio.estado === 'BORRADOR') redirect(`/dashboard/mensajes-masivos?borrador=${id}`);
    return (
        <div className="mx-auto max-w-7xl animate-fade-in space-y-4">
            <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-white">📢 {r.seguimiento.envio.nombre}</h1>
            <SeguimientoEnvio id={id} inicial={r.seguimiento} />
        </div>
    );
}
