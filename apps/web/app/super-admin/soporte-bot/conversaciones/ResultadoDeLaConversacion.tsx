import type { FilaConversacion } from '@agenia/shared';

/** Lo que pasó en la conversación, en etiquetas. */
export default function ResultadoDeLaConversacion({ c }: { c: Pick<FilaConversacion, 'casos' | 'feedback' | 'sinCubrir' | 'prueba'> }) {
    const chip = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset';
    return (
        <span className="inline-flex flex-wrap gap-1">
            {c.prueba && <span className={`${chip} bg-zinc-100 text-zinc-700 ring-zinc-200`}>Prueba</span>}
            {c.casos.map((n) => (
                <span key={n} className={`${chip} bg-indigo-50 text-indigo-700 ring-indigo-200`}>
                    Caso #{n}
                </span>
            ))}
            {c.feedback === 'UTIL' && (
                <span className={`${chip} bg-emerald-50 text-emerald-700 ring-emerald-200`}>Le sirvió</span>
            )}
            {c.feedback === 'NO_UTIL' && (
                <span className={`${chip} bg-amber-50 text-amber-800 ring-amber-200`}>No le sirvió</span>
            )}
            {c.sinCubrir && <span className={`${chip} bg-sky-50 text-sky-700 ring-sky-200`}>Sin cubrir</span>}
        </span>
    );
}
