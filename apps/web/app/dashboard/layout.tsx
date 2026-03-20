import Link from 'next/link';
import { getSession } from '../../lib/session';
import { redirect } from 'next/navigation';
import { logoutUser } from '../actions/auth';

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
        { label: 'Analíticas de Negocio', href: '/dashboard/analytics', icon: '📊' },
        { label: 'Agendas (Slots)', href: '/dashboard/agenda', icon: '📅' },
        { label: 'Servicios de Salud', href: '/dashboard/servicios', icon: '💉' },
        { label: 'Aseguradoras (EPS)', href: '/dashboard/eps', icon: '🏦' },
        { label: 'Usuarios', href: '/dashboard/usuarios', icon: '👥' },
        { label: 'Médicos', href: '/dashboard/medicos', icon: '⚕️' },
        { label: 'Caja Negra (Auditoría)', href: '/dashboard/auditoria', icon: '🕵️' }
    ];

    const AGENT_MENUS = [
        { label: 'Visión General', href: '/dashboard', icon: '📋' },
        { label: 'Agendamiento', href: '/dashboard/agendamiento', icon: '📅' }
    ];

    const OBSERVER_MENUS = [
        { label: 'Analíticas de Negocio', href: '/dashboard/analytics', icon: '📊' }
    ];

    const roleMap: Record<string, string> = {
        'PATIENT': 'Paciente',
        'DOCTOR': 'Médico Especialista',
        'ADMIN': 'Administrador del Sistema',
        'BOOKING_AGENT': 'Agente de Reservas',
        'GENERAL_OBSERVER': 'Observador General'
    };

    let menus: Array<{ label: string, href: string, icon: string }> = [];
    if (role === 'PATIENT') menus = PATIENT_MENUS;
    else if (role === 'DOCTOR') menus = DOCTOR_MENUS;
    else if (role === 'ADMIN') menus = ADMIN_MENUS;
    else if (role === 'BOOKING_AGENT') menus = AGENT_MENUS;
    else if (role === 'GENERAL_OBSERVER') menus = OBSERVER_MENUS;

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
                    <div className="text-xs mb-4">
                        <p className="font-semibold text-zinc-900 dark:text-white truncate text-sm mb-1">{email}</p>
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 font-medium">
                            {roleMap[role]}
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
                    <span className="text-2xl">🏥</span>
                    <span className="font-bold text-zinc-900 dark:text-white">Portal</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold px-3 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 rounded-lg">
                        {roleMap[role]}
                    </span>
                    <form action={logoutUser}>
                        <button type="submit" className="p-2 flex items-center justify-center text-red-600 bg-red-50 rounded-lg dark:text-red-400 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors" title="Cerrar Sesión">
                            🚪
                        </button>
                    </form>
                </div>
            </header>

            {/* Contenido Principal */}
            <main className="flex-1 p-6 md:p-10 overflow-x-hidden overflow-y-auto w-full">
                {/* Menú de enlaces rápidos temporal para móviles */}
                <div className="md:hidden flex flex-wrap gap-2 mb-6">
                    {menus.map((item, idx) => (
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
