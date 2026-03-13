'use client';

import { useTransition, useState } from 'react';
import { cloneDaySlots } from '@/app/actions/agenda';
import { useRouter } from 'next/navigation';

export default function CloneDayModal({ deps, isOpen, onClose }: { deps: any, isOpen: boolean, onClose: () => void }) {
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const router = useRouter();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/50 backdrop-blur-sm p-4">
            <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl ring-1 ring-gray-200 transition-all">
                <div className="flex bg-emerald-600 rounded-t-xl items-center justify-between p-4 border-b border-emerald-700">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                        Máquina de Clonación H.I.S
                    </h3>
                    <button onClick={onClose} className="text-emerald-200 hover:text-white transition-colors">
                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                <form action={(formData) => {
                    setError(''); setSuccessMsg('');
                    startTransition(async () => {
                        const res = await cloneDaySlots(formData);
                        if (!res.success) {
                            setError(res.error || 'Server error');
                        } else {
                            setSuccessMsg(res.message || 'Agenda Clonada!');
                            router.refresh();
                            setTimeout(() => { onClose(); setSuccessMsg(''); }, 2000);
                        }
                    });
                }} className="p-5 space-y-6">

                    {error && <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>}
                    {successMsg && <div className="p-3 text-sm text-green-700 bg-green-50 rounded-lg font-medium">{successMsg}</div>}

                    <p className="text-sm text-gray-500">Este módulo replicará de forma exacta el horario de trabajo y los intervalos de tiempo del Doctor desde un Día Origen hacia un Día Destino.</p>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Médico a Clonar *</label>
                            <select name="doctorId" required className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-emerald-500 bg-white shadow-sm">
                                <option value="">Seleccione al Médico</option>
                                {deps.doctors.map((d: any) => (
                                    <option key={d.id} value={d.id}>
                                        Dr. {d.fullName}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">1️⃣ Día Origen (Plantilla) *</label>
                                <input type="date" name="sourceDate" required className="w-full shadow-sm rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-emerald-500" />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">2️⃣ Día Destino (Pegado) *</label>
                                <input type="date" name="targetDate" required className="w-full shadow-sm rounded-md border border-blue-300 px-3 py-2 text-blue-900 bg-blue-50 focus:border-blue-500" />
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button type="button" onClick={onClose} disabled={isPending} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50">
                            Cancelar
                        </button>
                        <button type="submit" disabled={isPending} className="px-5 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm">
                            {isPending ? 'Ejecutando Clonación Cuántica...' : 'Clonar Agenda'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
