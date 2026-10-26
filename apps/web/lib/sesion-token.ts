/**
 * 🔐 El token de sesión y su cookie. Lo usan el ingreso y «Cambiar mi clave» (que
 * cierra las otras sesiones y le da a quien la cambió un token nuevo). Lleva `iat`
 * (cuándo se emitió): es lo que «cerrar sesiones» compara (packages/shared/src/sesion.ts).
 */
import { cookies } from 'next/headers';
import { SignJWT } from 'jose';
import { DURACION_SESION_SEG } from '@agenia/shared';
import { getJwtSecretKey } from './jwt-secret';

export async function abrirSesion(user: {
    id: string;
    email: string;
    role: string;
    organizationId: string | null;
}): Promise<void> {
    const token = await new SignJWT({
        userId: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${DURACION_SESION_SEG}s`)
        .sign(getJwtSecretKey());

    const cookieStore = await cookies();
    cookieStore.set('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: DURACION_SESION_SEG,
    });
}
