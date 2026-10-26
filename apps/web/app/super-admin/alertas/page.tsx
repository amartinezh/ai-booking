import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getTechAlertConfig, listTechAlerts } from '@/app/actions/tech-alerts';
import AlertasClient from './AlertasClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 🚨 Alertas técnicas por Telegram (docs/PLAN_ALERTAS_TECNICAS.md §3.8). Solo
 * SUPER_ADMIN: el layout de /super-admin ya saca a los demás, y la página lo
 * vuelve a revisar (como el monitor) porque la API es la que manda.
 */
export default async function AlertasTecnicasPage() {
    const session = await getSession();
    if (!session) redirect('/sesion-cerrada');
    if (session.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const [config, alerts] = await Promise.all([getTechAlertConfig(), listTechAlerts()]);

    return (
        <div className="max-w-5xl mx-auto animate-fade-in pb-10">
            <header className="mb-8">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    🚨 Alertas técnicas
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
                    Cuando algo falla —un servicio caído, el espejo sin señal, una tarea que
                    revienta— el sistema le escribe al instante a un grupo de Telegram del equipo
                    técnico. Solo dice qué pasa, en qué clínica y desde cuándo: nunca datos de
                    pacientes. Esto no lo ve ningún administrador de clínica.
                </p>
            </header>
            <AlertasClient
                initialConfig={config.success ? config.data : null}
                loadError={config.success ? null : config.error}
                initialAlerts={alerts}
            />
        </div>
    );
}
