'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { salirDeEstadisticas } from '@/app/actions/estadisticas';

/** 📊 Olvida la clave en este navegador (útil en un equipo compartido). */
export default function BotonSalir({ organizationId }: { organizationId: string }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    return (
        <button
            type="button"
            disabled={isPending}
            onClick={() =>
                startTransition(async () => {
                    await salirDeEstadisticas(organizationId);
                    router.refresh();
                })
            }
            className="rounded-lg border border-[#dde3eb] bg-white px-3 py-1.5 text-sm text-[#586378] hover:text-[#101a2a] disabled:opacity-50"
        >
            Salir
        </button>
    );
}
