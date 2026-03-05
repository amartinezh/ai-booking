/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useTransition } from 'react';
import PatientModal from './PatientModal';
import { deletePatientAction } from './actions';

export default function PatientClientView({ patients }: { patients: any[] }) {
    const [editingPatient, setEditingPatient] = useState<any | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isPending, startTransition] = useTransition();

    const handleDelete = (id: string) => {
        if (!confirm('¿Estás seguro de eliminar este registro de paciente? Perderá acceso a la plataforma y se borrarán sus dependencias inmediatas.')) return;
        startTransition(async () => {
            const res = await deletePatientAction(id);
            if (!res.success) alert(res.error);
        });
    };

    return (
        <div className="animate-fade-in space-y-8">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                        Directorio de Pacientes
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">
                        Visualiza los registros clínicos y datos de contacto de los pacientes de la institución.
                    </p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-white bg-indigo-600 rounded-xl shadow-xl shadow-indigo-600/30 hover:bg-indigo-700 hover:scale-105 transition-all"
                >
                    <span className="text-lg">👥</span> Añadir Paciente
                </button>
            </header>

            {(isCreating || editingPatient) && (
                <PatientModal
                    patient={editingPatient}
                    onClose={() => { setIsCreating(false); setEditingPatient(null); }}
                />
            )}

            <div className="bg-white dark:bg-zinc-900 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-black/20 rounded-3xl overflow-hidden border border-zinc-100 dark:border-zinc-800">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
                        <thead className="bg-zinc-50/80 dark:bg-zinc-800/40 backdrop-blur-md">
                            <tr>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Identidad</th>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Cédula</th>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Contacto (WA)</th>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Correo (Login)</th>
                                <th scope="col" className="relative px-6 py-5"><span className="sr-only">Acciones</span></th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800/60">
                            {patients.map(patient => (
                                <tr key={patient.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors group">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center">
                                            <div className="flex-shrink-0 h-10 w-10 bg-gradient-to-tr from-indigo-100 to-purple-100 dark:from-indigo-900/40 dark:to-purple-900/40 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center font-bold text-lg border border-indigo-200/50 dark:border-indigo-800/50">
                                                {patient.fullName.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="ml-4">
                                                <div className="text-sm font-bold text-zinc-900 dark:text-white">
                                                    {patient.fullName}
                                                </div>
                                                <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono mt-0.5">
                                                    {patient.id.slice(0, 8)}...
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="text-sm text-zinc-900 dark:text-white font-medium">{patient.cedula}</span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {patient.whatsappId ? (
                                            <span className="px-3 py-1 inline-flex text-xs font-bold rounded-lg bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/40">
                                                💬 {patient.whatsappId}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-zinc-400 italic">No registrado</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                                        {patient.user?.email || 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-2">
                                            <button
                                                onClick={() => setEditingPatient(patient)}
                                                className="p-2 text-zinc-400 hover:text-indigo-600 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 transition-all"
                                                title="Editar"
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                onClick={() => handleDelete(patient.id)}
                                                disabled={isPending}
                                                className="p-2 text-zinc-400 hover:text-red-600 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 hover:border-red-300 transition-all disabled:opacity-50"
                                                title="Eliminar"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {patients.length === 0 && (
                        <div className="text-center py-16 text-zinc-500">
                            No hay pacientes en la base de datos.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
