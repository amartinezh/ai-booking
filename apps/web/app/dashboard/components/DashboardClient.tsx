/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cancelAppointmentAndFreeSlot, updateAttendance } from '@/app/actions/dashboard';
import ClinicalRecordDrawer from './ClinicalRecordDrawer';
import { useDebouncedCallback } from 'use-debounce';

export default function DashboardClient({
    appointments,
    epsList,
    doctorsList,
    role
}: {
    appointments: any[],
    epsList: any[],
    doctorsList: any[],
    role: string
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [loadingId, setLoadingId] = useState<string | null>(null);

    const handleFilterChange = (key: string, value: string) => {
        const params = new URLSearchParams(searchParams);
        if (value && value !== 'all') {
            params.set(key, value);
        } else {
            params.delete(key);
        }
        router.replace(`/dashboard?${params.toString()}`);
    };

    const handleCancelAndFree = async (appointmentId: string, slotId: string) => {
        if (!confirm('¿Seguro de cancelar la cita? Esto liberará el turno de nuevo al mercado para que otro paciente pueda reservarlo vía WhatsApp o Portal.')) return;
        setLoadingId(appointmentId);
        const res = await cancelAppointmentAndFreeSlot(appointmentId, slotId);
        if (!res.success) alert(res.error);
        setLoadingId(null);
    }

    const handleAttendance = async (appointmentId: string, status: string) => {
        setLoadingId(appointmentId);
        const res = await updateAttendance(appointmentId, status);
        if (!res.success) alert(res.error);
        setLoadingId(null);
    };

    const [ehrAppointment, setEhrAppointment] = useState<any | null>(null);

    return (
        <>
            {ehrAppointment && (
                <ClinicalRecordDrawer
                    appointment={ehrAppointment}
                    onClose={() => setEhrAppointment(null)}
                />
            )}

            <div className="mb-6 flex flex-col md:flex-row gap-4 items-center bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-zinc-500">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
                    </svg>
                    <span className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">Filtros Activos:</span>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                    <input 
                        type="date"
                        title="Fecha Inicial"
                        onChange={(e) => handleFilterChange('startDate', e.target.value)}
                        defaultValue={searchParams.get('startDate') || ''}
                        className="w-full md:w-36 rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm py-2 px-3 focus:ring-indigo-500"
                    />
                    <span className="text-zinc-400 text-sm">-</span>
                    <input 
                        type="date"
                        title="Fecha Final"
                        onChange={(e) => handleFilterChange('endDate', e.target.value)}
                        defaultValue={searchParams.get('endDate') || ''}
                        className="w-full md:w-36 rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm py-2 px-3 focus:ring-indigo-500"
                    />
                </div>

                {role !== 'DOCTOR' && role !== 'PATIENT' && (
                    <select
                        onChange={(e) => handleFilterChange('doctor', e.target.value)}
                        defaultValue={searchParams.get('doctor') || 'all'}
                        className="w-full md:w-64 rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm py-2 px-3 focus:ring-indigo-500"
                    >
                        <option value="all">👨‍⚕️ Todos los Médicos</option>
                        {doctorsList.map(d => <option key={d.id} value={d.id}>Dr/a. {d.fullName}</option>)}
                    </select>
                )}

                {role !== 'PATIENT' && (
                    <select
                        onChange={(e) => handleFilterChange('eps', e.target.value)}
                        defaultValue={searchParams.get('eps') || 'all'}
                        className="w-full md:w-64 rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm py-2 px-3 focus:ring-indigo-500"
                    >
                        <option value="all">🏦 Todas las EPS (Convenios)</option>
                        {epsList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                )}
            </div>

            <div className="bg-white dark:bg-zinc-900 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
                        <thead className="bg-zinc-50/50 dark:bg-zinc-800/20">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold text-zinc-500 uppercase">Horario Slot</th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-zinc-500 uppercase">Estudio/EPS</th>
                                {role !== 'PATIENT' && <th className="px-6 py-4 text-left text-xs font-bold text-zinc-500 uppercase">Paciente</th>}
                                {role !== 'DOCTOR' && <th className="px-6 py-4 text-left text-xs font-bold text-zinc-500 uppercase">Médico</th>}
                                <th className="px-6 py-4 text-center text-xs font-bold text-zinc-500 uppercase">Estado y Asistencia</th>
                                <th className="px-6 py-4 text-right text-xs font-bold text-zinc-500 uppercase">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
                            {appointments.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-zinc-500">
                                        <span className="text-4xl mb-3 block">📭</span>
                                        No se encontraron citas bajo esos filtros.
                                    </td>
                                </tr>
                            ) : (
                                appointments.map((apt) => (
                                    <tr key={apt.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                                        <td className="px-6 py-5 whitespace-nowrap">
                                            <div className="font-semibold text-zinc-900 dark:text-white">
                                                {new Date(apt.scheduleSlot.startTime).toLocaleDateString('es-CO')}
                                            </div>
                                            <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                                                {new Date(apt.scheduleSlot.startTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} - {new Date(apt.scheduleSlot.endTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 whitespace-nowrap">
                                            <div className="mb-1">
                                                <span className="px-3 py-1 inline-flex text-xs font-bold rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-800">
                                                    {apt.scheduleSlot.service.name}
                                                </span>
                                            </div>
                                            {apt.eps && (
                                                <span className="text-[10px] uppercase font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                                    EPS: {apt.eps.name}
                                                </span>
                                            )}
                                        </td>

                                        {role !== 'PATIENT' && (
                                            <td className="px-6 py-5 whitespace-nowrap">
                                                <div className="text-sm font-bold text-zinc-900 dark:text-white">{apt.patient.fullName}</div>
                                                <div className="text-xs text-zinc-500">DNI: {apt.patient.cedula}</div>
                                            </td>
                                        )}

                                        {role !== 'DOCTOR' && (
                                            <td className="px-6 py-5 whitespace-nowrap">
                                                <div className="text-sm font-bold text-zinc-900 dark:text-white">Dr. {apt.scheduleSlot.doctor.fullName}</div>
                                            </td>
                                        )}

                                        <td className="px-6 py-5 whitespace-nowrap text-center">
                                            <div className="mb-2">
                                                <span className={`px-4 py-1.5 inline-flex text-xs font-bold rounded-full border ${apt.status === 'SCHEDULED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-50 text-zinc-600 border-zinc-200'}`}>
                                                    {apt.status === 'CANCELLED' ? 'CANCELADA' : apt.status}
                                                </span>
                                                {apt.origin === 'WHATSAPP' && apt.status === 'SCHEDULED' && <div className="mt-1 ml-1 text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-full inline-block border border-indigo-200">🤖 AI Bot</div>}
                                                {apt.origin === 'MANUAL' && apt.status === 'SCHEDULED' && <div className="mt-1 ml-1 text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full inline-block border border-blue-200">👤 Manual</div>}
                                            </div>

                                            {/* ATTENDANCE TOGGLE */}
                                            {apt.status === 'SCHEDULED' && role !== 'PATIENT' && (
                                                <div className="mt-2 inline-flex flex-col items-center">
                                                    <select 
                                                        value={apt.attendanceStatus} 
                                                        onChange={(e) => handleAttendance(apt.id, e.target.value)}
                                                        disabled={loadingId === apt.id}
                                                        className={`text-xs font-semibold px-2 py-1 rounded-md border ${
                                                            apt.attendanceStatus === 'ATTENDED' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
                                                            apt.attendanceStatus === 'NO_SHOW' ? 'bg-red-100 text-red-800 border-red-300' :
                                                            'bg-amber-50 text-amber-600 border-amber-200'
                                                        }`}
                                                    >
                                                        <option value="PENDING">En Espera</option>
                                                        <option value="ATTENDED">✅ Asistió</option>
                                                        <option value="NO_SHOW">❌ Ausente</option>
                                                    </select>
                                                </div>
                                            )}
                                        </td>

                                        <td className="px-6 py-5 whitespace-nowrap text-right space-y-2">
                                            {apt.status === 'SCHEDULED' && apt.attendanceStatus === 'ATTENDED' && role === 'DOCTOR' && (
                                                <button
                                                    onClick={() => setEhrAppointment(apt)}
                                                    className="w-full text-xs font-semibold px-3 py-1.5 rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm"
                                                >
                                                    📝 Hist. Clínica
                                                </button>
                                            )}

                                            {apt.status === 'SCHEDULED' && apt.attendanceStatus !== 'ATTENDED' && (
                                                <button
                                                    onClick={() => handleCancelAndFree(apt.id, apt.scheduleSlotId)}
                                                    disabled={loadingId === apt.id}
                                                    className="w-full text-xs font-semibold px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                                                >
                                                    Anular y Liberar
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}
