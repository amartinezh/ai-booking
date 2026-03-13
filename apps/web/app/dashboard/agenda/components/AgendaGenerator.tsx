/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use client';

import { useTransition, useState, useEffect } from 'react';
import { generateBulkSlots } from '@/app/actions/agenda';
import { useRouter } from 'next/navigation';

export default function AgendaGenerator({
    deps,
    isOpen,
    onClose,
    initialDate,
    initialStartTime
}: {
    deps: any,
    isOpen: boolean,
    onClose: () => void,
    initialDate?: string,
    initialStartTime?: string
}) {
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const router = useRouter();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/50 backdrop-blur-sm p-4">
            <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl ring-1 ring-gray-200 transition-all">
                <div className="flex bg-indigo-600 rounded-t-xl items-center justify-between p-4 border-b border-indigo-700">
                    <h3 className="text-lg font-semibold text-white">
                        Generador Avanzado de Agenda H.I.S
                    </h3>
                    <button onClick={onClose} className="text-indigo-200 hover:text-white transition-colors">
                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                <form action={(formData) => {
                    setError(''); setSuccessMsg('');
                    startTransition(async () => {
                        const res = await generateBulkSlots(formData);
                        if (!res.success) {
                            setError(res.error || 'Server error');
                        } else {
                            setSuccessMsg(res.message || 'Agenda abierta!');
                            router.refresh(); // Para asegurar sync de la tabla
                            setTimeout(() => { onClose(); setSuccessMsg(''); }, 2000);
                        }
                    });
                }} className="p-5 space-y-6">

                    {error && <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>}
                    {successMsg && <div className="p-3 text-sm text-green-700 bg-green-50 rounded-lg font-medium">{successMsg}</div>}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Especialista (Servicio Autodetectado) *</label>
                            <select name="doctorId" required className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-indigo-500 bg-white">
                                <option value="">Seleccione al Médico</option>
                                {deps.doctors.map((d: any) => (
                                    <option key={d.id} value={d.id}>
                                        Dr. {d.fullName} — {d.service?.name || 'Sin Asignar'}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Restricción Preferencial de Convenio (EPS)</label>
                            <select name="epsId" className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-indigo-500 bg-white">
                                <option value="none">🌐 Cupos Universales (Para cualquier EPS en el Chatbot)</option>
                                {deps.epsList.map((e: any) => (
                                    <option key={e.id} value={e.id}>
                                        🔒 Exclusivo: Privilegio a {e.name}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-gray-400 mt-1">La IA ofrecerá turnos exclusivos de Sura solo si el usuario en WhatsApp responde que pertenece a Sura.</p>
                        </div>

                        <div className="md:col-span-2 mt-2 pt-4 border-t border-gray-100">
                            <h4 className="text-sm font-semibold text-gray-800 mb-2">Acelerador de Tiempos</h4>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de la Agenda *</label>
                            <input type="date" name="date" defaultValue={initialDate || ""} required className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-indigo-500" />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Duración Base por Paciente (Minutos)</label>
                            <select name="durationMinutes" defaultValue="20" required className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-indigo-500">
                                <option value="15">15 Minutos (Triage Exprés)</option>
                                <option value="20">20 Minutos (Cita Gral)</option>
                                <option value="30">30 Minutos (Especialista)</option>
                                <option value="60">60 Minutos (Psiquiatría/Consulta Total)</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Hora Inicio Jornada *</label>
                            <input type="time" name="startTime" defaultValue={initialStartTime || "08:00"} required className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900" />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Hora Fin Jornada *</label>
                            <input type="time" name="endTime" defaultValue="12:00" required className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900" />
                        </div>
                    </div>

                    <div className="mt-5 flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button type="button" onClick={onClose} disabled={isPending} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
                            Cancelar Módulo
                        </button>
                        <button type="submit" disabled={isPending} className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 flex items-center justify-center gap-2">
                            {isPending ? 'Bifurcando Línea de Tiempo...' : 'Generar Slots H.I.S'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
