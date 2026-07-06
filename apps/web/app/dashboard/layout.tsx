import Link from 'next/link';
import { getSession } from '../../lib/session';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/prisma';
import LogoutButton from './components/LogoutButton';
import BrandLogo from '@/app/components/BrandLogo';
import { getMenusForRole } from '../../lib/menus';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    const session = await getSession();

    if (!session) {
        redirect('/login');
    }

    const { role, email } = session;

    let orgName = 'Portal Salud';
    let orgLogoUrl = null;

    if (session.organizationId && session.role !== 'SUPER_ADMIN') {
        const org = await prisma.organization.findUnique({
            where: { id: session.organizationId },
            select: { name: true, logoUrl: true }
        });
        if (org) {
            orgName = org.name;
            orgLogoUrl = org.logoUrl;
        }
    }

    const roleMap: Record<string, string> = {
        'PATIENT': 'Paciente',
        'DOCTOR': 'Médico Especialista',
        'ORG_ADMIN': 'Administrador del Hospital',
        'SUPER_ADMIN': 'Súper Administrador',
        'BOOKING_AGENT': 'Agente de Reservas',
        'GENERAL_OBSERVER': 'Observador General'
    };

    // Fuente única de verdad de la navegación por rol (compartida con el
    // grid de accesos rápidos del dashboard): lib/menus.ts.
    const menus = getMenusForRole(role);

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col md:flex-row font-sans">

            {/* Sidebar Moderno */}
            <aside className="w-full md:w-72 bg-white dark:bg-zinc-900 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 hidden md:flex flex-col md:h-screen md:sticky md:top-0">
                <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3 shrink-0">
                    {orgLogoUrl ? (
                        <img src={orgLogoUrl} alt="Logo Organización" className="w-10 h-10 shrink-0 rounded-lg object-contain bg-white shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-800" />
                    ) : (
                        <BrandLogo size={40} alt={orgName} />
                    )}
                    <h2 className="text-base font-bold tracking-tight leading-snug text-zinc-900 dark:text-white wrap-break-word" title={orgName}>{orgName}</h2>
                </div>

                <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5">
                    {menus.map((item, idx) => (
                        <Link
                            key={idx}
                            href={item.href}
                            className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all"
                        >
                            <span className="text-xl">{item.icon}</span>
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
                    <div className="text-xs mb-4">
                        <p className="font-semibold text-zinc-900 dark:text-white truncate text-sm mb-1">{email}</p>
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 font-medium">
                            {roleMap[role]}
                        </span>
                    </div>
                    <LogoutButton variant="sidebar" />
                </div>
            </aside>

            {/* Configuración Móvil */}
            <header className="md:hidden bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-4 flex justify-between items-center">
                <div className="flex items-center gap-2 truncate max-w-[60%]">
                    {orgLogoUrl ? (
                        <img src={orgLogoUrl} alt="Logo" className="w-8 h-8 shrink-0 rounded-md object-contain bg-white shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-800" />
                    ) : (
                        <BrandLogo size={32} alt={orgName} />
                    )}
                    <span className="font-bold text-zinc-900 dark:text-white truncate" title={orgName}>{orgName}</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold px-3 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 rounded-lg">
                        {roleMap[role]}
                    </span>
                    <LogoutButton variant="mobile" />
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
