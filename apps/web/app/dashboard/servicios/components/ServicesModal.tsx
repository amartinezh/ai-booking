'use client';

import { useActionState, useEffect } from 'react';
import { createMedicalService } from '@/app/actions/services';

export default function ServicesModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const [state, action, pending] = useActionState(createMedicalService, null);

    useEffect(() => {
        if (state?.success) {
            onClose();
        }
    }, [state, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/50 backdrop-blur-sm p-4">
            <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl ring-1 ring-gray-200 transition-all">
                <div className="flex items-center justify-between p-4 border-b border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900">
                        Registrar Especialidad Médica
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 focus:outline-none transition-colors"
                    >
                        <span className="sr-only">Cerrar modal</span>
                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                <form action={action} className="p-5 space-y-4">
                    {state?.error && (
                        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
                            {state.error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                                Nombre Oficial del Servicio *
                            </label>
                            <input
                                type="text"
                                name="name"
                                id="name"
                                placeholder="Ej. Medicina Interna, Ortopedia Infantil..."
                                required
                                className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
                            />
                            {state?.issues?.name && <p className="mt-1 text-xs text-red-500">{state.issues.name}</p>}
                        </div>

                        <div className="flex items-start bg-gray-50 p-3 rounded-lg border border-gray-100">
                            <div className="flex h-5 items-center">
                                <input
                                    id="isActive"
                                    name="isActive"
                                    type="checkbox"
                                    defaultChecked
                                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                                />
                            </div>
                            <div className="ml-3 text-sm">
                                <label htmlFor="isActive" className="font-medium text-gray-700">Apertura Inmediata</label>
                                <p className="text-gray-500 text-xs">Aplaza el check si este servicio médico es una proyeccional futura de sanidad.</p>
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={pending}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={pending}
                            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 flex items-center justify-center gap-2 min-w-[120px]"
                        >
                            {pending ? (
                                <>
                                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>Procesando</span>
                                </>
                            ) : (
                                'Registrar'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
