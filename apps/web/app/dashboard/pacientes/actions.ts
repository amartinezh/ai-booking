'use server'

import { prisma } from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../../lib/session';
import { getErrorMessage } from '../../../lib/error';
import { Prisma } from '@agenia/database';
import { validarClaveAsignada } from '../../../lib/cuenta/clave';
import { actorDeSesion, registrarActividad } from '../../../lib/actividad/registrar';
import { enmascarar, listarCambios } from '../../../lib/actividad/catalogo';

/**
 * 🔐 2026-10-27: la pantalla de Pacientes es del administrador, pero estas acciones
 * aceptaban cualquier sesión de la clínica (crear fichas, cambiarle el correo o la
 * clave a un paciente, borrarlo). Ahora solo ORG_ADMIN, la clave cumple la regla de
 * «Cambiar mi clave» (antes, vacía, quedaba `temporal123`) y cada cambio queda en la
 * Actividad de usuarios, sin copiar los datos del paciente: solo qué campo cambió.
 */
const MSG_SIN_PERMISO = 'Solo el administrador de la clínica puede gestionar las fichas de pacientes.';

const CAMPOS_PACIENTE: Record<string, string> = {
    fullName: 'nombre',
    cedula: 'cédula',
    whatsappId: 'WhatsApp',
    address: 'dirección',
    dateOfBirth: 'fecha de nacimiento',
    email: 'correo',
};
const TODOS_SIN_VALOR = Object.keys(CAMPOS_PACIENTE);

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
        if (session.role !== 'ORG_ADMIN') return { success: false, error: MSG_SIN_PERMISO };

        if (password || !id) {
            const problema = validarClaveAsignada(password, email);
            if (problema) return { success: false, error: problema };
        }

        if (id) {
            const patient = await prisma.patientProfile.findFirst({ where: { id, organizationId: session.organizationId }, include: { user: true } });
            if (!patient) throw new Error("Paciente no encontrado en esta Organización");

            const userData: Prisma.UserUpdateInput = { email };
            if (password) {
                userData.password = await bcrypt.hash(password, 10);
                userData.sessionsRevokedAt = new Date();
            }
            await prisma.user.update({ where: { id: patient.userId }, data: userData });

            const despues = {
                fullName, cedula, address,
                whatsappId: whatsappId || null,
                dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null
            };
            await prisma.patientProfile.update({ where: { id }, data: despues });

            const cambios = listarCambios(
                { ...patient, email: patient.user.email },
                { ...despues, email },
                CAMPOS_PACIENTE,
                TODOS_SIN_VALOR,
            );
            if (password) cambios.push('le puso una clave nueva y se cerraron sus sesiones');
            await registrarActividad({
                action: 'PATIENT_UPDATED',
                level: password || patient.user.email !== email ? 'WARNING' : 'EVENT',
                message: `Ficha de paciente modificada (${patient.id})`,
                actor: actorDeSesion(session),
                organizationId: session.organizationId,
                metadata: {
                    detalle: `Paciente ${enmascarar(patient.cedula)}: ${cambios.length ? cambios.join(' · ') : 'sin cambios'}`,
                    objetivo: { patientId: patient.id, userId: patient.userId },
                    claveNueva: !!password,
                },
            });
        } else {
            const hashedPassword = await bcrypt.hash(password, 10);

            const existing = await prisma.patientProfile.findFirst({ where: { cedula, organizationId: session.organizationId } });
            if (existing) throw new Error("La cédula ya está registrada en esta clínica");

            const newUser = await prisma.user.create({
                data: { email, password: hashedPassword, role: 'PATIENT', organizationId: session.organizationId }
            });

            const nuevo = await prisma.patientProfile.create({
                data: {
                    fullName, cedula, address,
                    whatsappId: whatsappId || null,
                    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
                    userId: newUser.id,
                    organizationId: session.organizationId
                }
            });
            await registrarActividad({
                action: 'PATIENT_CREATED',
                message: `Ficha de paciente creada (${nuevo.id})`,
                actor: actorDeSesion(session),
                organizationId: session.organizationId,
                metadata: {
                    detalle: `Paciente ${enmascarar(cedula)}${whatsappId ? ' · con WhatsApp' : ''}`,
                    objetivo: { patientId: nuevo.id, userId: newUser.id },
                },
            });
        }
        revalidatePath('/dashboard/pacientes');
        return { success: true };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) || 'Error al guardar el paciente' };
    }
}

export async function deletePatientAction(id: string) {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant no encontrado' };
        if (session.role !== 'ORG_ADMIN') return { success: false, error: MSG_SIN_PERMISO };

        const patient = await prisma.patientProfile.findFirst({ where: { id, organizationId: session.organizationId } });
        if (patient) {
            await prisma.user.delete({ where: { id: patient.userId } });
            await registrarActividad({
                action: 'PATIENT_DELETED',
                level: 'WARNING',
                message: `Ficha de paciente eliminada (${patient.id})`,
                actor: actorDeSesion(session),
                organizationId: session.organizationId,
                metadata: {
                    detalle: `Paciente ${enmascarar(patient.cedula)}`,
                    objetivo: { patientId: patient.id, userId: patient.userId },
                },
            });
        }
        revalidatePath('/dashboard/pacientes');
        return { success: true };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) || 'Error al eliminar el paciente' };
    }
}
