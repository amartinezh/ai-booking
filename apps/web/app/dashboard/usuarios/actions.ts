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
        // Propiedades de Agente
        const agentFullName = formData.get('agentFullName') as string;
        const agentEpsId = formData.get('agentEpsId') as string;
        const agentDoctorId = formData.get('agentDoctorId') as string;

        if (id) {
            const data: any = { email, role };
            if (password) {
                data.password = await bcrypt.hash(password, 10);
            }
            // MODO EDICIÓN
            await prisma.$transaction(async (tx: any) => {
                await tx.user.update({ where: { id }, data });
                
                if (role === 'BOOKING_AGENT') {
                    await tx.agentProfile.upsert({
                        where: { userId: id },
                        update: {
                            fullName: agentFullName,
                            epsId: agentEpsId || null,
                            doctorId: agentDoctorId || null,
                        },
                        create: {
                            userId: id,
                            fullName: agentFullName,
                            epsId: agentEpsId || null,
                            doctorId: agentDoctorId || null,
                        }
                    });
                } else {
                    // Si el usuario cambia de rol, limpiamos sus perfiles anteriores
                    await tx.agentProfile.deleteMany({ where: { userId: id } });
                }
            });
        } else {
            // MODO CREACIÓN
            const hashedPassword = await bcrypt.hash(password || 'sanvicente123', 10);
            await prisma.$transaction(async (tx: any) => {
                const newUser = await tx.user.create({
                    data: { email, password: hashedPassword, role }
                });

                if (role === 'BOOKING_AGENT') {
                    await tx.agentProfile.create({
                        data: {
                            userId: newUser.id,
                            fullName: agentFullName,
                            epsId: agentEpsId || null,
                            doctorId: agentDoctorId || null,
                        }
                    });
                }
            });
        }
        revalidatePath('/dashboard/usuarios');
        return { success: true, error: undefined };
    } catch (e: any) {
        return { success: false, error: e.message || 'Error al guardar el usuario' };
    }
}

export async function deleteUserAction(id: string) {
    try {
        await prisma.user.delete({ where: { id } });
        revalidatePath('/dashboard/usuarios');
        return { success: true, error: undefined };
    } catch (e: any) {
        return { success: false, error: e.message || 'Error al eliminar el usuario' };
    }
}
