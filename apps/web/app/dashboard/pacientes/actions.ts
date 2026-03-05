/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { prisma } from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';

export async function savePatientAction(formData: FormData) {
    const id = formData.get('id') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const fullName = formData.get('fullName') as string;
    const cedula = formData.get('cedula') as string;
    const whatsappId = formData.get('whatsappId') as string;
    const address = formData.get('address') as string;
    const dateOfBirth = formData.get('dateOfBirth') as string;

    try {
        if (id) {
            const patient = await prisma.patientProfile.findUnique({ where: { id }, include: { user: true } });
            if (!patient) throw new Error("Paciente no encontrado");

            const userData: any = { email };
            if (password) userData.password = await bcrypt.hash(password, 10);
            await prisma.user.update({ where: { id: patient.userId }, data: userData });

            await prisma.patientProfile.update({
                where: { id },
                data: {
                    fullName, cedula, address,
                    whatsappId: whatsappId || null,
                    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null
                }
            });
        } else {
            const hashedPassword = await bcrypt.hash(password || 'sanvicente123', 10);

            const existing = await prisma.patientProfile.findUnique({ where: { cedula } });
            if (existing) throw new Error("La cédula ya está registrada");

            const newUser = await prisma.user.create({
                data: { email, password: hashedPassword, role: 'PATIENT' }
            });

            await prisma.patientProfile.create({
                data: {
                    fullName, cedula, address,
                    whatsappId: whatsappId || null,
                    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
                    userId: newUser.id
                }
            });
        }
        revalidatePath('/dashboard/pacientes');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Error al guardar el paciente' };
    }
}

export async function deletePatientAction(id: string) {
    try {
        const patient = await prisma.patientProfile.findUnique({ where: { id } });
        if (patient) {
            await prisma.user.delete({ where: { id: patient.userId } });
        }
        revalidatePath('/dashboard/pacientes');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Error al eliminar el paciente' };
    }
}
