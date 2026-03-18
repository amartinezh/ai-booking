'use client';

import { useState } from 'react';
import { sendManualWhatsappAction, createManualAppointmentAction, updateManualAppointmentAction } from './actions';

export default function AppointmentModal({
    isOpen,
    onClose,
    eventData, // Si trae eventData, es modo DETALLE. Si es null, modo CREACIÓN.
    epsList,
    doctorList,
    servicesList,
    defaultDate
}: {
    isOpen: boolean;
    onClose: () => void;
    eventData: any | null;
    epsList: any[];
    doctorList: any[];
    servicesList: any[];
    defaultDate?: Date | null;
}) {
    const [loading, setLoading] = useState(false);
    const [msgMode, setMsgMode] = useState(false);
    const [msgText, setMsgText] = useState('');
    const [isEditing, setIsEditing] = useState(false);

    if (!isOpen) return null;

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.target as HTMLFormElement);
        const res = await updateManualAppointmentAction(eventData.id, formData);
        setLoading(false);
        if (res.success) {
            setIsEditing(false);
            onClose();
        } else {
            alert(res.error);
        }
    };

    const handleWhatsapp = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const res = await sendManualWhatsappAction(eventData.id, msgText);
        setLoading(false);
        if (res.success) {
            alert('Mensaje enviado por WhatsApp');
            setMsgMode(false);
            setMsgText('');
        } else {
            alert(res.error);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.target as HTMLFormElement);
        // Helper para inyectar default date si existe
        if (defaultDate && !formData.get('startDate')) {
            // ISO trick to local time
            const d = new Date(defaultDate.getTime() - defaultDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            formData.set('startDate', d);
        }

        const res = await createManualAppointmentAction(formData);
        setLoading(false);
        if (res.success) {
            onClose();
        } else {
            alert(res.error);
        }
    };

    // VISTA: DETALLES DE CITA
    if (eventData) {
        if (isEditing) {
            // EDIT FORM
            const dStrEdit = eventData.scheduleSlot?.startTime ? new Date(new Date(eventData.scheduleSlot.startTime).getTime() - new Date(eventData.scheduleSlot.startTime).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
            return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-zinc-200 dark:border-zinc-800">
                        <div className="border-b border-zinc-200 dark:border-zinc-800 p-6 flex justify-between items-center bg-blue-50 dark:bg-blue-900/10">
                            <h3 className="text-xl font-bold text-blue-700 dark:text-blue-400">Modificar Cita Interfaz</h3>
                            <button onClick={onClose} className="text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 p-2 rounded-full transition-colors">✖</button>
                        </div>
                        <form onSubmit={handleUpdate} className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-1">
                                    <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Cédula del Paciente</label>
                                    <input required name="cedula" defaultValue={eventData.patient?.cedula} type="text" className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm" />
                                </div>
                                <div className="col-span-1">
                                    <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Nombre Paciente</label>
                                    <input required name="fullName" defaultValue={eventData.patient?.fullName} type="text" className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-1">
                                    <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Servicio</label>
                                    <select required name="serviceId" defaultValue={eventData.scheduleSlot?.serviceId} className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm">
                                        <option value="">Seleccione...</option>
                                        {servicesList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                                <div className="col-span-1">
                                    <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Médico</label>
                                    <select required name="doctorId" defaultValue={eventData.scheduleSlot?.doctorId} className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm">
                                        <option value="">Seleccione...</option>
                                        {doctorList.map(d => <option key={d.id} value={d.id}>{d.fullName}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Entidad EPS</label>
                                <select required name="epsId" defaultValue={eventData.epsId || ''} className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm">
                                    <option value="">Sin EPS / Particular</option>
                                    {epsList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Fecha y Hora</label>
                                <input required name="startDate" type="datetime-local" defaultValue={dStrEdit} className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm" />
                            </div>
                            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 mt-2 flex justify-end gap-3">
                                <button type="button" onClick={() => setIsEditing(false)} className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-sm font-semibold py-2 px-4 rounded-lg">Cancelar</button>
                                <button disabled={loading} type="submit" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2 px-6 rounded-lg disabled:opacity-50">
                                    {loading ? 'Guardando...' : 'Re-Agendar Cita'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            );
        }

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-zinc-200 dark:border-zinc-800">
                    <div className="border-b border-zinc-200 dark:border-zinc-800 p-6">
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="text-xl font-bold text-zinc-900 dark:text-white">Detalles de Cita</h3>
                                <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mt-1">
                                    {eventData.scheduleSlot?.doctor?.fullName ? `Dr. ${eventData.scheduleSlot.doctor.fullName}` : ''}
                                </p>
                            </div>
                            <button onClick={onClose} className="text-zinc-500 hover:bg-zinc-100 p-2 rounded-full transition-colors">
                                ✖
                            </button>
                        </div>
                    </div>

                    <div className="p-6 space-y-4 text-sm text-zinc-600 dark:text-zinc-300">
                        <div className="flex gap-2">
                            <span className="font-semibold text-zinc-900 dark:text-white">Paciente:</span>
                            {eventData.patient?.fullName} - Doc: {eventData.patient?.cedula}
                        </div>
                        <div className="flex gap-2">
                            <span className="font-semibold text-zinc-900 dark:text-white">Horario:</span>
                            {new Date(eventData.scheduleSlot?.startTime).toLocaleString('es-CO')}
                        </div>
                        <div className="flex gap-2">
                            <span className="font-semibold text-zinc-900 dark:text-white">Especialidad/Servicio:</span>
                            <span className="bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-md font-bold">{eventData.scheduleSlot?.service?.name}</span>
                        </div>
                        <div className="flex gap-2 items-center">
                            <span className="font-semibold text-zinc-900 dark:text-white">Origen Sistema:</span>
                            {eventData.origin === 'WHATSAPP' ? (
                                <span className="text-xs bg-emerald-50 text-emerald-700 font-bold px-2 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
                                    🤖 Creado por Vicente (Bot)
                                </span>
                            ) : (
                                <span className="text-xs bg-blue-50 text-blue-700 font-bold px-2 py-1 rounded-full border border-blue-200 flex items-center gap-1">
                                    👤 Creación Manual Agente
                                </span>
                            )}
                        </div>

                        {msgMode && (
                            <form onSubmit={handleWhatsapp} className="mt-6 border-t border-zinc-200 dark:border-zinc-800 pt-4 animate-in slide-in-from-top-2">
                                <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-2">Mensaje WhatsApp Saliente a {eventData.patient?.fullName}</label>
                                <textarea 
                                    required
                                    rows={3}
                                    value={msgText}
                                    onChange={e => setMsgText(e.target.value)}
                                    className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-sm focus:ring-2 focus:ring-emerald-500 mb-2"
                                    placeholder="Hola, nos comunicamos del Hospital San Vicente..."
                                />
                                <div className="flex gap-2 justify-end">
                                    <button type="button" onClick={() => setMsgMode(false)} className="px-3 py-1.5 text-xs text-zinc-600 font-semibold hover:bg-zinc-100 rounded-md">Cancelar</button>
                                    <button disabled={loading} type="submit" className="bg-emerald-500 text-white font-bold text-xs px-3 py-1.5 rounded-md hover:bg-emerald-600 disabled:opacity-50">
                                        Enviar WhatsApp
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>

                    {!msgMode && (
                        <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-900/50 flex justify-end gap-3">
                            {eventData.origin === 'WHATSAPP' && (
                                <button onClick={() => setMsgMode(true)} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2 px-4 rounded-lg flex items-center gap-2 text-sm transition-colors">
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12.002 0A12 12 0 0 0 0 12c0 2.124.553 4.128 1.523 5.86L.002 24l5.955-1.562a11.96 11.96 0 0 0 6.044 1.565A12 12 0 1 0 12.002 0zM7.4 8.6c.14-.14.33-.2.53-.26.21-.06.4-.04.57.1.18.15.54.91.59 1.02.04.1.06.21 0 .31-.06.1-.1.17-.2.3l-.29.35c-.09.11-.19.22-.07.43.12.21.54.89 1.15 1.43.79.71 1.48.93 1.69 1.03.2.1.32.09.43-.03l.5-.6c.12-.13.26-.17.43-.1.17.07 1.1.52 1.28.61.19.09.31.14.36.22.04.08.04.47-.11 1.05-.14.59-.83 1.15-1.56 1.25-.72.11-1.46.2-4.04-1.28-2.58-1.5-4.22-3.96-4.35-4.14-.12-.18-1.04-1.38-1.04-2.63 0-1.25.65-1.87.89-2.12z"/></svg>
                                    Contactar
                                </button>
                            )}
                            <button onClick={() => setIsEditing(true)} className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-semibold py-2 px-4 rounded-lg text-sm hover:bg-blue-200 transition-colors">
                                📝 Modificar Cita
                            </button>
                            <button onClick={onClose} className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-semibold py-2 px-4 rounded-lg text-sm transition-colors">
                                Cerrar
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // VISTA: CREACIÓN MANUAL
    const dStr = defaultDate ? new Date(defaultDate.getTime() - defaultDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-zinc-200 dark:border-zinc-800">
                <div className="border-b border-zinc-200 dark:border-zinc-800 p-6 flex justify-between items-center bg-blue-50 dark:bg-blue-900/10">
                    <h3 className="text-xl font-bold text-blue-700 dark:text-blue-400">Agendar Cita (Manual)</h3>
                    <button onClick={onClose} className="text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 p-2 rounded-full transition-colors">✖</button>
                </div>

                <form onSubmit={handleCreate} className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-1">
                            <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Cédula del Paciente</label>
                            <input required name="cedula" type="text" className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm" placeholder="100..." />
                        </div>
                        <div className="col-span-1">
                            <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Nombre Paciente</label>
                            <input required name="fullName" type="text" className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm" placeholder="Nombre completo" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-1">
                            <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Especialidad/Servicio</label>
                            <select required name="serviceId" className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm">
                                <option value="">Seleccione...</option>
                                {servicesList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                        <div className="col-span-1">
                            <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Médico Responsable</label>
                            <select required name="doctorId" className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm">
                                <option value="">Seleccione...</option>
                                {doctorList.map(d => <option key={d.id} value={d.id}>{d.fullName}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Entidad EPS Administradora</label>
                        <select required name="epsId" className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm">
                            <option value="">Seleccione...</option>
                            {epsList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Fecha y Hora de Inicio Estimada</label>
                        <input required name="startDate" type="datetime-local" defaultValue={dStr} className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-sm" />
                    </div>

                    <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 mt-2 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 text-sm font-semibold py-2 px-4 rounded-lg">
                            Cancelar
                        </button>
                        <button disabled={loading} type="submit" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2 px-6 rounded-lg disabled:opacity-50">
                            {loading ? 'Agendando...' : 'Crear Cita Manual'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
