'use client';

import { ShieldCheck, ShieldOff } from 'lucide-react';
import { cambiarEnvioAlHospital } from '@/app/actions/espejo';
import InstantSwitch from '@/app/dashboard/configuracion/InstantSwitch';

/**
 * Interruptor del envío de CITAS NUEVAS hacia el sistema del hospital
 * (`pushEnabled`). Desde 2026-10-15 cada operación tiene su compuerta
 * (`compuerta-his.ts`): este interruptor deja pasar las citas nuevas (y lo demás
 * que no es cancelar ni cambiar fecha); las cancelaciones y los cambios de fecha
 * pasan con «Cancelar» y «Cambiar fecha» de Configuración. Lo que llega del
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
            title="Envío de citas nuevas hacia el hospital"
            description="Escritura en el sistema del hospital de las citas que se agendan en AgenIA (por el asistente o desde el panel). El cambio aplica en segundos, sin reiniciar el agente."
            iconOn={<ShieldCheck className="w-5 h-5" />}
            iconOff={<ShieldOff className="w-5 h-5" />}
            iconOnClassName="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
            labelOn="Encendido"
            labelOff="Apagado: no se escriben citas nuevas en el hospital"
            detailOn="Las citas que se agendan en AgenIA llegan al sistema del hospital, y el asistente puede agendar (si «Agendar» está encendido en Configuración)."
            detailOff="AgenIA no escribe citas nuevas en el sistema del hospital y el asistente no agenda. Lo que se agende desde el panel queda en cola y sale cuando se vuelva a encender."
            footnote="Las cancelaciones y los cambios de fecha NO dependen de este interruptor: llegan al hospital con «Cancelar» y «Cambiar fecha» encendidos en Configuración. En todos los casos sigue entrando lo que viene del hospital: su agenda y las citas agendadas en ventanilla."
            confirmMessage={(next) =>
                next
                    ? enCola > 0
                        ? `¿Encender el envío de citas nuevas al hospital? Hay ${enCola} evento(s) en cola; las citas nuevas entre ellos se escribirán en el sistema del hospital en los próximos segundos.`
                        : '¿Encender el envío de citas nuevas al hospital? Desde ahora lo que se agende en AgenIA se escribirá en el sistema del hospital.'
                    : '¿Apagar el envío de citas nuevas al hospital? AgenIA dejará de escribir citas nuevas en el sistema del hospital hasta que lo vuelva a encender (cancelar y cambiar fecha siguen con su propio interruptor).'
            }
        />
    );
}
