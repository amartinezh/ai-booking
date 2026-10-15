'use client';

import { CalendarClock, CalendarOff } from 'lucide-react';
import { setMyRescheduleEnabled } from '@/app/actions/settings';
import InstantSwitch from './InstantSwitch';
import { notaCompuertaHis } from './operaciones-bot';

/**
 * Interruptor de CAMBIAR LA FECHA de una cita por el bot. Guarda al instante y
 * el bot lo lee en cada mensaje.
 */
export default function RescheduleToggle({ initialEnabled }: { initialEnabled: boolean }) {
    return (
        <InstantSwitch
            initialEnabled={initialEnabled}
            save={setMyRescheduleEnabled}
            title="Cambiar la fecha de una cita por el asistente"
            description="Si el paciente puede mover su cita a otro horario por WhatsApp o Telegram. El cambio aplica desde el siguiente mensaje."
            iconOn={<CalendarClock className="w-5 h-5" />}
            iconOff={<CalendarOff className="w-5 h-5" />}
            iconOnClassName="bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400"
            labelOn="Encendido"
            labelOff="Apagado"
            detailOn="Los pacientes pueden cambiar la fecha de sus citas con el asistente, eligiendo entre los cupos libres."
            detailOff="Si un paciente intenta cambiar la fecha, el asistente le dice que se comunique con el hospital (al teléfono de soporte, si está configurado). El recordatorio tampoco le ofrece cambiarla por el asistente."
            footnote={`Sin conexión al hospital, el personal sigue cambiando citas desde el panel en ambos casos. ${notaCompuertaHis('los cambios de fecha')}`}
        />
    );
}
