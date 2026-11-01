'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { salirDelResumenAction } from '@/app/actions/resumen-publico';

/** Borra el acceso de este celular: útil si es prestado o compartido. */
export default function BotonSalir({ token }: { token: string }) {
    const router = useRouter();
    const [saliendo, startSalir] = useTransition();
    return (
        <button
            onClick={() =>
                startSalir(async () => {
                    await salirDelResumenAction(token);
                    router.refresh();
                })
            }
            disabled={saliendo}
            className="w-full rounded-xl border border-[#dde3eb] bg-white px-4 py-3 text-base text-[#38445a] disabled:opacity-50"
        >
            {saliendo ? 'Saliendo…' : 'Salir (para que nadie más los vea en este celular)'}
        </button>
    );
}
