/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useActionState, useEffect } from 'react';
import { resolveTicket, updateResolutionNote } from '@/app/actions/support';

type Mode = 'resolve' | 'edit';

export default function ResolveTicketModal({
    ticketId,
    mode,
    initialNote,
    onClose,
}: {
    ticketId: string;
    mode: Mode;
    initialNote?: string | null;
    onClose: () => void;
}) {
    const boundAction =
        mode === 'resolve' ? resolveTicket.bind(null, ticketId) : updateResolutionNote.bind(null, ticketId);

    const [state, action, pending] = useActionState(boundAction, null);

    useEffect(() => {
        if (state?.success) onClose();
    }, [state, onClose]);

    const title = mode === 'resolve' ? 'Marcar como Solucionado' : 'Editar respuesta al usuario';
    const cta = mode === 'resolve' ? 'Marcar Solucionado' : 'Guardar cambios';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4">
            <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl ring-1 ring-zinc-200">
                <div className="flex items-center justify-between p-5 border-b border-zinc-100">
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-900">{title}</h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            Esta nota será visible para la clínica que reportó la solicitud.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-zinc-400 hover:text-zinc-600 transition-colors"
                        aria-label="Cerrar"
                    >
                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path
                                fillRule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                clipRule="evenodd"
                            />
                        </svg>
                    </button>
                </div>

                <form action={action} className="p-5 space-y-5">
                    {state?.error && !state.issues && (
                        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
                            {state.error}
                        </div>
                    )}

                    <div>
                        <label htmlFor="resolutionNote" className="block text-sm font-medium text-zinc-700 mb-1">
                            Informe / Nota de resolución *
                        </label>
                        <textarea
                            id="resolutionNote"
                            name="resolutionNote"
                            required
                            rows={7}
                            defaultValue={initialNote ?? ''}
                            placeholder="Describe brevemente qué se hizo, la causa y, si aplica, cómo evitar que vuelva a ocurrir."
                            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        />
                        {state?.issues?.resolutionNote && (
                            <p className="mt-1 text-xs text-red-500">{state.issues.resolutionNote[0]}</p>
                        )}
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={pending}
                            className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={pending}
                            className={`px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 flex items-center gap-2 min-w-[180px] justify-center ${
                                mode === 'resolve'
                                    ? 'bg-green-600 hover:bg-green-700'
                                    : 'bg-indigo-600 hover:bg-indigo-700'
                            }`}
                        >
                            {pending ? (
                                <>
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                                    </svg>
                                    Guardando
                                </>
                            ) : (
                                cta
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
