'use server'

import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { getSession } from '../../lib/session';
import { abrirSesion } from '../../lib/sesion-token';
import { origenDeLaPeticion, registrarActividad, type OrigenDeLaPeticion } from '../../lib/actividad/registrar';
import { INTENTOS_INGRESO, claveDeIntento, ipDeIntento } from '../../lib/actividad/ingreso';
import type { MotivoIngresoFallido } from '../../lib/actividad/catalogo';

const MSG_CREDENCIALES = 'Credenciales incorrectas';
const MSG_DEMASIADOS = `Demasiados intentos fallidos. Espere ${INTENTOS_INGRESO.VENTANA_MIN} minutos e intente de nuevo.`;

/**
 * Cada ingreso (y cada intento fallido, y cada cierre de sesión) queda en la
 * bitácora del sistema con la IP y el navegador: es lo que muestra «Actividad de
 * usuarios» del super administrador (2026-10-26).
 *
 * Ya NO se crea solo un super administrador `superadmin@sanvicente.com` con la
 * clave `admin123` cuando no hay ninguno: esa clave estaba escrita en el código y
 * en la documentación. El primero se crea en el servidor con
 * `agenia superadmin crear <correo>` (apps/web/scripts/superadmin.mjs), que
 * genera una clave aleatoria.
 */
export async function loginUser(formData: FormData) {
    const email = formData.get('email');
    const password = formData.get('password');

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
        return { error: 'Por favor ingrese correo y contraseña' };
    }

    try {
        const leido = await origenDeLaPeticion();
        const origen = { ...leido, ip: ipDeIntento(leido.ip) };
        const clave = claveDeIntento(email);

        // 0. Tope de intentos fallidos por correo y por IP: frena a quien prueba claves.
        //    Se cuentan en la bitácora, así valen aunque la web se reinicie.
        const enLaVentana = (action: string) => ({
            action,
            createdAt: { gte: new Date(Date.now() - INTENTOS_INGRESO.VENTANA_MIN * 60_000) },
            AND: [
                { metadata: { path: ['email'], equals: clave } },
                { metadata: { path: ['ip'], equals: origen.ip } },
            ],
        });
        const fallidos = await prisma.systemLog.count({ where: enLaVentana('LOGIN_FAILED') });
        if (fallidos >= INTENTOS_INGRESO.MAX) {
            // Una constancia por ventana: quien insiste no llena la bitácora.
            const yaFrenado = await prisma.systemLog.count({ where: enLaVentana('LOGIN_BLOCKED') });
            if (yaFrenado === 0) {
                await registrarActividad({
                    action: 'LOGIN_BLOCKED',
                    level: 'WARNING',
                    message: 'Ingreso frenado: demasiados intentos fallidos con el mismo correo desde la misma IP',
                    actor: null,
                    organizationId: null,
                    metadata: { email: clave, intentos: fallidos },
                    origen,
                });
            }
            return { error: MSG_DEMASIADOS };
        }

        // 1. Buscar al usuario por correo e incluir su organización
        const user = await prisma.user.findUnique({
            where: { email },
            include: { organization: true }
        });

        // 2. Validaciones de seguridad estrictas
        if (!user || !user.password) {
            await registrarFallido(origen, clave, 'USUARIO_NO_EXISTE', null);
            return { error: MSG_CREDENCIALES };
        }

        // 3. Verificar contraseña encriptada
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            await registrarFallido(origen, clave, 'CLAVE_INCORRECTA', user);
            return { error: MSG_CREDENCIALES };
        }

        // Kill-switch: Validar si la organización está activa
        if (user.organizationId && user.organization && !user.organization.isActive) {
            await registrarFallido(origen, clave, 'CLINICA_INACTIVA', user);
            return { error: 'Por el momento su organización no se encuentra activa. Contacte al administrador del sistema.' };
        }

        // 4 y 5. El token (con su hora de emisión, que «cerrar sesiones» compara) y la cookie.
        await abrirSesion(user);

        // 6. Dejar constancia del ingreso, con IP y navegador. También alimenta
        //    «Logueos por rol» de Estadísticas Globales (lee `metadata.role`).
        //    Nunca bloquea el login si la escritura falla.
        await registrarActividad({
            action: 'USER_LOGIN',
            message: `Ingreso de usuario (${user.role})`,
            actor: { userId: user.id, email: user.email, role: user.role },
            organizationId: user.organizationId,
            origen,
        });

        return { success: true, role: user.role };
    } catch (error) {
        console.error('Error en login:', error);
        return { error: 'Error interno del servidor' };
    }
}

async function registrarFallido(
    origen: OrigenDeLaPeticion,
    clave: string,
    motivo: MotivoIngresoFallido,
    user: { id: string; email: string; role: string; organizationId: string | null } | null,
): Promise<void> {
    await registrarActividad({
        action: 'LOGIN_FAILED',
        level: 'WARNING',
        message: `Intento de ingreso fallido (${motivo})`,
        // Sin cuenta no hay a quién atribuirlo: el correo intentado va en `metadata.email`.
        actor: user ? { userId: user.id, email: clave, role: user.role } : null,
        organizationId: user?.organizationId ?? null,
        metadata: { email: clave, motivo },
        origen,
    });
}

export async function logoutUser() {
    const session = await getSession();
    if (session) {
        await registrarActividad({
            action: 'USER_LOGOUT',
            message: `Cierre de sesión (${session.role})`,
            actor: { userId: session.userId, email: session.email, role: session.role },
            organizationId: session.organizationId ?? null,
        });
    }
    const cookieStore = await cookies();
    cookieStore.delete('auth_token');
}
