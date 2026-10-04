'use client';

import { ShieldCheck, ShieldOff } from 'lucide-react';
import { cambiarEnvioAlHospital } from '@/app/actions/espejo';
import InstantSwitch from '@/app/dashboard/configuracion/InstantSwitch';

/**
 * Interruptor del envío de AgenIA hacia el sistema del hospital (`pushEnabled`).
 * Apagado, nada de lo que pase en AgenIA se escribe en el HIS; lo que llega del
 * hospital sigue entrando. Guarda al instante y la API lo aplica en el siguiente
 * segundo, sin reiniciar el agente.
 */
export default function EnvioHospitalToggle({
    initialEnabled,
    enCola,
}: {
    initialEnabled: boolean;
    /** Eventos pendientes de entrega: los que saldrían al encenderlo. */
    enCola: number;
}) {
    return (
        <InstantSwitch
            initialEnabled={initialEnabled}
            save={cambiarEnvioAlHospital}
            title="Envío de AgenIA hacia el hospital"
            description="Escritura de citas, cancelaciones y cambios de fecha en el sistema del hospital. El cambio aplica en segundos, sin reiniciar el agente."
            iconOn={<ShieldCheck className="w-5 h-5" />}
            iconOff={<ShieldOff className="w-5 h-5" />}
            iconOnClassName="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
            labelOn="Encendido"
            labelOff="Apagado: no se escribe nada en el hospital"
            detailOn="Lo que se agenda, cancela o cambia en AgenIA llega al sistema del hospital."
            detailOff="AgenIA no escribe nada en el sistema del hospital. Lo que se agende, cancele o cambie aquí queda en cola y sale cuando se vuelva a encender."
            footnote="En ambos casos sigue entrando lo que viene del hospital: su agenda y las citas agendadas en ventanilla."
            confirmMessage={(next) =>
                next
                    ? enCola > 0
                        ? `¿Encender el envío al hospital? Hay ${enCola} evento(s) en cola que se escribirán en el sistema del hospital en los próximos segundos.`
                        : '¿Encender el envío al hospital? Desde ahora lo que se agende, cancele o cambie en AgenIA se escribirá en el sistema del hospital.'
                    : '¿Apagar el envío al hospital? AgenIA dejará de escribir en el sistema del hospital hasta que lo vuelva a encender.'
            }
        />
    );
}
