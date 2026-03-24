import Link from 'next/link';
import { getSession } from '../../lib/session';
import { redirect } from 'next/navigation';
import { logoutUser } from '../actions/auth';

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
    const session = await getSession();

    if (!session || session.role !== 'SUPER_ADMIN') {
        redirect('/dashboard');
    }

    const { email } = session;

    const SUPER_ADMIN_MENUS = [
        { label: 'Organizaciones', href: '/super-admin/organizations', icon: '🏢' },
        { label: 'Facturación Global', href: '/super-admin/billing', icon: '💳' },
        { label: 'Ajustes del Sistema', href: '/super-admin/settings', icon: '⚙️' },
    ];

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col md:flex-row font-sans">
            {/* Sidebar Moderno */}
            <aside className="w-full md:w-72 bg-white dark:bg-zinc-900 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 hidden md:flex flex-col">
                <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
                    <span className="text-3xl">🌎</span>
                    <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Admin Global</h2>
                </div>

                <nav className="flex-1 p-4 space-y-2">
                    {SUPER_ADMIN_MENUS.map((item, idx) => (
                        <Link
                            key={idx}
                            href={item.href}
                            className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-2xl transition-all"
                        >
                            <span className="text-xl">{item.icon}</span>
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <div className="p-6 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
                    <div className="text-xs mb-4">
                        <p className="font-semibold text-zinc-900 dark:text-white truncate text-sm mb-1">{email}</p>
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 font-medium">
                            Súper Administrador
                        </span>
                    </div>
                    <form action={logoutUser}>
                        <button type="submit" className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-xl transition-colors">
                            <span>🚪</span> Cerrar Sesión
                        </button>
                    </form>
                </div>
            </aside>

            {/* Configuración Móvil */}
            <header className="md:hidden bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-4 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <span className="text-2xl">🌎</span>
                    <span className="font-bold text-zinc-900 dark:text-white">Global</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold px-3 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 rounded-lg">
                        Super Admin
                    </span>
                    <form action={logoutUser}>
                        <button type="submit" className="p-2 flex items-center justify-center text-red-600 bg-red-50 rounded-lg dark:text-red-400 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
                            🚪
                        </button>
                    </form>
                </div>
            </header>

            {/* Contenido Principal */}
            <main className="flex-1 p-6 md:p-10 overflow-x-hidden overflow-y-auto w-full">
                <div className="md:hidden flex flex-wrap gap-2 mb-6">
                    {SUPER_ADMIN_MENUS.map((item, idx) => (
                        <Link key={idx} href={item.href} className="px-3 py-2 bg-white dark:bg-zinc-900 shadow-sm rounded-lg text-xs font-semibold text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800">
                            {item.icon} {item.label}
                        </Link>
                    ))}
                </div>
                {children}
            </main>
        </div>
    );
}
