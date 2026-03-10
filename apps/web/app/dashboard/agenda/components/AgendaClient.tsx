/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use client';

import { useState } from 'react';
import AgendaTable from './AgendaTable';
import AgendaGenerator from './AgendaGenerator';

export default function AgendaClient({
    slots,
    deps
}: {
    slots: any[],
    deps: any
}) {
    const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [hidePastSlots, setHidePastSlots] = useState(true);

    const filteredSlots = slots.filter((slot) => {
        // Filtrar por Tiempo (Ocultar Agendas Vencidas si el toggle está activo)
        if (hidePastSlots) {
            if (new Date(slot.endTime) <= new Date()) return false;
        }

        // Filtrar por Texto de Búsqueda
        if (searchTerm.trim() !== '') {
            const lowerTerm = searchTerm.toLowerCase();
            const searchTargets = [
                slot.doctor?.fullName?.toLowerCase(),
                slot.service?.name?.toLowerCase(),
                slot.allowedEps ? slot.allowedEps.name.toLowerCase() : 'universal libre',
                slot.appointment ? 'reservado' : 'disponible',
                new Date(slot.startTime).toLocaleDateString(),
                new Date(slot.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            ].join(' ');

            if (!searchTargets.includes(lowerTerm)) {
                return false;
            }
        }
        return true;
    });

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                        Monitor de Agenda y Motor H.I.S
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Genere bloques de tiempo (slots) para permitir al Chatbot transaccionar citas.
                    </p>
                </div>

                <div className="flex w-full sm:w-auto items-center gap-3">
                    {/* Barra de Búsqueda Inteligente */}
                    <div className="relative flex-grow sm:flex-grow-0 sm:w-72">
                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                            <svg className="w-4 h-4 text-gray-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
                                <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z" />
                            </svg>
                        </div>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="block w-full p-2 pl-10 text-sm text-gray-900 border border-gray-300 rounded-lg bg-white focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                            placeholder="Buscar cita, médico, EPS..."
                        />
                    </div>

                    <button
                        onClick={() => setIsGeneratorOpen(true)}
                        className="flex-none bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Aperturar Agenda
                    </button>
                </div>
            </div>

            {/* Fila secundaria de controles (Toggles) */}
            <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                <div
                    onClick={() => setHidePastSlots(!hidePastSlots)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${hidePastSlots ? 'bg-indigo-600' : 'bg-gray-200'}`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${hidePastSlots ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
                <span className="text-sm font-medium text-gray-700 select-none">
                    Ocultar cupos con horarios ya vencidos o pasados hoy
                </span>
            </div>

            <AgendaTable data={filteredSlots} />
            {isGeneratorOpen && <AgendaGenerator deps={deps} isOpen={isGeneratorOpen} onClose={() => setIsGeneratorOpen(false)} />}
        </div>
    );
}
