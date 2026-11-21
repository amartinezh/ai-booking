import { getMyOrgSettings } from '@/app/actions/settings';
import { getMyAudioConfig } from '@/app/actions/audio-config';
import SettingsForm from '../../SettingsForm';
import AudioConfigForm from '../../AudioConfigForm';
import { Ajuste, Seccion, SectionLoadError, Separador, exigirAdministrador, motivoDelFallo } from '../../comunes';

export const dynamic = 'force-dynamic';

/**
 * 🗣️ Nombre, tono y voz. Se cargan aislados: si la voz falla (backend,
 * migración, descifrado), el nombre y el tono se muestran igual.
 */
export default async function NombreTonoVozPage() {
    await exigirAdministrador();
    const [ajustes, voz] = await Promise.allSettled([getMyOrgSettings(), getMyAudioConfig()]);
    if (voz.status === 'rejected') console.error('[configuracion] Audio config load failed:', voz.reason);

    return (
        <Seccion
            titulo="Nombre, tono y voz"
            icono="🗣️"
            descripcion="Cómo se llama el asistente, cómo les habla a sus pacientes y con qué voz responde los audios."
        >
            <Ajuste id="nombre-tono">
                {ajustes.status === 'fulfilled' ? (
                    <SettingsForm
                        initial={{ botName: ajustes.value.botName, communicationStyle: ajustes.value.communicationStyle }}
                    />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar el nombre y el tono"
                        detail={motivoDelFallo(ajustes.reason, 'Error desconocido.')}
                    />
                )}
            </Ajuste>
            <Separador />
            <Ajuste id="voz">
                {voz.status === 'fulfilled' ? (
                    <AudioConfigForm
                        initial={voz.value}
                        assistantName={ajustes.status === 'fulfilled' ? ajustes.value.botName : ''}
                    />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar la configuración de voz"
                        detail={motivoDelFallo(voz.reason, 'Error desconocido cargando la configuración de voz.')}
                    />
                )}
            </Ajuste>
        </Seccion>
    );
}
