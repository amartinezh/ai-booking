import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getConfigAsistente } from '@/app/actions/support-bot';
import SoporteBotClient from './SoporteBotClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 🛟 Asistente de soporte por Telegram (docs/PLAN_BOT_SOPORTE.md §3.7). Solo
 * SUPER_ADMIN: el layout de /super-admin ya saca a los demás, y la página lo vuelve
 * a revisar porque la API es la que manda.
 */
export default async function SoporteBotPage() {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const [config, clinicas] = await Promise.all([
        getConfigAsistente(),
        prisma.organization.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        }),
    ]);

    return (
        <div className="max-w-5xl mx-auto animate-fade-in pb-10">
            <header className="mb-8">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    🤖 Asistente de soporte
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
                    Un bot de Telegram que atiende al personal de las clínicas: responde con el manual de AgenIA y,
                    si algo falla, abre el caso en la Mesa de Ayuda. Para conversar, cada persona escribe un código
                    que genera en Soporte, en cada conversación. Usa la IA de la clínica de quien pregunta.
                </p>
            </header>
            <SoporteBotClient inicial={config} clinicas={clinicas} />
        </div>
    );
}
