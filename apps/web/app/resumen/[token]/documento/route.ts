import { cookies } from 'next/headers';
import { COOKIE_ACCESO_RESUMEN, TOKEN_RESUMEN, llamarApiPublica, reenviarArchivo } from '@/lib/resumen/api';

/**
 * Un documento del resumen para el paciente:
 * `/resumen/<token>/documento?doc=<documento>&formato=pdf|png&hoja=N[&descargar=1]`.
 * Sin el acceso de la cookie (o vencido), vuelve a la página, que pide la fecha.
 */
const DOCUMENTO = /^[a-z0-9-]{1,60}$/;

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
    const { token } = await ctx.params;
    if (!TOKEN_RESUMEN.test(token)) return new Response('No disponible.', { status: 404 });
    // Relativa a propósito: detrás del proxy, `req.url` trae la dirección interna del servidor.
    const aLaPagina = () => new Response(null, { status: 303, headers: { Location: `/resumen/${token}` } });

    const q = new URL(req.url).searchParams;
    const documento = q.get('doc') ?? '';
    const formato = q.get('formato') === 'png' ? 'png' : 'pdf';
    const hoja = Number(q.get('hoja') ?? '1');
    if (!DOCUMENTO.test(documento) || !Number.isInteger(hoja) || hoja < 1 || hoja > 99) {
        return new Response('Pedido inválido.', { status: 400 });
    }

    const acceso = (await cookies()).get(COOKIE_ACCESO_RESUMEN)?.value;
    if (!acceso) return aLaPagina();

    let res: Response;
    try {
        res = await llamarApiPublica('document', { token, acceso, documento, formato, hoja });
    } catch {
        return new Response('No se pudo generar el documento. Intente de nuevo.', { status: 502 });
    }
    if (!res.ok) return aLaPagina();
    return reenviarArchivo(res, q.get('descargar') === '1');
}
