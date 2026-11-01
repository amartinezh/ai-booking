import { origenDeLaPeticion } from '@/lib/actividad/registrar';

/**
 * Llamadas de la web a la API del resumen de la atención (Fase 2). Van por la
 * red interna: la API descifra, genera los documentos y lleva la bitácora.
 */
export const INTERNAL_API_URL =
    process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/** El token del enlace: 128 bits en base64url. */
export const TOKEN_RESUMEN = /^[A-Za-z0-9_-]{22}$/;

/** La cookie con el acceso de 30 minutos que da la API tras verificar la fecha. */
export const COOKIE_ACCESO_RESUMEN = 'resumen_acceso';

/** POST a la página pública de la API, con la IP y el navegador de quien visita. */
export async function llamarApiPublica(ruta: 'open' | 'verify' | 'content' | 'document', cuerpo: unknown): Promise<Response> {
    const origen = await origenDeLaPeticion();
    return fetch(`${INTERNAL_API_URL}/public/attention-summaries/${ruta}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(origen.ip ? { 'X-AgenIA-IP': origen.ip } : {}),
            ...(origen.navegador ? { 'X-AgenIA-Navegador': origen.navegador } : {}),
        },
        body: JSON.stringify(cuerpo),
        cache: 'no-store',
    });
}

/** El archivo que devolvió la API, tal cual, sin guardarlo en ninguna caché. */
export async function reenviarArchivo(res: Response, descargar: boolean): Promise<Response> {
    const tipo = res.headers.get('content-type') ?? 'application/octet-stream';
    const disposicion = res.headers.get('content-disposition') ?? 'inline';
    return new Response(await res.arrayBuffer(), {
        status: 200,
        headers: {
            'Content-Type': tipo,
            'Content-Disposition': descargar ? disposicion.replace(/^inline/, 'attachment') : disposicion,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}
