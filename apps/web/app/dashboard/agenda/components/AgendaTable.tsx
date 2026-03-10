/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use client';

import { useState } from 'react';
import { deleteSlot } from '@/app/actions/agenda';

export default function AgendaTable({ data }: { data: any[] }) {
    const [loadingId, setLoadingId] = useState<string | null>(null);

    const handleDelete = async (id: string) => {
        if (!confirm('¿Desea cerrar y eliminar este bloque de agenda permanentemente?')) return;
        setLoadingId(id);
        const res = await deleteSlot(id);
        if (!res.success) alert(res.error);
        setLoadingId(null);
    };

    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm mt-4">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Turno / Horario</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Profesional Asignado</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Especialidad</th>
                        <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Restricción EPS</th>
                        <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Estado Actual</th>
                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Opciones</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {data.map((slot) => {
                        const startDate = new Date(slot.startTime);
                        const endDate = new Date(slot.endTime);
                        const timeStr = `${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                        return (
                            <tr key={slot.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm font-semibold text-gray-900">{startDate.toLocaleDateString()}</div>
                                    <div className="text-sm text-gray-600 font-mono mt-0.5">{timeStr}</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    Dr/a. {slot.doctor.fullName}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {slot.service.name}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center text-sm">
                                    {slot.allowedEps ? (
                                        <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-xs font-medium">Exclusivo: {slot.allowedEps.name}</span>
                                    ) : (
                                        <span className="text-gray-400 italic">Universal Libre</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-center">
                                    {slot.appointment ? (
                                        <span className="bg-gray-200 text-gray-700 font-medium px-2 py-1 rounded text-xs border border-gray-300">Reservado</span>
                                    ) : (
                                        <span className="bg-emerald-100 text-emerald-800 font-medium px-2 py-1 rounded text-xs border border-emerald-200">Disponible (AI)</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    {!slot.appointment && (
                                        <button
                                            onClick={() => handleDelete(slot.id)}
                                            disabled={loadingId === slot.id}
                                            className="text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                                            title="Eliminar Slot de Agenda"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                            </svg>
                                        </button>
                                    )}
                                </td>
                            </tr>
                        )
                    })}
                    {data.length === 0 && (
                        <tr>
                            <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                                La agenda clínica está vacía. Genere cupos para que los pacientes puedan agendarse en WhatsApp H.I.S.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
