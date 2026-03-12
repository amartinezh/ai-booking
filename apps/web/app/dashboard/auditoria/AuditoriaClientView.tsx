/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState } from 'react';

type InteractionLog = {
    id: string;
    whatsappId: string;
    status: string;
    failureReason: string | null;
    userMessage: string | null;
    botReply: string | null;
    metadata: any;
    createdAt: Date;
    patientId: string | null;
};

export default function AuditoriaClientView({ logs }: { logs: InteractionLog[] }) {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredLogs = logs.filter(log =>
        log.failureReason?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.whatsappId.includes(searchTerm) ||
        log.userMessage?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getReasonBadgeColor = (reason: string | null) => {
        if (!reason) return 'bg-gray-100 text-gray-800';
        if (reason === 'UNINTELLIGIBLE_AUDIO') return 'bg-orange-100 text-orange-800 border-orange-200';
        if (reason === 'NO_AGENDA') return 'bg-red-100 text-red-800 border-red-200';
        if (reason === 'AI_SYSTEM_FAILURE') return 'bg-purple-100 text-purple-800 border-purple-200';
        return 'bg-blue-100 text-blue-800 border-blue-200';
    };

    return (
        <div className="animate-fade-in space-y-8">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2 flex items-center gap-3">
                        <span>🕵️</span> Caja Negra - Auditoría
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">
                        Registro de eventos fallidos del Chatbot (Demanda insatisfecha). Identifique qué servicios buscan los pacientes que no tenemos agenda y recupérelos.
                    </p>
                </div>
                <div className="relative">
                    <span className="absolute left-3 top-3 text-zinc-400">🔍</span>
                    <input
                        type="text"
                        placeholder="Buscar teléfono o fallo..."
                        className="pl-10 pr-4 py-3 w-72 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </header>

            <div className="bg-white dark:bg-zinc-900 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-black/20 rounded-3xl overflow-hidden border border-zinc-100 dark:border-zinc-800">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
                        <thead className="bg-zinc-50/80 dark:bg-zinc-800/40 backdrop-blur-md">
                            <tr>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Fecha / Hora</th>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">WhatsApp</th>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Fallo (Motivo)</th>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Intención (IA / Texto)</th>
                                <th scope="col" className="relative px-6 py-5 text-right"><span className="sr-only">Acciones</span></th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800/60">
                            {filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-16 text-center text-zinc-500">
                                        No se encontraron registros de auditoría que coincidan con su búsqueda.
                                    </td>
                                </tr>
                            ) : (
                                filteredLogs.map((log) => (
                                    <tr key={log.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors group">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-bold text-zinc-900 dark:text-white">
                                                {new Date(log.createdAt).toLocaleDateString('es-CO')}
                                            </div>
                                            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono mt-0.5">
                                                {new Date(log.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="px-3 py-1 inline-flex text-xs font-bold rounded-lg bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/40 font-mono">
                                                💬 +{log.whatsappId}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${getReasonBadgeColor(log.failureReason)}`}>
                                                {log.failureReason || 'DESCONOCIDO'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 max-w-[300px]">
                                            <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200" title={log.userMessage || ''}>
                                                <span className="text-zinc-400 mr-1">Usuario:</span>{log.userMessage || 'N/A'}
                                            </p>
                                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-500 mt-1" title={log.botReply || ''}>
                                                <span className="text-zinc-400 mr-1">Bot:</span>{log.botReply || 'N/A'}
                                            </p>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <a
                                                href={`https://wa.me/${log.whatsappId.replace(/[^0-9]/g, '')}?text=Hola,%20soy%20secretaria%20del%20Hospital%20San%20Vicente.%20Noté%20que%20tuvo%20problemas%20con%20nuestro%20bot%20virtual...`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 hover:text-indigo-800 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-900/50 rounded-lg transition-all"
                                            >
                                                <span>Recuperar</span> <span>↗️</span>
                                            </a>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
