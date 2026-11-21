import { getMyKnowledgeBase } from '@/app/actions/knowledge-base';
import KnowledgeBaseEditor from '@/app/dashboard/conocimiento/KnowledgeBaseEditor';
import { Ajuste, Seccion, SectionLoadError, exigirAdministrador, motivoDelFallo } from '../../comunes';

export const dynamic = 'force-dynamic';

/** 📚 Base de conocimiento: lo que el asistente responde sobre la clínica. */
export default async function BaseDeConocimientoPage() {
    await exigirAdministrador();
    const [contenido] = await Promise.allSettled([getMyKnowledgeBase()]);

    return (
        <Seccion
            titulo="Base de conocimiento"
            icono="📚"
            descripcion="Horarios, dirección, tarifas, EPS con convenio y teléfonos: es lo único que el asistente responde sobre la clínica."
        >
            <Ajuste id="base">
                {contenido.status === 'fulfilled' ? (
                    <KnowledgeBaseEditor initialContent={contenido.value} />
                ) : (
                    <SectionLoadError
                        title="No pudimos cargar la base de conocimiento"
                        detail={motivoDelFallo(contenido.reason, 'Error desconocido.')}
                    />
                )}
            </Ajuste>
        </Seccion>
    );
}
