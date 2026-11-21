import { getMyOrgSettings } from '@/app/actions/settings';
import BookingToggle from '../../BookingToggle';
import CancelToggle from '../../CancelToggle';
import RescheduleToggle from '../../RescheduleToggle';
import LimiteDeCitas from '../../LimiteDeCitas';
import {
    Ajuste,
    AvisoMovido,
    Seccion,
    SectionLoadError,
    Separador,
    exigirAdministrador,
    motivoDelFallo,
} from '../../comunes';

export const dynamic = 'force-dynamic';

/**
 * 🤖 Qué puede hacer el asistente: agendar, cancelar y cambiar la fecha, y el
 * límite de citas por paciente (antes su propia pantalla, /dashboard/limites-citas,
 * que redirige aquí con `?desde=limites-citas`).
 */
export default async function QuePuedeHacerPage({ searchParams }: { searchParams: Promise<{ desde?: string }> }) {
    const session = await exigirAdministrador();
    const { desde } = await searchParams;
    const [ajustes] = await Promise.allSettled([getMyOrgSettings()]);

    return (
        <div className="space-y-4">
            <AvisoMovido visible={desde === 'limites-citas'}>
                El Límite de citas ya no es una opción del menú: ahora está aquí, en Configuración › Qué puede hacer el
                asistente, con todo lo que tenía.
            </AvisoMovido>
            <Seccion
                titulo="Qué puede hacer el asistente"
                icono="🤖"
                descripcion="Lo que el paciente puede hacer por WhatsApp o Telegram, y cuántas citas puede tener. Los interruptores se guardan al instante y aplican desde el siguiente mensaje."
            >
                {ajustes.status === 'fulfilled' ? (
                    <div className="space-y-3">
                        <Ajuste id="agendar">
                            <BookingToggle initialEnabled={ajustes.value.bookingEnabled} />
                        </Ajuste>
                        <Ajuste id="cancelar">
                            <CancelToggle initialEnabled={ajustes.value.cancelEnabled} />
                        </Ajuste>
                        <Ajuste id="cambiar-fecha">
                            <RescheduleToggle initialEnabled={ajustes.value.rescheduleEnabled} />
                        </Ajuste>
                    </div>
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar los interruptores del asistente"
                        detail={motivoDelFallo(ajustes.reason, 'Error desconocido.')}
                    />
                )}
                <Separador />
                <Ajuste id="limite">
                    <LimiteDeCitas organizationId={session.organizationId!} />
                </Ajuste>
            </Seccion>
        </div>
    );
}
