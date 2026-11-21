import { getMyOrgSettings } from '@/app/actions/settings';
import { getMyPaginaPoliticaDatos } from '@/app/actions/politica-datos';
import AutorizacionDatosSetting from '../../AutorizacionDatosSetting';
import { Ajuste, Seccion, SectionLoadError, exigirAdministrador, motivoDelFallo } from '../../comunes';

export const dynamic = 'force-dynamic';

/**
 * 🔒 Privacidad (Ley 1581): la autorización de datos antes de agendar y la
 * página pública de la política (va dentro de la autorización, que usa su
 * enlace; su ancla es `#politica`). Si la página falla, la autorización se
 * muestra igual, sin ese bloque.
 */
export default async function PrivacidadPage() {
    await exigirAdministrador();
    const [ajustes, pagina] = await Promise.allSettled([getMyOrgSettings(), getMyPaginaPoliticaDatos()]);
    if (pagina.status === 'rejected') console.error('[configuracion] Página de la política de datos load failed:', pagina.reason);

    return (
        <Seccion
            titulo="Privacidad (Ley 1581)"
            icono="🔒"
            descripcion="Si el asistente pide la autorización de tratamiento de datos antes de agendar, el enlace a la política de la clínica y la página pública de esa política."
        >
            <Ajuste id="autorizacion">
                {ajustes.status === 'fulfilled' ? (
                    <AutorizacionDatosSetting
                        inicial={ajustes.value.autorizacionDatos}
                        nombreAsistente={ajustes.value.botName}
                        nombreClinica={ajustes.value.nombreClinica}
                        estilo={ajustes.value.communicationStyle}
                        pagina={pagina.status === 'fulfilled' ? pagina.value : null}
                    />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar la autorización de datos"
                        detail={motivoDelFallo(ajustes.reason, 'Error desconocido.')}
                    />
                )}
            </Ajuste>
        </Seccion>
    );
}
