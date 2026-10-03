'use client';

import { BellRing, BellOff } from 'lucide-react';
import { setMyRemindersEnabled } from '@/app/actions/settings';
import InstantSwitch from './InstantSwitch';

/**
 * Interruptor de los recordatorios automáticos de citas. Guarda al instante
 * (no espera al botón «Guardar» del formulario) y el cron lo lee en su
 * siguiente vuelta: no hay que reiniciar nada.
 */
export default function RemindersToggle({ initialEnabled }: { initialEnabled: boolean }) {
    return (
        <InstantSwitch
            initialEnabled={initialEnabled}
            save={setMyRemindersEnabled}
            title="Recordatorios automáticos de citas"
            description="Mensaje que se le envía al paciente antes de su cita, por WhatsApp o Telegram. El cambio aplica de inmediato."
            iconOn={<BellRing className="w-5 h-5" />}
            iconOff={<BellOff className="w-5 h-5" />}
            iconOnClassName="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
            labelOn="Encendidos"
            labelOff="Apagados"
            detailOn="Los pacientes reciben el recordatorio antes de su cita."
            detailOff="No se envía ningún recordatorio automático. Al encenderlos, las citas que aún estén dentro del plazo reciben el suyo."
            footnote="El botón de recordatorio manual de la agenda sigue funcionando en ambos casos."
        />
    );
}
