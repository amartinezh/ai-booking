'use client';

import { useState } from 'react';
import { toggleMedicalServiceStatus, deleteMedicalService } from '@/app/actions/services';

type ServiceWithCounts = {
    id: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count: {
        doctors: number;
        scheduleSlots: number;
    };
};

export default function ServicesTable({ data }: { data: ServiceWithCounts[] }) {
    const [loadingId, setLoadingId] = useState<string | null>(null);

    const handleToggle = async (id: string, currentState: boolean) => {
        setLoadingId(id);
        await toggleMedicalServiceStatus(id, currentState);
        setLoadingId(null);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('¿Está seguro de eliminar este Servicio Médico? Se requiere confirmación.')) return;
        setLoadingId(id);
        const res = await deleteMedicalService(id);
        if (!res.success) {
            alert(res.error);
        }
        setLoadingId(null);
    };

    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm mt-4">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Especialidad / Servicio
                        </th>
                        <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Métricas Operativas
                        </th>
                        <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Servicio Habitado
                        </th>
                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Acciones
                        </th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {data.map((service) => (
                        <tr key={service.id} className="hover:bg-gray-50 transition-colors duration-150">
                            <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm font-medium text-gray-900">{service.name}</div>
                                <div className="text-xs text-gray-500">Agregado el {new Date(service.createdAt).toLocaleDateString()}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                                <div className="flex flex-col gap-1 items-center font-mono text-xs">
                                    <span title="Staff Médico Asignado" className="bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full">
                                        {service._count.doctors} Especialista(s)
                                    </span>
                                    <span title="Agendas Históricas Abiertas" className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full">
                                        {service._count.scheduleSlots} Agendas Creadas
                                    </span>
                                </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                                <button
                                    onClick={() => handleToggle(service.id, service.isActive)}
                                    disabled={loadingId === service.id}
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 disabled:opacity-50 ${service.isActive ? 'bg-green-500' : 'bg-gray-300'
                                        }`}
                                    role="switch"
                                    aria-checked={service.isActive}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${service.isActive ? 'translate-x-5' : 'translate-x-0'
                                            }`}
                                    />
                                </button>
                                <div className="text-xs mt-1 text-gray-500">{service.isActive ? 'Prestando Servicio' : 'Sub-oferta Inactiva'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => handleDelete(service.id)}
                                        disabled={loadingId === service.id}
                                        className="text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                                        title="Eliminar del Sistema"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                        </svg>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                    {data.length === 0 && (
                        <tr>
                            <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                                Aún no hay especialidades añadidas al catálogo o devueltas por el buscador.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
