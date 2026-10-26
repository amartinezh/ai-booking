import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getJwtSecretKey } from '@/lib/jwt-secret';
import { ACCESO_ESTADISTICAS } from './clave';

/**
 * 📊 Estadísticas para compartir: la cookie que recuerda a quien ya escribió la
 * clave (las reglas de la clave, que también usa el navegador, van en clave.ts).
 *
 * La cookie NO es un JWT de sesión: es `<vence>.<firma>` con una llave derivada
 * de JWT_SECRET pero distinta, para que nunca pueda pasar por un `auth_token`
 * del panel. La firma incluye una huella del hash de la clave guardada: cambiar
 * la clave (o cerrar la página) deja sin efecto las cookies anteriores.
 */

const llave = () => createHash('sha256').update('agenia:estadisticas:').update(getJwtSecretKey()).digest();
const huella = (hashDeLaClave: string) => createHash('sha256').update(hashDeLaClave).digest('base64url').slice(0, 16);
const firma = (organizationId: string, vence: number, hashDeLaClave: string) =>
    createHmac('sha256', llave()).update(`${organizationId}.${vence}.${huella(hashDeLaClave)}`).digest('base64url');

/** El valor de la cookie para quien acaba de escribir bien la clave. */
export function firmarAcceso(organizationId: string, hashDeLaClave: string, ahora: Date = new Date()): string {
    const vence = Math.floor(ahora.getTime() / 1000) + ACCESO_ESTADISTICAS.DIAS * 24 * 3600;
    return `${vence}.${firma(organizationId, vence, hashDeLaClave)}`;
}

/** ¿La cookie es de esta clínica, con la clave vigente, y no ha vencido? */
export function accesoValido(
    valor: string | undefined,
    organizationId: string,
    hashDeLaClave: string,
    ahora: Date = new Date(),
): boolean {
    const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(valor ?? '');
    if (!m) return false;
    const vence = Number(m[1]);
    if (vence * 1000 <= ahora.getTime()) return false;
    const esperada = Buffer.from(firma(organizationId, vence, hashDeLaClave));
    const recibida = Buffer.from(m[2]);
    return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}
