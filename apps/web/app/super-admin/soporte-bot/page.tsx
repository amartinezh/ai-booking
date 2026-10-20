import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { periodoDeCifras } from '@agenia/shared';
import { getCifrasAsistente, getConfigAsistente, getPreguntasSinCubrir } from '@/app/actions/support-bot';
import SoporteBotClient from './SoporteBotClient';
import { CifrasDelAsistente, PreguntasSinCubrir } from './CifrasAsistente';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 🛟 Asistente de soporte por Telegram (docs/PLAN_BOT_SOPORTE.md §3.7). Solo
 * SUPER_ADMIN: el layout de /super-admin ya saca a los demás, y la página lo vuelve
 * a revisar porque la API es la que manda. Debajo de la configuración, cómo va
 * (Fase 5): cifras y lo que el manual no cubrió, de los últimos 7 o 30 días.
 */
export default async function SoporteBotPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const dias = periodoDeCifras((await searchParams).dias);
    const [config, clinicas] = await Promise.all([
        getConfigAsistente(),
        prisma.organization.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        }),
    ]);
    // Sin el asistente en el servidor (SUPPORT_BOT_ENABLED), no hay cifras que pedir.
    const [cifras, preguntas] = config.ok
        ? await Promise.all([getCifrasAsistente(dias), getPreguntasSinCubrir(dias)])
        : [null, null];

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
            {cifras && (
                <div className="mt-6 space-y-6">
                    {cifras.ok ? (
                        <CifrasDelAsistente cifras={cifras.data} />
                    ) : (
                        <p role="alert" className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
                            No se pudieron cargar las cifras: {cifras.error}
                        </p>
                    )}
                    {preguntas?.ok && <PreguntasSinCubrir preguntas={preguntas.data} />}
                </div>
            )}
        </div>
    );
}
