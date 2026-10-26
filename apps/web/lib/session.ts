/* eslint-disable @typescript-eslint/no-unused-vars */
import { cache } from 'react';
import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
import { motivoSesionInvalida, type MotivoSesionInvalida } from '@agenia/shared';
import { getJwtSecretKey } from './jwt-secret';
import { prisma } from './prisma';

export interface SessionPayload {
    userId: string;
    email: string;
    role: 'PATIENT' | 'DOCTOR' | 'ORG_ADMIN' | 'SUPER_ADMIN' | 'BOOKING_AGENT' | 'GENERAL_OBSERVER';
    organizationId?: string | null;
    iat?: number;
    exp?: number;
}

/**
 * La cuenta tal como está HOY en la base, una vez por petición (`cache` de React:
 * el layout, la página y las acciones de una misma petición la leen una sola vez).
 */
const cuentaDeLaSesion = cache(async (userId: string) => {
    const u = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            role: true,
            organizationId: true,
            sessionsRevokedAt: true,
            organization: { select: { isActive: true } },
        },
    });
    return u
        ? {
              role: u.role as string,
              organizationId: u.organizationId,
              sessionsRevokedAt: u.sessionsRevokedAt,
              clinicaActiva: u.organization ? u.organization.isActive : null,
          }
        : null;
});

/**
 * Por qué la sesión de este token ya no vale (cuenta borrada, rol o clínica
 * cambiados, clínica suspendida, sesiones cerradas), o null si sigue vigente.
 * Si la base no responde, falla cerrado: sin poder comprobarla no hay sesión.
 */
export async function motivoDeSesionInvalida(payload: SessionPayload): Promise<MotivoSesionInvalida | null> {
    try {
        return motivoSesionInvalida(payload, await cuentaDeLaSesion(payload.userId));
    } catch (e) {
        console.error('[sesión] no se pudo comprobar la cuenta en la base:', e instanceof Error ? e.message : e);
        return 'CUENTA_NO_EXISTE';
    }
}

export async function getSession(): Promise<SessionPayload | null> {
    // Leer la cookie PRIMERO (y fuera del try) marca la ruta como dinámica: en
    // `next build` Next no intenta prerenderizarla, así que NO evalúa
    // `getJwtSecretKey()` en build-time (donde JWT_SECRET no existe y lanzaría,
    // tumbando el build). En runtime el comportamiento es idéntico.
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;

    if (!token) return null;

    // Fuera del try: si JWT_SECRET falta, queremos el error explícito de
    // configuración, no un "sesión inválida" silencioso en bucle.
    const secretKey = getJwtSecretKey();
    let payload: SessionPayload;
    try {
        const verified = await jwtVerify(token, secretKey);
        payload = verified.payload as unknown as SessionPayload;
    } catch (_) {
        return null;
    }

    // 🔐 2026-10-27: la firma sola no basta. Una cuenta borrada, con otro rol, de una
    // clínica suspendida o con las sesiones cerradas ya no entra, aunque su token
    // no haya vencido (antes seguía adentro hasta 8 horas).
    if (await motivoDeSesionInvalida(payload)) return null;
    return payload;
}
