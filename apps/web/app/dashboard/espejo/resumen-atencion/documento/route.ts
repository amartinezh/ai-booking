import { cookies } from 'next/headers';
import { adminDelResumen } from '@/lib/resumen/acceso';
import { INTERNAL_API_URL, reenviarArchivo } from '@/lib/resumen/api';

/**
 * 📄 Un documento del resumen de la atención para el administrador (Fase 2):
 * `?id=<resumen>&doc=<documento>&formato=pdf|png&hoja=N[&descargar=1]`. Lo
 * genera la API (que descifra y deja constancia en la Actividad de usuarios);
 * esta ruta solo comprueba el permiso y reenvía el archivo.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCUMENTO = /^[a-z0-9-]{1,60}$/;

export async function GET(req: Request): Promise<Response> {
    const auth = await adminDelResumen();
    if (!auth) return new Response('Acceso denegado.', { status: 403 });

    const q = new URL(req.url).searchParams;
    const id = q.get('id') ?? '';
    const doc = q.get('doc') ?? '';
    const formato = q.get('formato') === 'png' ? 'png' : 'pdf';
    const hoja = q.get('hoja') ?? '1';
    if (!UUID.test(id) || !DOCUMENTO.test(doc) || !/^\d{1,2}$/.test(hoja)) {
        return new Response('Pedido inválido.', { status: 400 });
    }

    const token = (await cookies()).get('auth_token')?.value;
    let res: Response;
    try {
        res = await fetch(
            `${INTERNAL_API_URL}/attention-summaries/${id}/documents/${doc}?formato=${formato}&hoja=${hoja}`,
            { headers: token ? { Cookie: `auth_token=${token}` } : {}, cache: 'no-store' },
        );
    } catch {
        return new Response('No se pudo contactar al servidor.', { status: 502 });
    }
    if (!res.ok) {
        const mensaje = res.status === 410 ? 'El contenido de este resumen ya se borró (se guarda 30 días).' : 'Documento no disponible.';
        return new Response(mensaje, { status: res.status === 410 ? 410 : res.status === 403 ? 403 : 404 });
    }
    return reenviarArchivo(res, q.get('descargar') === '1');
}
