/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { prisma } from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';

export async function saveDoctorAction(formData: FormData) {
    const id = formData.get('id') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const fullName = formData.get('fullName') as string;
    const cedula = formData.get('cedula') as string;
    const specialty = formData.get('specialty') as string;
    const medicalLicense = formData.get('medicalLicense') as string;
    const phone = formData.get('phone') as string;
    const isActive = formData.get('isActive') === 'true';

    try {
        if (id) {
            // Editando (Asumimos que id es el DoctorProfile.id)
            const doctor = await prisma.doctorProfile.findUnique({ where: { id }, include: { user: true } });
            if (!doctor) throw new Error("Doctor no encontrado");

            // Actualizar User
            const userData: any = { email };
            if (password) userData.password = await bcrypt.hash(password, 10);
            await prisma.user.update({ where: { id: doctor.userId }, data: userData });

            // Actualizar DoctorProfile
            await prisma.doctorProfile.update({
                where: { id },
                data: { fullName, cedula, specialty, medicalLicense, phone, isActive }
            });
        } else {
            // Creando
            const hashedPassword = await bcrypt.hash(password || 'sanvicente123', 10);

            // Verificamos si la cédula ya existe
            const existing = await prisma.doctorProfile.findUnique({ where: { cedula } });
            if (existing) throw new Error("La cédula ya está registrada para otro médico");

            const newUser = await prisma.user.create({
                data: { email, password: hashedPassword, role: 'DOCTOR' }
            });

            await prisma.doctorProfile.create({
                data: {
                    fullName, cedula, specialty, medicalLicense, phone, isActive,
                    userId: newUser.id
                }
            });
        }
        revalidatePath('/dashboard/medicos');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Error al guardar el médico' };
    }
}

export async function deleteDoctorAction(id: string) {
    try {
        const doctor = await prisma.doctorProfile.findUnique({ where: { id } });
        if (doctor) {
            // Por comportamiento de base de datos o por logica, borramos al user y eso hace cascade en el profile (si se tiene Cascade Delete)
            // Para asegurar, borramos explicitamente el user. 
            await prisma.user.delete({ where: { id: doctor.userId } });
        }
        revalidatePath('/dashboard/medicos');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Error al eliminar el médico' };
    }
}
