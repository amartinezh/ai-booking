import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import CambiarClaveForm from './CambiarClaveForm';

// ─────────────────────────────────────────────────────────────
// 🔑 MI CUENTA — cambiar la clave propia (2026-10-22). Para cualquier usuario del
// panel: se llega desde «Cambiar mi clave», al pie del menú. No es una opción del
// menú; la acción (`cambiarMiClave`) solo cambia la clave de quien tiene la sesión.
// ─────────────────────────────────────────────────────────────
export default async function CuentaPage() {
    const session = await getSession();
    if (!session) redirect('/login');

    return (
        <div className="max-w-xl mx-auto animate-fade-in space-y-6">
            <header>
                <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    🔑 Cambiar mi clave
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Cambie la clave con la que ingresa como <strong>{session.email}</strong>. Si la recibió por correo,
                    cámbiela ahora: el correo no es un canal seguro. Es personal: no la comparta.
                </p>
            </header>
            <CambiarClaveForm />
        </div>
    );
}
