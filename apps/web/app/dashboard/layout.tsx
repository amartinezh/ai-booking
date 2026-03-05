import Link from 'next/link';
import { getSession } from '../../lib/session';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    const session = await getSession();

    if (!session) {
        redirect('/login');
    }

    const { role, email } = session;

    // Diferentes opciones de menú dependiendo del Rol
    const PATIENT_MENUS = [
        { label: 'Mis Citas Programadas', href: '/dashboard', icon: '📅' }
    ];

    const DOCTOR_MENUS = [
        { label: 'Mi Agenda', href: '/dashboard', icon: '🩺' }
    ];

    const ADMIN_MENUS = [
        { label: 'Visión General', href: '/dashboard', icon: '📋' },
        { label: 'Usuarios', href: '/dashboard/usuarios', icon: '👥' },
        { label: 'Médicos', href: '/dashboard/medicos', icon: '⚕️' },
        { label: 'Especialidades', href: '/dashboard/especialidades', icon: '🏥' }
    ];

    const roleMap = {
        'PATIENT': 'Paciente',
        'DOCTOR': 'Médico Especialista',
        'ADMIN': 'Administrador del Sistema'
    };

    let menus: Array<{ label: string, href: string, icon: string }> = [];
    if (role === 'PATIENT') menus = PATIENT_MENUS;
    else if (role === 'DOCTOR') menus = DOCTOR_MENUS;
    else if (role === 'ADMIN') menus = ADMIN_MENUS;

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col md:flex-row font-sans">

            {/* Sidebar Moderno */}
            <aside className="w-full md:w-72 bg-white dark:bg-zinc-900 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 hidden md:flex flex-col">
                <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
                    <span className="text-3xl">🏥</span>
                    <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Portal Salud</h2>
                </div>

                <nav className="flex-1 p-4 space-y-2">
                    {menus.map((item, idx) => (
                        <Link
                            key={idx}
                            href={item.href}
                            className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-2xl transition-all"
                        >
                            <span className="text-xl">{item.icon}</span>
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <div className="p-6 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
                    <div className="text-xs">
                        <p className="font-semibold text-zinc-900 dark:text-white truncate text-sm mb-1">{email}</p>
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 font-medium">
                            {roleMap[role]}
                        </span>
                    </div>
                </div>
            </aside>

            {/* Configuración Móvil */}
            <header className="md:hidden bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-4 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <span className="text-2xl">🏥</span>
                    <span className="font-bold text-zinc-900 dark:text-white">Portal</span>
                </div>
                <span className="text-xs font-semibold px-3 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 rounded-lg">
                    {roleMap[role]}
                </span>
            </header>

            {/* Contenido Principal */}
            <main className="flex-1 p-6 md:p-10 overflow-y-auto w-full">
                {children}
            </main>
        </div>
    );
}
