'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es as esCO } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import AppointmentModal from './AppointmentModal';

// Configure the localizer for react-big-calendar supporting Spanish
const locales = {
  'es': esCO,
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
})

export default function CalendarClient({
    appointments,
    epsList,
    doctorList,
    servicesList,
    role
}: {
    appointments: any[],
    epsList: any[],
    doctorList: any[],
    servicesList: any[],
    role: string
}) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<any>(null);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);

    // Map DB Appointments to Calendar Events
    const events = appointments.map(apt => ({
        id: apt.id,
        title: `${apt.patient.fullName} - ${apt.scheduleSlot.service.name}`,
        start: new Date(apt.scheduleSlot.startTime),
        end: new Date(apt.scheduleSlot.endTime),
        resource: apt,
    }));

    // Debounced search for the Omnibox
    const handleSearch = useDebouncedCallback((term: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (term) {
            params.set('search', term);
        } else {
            params.delete('search');
        }
        router.push(`?${params.toString()}`);
    }, 300);

    const handleFilterChange = (key: string, value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value && value !== 'all') {
            params.set(key, value);
        } else {
            params.delete(key);
        }
        router.push(`?${params.toString()}`);
    };

    return (
        <div className="flex flex-col h-[85vh]">
            <div className="mb-4 flex flex-col md:flex-row gap-4 items-center">
                {/* Omnibox Search */}
                <div className="flex-1 w-full">
                    <input 
                        type="text"
                        placeholder="🔍 Buscar por Cédula, Nombre o Email..."
                        onChange={(e) => handleSearch(e.target.value)}
                        defaultValue={searchParams.get('search') || ''}
                        className="w-full rounded-lg border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-3 shadow-sm focus:ring-2 focus:ring-indigo-500"
                    />
                </div>

                {/* Sidebar / Topbar Filters */}
                {role !== 'DOCTOR' && (
                    <select
                        onChange={(e) => handleFilterChange('doctorId', e.target.value)}
                        defaultValue={searchParams.get('doctorId') || 'all'}
                        className="w-full md:w-auto rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 py-2 px-3"
                    >
                        <option value="all">👨‍⚕️ Todos los Doctores</option>
                        {doctorList.map(d => <option key={d.id} value={d.id}>{d.fullName}</option>)}
                    </select>
                )}
                
                <select
                    onChange={(e) => handleFilterChange('serviceId', e.target.value)}
                    defaultValue={searchParams.get('serviceId') || 'all'}
                    className="w-full md:w-auto rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 py-2 px-3"
                >
                    <option value="all">⚕️ Todos los Servicios</option>
                    {servicesList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>

                <select
                    onChange={(e) => handleFilterChange('epsId', e.target.value)}
                    defaultValue={searchParams.get('epsId') || 'all'}
                    className="w-full md:w-auto rounded-lg border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 py-2 px-3"
                >
                    <option value="all">🏦 Todas las EPS</option>
                    {epsList.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
            </div>

            <div className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm p-4">
                <Calendar
                    localizer={localizer}
                    events={events}
                    startAccessor="start"
                    endAccessor="end"
                    culture="es"
                    style={{ height: '100%' }}
                    messages={{
                        today: 'Hoy',
                        previous: 'Anterior',
                        next: 'Siguiente',
                        month: 'Mes',
                        week: 'Semana',
                        day: 'Día',
                        agenda: 'Agenda',
                        date: 'Fecha',
                        time: 'Hora',
                        event: 'Evento',
                        noEventsInRange: 'No hay citas en este periodo.'
                    }}
                    eventPropGetter={(event) => {
                        const isWhatsapp = event.resource.origin === 'WHATSAPP';
                        return {
                            className: isWhatsapp ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-blue-50 border-blue-200 text-blue-700',
                            style: {
                                backgroundColor: isWhatsapp ? '#eef2ff' : '#eff6ff',
                                borderColor: isWhatsapp ? '#c7d2fe' : '#bfdbfe',
                                color: isWhatsapp ? '#4338ca' : '#1d4ed8',
                                borderRadius: '4px',
                                fontSize: '0.8rem',
                                padding: '2px 4px',
                                border: '1px solid',
                            }
                        };
                    }}
                    selectable={true}
                    onSelectEvent={(event) => {
                        setSelectedEvent(event.resource);
                        setSelectedDate(null);
                        setIsModalOpen(true);
                    }}
                    onSelectSlot={(slotInfo) => {
                        setSelectedEvent(null);
                        setSelectedDate(slotInfo.start);
                        setIsModalOpen(true);
                    }}
                />
            </div>

            <AppointmentModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                eventData={selectedEvent}
                epsList={epsList}
                doctorList={doctorList}
                servicesList={servicesList}
                defaultDate={selectedDate}
            />
        </div>
    );
}
