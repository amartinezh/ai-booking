/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { prisma } from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../../lib/session';

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
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant no encontrado' };

        if (id) {
            const patient = await prisma.patientProfile.findFirst({ where: { id, organizationId: session.organizationId }, include: { user: true } });
            if (!patient) throw new Error("Paciente no encontrado en esta Organización");

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
            const hashedPassword = await bcrypt.hash(password || 'temporal123', 10);

            const existing = await prisma.patientProfile.findFirst({ where: { cedula, organizationId: session.organizationId } });
            if (existing) throw new Error("La cédula ya está registrada en esta clínica");

            const newUser = await prisma.user.create({
                data: { email, password: hashedPassword, role: 'PATIENT', organizationId: session.organizationId }
            });

            await prisma.patientProfile.create({
                data: {
                    fullName, cedula, address,
                    whatsappId: whatsappId || null,
                    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
                    userId: newUser.id,
                    organizationId: session.organizationId
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
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant no encontrado' };

        const patient = await prisma.patientProfile.findFirst({ where: { id, organizationId: session.organizationId } });
        if (patient) {
            await prisma.user.delete({ where: { id: patient.userId } });
        }
        revalidatePath('/dashboard/pacientes');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Error al eliminar el paciente' };
    }
}
