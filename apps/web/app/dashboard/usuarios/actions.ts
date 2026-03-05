/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { prisma } from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { Role } from '@antigravity/database';

export async function saveUserAction(formData: FormData) {
    const id = formData.get('id') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const role = formData.get('role') as Role;

    try {
        if (id) {
            const data: any = { email, role };
            if (password) {
                data.password = await bcrypt.hash(password, 10);
            }
            await prisma.user.update({ where: { id }, data });
        } else {
            const hashedPassword = await bcrypt.hash(password || 'sanvicente123', 10);
            await prisma.user.create({
                data: { email, password: hashedPassword, role }
            });
        }
        revalidatePath('/dashboard/usuarios');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Error al guardar el usuario' };
    }
}

export async function deleteUserAction(id: string) {
    try {
        await prisma.user.delete({ where: { id } });
        revalidatePath('/dashboard/usuarios');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Error al eliminar el usuario' };
    }
}
