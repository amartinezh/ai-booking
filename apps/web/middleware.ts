import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Debe ser la misma clave secreta que usaste en auth.ts
const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'clave-secreta-hospital-san-vicente-2026');

export async function middleware(request: NextRequest) {
    // Solo protegemos las rutas que empiezan con /dashboard
    if (request.nextUrl.pathname.startsWith('/dashboard')) {

        // 1. Buscar la cookie
        const token = request.cookies.get('auth_token')?.value;

        // 2. Si no hay cookie, lo pateamos al login
        if (!token) {
            return NextResponse.redirect(new URL('/login', request.url));
        }

        // 3. Si hay cookie, verificamos que no sea falsa y no haya expirado
        try {
            await jwtVerify(token, SECRET_KEY);
            return NextResponse.next(); // Adelante, puede pasar
        } catch (_) {
            // Token inválido o expirado
            return NextResponse.redirect(new URL('/login', request.url));
        }
    }

    // Las demás rutas (como la landing page) son públicas
    return NextResponse.next();
}

// Configuración opcional para que el middleware corra solo donde se necesita
export const config = {
    matcher: ['/dashboard/:path*'],
};