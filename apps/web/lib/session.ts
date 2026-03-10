/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';

const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'clave-secreta-hospital-san-vicente-2026');

export interface SessionPayload {
    userId: string;
    email: string;
    role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
}

export async function getSession(): Promise<SessionPayload | null> {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        if (!token) return null;

        const verified = await jwtVerify(token, SECRET_KEY);
        return verified.payload as unknown as SessionPayload;
    } catch (_) {
        return null;
    }
}
