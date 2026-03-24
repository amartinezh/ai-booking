/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Debe ser la misma clave secreta que usaste en auth.ts
const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'clave-secreta-hospital-san-vicente-2026');

export async function middleware(request: NextRequest) {
    const isDashboard = request.nextUrl.pathname.startsWith('/dashboard');
    const isSuperAdmin = request.nextUrl.pathname.startsWith('/super-admin');

    if (isDashboard || isSuperAdmin) {
        const token = request.cookies.get('auth_token')?.value;

        if (!token) {
            return NextResponse.redirect(new URL('/login', request.url));
        }

        try {
            const verified = await jwtVerify(token, SECRET_KEY);
            const payload = verified.payload as any;

            if (isSuperAdmin && payload.role !== 'SUPER_ADMIN') {
                return NextResponse.redirect(new URL('/dashboard', request.url));
            }

            if (isDashboard && payload.role === 'SUPER_ADMIN') {
                return NextResponse.redirect(new URL('/super-admin/organizations', request.url));
            }

            return NextResponse.next();
        } catch (_) {
            return NextResponse.redirect(new URL('/login', request.url));
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/dashboard/:path*', '/super-admin/:path*'],
};