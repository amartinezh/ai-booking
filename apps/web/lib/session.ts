/* eslint-disable @typescript-eslint/no-unused-vars */
import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
import { getJwtSecretKey } from './jwt-secret';

export interface SessionPayload {
    userId: string;
    email: string;
    role: 'PATIENT' | 'DOCTOR' | 'ORG_ADMIN' | 'SUPER_ADMIN' | 'BOOKING_AGENT' | 'GENERAL_OBSERVER';
    organizationId?: string | null;
}

export async function getSession(): Promise<SessionPayload | null> {
    // Fuera del try: si JWT_SECRET falta, queremos el error explícito de
    // configuración, no un "sesión inválida" silencioso en bucle.
    const secretKey = getJwtSecretKey();
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        if (!token) return null;

        const verified = await jwtVerify(token, secretKey);
        return verified.payload as unknown as SessionPayload;
    } catch (_) {
        return null;
    }
}
