/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useActionState, useEffect } from 'react';
import { createTicket } from '@/app/actions/support';

export default function NewTicketModal({
    isOpen,
    onClose,
}: {
    isOpen: boolean;
    onClose: () => void;
}) {
    const [state, action, pending] = useActionState(createTicket, null);

    useEffect(() => {
        if (state?.success) onClose();
    }, [state, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4">
            <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl ring-1 ring-zinc-200">
                <div className="flex items-center justify-between p-5 border-b border-zinc-100">
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-900">Reportar Falla / Nueva Solicitud</h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            Cuéntale al equipo de soporte qué está pasando. Te avisaremos cuando lo tomemos.
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
                        <label htmlFor="title" className="block text-sm font-medium text-zinc-700 mb-1">
                            Título de la solicitud *
                        </label>
                        <input
                            id="title"
                            name="title"
                            type="text"
                            required
                            maxLength={140}
                            placeholder="Ej. No puedo cargar la agenda del Dr. Pérez"
                            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        {state?.issues?.title && (
                            <p className="mt-1 text-xs text-red-500">{state.issues.title[0]}</p>
                        )}
                    </div>

                    <div>
                        <label htmlFor="description" className="block text-sm font-medium text-zinc-700 mb-1">
                            Detalles del problema *
                        </label>
                        <textarea
                            id="description"
                            name="description"
                            required
                            rows={6}
                            placeholder="Describe el comportamiento esperado vs lo que sucede, pasos para reproducirlo y, si aplica, mensajes de error."
                            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        {state?.issues?.description && (
                            <p className="mt-1 text-xs text-red-500">{state.issues.description[0]}</p>
                        )}
                        <p className="mt-1 text-xs text-zinc-500">
                            Mientras más detalle, más rápida podrá ser la atención.
                        </p>
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
                            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 min-w-[160px] justify-center"
                        >
                            {pending ? (
                                <>
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                                    </svg>
                                    Enviando
                                </>
                            ) : (
                                'Enviar solicitud'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
