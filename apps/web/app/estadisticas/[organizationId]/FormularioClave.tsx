'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { entrarAEstadisticas } from '@/app/actions/estadisticas';

/** 📊 La puerta de la página de estadísticas: la clave que el administrador compartió. */
export default function FormularioClave({ organizationId, clinica }: { organizationId: string; clinica: string }) {
    const router = useRouter();
    const [clave, setClave] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const entrar = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
            const res = await entrarAEstadisticas(organizationId, clave);
            if (res.success) router.refresh();
            else setError(res.error);
        });
    };

    return (
        <main className="min-h-screen bg-[#f4f6f9] text-[#101a2a] flex items-center justify-center px-4 py-12">
            <form
                onSubmit={entrar}
                className="w-full max-w-sm rounded-2xl border border-[#dde3eb] bg-white p-6 shadow-sm space-y-4"
            >
                <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wider text-[#586378]">{clinica}</p>
                    <h1 className="text-2xl font-semibold">Estadísticas de AgenIA</h1>
                    <p className="text-sm text-[#586378]">Escriba la clave que le compartió el hospital.</p>
                </div>
                <label className="block space-y-1">
                    <span className="text-sm font-medium">Clave</span>
                    <input
                        type="password"
                        value={clave}
                        onChange={(e) => setClave(e.target.value)}
                        autoComplete="current-password"
                        autoFocus
                        required
                        className="w-full rounded-xl border border-[#dde3eb] px-4 py-2.5 text-base outline-none focus:border-[#2a78d6] focus:ring-2 focus:ring-[#2a78d6]/30"
                    />
                </label>
                {error && (
                    <p role="alert" className="text-sm text-red-600">
                        {error}
                    </p>
                )}
                <button
                    type="submit"
                    disabled={isPending || clave.length === 0}
                    className="w-full rounded-xl bg-[#2a78d6] px-4 py-2.5 font-semibold text-white transition-opacity disabled:opacity-50"
                >
                    {isPending ? 'Comprobando…' : 'Ver estadísticas'}
                </button>
            </form>
        </main>
    );
}
