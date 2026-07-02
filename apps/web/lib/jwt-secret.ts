/**
 * Llave de firma/verificación de los JWT de sesión.
 *
 * SIN fallback hardcodeado: un secreto escrito en el repo equivale a no tener
 * secreto (cualquiera que lea el código puede forjar tokens de cualquier
 * clínica). Si la variable falta, fallamos ruidosamente con la remediación —
 * jamás degradamos a un valor público.
 *
 * Debe ser EL MISMO valor en web y api: el web firma el token en el login y
 * la API NestJS lo verifica en RolesGuard.
 */
export function getJwtSecretKey(): Uint8Array {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error(
            'JWT_SECRET no está configurado. Defina la variable de entorno (mismo valor en web y api) antes de iniciar la aplicación.',
        );
    }
    return new TextEncoder().encode(secret);
}
