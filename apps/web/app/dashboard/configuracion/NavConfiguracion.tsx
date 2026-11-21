'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Una entrada de la columna; el layout la arma desde `seccionesDeConfiguracion`. */
export interface EntradaNavConfiguracion {
    href: string;
    titulo: string;
    icono: string;
    /** El grupo («El asistente», «La clínica», «Conexiones»); null para el Resumen. */
    grupo: string | null;
}

/**
 * La columna de Configuración (docs/PLAN_NAVEGACION.md §5.1): el Resumen arriba
 * y las secciones por grupo, con la abierta resaltada. En el celular es una fila
 * que se desliza de lado. Es de cliente solo para saber la ruta; las entradas
 * llegan ya armadas del servidor (aquí no se importa `@agenia/shared`).
 */
export default function NavConfiguracion({ entradas }: { entradas: EntradaNavConfiguracion[] }) {
    const ruta = (usePathname() ?? '').replace(/\/+$/, '');
    const grupos: { grupo: string | null; entradas: EntradaNavConfiguracion[] }[] = [];
    for (const e of entradas) {
        const ultimo = grupos[grupos.length - 1];
        if (ultimo && ultimo.grupo === e.grupo) ultimo.entradas.push(e);
        else grupos.push({ grupo: e.grupo, entradas: [e] });
    }

    const enlace = (e: EntradaNavConfiguracion, enFila: boolean) => {
        const activa = ruta === e.href;
        return (
            <Link
                key={e.href}
                href={e.href}
                aria-current={activa ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-lg text-sm transition-colors ${
                    enFila ? 'shrink-0 whitespace-nowrap border px-3 py-1.5' : 'px-3 py-1.5'
                } ${
                    activa
                        ? `font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 ${enFila ? 'border-blue-200 dark:border-blue-800' : ''}`
                        : `font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white ${enFila ? 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900' : ''}`
                }`}
            >
                <span aria-hidden="true">{e.icono}</span>
                {e.titulo}
            </Link>
        );
    };

    return (
        <>
            {/* Celular: una fila que se desliza de lado. */}
            <nav aria-label="Secciones de Configuración" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 md:hidden">
                {entradas.map((e) => enlace(e, true))}
            </nav>

            {/* Escritorio: la columna, por grupos. */}
            <nav aria-label="Secciones de Configuración" className="sticky top-6 hidden space-y-4 md:block">
                {grupos.map((g, i) => (
                    <div key={g.grupo ?? `suelto-${i}`} role={g.grupo ? 'group' : undefined} aria-label={g.grupo ?? undefined}>
                        {g.grupo && (
                            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                                {g.grupo}
                            </p>
                        )}
                        <div className="space-y-0.5">{g.entradas.map((e) => enlace(e, false))}</div>
                    </div>
                ))}
            </nav>
        </>
    );
}
