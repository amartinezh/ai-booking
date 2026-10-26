'use server';

import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { getSession } from '../../lib/session';
import { getErrorMessage } from '../../lib/error';
import { INTENTOS_CLAVE, validarCambioDeClave } from '../../lib/cuenta/clave';
import { abrirSesion } from '../../lib/sesion-token';

export type ResultadoCambioDeClave = { success: true } | { success: false; error: string };

/**
 * 🔑 Quien tiene la sesión cambia SU clave (2026-10-22). Exige la actual —la sesión
 * sola no basta: puede ser un equipo compartido que quedó abierto—, valida la
 * nueva (`lib/cuenta/clave.ts`) y la guarda con bcrypt, igual que el ingreso y el
 * alta de usuarios. Deja constancia en la bitácora del sistema (`PASSWORD_CHANGED`;
 * los intentos con la actual equivocada, `PASSWORD_CHANGE_FAILED`), sin ningún
 * dato de la clave.
 */
export async function cambiarMiClave(datos: {
    actual: string;
    nueva: string;
    confirmacion: string;
}): Promise<ResultadoCambioDeClave> {
    const session = await getSession();
    if (!session?.userId) {
        return { success: false, error: 'Su sesión terminó. Vuelva a ingresar.' };
    }

    const problema = validarCambioDeClave({ ...datos, email: session.email });
    if (problema) return { success: false, error: problema };

    try {
        const fallidos = await prisma.systemLog.count({
            where: {
                action: 'PASSWORD_CHANGE_FAILED',
                userId: session.userId,
                createdAt: { gte: new Date(Date.now() - INTENTOS_CLAVE.VENTANA_MIN * 60_000) },
            },
        });
        if (fallidos >= INTENTOS_CLAVE.MAX) {
            return {
                success: false,
                error: `Demasiados intentos con una clave actual equivocada. Espere ${INTENTOS_CLAVE.VENTANA_MIN} minutos e intente de nuevo.`,
            };
        }

        const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { id: true, password: true, role: true, organizationId: true },
        });
        if (!user) return { success: false, error: 'Su sesión terminó. Vuelva a ingresar.' };

        if (!(await bcrypt.compare(datos.actual, user.password))) {
            await prisma.systemLog
                .create({
                    data: {
                        level: 'WARNING',
                        action: 'PASSWORD_CHANGE_FAILED',
                        message: `Intento de cambio de clave con la clave actual equivocada (${user.role})`,
                        userId: user.id,
                        organizationId: user.organizationId,
                        metadata: { role: user.role },
                    },
                })
                .catch((e: unknown) => console.error('No se pudo registrar PASSWORD_CHANGE_FAILED:', getErrorMessage(e)));
            return { success: false, error: 'La clave actual no es correcta.' };
        }

        const hash = await bcrypt.hash(datos.nueva, 10);
        // Cambiar la clave cierra las OTRAS sesiones de la cuenta (2026-10-27: antes
        // seguían abiertas hasta 8 horas); a quien la cambió se le da un token nuevo.
        const cuenta = await prisma.user.update({
            where: { id: user.id },
            data: { password: hash, sessionsRevokedAt: new Date() },
            select: { id: true, email: true, role: true, organizationId: true },
        });
        await abrirSesion(cuenta);

        await prisma.systemLog
            .create({
                data: {
                    level: 'EVENT',
                    action: 'PASSWORD_CHANGED',
                    message: `Cambio de clave (${user.role})`,
                    userId: user.id,
                    organizationId: user.organizationId,
                    metadata: { role: user.role, detalle: 'Se cerraron sus otras sesiones abiertas' },
                },
            })
            .catch((e: unknown) => console.error('No se pudo registrar PASSWORD_CHANGED:', getErrorMessage(e)));

        return { success: true };
    } catch (error) {
        console.error('Error cambiando la clave:', getErrorMessage(error));
        return { success: false, error: 'No se pudo cambiar la clave. Intente de nuevo.' };
    }
}
