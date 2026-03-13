'use client';

import { useState, useMemo } from 'react';
import { Calendar, dateFnsLocalizer, View, Views } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale/es';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import AgendaGenerator from './AgendaGenerator';
import CloneDayModal from './CloneDayModal';

// Configuración de Localización para Español
const locales = {
    'es': es,
};

const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales,
});

export default function AgendaCalendarClient({
    slots,
    deps
}: {
    slots: any[],
    deps: any
}) {
    const [view, setView] = useState<View>(Views.WEEK);
    const [date, setDate] = useState(new Date());

    const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
    const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
    const [selectedDateStr, setSelectedDateStr] = useState<string>('');
    const [selectedTimeStr, setSelectedTimeStr] = useState<string>('');

    // Mapeo de ScheduleSlots a Eventos de React Big Calendar
    const events = useMemo(() => {
        return slots.map(slot => ({
            id: slot.id,
            title: `${slot.doctor?.fullName} - ${slot.service?.name}`,
            start: new Date(slot.startTime),
            end: new Date(slot.endTime),
            resource: slot, // Guardamos la metadata original
            isReserved: !!slot.appointment,
            epsName: slot.allowedEps?.name || 'Universal',
        }));
    }, [slots]);

    const handleSelectSlot = (slotInfo: { start: Date, end: Date, action: 'select' | 'click' | 'doubleClick' }) => {
        const d = slotInfo.start;
        // Format YYYY-MM-DD
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        // Format HH:mm
        const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

        setSelectedDateStr(dateStr);
        setSelectedTimeStr(timeStr);
        setIsGeneratorOpen(true);
    };

    const handleSelectEvent = (event: any) => {
        // TODO: Abrir detalles del Slot para borrarlo o ver quién lo reservó
        alert(`Slot de ${event.title}\nEstado: ${event.isReserved ? 'Reservado' : 'Disponible'}\nEPS: ${event.epsName}`);
    };

    // Estilos personalizados para los eventos en el calendario
    const eventPropGetter = (event: any) => {
        let backgroundColor = '#3b82f6'; // Blue-500 default (Disponible Universal)

        if (event.isReserved) {
            backgroundColor = '#ef4444'; // Red-500 (Ocupado / Reservado)
        } else if (event.epsName !== 'Universal') {
            backgroundColor = '#10b981'; // Emerald-500 (Disponible pero Exclusivo EPS)
        }

        return {
            style: {
                backgroundColor,
                borderRadius: '8px',
                opacity: 0.9,
                color: 'white',
                border: '0px',
                display: 'block',
                fontWeight: 600,
                fontSize: '0.75rem',
            }
        };
    };

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-800 h-[800px] flex flex-col">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Motor de Agendas Visual</h2>
                    <p className="text-sm text-zinc-500">Seleccione un espacio vacío para crear un cupo, o clone un día entero.</p>
                </div>
                <div className="flex gap-4 items-center">
                    <button
                        onClick={() => setIsCloneModalOpen(true)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition-colors flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                        Clonar Día
                    </button>
                    <div className="flex gap-3 bg-zinc-50 dark:bg-zinc-800 p-2 rounded-lg border border-zinc-200 dark:border-zinc-700">
                        <span className="flex items-center text-xs text-zinc-600 dark:text-zinc-400 font-medium whitespace-nowrap">
                            <span className="w-3 h-3 rounded-full bg-blue-500 mr-2"></span> Universal
                        </span>
                        <span className="flex items-center text-xs text-zinc-600 dark:text-zinc-400 font-medium whitespace-nowrap">
                            <span className="w-3 h-3 rounded-full bg-emerald-500 mr-2"></span> EPS Exclusiva
                        </span>
                        <span className="flex items-center text-xs text-zinc-600 dark:text-zinc-400 font-medium whitespace-nowrap pl-3 border-l border-zinc-200 dark:border-zinc-700">
                            <span className="w-3 h-3 rounded-full bg-red-500 mr-2"></span> Reservado
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-hidden">
                <Calendar
                    culture="es"
                    localizer={localizer}
                    events={events}
                    startAccessor="start"
                    endAccessor="end"
                    style={{ height: '100%' }}
                    view={view}
                    views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
                    date={date}
                    onNavigate={(newDate) => setDate(newDate)}
                    onView={(newView) => setView(newView)}
                    selectable={true}
                    onSelectSlot={handleSelectSlot}
                    onSelectEvent={handleSelectEvent}
                    step={30} // Intervalos de 30 mins
                    timeslots={1}
                    eventPropGetter={eventPropGetter}
                    messages={{
                        next: "Sig",
                        previous: "Ant",
                        today: "Hoy",
                        month: "Mes",
                        week: "Semana",
                        day: "Día",
                        agenda: "Agenda",
                        date: "Fecha",
                        time: "Hora",
                        event: "Evento",
                        noEventsInRange: "No hay cupos en este rango.",
                        showMore: total => `+ Ver más (${total})`
                    }}
                />
            </div>

            {isGeneratorOpen && (
                <AgendaGenerator
                    deps={deps}
                    isOpen={isGeneratorOpen}
                    onClose={() => setIsGeneratorOpen(false)}
                    initialDate={selectedDateStr}
                    initialStartTime={selectedTimeStr}
                />
            )}

            {isCloneModalOpen && (
                <CloneDayModal
                    deps={deps}
                    isOpen={isCloneModalOpen}
                    onClose={() => setIsCloneModalOpen(false)}
                />
            )}
        </div>
    );
}
