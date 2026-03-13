'use server'

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT } from 'jose';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';

const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'clave-secreta-hospital-san-vicente-2026');

export async function loginUser(formData: FormData) {
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    if (!email || !password) return { error: 'Por favor ingrese correo y contraseña' };

    try {
        // 🪄 TRUCO: Si no hay NINGÚN administrador en la tabla User, creamos el primero
        const adminCount = await prisma.user.count({
            where: { role: 'ADMIN' }
        });

        if (adminCount === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await prisma.user.create({
                data: {
                    email: 'admin@sanvicente.com',
                    password: hashedPassword,
                    role: 'ADMIN'
                }
            });
            console.log('✅ Creado usuario administrador por defecto');
        }

        // 1. Buscar al usuario por correo
        const user = await prisma.user.findUnique({ where: { email } });

        // 2. Validaciones de seguridad estrictas
        if (!user || !user.password) return { error: 'Credenciales incorrectas' };
        // Permitimos el paso a cualquier rol registrado.

        // 3. Verificar contraseña encriptada
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) return { error: 'Credenciales incorrectas' };

        // 4. Crear el token JWT
        const token = await new SignJWT({ userId: user.id, email: user.email, role: user.role })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('8h')
            .sign(SECRET_KEY);

        // 5. Guardar la Cookie (ahora asíncrona)
        const cookieStore = await cookies();
        cookieStore.set('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 60 * 60 * 8,
        });

        return { success: true };
    } catch (error) {
        console.error('Error en login:', error);
        return { error: 'Error interno del servidor' };
    }
}

export async function logoutUser() {
    const cookieStore = await cookies();
    cookieStore.delete('auth_token');
    redirect('/login');
}