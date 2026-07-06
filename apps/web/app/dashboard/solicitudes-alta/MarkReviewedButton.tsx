'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { markEnrollmentRequestReviewed } from './actions';

// Botón mínimo por fila: marca la solicitud como revisada y deja que el
// server component (revalidatePath) refresque la tabla.
export default function MarkReviewedButton({ requestId }: { requestId: string }) {
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    function handleClick() {
        setError(null);
        startTransition(async () => {
            const result = await markEnrollmentRequestReviewed(requestId);
            if (!result.success) setError(result.error ?? 'Error');
        });
    }

    return (
        <div className="flex flex-col items-start gap-1">
            <button
                type="button"
                onClick={handleClick}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Marcar revisada
            </button>
            {error && <span className="text-[11px] text-red-500">{error}</span>}
        </div>
    );
}
