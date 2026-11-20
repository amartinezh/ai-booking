'use client';

import { Printer } from 'lucide-react';

/** «Imprimir o guardar en PDF»: el hospital la archiva o la publica en su propio sitio. */
export default function BotonImprimir() {
    return (
        <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-[#cfd6e2] bg-white px-3 py-2 text-sm font-semibold text-[#1d3557] transition-colors hover:bg-[#eef2f8] print:hidden"
        >
            <Printer className="h-4 w-4" aria-hidden />
            Imprimir o guardar en PDF
        </button>
    );
}
