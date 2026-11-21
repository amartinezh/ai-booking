'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
// Solo el tipo: el paquete compartido no viaja al navegador (ver lib/menu-activo.ts).
import type { SeccionDelMenu } from '@/lib/menus';
import { opcionActiva } from '@/lib/menu-activo';

// ─────────────────────────────────────────────────────────────
// El menú del panel (docs/PLAN_NAVEGACION.md §4): las opciones en grupos con
// su encabezado y la opción en la que está quien navega, resaltada. Es de
// cliente solo para saber la ruta (usePathname); las opciones las decide el
// servidor en el layout (`getMenusForRole` + `seccionesDelMenu`) y llegan ya
// armadas, así que aquí no se importa `@agenia/shared`.
// ─────────────────────────────────────────────────────────────

function ListaDelMenu({
    secciones,
    alElegir,
}: {
    secciones: SeccionDelMenu[];
    /** En el celular, cierra el panel al tocar una opción. */
    alElegir?: () => void;
}) {
    const ruta = usePathname();
    const activa = opcionActiva(
        secciones.flatMap((s) => s.items),
        ruta ?? '',
    );
    const idBase = useId();

    return (
        <div className="space-y-0.5">
            {secciones.map((seccion, i) => {
                const idTitulo = `${idBase}-grupo-${i}`;
                const tieneLaActiva = seccion.items.some((m) => m.href === activa);
                // Las opciones sueltas del final (Soporte y ayuda) van separadas de los grupos.
                const alPie = !seccion.grupo && i > 0;
                return (
                    <div
                        key={seccion.grupo?.id ?? `suelta-${i}`}
                        role={seccion.grupo ? 'group' : undefined}
                        aria-labelledby={seccion.grupo ? idTitulo : undefined}
                        className={alPie ? 'mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800' : undefined}
                    >
                        {seccion.grupo && (
                            <p
                                id={idTitulo}
                                className={`px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider ${
                                    tieneLaActiva
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-zinc-400 dark:text-zinc-500'
                                }`}
                            >
                                {seccion.grupo.titulo}
                            </p>
                        )}
                        <ul className="space-y-0.5">
                            {seccion.items.map((item) => {
                                const esActiva = item.href === activa;
                                return (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            onClick={alElegir}
                                            aria-current={esActiva ? 'page' : undefined}
                                            className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-all ${
                                                esActiva
                                                    ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                                    : 'font-medium text-zinc-600 hover:bg-blue-50 hover:text-blue-600 dark:text-zinc-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-400'
                                            }`}
                                        >
                                            <span aria-hidden="true" className="w-6 shrink-0 text-center text-lg">
                                                {item.icon}
                                            </span>
                                            <span className="min-w-0 flex-1">{item.label}</span>
                                            {item.badge ? (
                                                <span
                                                    className="ml-auto rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white"
                                                    aria-label={`${item.badge} pendientes`}
                                                >
                                                    {item.badge}
                                                </span>
                                            ) : null}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                );
            })}
        </div>
    );
}

/** El menú del costado, en pantallas medianas y grandes. */
export default function MenuLateral({ secciones }: { secciones: SeccionDelMenu[] }) {
    return (
        <nav aria-label="Menú principal" className="flex-1 min-h-0 overflow-y-auto p-3">
            <ListaDelMenu secciones={secciones} />
        </nav>
    );
}

/**
 * En el celular: un botón «☰ Menú» que abre el mismo menú en un panel. Antes,
 * todas las opciones salían como botones encima del contenido de cada página.
 */
export function MenuMovil({
    secciones,
    correo,
    rol,
}: {
    secciones: SeccionDelMenu[];
    correo: string;
    rol: string;
}) {
    const ruta = usePathname() ?? '';
    // La ruta en la que se abrió: al cambiar de página (también con atrás o
    // adelante), el panel queda cerrado solo.
    const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
    const abierto = abiertoEn === ruta;
    const setAbierto = (si: boolean) => setAbiertoEn(si ? ruta : null);
    const idPanel = useId();
    const pendientes = secciones
        .flatMap((s) => s.items)
        .reduce((n, m) => n + (m.badge ?? 0), 0);

    useEffect(() => {
        if (!abierto) return;
        const alTeclear = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setAbiertoEn(null);
        };
        const antes = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', alTeclear);
        return () => {
            document.body.style.overflow = antes;
            window.removeEventListener('keydown', alTeclear);
        };
    }, [abierto]);

    return (
        <>
            <button
                type="button"
                onClick={() => setAbierto(true)}
                aria-expanded={abierto}
                aria-controls={idPanel}
                className="relative flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
                <span aria-hidden="true">☰</span> Menú
                {pendientes > 0 && (
                    <span
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                        aria-label={`${pendientes} pendientes`}
                    >
                        {pendientes}
                    </span>
                )}
            </button>

            {abierto && (
                <div className="fixed inset-0 z-50 md:hidden">
                    <button
                        type="button"
                        aria-label="Cerrar el menú"
                        onClick={() => setAbierto(false)}
                        className="absolute inset-0 h-full w-full cursor-default bg-zinc-900/40"
                    />
                    <div
                        id={idPanel}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Menú principal"
                        className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-white shadow-xl dark:bg-zinc-900"
                    >
                        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
                            <div className="min-w-0 text-xs">
                                <p className="mb-1 truncate text-sm font-semibold text-zinc-900 dark:text-white">{correo}</p>
                                <span className="inline-flex items-center rounded-md bg-blue-100 px-2 py-1 font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                                    {rol}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setAbierto(false)}
                                aria-label="Cerrar el menú"
                                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            >
                                ✕
                            </button>
                        </div>
                        <nav aria-label="Menú principal" className="min-h-0 flex-1 overflow-y-auto p-3">
                            <ListaDelMenu secciones={secciones} alElegir={() => setAbierto(false)} />
                        </nav>
                    </div>
                </div>
            )}
        </>
    );
}
