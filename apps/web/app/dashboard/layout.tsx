import Link from 'next/link';
import { getSession } from '../../lib/session';
import RegistroDePantallas from '../components/RegistroDePantallas';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/prisma';
import LogoutButton from './components/LogoutButton';
import BrandLogo from '@/app/components/BrandLogo';
import { getMenusForRole, seccionesDelMenu } from '../../lib/menus';
import MenuLateral, { MenuMovil } from './components/MenuDelPanel';
import { getTenantMirrorFlags } from '../../lib/mirror-flags';
import { pendientesParaMenu } from '../../lib/bandeja/pendientes';
import { solicitudesCitasPendientes } from '../../lib/limite-citas/acceso';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    const session = await getSession();

    if (!session) {
        // Con cookie pero sin sesión válida (cerrada, cuenta borrada, rol cambiado):
        // /sesion-cerrada borra la cookie y lleva al ingreso con el aviso.
        redirect('/sesion-cerrada');
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
    // La sección del espejo solo existe para las clínicas que lo tienen; los
    // avisos masivos, solo para las que además tienen el driver correcto y
    // la función encendida (PLAN_AVISOS_MASIVOS.md §1).
    const { conEspejo, conAvisos, conAvisosDriver, conResumen } = await getTenantMirrorFlags(session.organizationId);
    // La cifra de la bandeja de sincronización (solo quien la trabaja, solo con espejo).
    const pendientesBandeja = await pendientesParaMenu(prisma, session, conEspejo);
    // La cifra de solicitudes de más citas por revisar (ORG_ADMIN y BOOKING_AGENT).
    const pendientesSolicitudesCitas = await solicitudesCitasPendientes(prisma, session);
    const menus = getMenusForRole(role, {
        conEspejo,
        conAvisos,
        conAvisosDriver,
        conResumen,
        pendientesBandeja,
        pendientesSolicitudesCitas,
    });
    // En grupos con su encabezado (docs/PLAN_NAVEGACION.md §4); los menús cortos, sin encabezados.
    const secciones = seccionesDelMenu(menus);

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

                <MenuLateral secciones={secciones} />

                <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
                    <div className="text-xs mb-4">
                        <p className="font-semibold text-zinc-900 dark:text-white truncate text-sm mb-1">{email}</p>
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 font-medium">
                            {roleMap[role]}
                        </span>
                    </div>
                    <Link
                        href="/dashboard/cuenta"
                        className="mb-3 w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-zinc-700 bg-white hover:bg-zinc-100 dark:text-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-xl border border-zinc-200 dark:border-zinc-700 transition-colors"
                    >
                        <span>🔑</span> Cambiar mi clave
                    </Link>
                    <LogoutButton variant="sidebar" />
                </div>
            </aside>

            {/* Encabezado en el celular: el menú se abre con «☰ Menú» */}
            <header className="md:hidden bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-4 flex justify-between items-center gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    {secciones.length > 0 && (
                        <MenuMovil secciones={secciones} correo={email} rol={roleMap[role]} />
                    )}
                    {orgLogoUrl ? (
                        <img src={orgLogoUrl} alt="Logo" className="w-8 h-8 shrink-0 rounded-md object-contain bg-white shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-800" />
                    ) : (
                        <BrandLogo size={32} alt={orgName} />
                    )}
                    <span className="font-bold text-zinc-900 dark:text-white truncate" title={orgName}>{orgName}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <Link
                        href="/dashboard/cuenta"
                        title="Cambiar mi clave"
                        aria-label="Cambiar mi clave"
                        className="p-2 flex items-center justify-center text-zinc-700 bg-zinc-100 rounded-lg dark:text-zinc-300 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                    >
                        🔑
                    </Link>
                    <LogoutButton variant="mobile" />
                </div>
            </header>

            {/* Contenido Principal */}
            <main className="flex-1 p-6 md:p-10 overflow-x-hidden overflow-y-auto w-full">
                <RegistroDePantallas />
                {children}
            </main>
        </div>
    );
}
