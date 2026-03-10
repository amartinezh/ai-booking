/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useTransition } from 'react';
import DoctorModal from './DoctorModal';
import { deleteDoctorAction } from './actions';

export default function DoctorClientView({ doctors, services }: { doctors: any[], services: any[] }) {
    const [editingDoctor, setEditingDoctor] = useState<any | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isPending, startTransition] = useTransition();

    const handleDelete = (id: string) => {
        if (!confirm('¿Estás seguro de eliminar este médico? Se borrará su acceso (User) y su agenda futura.')) return;
        startTransition(async () => {
            const res = await deleteDoctorAction(id);
            if (!res.success) alert(res.error);
        });
    };

    return (
        <div className="animate-fade-in space-y-8">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                        Plantilla Médica
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">
                        Gestiona los perfiles, credenciales y especialidades de los doctores del Hospital.
                    </p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-white bg-blue-600 rounded-xl shadow-xl shadow-blue-600/30 hover:bg-blue-700 hover:scale-105 transition-all"
                >
                    <span className="text-lg">🩺</span> Agregar Médico
                </button>
            </header>

            {(isCreating || editingDoctor) && (
                <DoctorModal
                    doctor={editingDoctor}
                    services={services}
                    onClose={() => { setIsCreating(false); setEditingDoctor(null); }}
                />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {doctors.map(doctor => (
                    <div key={doctor.id} className="group bg-white dark:bg-zinc-900 rounded-3xl p-6 shadow-xl shadow-zinc-200/50 dark:shadow-none border border-zinc-100 dark:border-zinc-800 hover:border-blue-500/50 transition-all flex flex-col justify-between">
                        <div>
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="h-12 w-12 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-xl text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800/50 font-bold">
                                        {doctor.fullName.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-zinc-900 dark:text-white leading-tight">{doctor.fullName}</h3>
                                        <p className="text-sm font-medium text-blue-600 dark:text-blue-400">{doctor.service?.name || 'Servicio no asignado'}</p>
                                    </div>
                                </div>
                                <span className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-lg border ${doctor.isActive ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-800' : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:border-red-800'}`}>
                                    {doctor.isActive ? 'Activo' : 'Inactivo'}
                                </span>
                            </div>

                            <div className="space-y-2 mt-5 text-sm">
                                <div className="flex justify-between border-b border-zinc-100 dark:border-zinc-800/30 pb-2">
                                    <span className="text-zinc-500 dark:text-zinc-400">T.P (Licencia)</span>
                                    <span className="font-medium text-zinc-900 dark:text-white">{doctor.medicalLicense || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between border-b border-zinc-100 dark:border-zinc-800/30 pb-2">
                                    <span className="text-zinc-500 dark:text-zinc-400">Cédula</span>
                                    <span className="font-medium text-zinc-900 dark:text-white">{doctor.cedula}</span>
                                </div>
                                <div className="flex justify-between pb-2">
                                    <span className="text-zinc-500 dark:text-zinc-400">Contacto</span>
                                    <span className="font-medium text-zinc-900 dark:text-white">{doctor.phone || 'Sin número'}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                            <button
                                onClick={() => setEditingDoctor(doctor)}
                                className="flex-1 py-2 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold py-2 px-4 rounded-xl text-sm transition-colors text-center"
                            >
                                Modificar Perfil
                            </button>
                            <button
                                onClick={() => handleDelete(doctor.id)}
                                disabled={isPending}
                                className="w-12 h-10 flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-xl text-sm transition-colors disabled:opacity-50"
                                title="Dar de baja"
                            >
                                🗑️
                            </button>
                        </div>
                    </div>
                ))}

                {doctors.length === 0 && (
                    <div className="col-span-1 lg:col-span-3 text-center py-20 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl">
                        <span className="text-4xl mb-4 block">🩺</span>
                        <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-1">Sin médicos registrados</h3>
                        <p className="text-zinc-500 dark:text-zinc-400">Aún no hay perfiles médicos para agendar citas.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
