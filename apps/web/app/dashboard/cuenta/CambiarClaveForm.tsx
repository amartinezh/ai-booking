'use client';

import { useState, useTransition } from 'react';
import { cambiarMiClave } from '@/app/actions/cuenta';
import { CLAVE } from '@/lib/cuenta/clave';

const campo =
    'w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white';

/**
 * 🔑 Cambiar mi clave: la actual, la nueva y su confirmación. La regla la aplica el
 * servidor (`cambiarMiClave`); aquí solo se muestra y se limpian los campos al
 * terminar, para que la clave no quede escrita en pantalla.
 */
export default function CambiarClaveForm() {
    const [actual, setActual] = useState('');
    const [nueva, setNueva] = useState('');
    const [confirmacion, setConfirmacion] = useState('');
    const [ver, setVer] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [listo, setListo] = useState(false);
    const [isPending, startTransition] = useTransition();

    const enviar = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setListo(false);
        startTransition(async () => {
            const res = await cambiarMiClave({ actual, nueva, confirmacion });
            if (res.success) {
                setActual('');
                setNueva('');
                setConfirmacion('');
                setListo(true);
            } else {
                setError(res.error);
            }
        });
    };

    const tipo = ver ? 'text' : 'password';

    return (
        <form
            onSubmit={enviar}
            className="space-y-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6"
        >
            <div>
                <label htmlFor="clave-actual" className="block text-sm font-semibold text-zinc-900 dark:text-white mb-1">
                    Clave actual
                </label>
                <input
                    id="clave-actual"
                    type={tipo}
                    autoComplete="current-password"
                    value={actual}
                    onChange={(e) => setActual(e.target.value)}
                    className={campo}
                    required
                />
            </div>
            <div>
                <label htmlFor="clave-nueva" className="block text-sm font-semibold text-zinc-900 dark:text-white mb-1">
                    Clave nueva
                </label>
                <input
                    id="clave-nueva"
                    type={tipo}
                    autoComplete="new-password"
                    value={nueva}
                    onChange={(e) => setNueva(e.target.value)}
                    className={campo}
                    required
                />
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Al menos {CLAVE.MIN} caracteres, con letras y números, distinta de la actual y sin su usuario.
                </p>
            </div>
            <div>
                <label htmlFor="clave-confirmacion" className="block text-sm font-semibold text-zinc-900 dark:text-white mb-1">
                    Confirme la clave nueva
                </label>
                <input
                    id="clave-confirmacion"
                    type={tipo}
                    autoComplete="new-password"
                    value={confirmacion}
                    onChange={(e) => setConfirmacion(e.target.value)}
                    className={campo}
                    required
                />
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} />
                Mostrar las claves
            </label>

            {error && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {error}
                </p>
            )}
            {listo && (
                <p role="status" className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    ✓ Su clave quedó cambiada. La próxima vez ingrese con la nueva.
                </p>
            )}

            <button
                type="submit"
                disabled={isPending}
                className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
                {isPending ? 'Guardando…' : 'Cambiar mi clave'}
            </button>
        </form>
    );
}
