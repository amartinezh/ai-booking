/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { prisma } from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../../lib/session';

export async function saveDoctorAction(formData: FormData) {
    const id = formData.get('id') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const fullName = formData.get('fullName') as string;
    const cedula = formData.get('cedula') as string;
    const serviceId = formData.get('serviceId') as string;
    const medicalLicense = formData.get('medicalLicense') as string;
    const phone = formData.get('phone') as string;
    const isActive = formData.get('isActive') === 'true';

    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant no encontrado' };

        if (id) {
            // Editando (Asumimos que id es el DoctorProfile.id)
            const doctor = await prisma.doctorProfile.findFirst({ where: { id, organizationId: session.organizationId }, include: { user: true } });
            if (!doctor) throw new Error("Doctor no encontrado en esta Organización");

            // Validaciones de unicidad (edición)
            if (email !== doctor.user.email) {
                const exist = await prisma.user.findUnique({ where: { email } });
                if (exist) throw new Error("El correo electrónico ya está registrado por otro usuario.");
            }
            if (cedula !== doctor.cedula) {
                const exist = await prisma.doctorProfile.findUnique({ where: { cedula } });
                if (exist) throw new Error("La cédula ya pertenece a otro perfil médico.");
            }
            if (medicalLicense && medicalLicense !== doctor.medicalLicense) {
                const exist = await prisma.doctorProfile.findUnique({ where: { medicalLicense } });
                if (exist) throw new Error("La Tarjeta Profesional ya pertenece a otro perfil médico.");
            }

            // Actualizar User
            const userData: any = { email };
            if (password) userData.password = await bcrypt.hash(password, 10);
            await prisma.user.update({ where: { id: doctor.userId }, data: userData });

            // Actualizar DoctorProfile
            await prisma.doctorProfile.update({
                where: { id },
                data: { fullName, cedula, serviceId: serviceId || null, medicalLicense, phone, isActive }
            });
        } else {
            // Creando
            const hashedPassword = await bcrypt.hash(password || 'temporal123', 10);

            // Validaciones de unicidad (creación)
            const existCedula = await prisma.doctorProfile.findFirst({ where: { cedula, organizationId: session.organizationId } });
            if (existCedula) throw new Error("La cédula ya está registrada para otro médico en esta Clínica.");

            const existEmail = await prisma.user.findUnique({ where: { email } });
            if (existEmail) throw new Error("El correo electrónico ya se encuentra en uso.");

            if (medicalLicense) {
                const existLicense = await prisma.doctorProfile.findFirst({ where: { medicalLicense, organizationId: session.organizationId } });
                if (existLicense) throw new Error("La Tarjeta Profesional ya está registrada para otro médico.");
            }

            const newUser = await prisma.user.create({
                data: { email, password: hashedPassword, role: 'DOCTOR', organizationId: session.organizationId }
            });

            await prisma.doctorProfile.create({
                data: {
                    fullName, cedula, serviceId: serviceId || null, medicalLicense, phone, isActive,
                    userId: newUser.id,
                    organizationId: session.organizationId
                }
            });
        }
        revalidatePath('/dashboard/medicos');
        return { success: true };
    } catch (e: any) {
        if (e.code === 'P2002') {
            return { success: false, error: 'Conflicto: Un dato único (correo, cédula o Tarjeta Profesional) ya existe en la base de datos.' };
        }
        return { success: false, error: e.message || 'Error al guardar el médico' };
    }
}

export async function deleteDoctorAction(id: string) {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };

        const doctor = await prisma.doctorProfile.findFirst({ where: { id, organizationId: session.organizationId } });
        if (doctor) {
            await prisma.user.delete({ where: { id: doctor.userId } });
        }
        revalidatePath('/dashboard/medicos');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || 'Error al eliminar el médico' };
    }
}
