import type { ReactNode } from 'react';
import { GRUPOS_DE_CONFIGURACION, getMenusForRole, seccionesDeConfiguracion } from '@/lib/menus';
import { getTenantMirrorFlags } from '@/lib/mirror-flags';
import NavConfiguracion, { type EntradaNavConfiguracion } from '../NavConfiguracion';
import { exigirAdministrador } from '../comunes';

// ─────────────────────────────────────────────────────────────
// CONFIGURACIÓN por secciones (docs/PLAN_NAVEGACION.md §5): el Resumen y una
// sección por tema, cada una con su dirección. Antes eran cinco pestañas, y
// «Asistente Virtual» apilaba hasta 17 ajustes de seis temas.
//
// Las secciones van en el grupo de rutas `(secciones)` para que Encuestas
// (`/dashboard/configuracion/integraciones/surveys`, que es de Indicadores) no
// herede esta columna.
// ─────────────────────────────────────────────────────────────

export default async function ConfiguracionLayout({ children }: { children: ReactNode }) {
    const session = await exigirAdministrador();
    const banderas = await getTenantMirrorFlags(session.organizationId);
    const secciones = seccionesDeConfiguracion(getMenusForRole(session.role, banderas));
    const tituloDe = (id: string) => GRUPOS_DE_CONFIGURACION.find((g) => g.id === id)?.titulo ?? null;
    const entradas: EntradaNavConfiguracion[] = [
        { href: '/dashboard/configuracion', titulo: 'Resumen', icono: '🏠', grupo: null },
        ...secciones.map((s) => ({ href: s.href, titulo: s.titulo, icono: s.icono, grupo: tituloDe(s.grupo) })),
    ];

    return (
        <div className="mx-auto max-w-6xl animate-fade-in">
            <header className="mb-6">
                <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white md:text-4xl">
                    Configuración de la Clínica
                </h1>
                <p className="max-w-2xl text-lg leading-relaxed text-zinc-500 dark:text-zinc-400">
                    Lo que hace el asistente virtual, la agenda que ofrece, sus canales y la información que comparte
                    con los pacientes.
                </p>
            </header>
            <div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
                <aside>
                    <NavConfiguracion entradas={entradas} />
                </aside>
                <div className="min-w-0">{children}</div>
            </div>
        </div>
    );
}
