import { getMyOrgSettings } from '@/app/actions/settings';
import RemindersToggle from '../../RemindersToggle';
import SelfBookedRemindersToggle from '../../SelfBookedRemindersToggle';
import ReminderLeadTimeSetting from '../../ReminderLeadTimeSetting';
import { Ajuste, Seccion, SectionLoadError, Separador, exigirAdministrador, motivoDelFallo } from '../../comunes';

export const dynamic = 'force-dynamic';

/** 🔔 Recordatorios: el mensaje antes de la cita, a quién y con cuánta anticipación. */
export default async function RecordatoriosPage() {
    await exigirAdministrador();
    const [ajustes] = await Promise.allSettled([getMyOrgSettings()]);

    return (
        <Seccion
            titulo="Recordatorios"
            icono="🔔"
            descripcion="El mensaje que se le envía al paciente antes de su cita, por WhatsApp o Telegram. Los cambios aplican de inmediato."
        >
            {ajustes.status === 'fulfilled' ? (
                <>
                    <Ajuste id="recordatorios">
                        <RemindersToggle initialEnabled={ajustes.value.remindersEnabled} />
                    </Ajuste>
                    <Separador />
                    <Ajuste id="solo-chat">
                        <SelfBookedRemindersToggle initialEnabled={ajustes.value.remindersOnlySelfBooked} />
                    </Ajuste>
                    <Separador />
                    <Ajuste id="anticipacion">
                        <ReminderLeadTimeSetting initialMinutes={ajustes.value.reminderMinLeadMinutes} />
                    </Ajuste>
                </>
            ) : (
                <SectionLoadError
                    title="No pudimos cargar los recordatorios"
                    detail={motivoDelFallo(ajustes.reason, 'Error desconocido.')}
                />
            )}
        </Seccion>
    );
}
