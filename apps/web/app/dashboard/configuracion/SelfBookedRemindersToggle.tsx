'use client';

import { MessageCircleHeart, MessagesSquare } from 'lucide-react';
import { setMyRemindersOnlySelfBooked } from '@/app/actions/settings';
import InstantSwitch from './InstantSwitch';

/**
 * Recordatorios automáticos solo para las citas que el paciente se agendó él
 * mismo por el chat (WhatsApp o Telegram). Guarda al instante y el cron lo lee
 * en su siguiente vuelta. Solo cambia a quién le llega el recordatorio
 * automático; ninguna otra operación.
 */
export default function SelfBookedRemindersToggle({ initialEnabled }: { initialEnabled: boolean }) {
    return (
        <InstantSwitch
            initialEnabled={initialEnabled}
            save={setMyRemindersOnlySelfBooked}
            title="Recordatorios solo a pacientes que agendaron ellos mismos"
            description="Envía el recordatorio automático únicamente para las citas que el paciente agendó por el chat. El cambio aplica de inmediato."
            iconOn={<MessageCircleHeart className="w-5 h-5" />}
            iconOff={<MessagesSquare className="w-5 h-5" />}
            iconOnClassName="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
            labelOn="Encendido: solo citas agendadas por el paciente"
            labelOff="Apagado: todas las citas"
            detailOn="Reciben recordatorio solo las citas que el paciente agendó por WhatsApp o Telegram. Las que agendó el personal desde el panel o el hospital no lo reciben."
            detailOff="Reciben recordatorio todas las citas, sin importar quién las agendó."
            footnote="Solo cambia a quién le llega el recordatorio automático (y requiere los recordatorios automáticos encendidos). No cambia cómo se agendan, cancelan o atienden las citas, y el botón de recordatorio manual de la agenda sigue funcionando para cualquier cita."
        />
    );
}
