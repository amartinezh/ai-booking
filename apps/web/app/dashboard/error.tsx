'use client';

import { useEffect } from 'react';

export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[Dashboard Error]', error);
    }, [error]);

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
            <div className="text-5xl">⚠️</div>
            <div>
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">
                    Ocurrió un error inesperado
                </h2>
                <p className="text-zinc-500 dark:text-zinc-400 max-w-md">
                    No pudimos cargar esta sección. Por favor intente de nuevo o recargue la página.
                </p>
                {error.digest && (
                    <p className="mt-2 text-xs text-zinc-400 font-mono">ID: {error.digest}</p>
                )}
            </div>
            <button
                onClick={reset}
                className="px-6 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg font-semibold hover:opacity-80 transition-opacity"
            >
                Reintentar
            </button>
        </div>
    );
}
