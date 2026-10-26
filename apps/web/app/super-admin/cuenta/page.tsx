import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import CambiarClaveForm from '@/app/dashboard/cuenta/CambiarClaveForm';

// ─────────────────────────────────────────────────────────────
// 🔑 CAMBIAR MI CLAVE del super administrador (2026-10-26). La de `/dashboard/cuenta`
// no le sirve: el middleware lo saca de `/dashboard`. Hasta hoy no tenía cómo
// cambiar su clave desde el panel. Misma acción (`cambiarMiClave`) y mismas reglas.
// ─────────────────────────────────────────────────────────────
export default async function CuentaSuperAdminPage() {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') redirect('/dashboard');

    return (
        <div className="max-w-xl mx-auto animate-fade-in space-y-6">
            <header>
                <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    🔑 Cambiar mi clave
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Cambie la clave con la que ingresa como <strong>{session.email}</strong>. Esta cuenta ve todas las
                    clínicas: use una clave larga que no use en ningún otro sitio y guárdela en un gestor de claves.
                </p>
            </header>
            <CambiarClaveForm />
        </div>
    );
}
