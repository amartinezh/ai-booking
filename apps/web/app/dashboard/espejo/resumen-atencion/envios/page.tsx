import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { listarEnviosAction } from '@/app/actions/resumen-envios';
import EnviosClient from './EnviosClient';

/**
 * 📨 Envíos de documentos (docs/PLAN_RESUMEN_ATENCION.md §4.6, D14): el
 * Administrador y el Agente de Reservas ven si al paciente le llegaron los
 * documentos de su consulta y los reenvían a pedido suyo. Sin contenido clínico.
 */
export default async function EnviosPage() {
    const session = await getSession();
    if (!session) redirect('/login');
    const r = await listarEnviosAction();
    if (!r.success) redirect('/dashboard');
    return (
        <div className="p-6 md:p-8 max-w-5xl mx-auto w-full">
            <EnviosClient iniciales={r.atenciones} />
        </div>
    );
}
