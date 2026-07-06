import Link from 'next/link';
import { getMenusForRole, type MenuAccent, type UserRole } from '@/lib/menus';

// ─────────────────────────────────────────────────────────────
// ACCESOS RÁPIDOS — grid de tarjetas bajo el título del dashboard.
//
// Muestra las opciones principales del menú COMO ICONOS, filtradas por el rol
// del usuario (misma fuente de verdad que el sidebar: lib/menus.ts). Excluye
// la página actual (/dashboard) porque el usuario ya está en ella.
// ─────────────────────────────────────────────────────────────

// Clases ESTÁTICAS por acento (el JIT de Tailwind no compila clases dinámicas).
const ACCENT_STYLES: Record<MenuAccent, { tile: string; glow: string }> = {
    blue: { tile: 'bg-gradient-to-br from-blue-500 to-blue-700', glow: 'group-hover:shadow-blue-500/25' },
    violet: { tile: 'bg-gradient-to-br from-violet-500 to-violet-700', glow: 'group-hover:shadow-violet-500/25' },
    emerald: { tile: 'bg-gradient-to-br from-emerald-500 to-emerald-700', glow: 'group-hover:shadow-emerald-500/25' },
    amber: { tile: 'bg-gradient-to-br from-amber-400 to-amber-600', glow: 'group-hover:shadow-amber-500/25' },
    rose: { tile: 'bg-gradient-to-br from-rose-500 to-rose-700', glow: 'group-hover:shadow-rose-500/25' },
    cyan: { tile: 'bg-gradient-to-br from-cyan-500 to-cyan-700', glow: 'group-hover:shadow-cyan-500/25' },
    indigo: { tile: 'bg-gradient-to-br from-indigo-500 to-indigo-700', glow: 'group-hover:shadow-indigo-500/25' },
    teal: { tile: 'bg-gradient-to-br from-teal-500 to-teal-700', glow: 'group-hover:shadow-teal-500/25' },
    orange: { tile: 'bg-gradient-to-br from-orange-400 to-orange-600', glow: 'group-hover:shadow-orange-500/25' },
    fuchsia: { tile: 'bg-gradient-to-br from-fuchsia-500 to-fuchsia-700', glow: 'group-hover:shadow-fuchsia-500/25' },
    sky: { tile: 'bg-gradient-to-br from-sky-500 to-sky-700', glow: 'group-hover:shadow-sky-500/25' },
    slate: { tile: 'bg-gradient-to-br from-slate-500 to-slate-700', glow: 'group-hover:shadow-slate-500/25' },
};

export default function QuickAccessGrid({ role }: { role: UserRole }) {
    // La Visión General es la página actual: no tiene sentido como acceso rápido.
    const items = getMenusForRole(role).filter((item) => item.href !== '/dashboard');

    if (items.length === 0) return null;

    return (
        <nav aria-label="Accesos rápidos" className="mb-10">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                {items.map((item) => {
                    const accent = ACCENT_STYLES[item.accent];
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`group relative flex flex-col items-center gap-3 rounded-2xl bg-white dark:bg-zinc-900 p-4 md:p-5 text-center ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:ring-blue-300 dark:hover:ring-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${accent.glow}`}
                        >
                            <span
                                aria-hidden="true"
                                className={`flex h-12 w-12 md:h-14 md:w-14 items-center justify-center rounded-xl text-2xl md:text-3xl text-white shadow-md transition-transform duration-200 group-hover:scale-110 ${accent.tile}`}
                            >
                                {item.icon}
                            </span>
                            <span className="flex flex-col gap-0.5">
                                <span className="text-xs md:text-sm font-semibold leading-tight text-zinc-800 dark:text-zinc-100">
                                    {item.label}
                                </span>
                                <span className="hidden md:block text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
                                    {item.description}
                                </span>
                            </span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
