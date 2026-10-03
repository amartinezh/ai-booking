'use client';

import { CalendarCheck, CalendarSearch } from 'lucide-react';
import { setMyBookingEnabled } from '@/app/actions/settings';
import InstantSwitch from './InstantSwitch';

/**
 * Interruptor de las operaciones del paciente por el bot: agendar, cancelar y
 * cambiar citas. Apagado, el bot solo consulta citas y remite al hospital para
 * todo lo demás. Guarda al instante y el bot lo lee en cada mensaje.
 */
export default function BookingToggle({ initialEnabled }: { initialEnabled: boolean }) {
    return (
        <InstantSwitch
            initialEnabled={initialEnabled}
            save={setMyBookingEnabled}
            title="Agendar, cancelar y cambiar citas por el asistente"
            description="Lo que el paciente puede hacer por WhatsApp o Telegram. El cambio aplica desde el siguiente mensaje."
            iconOn={<CalendarCheck className="w-5 h-5" />}
            iconOff={<CalendarSearch className="w-5 h-5" />}
            iconOnClassName="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
            labelOn="Encendido"
            labelOff="Solo consultas"
            detailOn="Los pacientes pueden agendar, cancelar y cambiar sus citas con el asistente."
            detailOff="Los pacientes solo pueden consultar sus citas. Si intentan agendar, cancelar o cambiar una, el asistente les dice que se comuniquen con el hospital (al teléfono de soporte, si está configurado). Tampoco se ofrecen cupos de la lista de espera."
            footnote="El personal sigue agendando, cancelando y cambiando citas desde el panel en ambos casos."
        />
    );
}
