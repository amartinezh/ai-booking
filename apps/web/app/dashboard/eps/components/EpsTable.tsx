/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use client';

import { useState } from 'react';
import { updateEps, toggleEpsStatus, deleteEps } from '@/app/actions/eps';

// Ajustando tipado que coincida con lo que el server action manda (Prisma.Eps)
type EpsWithCounts = {
    id: string;
    name: string;
    nit: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count: {
        patients: number;
        appointments: number;
    };
};

export default function EpsTable({ data }: { data: EpsWithCounts[] }) {
    const [loadingId, setLoadingId] = useState<string | null>(null);

    const handleToggle = async (id: string, currentState: boolean) => {
        setLoadingId(id);
        await toggleEpsStatus(id, currentState);
        setLoadingId(null);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('¿Está seguro de eliminar esta EPS definitivamente?')) return;
        setLoadingId(id);
        const res = await deleteEps(id);
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
                            Nombre EPS
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            NIT / Registro
                        </th>
                        <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Métricas
                        </th>
                        <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Estado Operativo
                        </th>
                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Acciones
                        </th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {data.map((eps) => (
                        <tr key={eps.id} className="hover:bg-gray-50 transition-colors duration-150">
                            <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm font-medium text-gray-900">{eps.name}</div>
                                <div className="text-xs text-gray-500">Añadido {new Date(eps.createdAt).toLocaleDateString()}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {eps.nit || 'Sin Registrar'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                                <div className="flex flex-col gap-1 items-center font-mono text-xs">
                                    <span title="Pacientes Afiliados" className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                                        {eps._count.patients} pctes.
                                    </span>
                                    <span title="Histórico de Citas" className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full">
                                        {eps._count.appointments} citas
                                    </span>
                                </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                                <button
                                    onClick={() => handleToggle(eps.id, eps.isActive)}
                                    disabled={loadingId === eps.id}
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 disabled:opacity-50 ${eps.isActive ? 'bg-green-500' : 'bg-gray-300'
                                        }`}
                                    role="switch"
                                    aria-checked={eps.isActive}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${eps.isActive ? 'translate-x-5' : 'translate-x-0'
                                            }`}
                                    />
                                </button>
                                <div className="text-xs mt-1 text-gray-500">{eps.isActive ? 'Vigente' : 'Suspendida'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => handleDelete(eps.id)}
                                        disabled={loadingId === eps.id}
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
                            <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                                No hay ninguna aseguradora EPS registrada o que coincida con la búsqueda.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
