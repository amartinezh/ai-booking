'use server'

import { prisma } from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../../lib/session';
import { Role, Prisma } from '@agenia/database';
import { getErrorMessage } from '../../../lib/error';

export async function saveUserAction(formData: FormData) {
    const id = formData.get('id') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const role = formData.get('role') as Role;
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Contexto de Clínica no encontrado' };
        // Capturado tras el guard: TS no propaga el narrowing al closure de la transacción.
        const organizationId = session.organizationId;

        // Propiedades de Agente
        const agentFullName = formData.get('agentFullName') as string;
        const agentEpsId = formData.get('agentEpsId') as string;
        const agentDoctorId = formData.get('agentDoctorId') as string;

        if (id) {
            const data: Prisma.UserUpdateInput = { email, role };
            if (password) {
                data.password = await bcrypt.hash(password, 10);
            }
            // MODO EDICIÓN (Aseguramos que no modifique usuarios de otro lado, ni Super Admins)
            const existingUser = await prisma.user.findFirst({ where: { id, organizationId: session.organizationId, role: { not: 'SUPER_ADMIN' } }});
            if (!existingUser) return { success: false, error: 'Usuario no encontrado en este Tenant permitido para editar' };

            await prisma.$transaction(async (tx) => {
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
                            organizationId,
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
            const hashedPassword = await bcrypt.hash(password || 'temporal123', 10);
            await prisma.$transaction(async (tx) => {
                const newUser = await tx.user.create({
                    data: { email, password: hashedPassword, role, organizationId }
                });

                if (role === 'BOOKING_AGENT') {
                    await tx.agentProfile.create({
                        data: {
                            userId: newUser.id,
                            organizationId,
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
    } catch (e) {
        return { success: false, error: getErrorMessage(e) || 'Error al guardar el usuario' };
    }
}

export async function deleteUserAction(id: string) {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Contexto de Clínica no encontrado' };

        await prisma.user.delete({ where: { id, organizationId: session.organizationId, role: { not: 'SUPER_ADMIN' } } });
        revalidatePath('/dashboard/usuarios');
        return { success: true, error: undefined };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) || 'Error al eliminar el usuario' };
    }
}
