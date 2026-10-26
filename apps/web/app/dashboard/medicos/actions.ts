'use server'

import { prisma } from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../../lib/session';
import { getErrorMessage } from '../../../lib/error';
import { Prisma } from '@agenia/database';
import { validarClaveAsignada } from '../../../lib/cuenta/clave';
import { actorDeSesion, registrarActividad, registrarDespues } from '../../../lib/actividad/registrar';
import { enmascarar, listarCambios } from '../../../lib/actividad/catalogo';

/**
 * 🔐 2026-10-27: estas acciones solo pedían una sesión con clínica, y la pantalla
 * es del administrador. Cualquier usuario de la clínica podía crear médicos (con su
 * cuenta del panel), cambiarle el correo o la clave a uno —y entrar como él— o
 * borrarlo. Ahora solo ORG_ADMIN, la clave cumple la regla de «Cambiar mi clave»
 * (antes, vacía, quedaba `temporal123`) y cada cambio queda en la Actividad de
 * usuarios del super administrador.
 */
const MSG_SIN_PERMISO = 'Solo el administrador de la clínica puede gestionar los médicos.';

const CAMPOS_MEDICO: Record<string, string> = {
    fullName: 'nombre',
    cedula: 'cédula',
    servicio: 'servicio',
    medicalLicense: 'tarjeta profesional',
    phone: 'teléfono',
    email: 'correo',
    isActive: 'activo',
    whatsappBookingEnabled: 'WhatsApp',
};

async function nombreDelServicio(id: string | null | undefined, organizationId: string): Promise<string | null> {
    if (!id) return null;
    const s = await prisma.medicalService.findFirst({ where: { id, organizationId }, select: { name: true } });
    return s?.name ?? null;
}

export async function saveDoctorAction(formData: FormData) {
    const id = formData.get('id') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const fullName = formData.get('fullName') as string;
    const cedula = formData.get('cedula') as string;
    const serviceId = formData.get('serviceId') as string;
    const medicalLicenseRaw = formData.get('medicalLicense') as string;
    const medicalLicense = medicalLicenseRaw?.trim() || null;
    const phone = formData.get('phone') as string;
    const isActive = formData.get('isActive') === 'true';
    const whatsappBookingEnabled = formData.get('whatsappBookingEnabled') === 'true';

    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant no encontrado' };
        if (session.role !== 'ORG_ADMIN') return { success: false, error: MSG_SIN_PERMISO };
        const organizationId = session.organizationId;

        if (password || !id) {
            const problema = validarClaveAsignada(password, email);
            if (problema) return { success: false, error: problema };
        }

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
                const exist = await prisma.doctorProfile.findFirst({ where: { cedula, organizationId: session.organizationId } });
                if (exist) throw new Error("La cédula ya pertenece a otro perfil médico de esta Clínica.");
            }
            if (medicalLicense && medicalLicense !== doctor.medicalLicense) {
                const exist = await prisma.doctorProfile.findFirst({ where: { medicalLicense, organizationId: session.organizationId } });
                if (exist) throw new Error("La Tarjeta Profesional ya pertenece a otro perfil médico de esta Clínica.");
            }

            // Actualizar User
            const userData: Prisma.UserUpdateInput = { email };
            if (password) userData.password = await bcrypt.hash(password, 10);
            await prisma.user.update({ where: { id: doctor.userId }, data: userData });

            // Actualizar DoctorProfile
            await prisma.doctorProfile.update({
                where: { id },
                data: { fullName, cedula, serviceId: serviceId || null, medicalLicense, phone, isActive, whatsappBookingEnabled }
            });

            await registrarDespues(async () => {
                const [servicioAntes, servicioDespues] = await Promise.all([
                    nombreDelServicio(doctor.serviceId, organizationId),
                    nombreDelServicio(serviceId || null, organizationId),
                ]);
                const cambios = listarCambios(
                    { ...doctor, email: doctor.user.email, servicio: servicioAntes },
                    { fullName, cedula, servicio: servicioDespues, medicalLicense, phone, email, isActive, whatsappBookingEnabled },
                    CAMPOS_MEDICO,
                    ['cedula', 'phone'],
                );
                if (password) cambios.push('le puso una clave nueva');
                // Encender o apagar su WhatsApp decide si el asistente agenda con él.
                const sensible =
                    !!password ||
                    doctor.whatsappBookingEnabled !== whatsappBookingEnabled ||
                    doctor.isActive !== isActive ||
                    doctor.user.email !== email;
                return {
                    action: 'DOCTOR_UPDATED',
                    level: sensible ? 'WARNING' : 'EVENT',
                    message: `Médico modificado (${doctor.fullName})`,
                    actor: actorDeSesion(session),
                    organizationId,
                    metadata: {
                        detalle: `${fullName}: ${cambios.length ? cambios.join(' · ') : 'sin cambios'}`,
                        objetivo: { doctorId: id, userId: doctor.userId },
                        claveNueva: !!password,
                    },
                };
            });
        } else {
            // Creando (la clave ya se validó arriba: antes, vacía, quedaba `temporal123`)
            const hashedPassword = await bcrypt.hash(password, 10);

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

            const nuevo = await prisma.doctorProfile.create({
                data: {
                    fullName, cedula, serviceId: serviceId || null, medicalLicense, phone, isActive, whatsappBookingEnabled,
                    userId: newUser.id,
                    organizationId: session.organizationId
                }
            });

            await registrarDespues(async () => {
                const servicio = await nombreDelServicio(serviceId || null, organizationId);
                return {
                    action: 'DOCTOR_CREATED',
                    message: `Médico creado (${fullName})`,
                    actor: actorDeSesion(session),
                    organizationId,
                    metadata: {
                        detalle: [
                            fullName,
                            `cédula ${enmascarar(cedula)}`,
                            servicio,
                            `WhatsApp ${whatsappBookingEnabled ? 'ON' : 'OFF'}`,
                            isActive ? null : 'inactivo',
                            `cuenta ${email}`,
                        ]
                            .filter(Boolean)
                            .join(' · '),
                        objetivo: { doctorId: nuevo.id, userId: newUser.id },
                    },
                };
            });
        }
        revalidatePath('/dashboard/medicos');
        return { success: true };
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return { success: false, error: 'Conflicto: el correo ya está en uso, o la cédula/Tarjeta Profesional ya existe en esta Clínica.' };
        }
        return { success: false, error: getErrorMessage(e) || 'Error al guardar el médico' };
    }
}

export async function deleteDoctorAction(id: string) {
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };
        if (session.role !== 'ORG_ADMIN') return { success: false, error: MSG_SIN_PERMISO };

        const doctor = await prisma.doctorProfile.findFirst({ where: { id, organizationId: session.organizationId } });
        if (doctor) {
            await prisma.user.delete({ where: { id: doctor.userId } });
            await registrarActividad({
                action: 'DOCTOR_DELETED',
                level: 'WARNING',
                message: `Médico eliminado (${doctor.fullName})`,
                actor: actorDeSesion(session),
                organizationId: session.organizationId,
                metadata: {
                    detalle: `${doctor.fullName} · cédula ${enmascarar(doctor.cedula)}`,
                    objetivo: { doctorId: doctor.id, userId: doctor.userId },
                },
            });
        }
        revalidatePath('/dashboard/medicos');
        return { success: true };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) || 'Error al eliminar el médico' };
    }
}
