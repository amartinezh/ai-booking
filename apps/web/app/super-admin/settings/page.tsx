import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';
import SettingsClient from './components/SettingsClient';
import { getEnvVars } from '../../actions/settings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
    const session = await getSession();

    if (!session || session.role !== 'SUPER_ADMIN') {
        redirect('/dashboard');
    }

    const initialVars = await getEnvVars();

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Ajustes del Sistema</h1>
                <p className="text-zinc-500 dark:text-zinc-400 mt-2">
                    Manipula directamente las variables de entorno (.env) del servidor para configurar inteligencia artificial, bases de datos y tokens de WhatsApp.
                </p>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-4 flex gap-3 text-amber-800 dark:text-amber-400">
                <span className="text-xl shrink-0">⚠️</span>
                <div className="text-sm">
                    <strong>Peligro Cuidado:</strong> Cualquier error tipográfico en esta pantalla podría hacer que los microservicios se caigan temporalmente. Despúes de guardar, recuerda que <strong>debes reiniciar los contenedores (o el proceso de Node/NestJS)</strong> para que la memoria Caché reciba las nuevas configuraciones.
                </div>
            </div>

            <SettingsClient initialVars={initialVars} />
        </div>
    );
}
