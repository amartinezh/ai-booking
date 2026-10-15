'use client';

import { CalendarX, CalendarOff } from 'lucide-react';
import { setMyCancelEnabled } from '@/app/actions/settings';
import InstantSwitch from './InstantSwitch';
import { notaCompuertaHis } from './operaciones-bot';

/**
 * Interruptor de CANCELAR citas por el bot. Guarda al instante y el bot lo lee
 * en cada mensaje.
 */
export default function CancelToggle({ initialEnabled }: { initialEnabled: boolean }) {
    return (
        <InstantSwitch
            initialEnabled={initialEnabled}
            save={setMyCancelEnabled}
            title="Cancelar citas por el asistente"
            description="Si el paciente puede cancelar una cita por WhatsApp o Telegram. El cambio aplica desde el siguiente mensaje."
            iconOn={<CalendarX className="w-5 h-5" />}
            iconOff={<CalendarOff className="w-5 h-5" />}
            iconOnClassName="bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400"
            labelOn="Encendido"
            labelOff="Apagado"
            detailOn="Los pacientes pueden cancelar sus citas con el asistente (también si escriben «no puedo asistir»: les pregunta si la cancela); el cupo queda libre para otro paciente."
            detailOff="Si un paciente intenta cancelar, el asistente le dice que se comunique con el hospital (al teléfono de soporte, si está configurado) y deja su aviso en la Bandeja de sincronización. El recordatorio tampoco le ofrece cancelar por el asistente."
            footnote={`Sin conexión al hospital, el personal sigue cancelando desde el panel en ambos casos. ${notaCompuertaHis('las cancelaciones')}`}
        />
    );
}
