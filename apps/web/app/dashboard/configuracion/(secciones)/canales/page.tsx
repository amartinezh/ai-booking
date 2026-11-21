import { getMyAiConfig } from '@/app/actions/ai-config';
import { getMyWhatsappConfig } from '@/app/actions/whatsapp-config';
import { getMyWhatsappTemplates } from '@/app/actions/whatsapp-templates';
import { getMyTelegramConfig } from '@/app/actions/telegram-config';
import ConnectionHealthPanel from '../../ConnectionHealthPanel';
import AiIntegrationForm from '../../AiIntegrationForm';
import WhatsappChannelForm from '../../WhatsappChannelForm';
import WhatsappTemplatesForm from '../../WhatsappTemplatesForm';
import TelegramChannelForm from '../../TelegramChannelForm';
import {
    Ajuste,
    Seccion,
    SectionLoadError,
    Separador,
    exigirAdministrador,
    motivoDelFallo,
    serializeTelegramCard,
} from '../../comunes';

export const dynamic = 'force-dynamic';

/**
 * 🔌 Canales e IA. Cargamos IA, WhatsApp, plantillas y Telegram en paralelo PERO
 * aislados: si uno revienta (descifrado, backend caído, migración faltante) los
 * demás se muestran y el error queda en línea, no en el error boundary del panel.
 */
export default async function CanalesPage() {
    await exigirAdministrador();
    const [ia, whatsapp, plantillas, telegram] = await Promise.allSettled([
        getMyAiConfig(),
        getMyWhatsappConfig(),
        getMyWhatsappTemplates(),
        getMyTelegramConfig(),
    ]);
    for (const [nombre, r] of [['AI config', ia], ['WhatsApp config', whatsapp], ['WhatsApp templates', plantillas], ['Telegram config', telegram]] as const) {
        if (r.status === 'rejected') console.error(`[configuracion] ${nombre} load failed:`, r.reason);
    }

    return (
        <Seccion
            titulo="Canales e IA"
            icono="🔌"
            descripcion="El proveedor de inteligencia artificial, el número de WhatsApp y sus plantillas, y Telegram. Se configuran al instalar y casi no se tocan."
        >
            <Ajuste id="conexiones">
                <ConnectionHealthPanel />
            </Ajuste>
            <Separador />
            <Ajuste id="ia">
                {ia.status === 'fulfilled' ? (
                    <AiIntegrationForm
                        initial={{ ...ia.value, updatedAt: ia.value.updatedAt ? String(ia.value.updatedAt) : null }}
                    />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar la integración de IA"
                        detail={motivoDelFallo(ia.reason, 'Error desconocido cargando la integración de IA.')}
                    />
                )}
            </Ajuste>
            <Separador />
            <Ajuste id="whatsapp">
                {whatsapp.status === 'fulfilled' ? (
                    <WhatsappChannelForm
                        initial={{
                            ...whatsapp.value,
                            updatedAt: whatsapp.value.updatedAt ? String(whatsapp.value.updatedAt) : null,
                        }}
                    />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar el canal de WhatsApp"
                        detail={motivoDelFallo(whatsapp.reason, 'Error desconocido cargando el canal de WhatsApp.')}
                    />
                )}
            </Ajuste>
            <Separador />
            <Ajuste id="plantillas">
                {plantillas.status === 'fulfilled' ? (
                    <WhatsappTemplatesForm initial={plantillas.value} />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar las plantillas de WhatsApp"
                        detail={motivoDelFallo(plantillas.reason, 'Error desconocido cargando las plantillas.')}
                    />
                )}
            </Ajuste>
            <Separador />
            <Ajuste id="telegram">
                {telegram.status === 'fulfilled' ? (
                    <TelegramChannelForm initial={serializeTelegramCard(telegram.value)} />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar el canal de Telegram"
                        detail={motivoDelFallo(telegram.reason, 'Error desconocido cargando el canal de Telegram.')}
                    />
                )}
            </Ajuste>
        </Seccion>
    );
}
