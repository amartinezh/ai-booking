import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getEstadoEspejo } from '@/app/actions/espejo';
import EspejoClient from './components/EspejoClient';

/**
 * Estado del espejo con el sistema del hospital.
 *
 * Responde, en este orden, las preguntas que de verdad se hace quien opera
 * esto: ¿el agente está vivo y alcanza el HIS? ¿hay algo que NO llegó al
 * hospital? ¿la agenda coincide? Y da el único botón que la capa 4 del plan
 * promete y no existía: devolver a la cola un evento que se rindió.
 */
export default async function EspejoPage() {
    const session = await getSession();
    if (session?.role !== 'ORG_ADMIN') redirect('/dashboard');

    const res = await getEstadoEspejo();

    return (
        <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">
            {res.success ? (
                <EspejoClient data={res.data} />
            ) : (
                <div className="p-4 bg-amber-50 text-amber-700 rounded-lg font-medium border border-amber-200">
                    {res.error}
                </div>
            )}
        </div>
    );
}
