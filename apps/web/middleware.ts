/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'clave-secreta-hospital-san-vicente-2026');

function isServerActionRequest(request: NextRequest): boolean {
    if (request.method !== 'POST') return false;
    return request.headers.has('next-action');
}

function isRscRequest(request: NextRequest): boolean {
    return request.headers.get('rsc') === '1' || request.headers.has('next-router-state-tree');
}

function unauthorizedActionResponse(request: NextRequest) {
    const loginUrl = new URL('/login', request.url).toString();
    const res = new NextResponse(
        JSON.stringify({ error: 'SESSION_EXPIRED', redirect: '/login' }),
        {
            status: 401,
            headers: {
                'content-type': 'application/json',
                'x-session-expired': '1',
                'x-redirect-to': loginUrl,
            },
        }
    );
    res.cookies.delete('auth_token');
    return res;
}

function redirectToLogin(request: NextRequest, clearCookie: boolean) {
    const res = NextResponse.redirect(new URL('/login', request.url));
    if (clearCookie) res.cookies.delete('auth_token');
    return res;
}

export async function middleware(request: NextRequest) {
    const isDashboard = request.nextUrl.pathname.startsWith('/dashboard');
    const isSuperAdmin = request.nextUrl.pathname.startsWith('/super-admin');

    if (isDashboard || isSuperAdmin) {
        const token = request.cookies.get('auth_token')?.value;
        const isAction = isServerActionRequest(request);

        if (!token) {
            if (isAction) return unauthorizedActionResponse(request);
            return redirectToLogin(request, false);
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
            if (isAction) return unauthorizedActionResponse(request);
            return redirectToLogin(request, true);
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/dashboard/:path*', '/super-admin/:path*'],
};
