'use client';

import { CalendarCheck, CalendarSearch } from 'lucide-react';
import { setMyBookingEnabled } from '@/app/actions/settings';
import InstantSwitch from './InstantSwitch';
import { notaCompuertaHis } from './operaciones-bot';

/**
 * Interruptor de AGENDAR citas nuevas por el bot (y de los cupos de la lista de
 * espera). Cancelar y cambiar la fecha tienen el suyo; con los tres apagados el
 * bot solo consulta. Guarda al instante y el bot lo lee en cada mensaje.
 */
export default function BookingToggle({ initialEnabled }: { initialEnabled: boolean }) {
    return (
        <InstantSwitch
            initialEnabled={initialEnabled}
            save={setMyBookingEnabled}
            title="Agendar citas por el asistente"
            description="Si el paciente puede sacar una cita nueva por WhatsApp o Telegram. El cambio aplica desde el siguiente mensaje."
            iconOn={<CalendarCheck className="w-5 h-5" />}
            iconOff={<CalendarSearch className="w-5 h-5" />}
            iconOnClassName="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
            labelOn="Encendido"
            labelOff="Apagado"
            detailOn="Los pacientes pueden agendar citas nuevas con el asistente."
            detailOff="Si un paciente intenta agendar, el asistente le dice que se comunique con el hospital (al teléfono de soporte, si está configurado) y qué sí puede hacer por ahí. Tampoco se ofrecen cupos de la lista de espera. Con agendar, cancelar y cambiar apagados, el asistente solo consulta citas."
            footnote={`Sin conexión al hospital, el personal sigue agendando desde el panel en ambos casos. ${notaCompuertaHis('las citas nuevas')}`}
        />
    );
}
