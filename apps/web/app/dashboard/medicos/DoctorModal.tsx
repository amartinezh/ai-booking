/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState } from 'react';
import { saveDoctorAction } from './actions';

export default function DoctorModal({ doctor, services, onClose }: { doctor?: any, services: any[], onClose: () => void }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const formData = new FormData(e.currentTarget);
        if (doctor?.id) formData.append('id', doctor.id);

        // El checkbox no se envía si está desmarcado, procesamos su estado explícitamente
        const isActiveCheckbox = e.currentTarget.isActive as HTMLInputElement;
        formData.set('isActive', isActiveCheckbox.checked ? 'true' : 'false');

        const res = await saveDoctorAction(formData);
        if (!res.success) {
            setError(res.error || 'Ocurrió un error inesperado');
            setLoading(false);
        } else {
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40 backdrop-blur-sm animate-fade-in overflow-y-auto">
            <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 animate-slide-up my-auto">
                <div className="px-6 py-5 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50/50 dark:bg-zinc-800/20">
                    <h3 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                        <span>🩺</span> {doctor ? 'Editar Médico' : 'Crear Perfil Médico'}
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-2xl transition-colors">&times;</button>
                </div>

                <form onSubmit={handleSubmit} className="p-6">
                    {error && (
                        <div className="p-3 mb-5 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 flex items-center gap-2">
                            <span>⚠️</span> {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
                        <div className="md:col-span-2">
                            <h4 className="text-sm font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2">Credenciales (Login)</h4>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Correo Electrónico</label>
                            <input
                                name="email" type="email" required
                                defaultValue={doctor?.user?.email || ''}
                                className="w-full bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Contraseña</label>
                            <input
                                name="password" type="password" required={!doctor}
                                placeholder={doctor ? "••••••••" : ""}
                                className="w-full bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white outline-none"
                            />
                        </div>

                        <div className="md:col-span-2 mt-2">
                            <h4 className="text-sm font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2">Datos Profesionales</h4>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Nombre Completo</label>
                            <input
                                name="fullName" type="text" required
                                defaultValue={doctor?.fullName || ''}
                                className="w-full bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Número de Cédula (Documento)</label>
                            <input
                                name="cedula" type="text" required
                                defaultValue={doctor?.cedula || ''}
                                className="w-full bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Servicio Adscrito</label>
                            <select
                                name="serviceId"
                                defaultValue={doctor?.serviceId || ''}
                                required
                                className="w-full bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white outline-none"
                            >
                                <option value="">Seleccione el Servicio</option>
                                {services.map((svc: any) => (
                                    <option key={svc.id} value={svc.id}>{svc.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Tarjeta Profesional (Licencia)</label>
                            <input
                                name="medicalLicense" type="text"
                                defaultValue={doctor?.medicalLicense || ''}
                                className="w-full bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Teléfono de Contacto</label>
                            <input
                                name="phone" type="text"
                                defaultValue={doctor?.phone || ''}
                                className="w-full bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white outline-none"
                            />
                        </div>

                        <div className="flex items-center gap-3 mt-8">
                            <input
                                type="checkbox" id="isActive" name="isActive"
                                defaultChecked={doctor ? doctor.isActive : true}
                                className="w-5 h-5 text-blue-600 bg-zinc-100 border-zinc-300 rounded focus:ring-blue-500"
                            />
                            <label htmlFor="isActive" className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                                Estado Activo (Disponible para agendamiento)
                            </label>
                        </div>
                    </div>

                    <div className="pt-4 flex justify-end gap-3 border-t border-zinc-100 dark:border-zinc-800">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-3 rounded-xl font-bold bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-3 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all disabled:opacity-50"
                        >
                            {loading ? 'Guardando...' : 'Guardar Médico'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
