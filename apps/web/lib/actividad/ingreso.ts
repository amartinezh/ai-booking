/**
 * 🔐 INGRESO AL PANEL — el tope de intentos fallidos (2026-10-26).
 *
 * Vive aquí y no en la acción: un archivo 'use server' solo puede exportar
 * funciones async. Se cuenta por correo Y por IP: así quien prueba claves desde
 * un equipo queda frenado, sin dejar por fuera al dueño de la cuenta que entra
 * desde otro (un tope solo por correo dejaría a cualquiera bloquear al
 * administrador a propósito).
 *
 * Y además por IP sola (auditoría 2026-11-07, `MAX_POR_IP`): quien desde un mismo
 * equipo prueba una clave en muchos correos distintos («rociado de claves») no
 * llegaba nunca al tope de correo+IP. Es más alto que el otro para que una oficina
 * entera detrás de una misma IP no se frene por los olvidos normales.
 */
export const INTENTOS_INGRESO = { MAX: 5, MAX_POR_IP: 20, VENTANA_MIN: 15 } as const;

/** El correo como se cuenta en el tope: sin espacios y en minúsculas. */
export function claveDeIntento(email: string): string {
    return email.trim().toLowerCase().slice(0, 200);
}

/** La IP como se cuenta en el tope; sin IP conocida, todas cuentan juntas. */
export function ipDeIntento(ip: string | null | undefined): string {
    return ip?.trim() || 'desconocida';
}
