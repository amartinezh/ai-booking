'use server'

import { prisma } from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { getSession } from '../../../lib/session';
import { Role, Prisma } from '@agenia/database';
import { getErrorMessage } from '../../../lib/error';
import { validarClaveAsignada } from '../../../lib/cuenta/clave';
import { registrarActividad } from '../../../lib/actividad/registrar';
import { etiquetaRol } from '../../../lib/actividad/catalogo';

/**
 * 🔐 2026-10-26: estas dos acciones solo pedían una sesión con clínica. Una acción
 * de servidor es un endpoint público, así que cualquier usuario de la clínica
 * —médico, agendador, paciente— podía crear cuentas, cambiarle la clave a otro
 * o crear un SUPER_ADMIN (el rol llegaba sin revisar). Ahora: solo ORG_ADMIN,
 * solo los roles de una clínica, clave con la regla de «Cambiar mi clave» y cada
 * cambio en la bitácora (Actividad de usuarios del super administrador).
 */
const ROLES_ASIGNABLES: readonly Role[] = ['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR', 'GENERAL_OBSERVER', 'PATIENT'];

const MSG_SIN_PERMISO = 'Solo el administrador de la clínica puede gestionar usuarios.';

function esRolAsignable(valor: unknown): valor is Role {
    return typeof valor === 'string' && (ROLES_ASIGNABLES as readonly string[]).includes(valor);
}

export async function saveUserAction(formData: FormData) {
    const id = formData.get('id') as string;
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const role = formData.get('role');
    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Contexto de Clínica no encontrado' };
        if (session.role !== 'ORG_ADMIN') return { success: false, error: MSG_SIN_PERMISO };
        // Capturado tras el guard: TS no propaga el narrowing al closure de la transacción.
        const organizationId = session.organizationId;
        const actor = { userId: session.userId, email: session.email, role: session.role };

        if (!email) return { success: false, error: 'Escriba el correo del usuario.' };
        if (!esRolAsignable(role)) return { success: false, error: 'Elija un rol válido.' };

        // Propiedades de Agente
        const agentFullName = formData.get('agentFullName') as string;
        const agentEpsId = formData.get('agentEpsId') as string;
        const agentDoctorId = formData.get('agentDoctorId') as string;

        if (id) {
            // MODO EDICIÓN (Aseguramos que no modifique usuarios de otro lado, ni Super Admins)
            const existingUser = await prisma.user.findFirst({ where: { id, organizationId: session.organizationId, role: { not: 'SUPER_ADMIN' } }});
            if (!existingUser) return { success: false, error: 'Usuario no encontrado en este Tenant permitido para editar' };
            if (existingUser.id === session.userId && role !== existingUser.role) {
                return { success: false, error: 'No puede cambiar su propio rol: pídaselo a otro administrador.' };
            }

            const data: Prisma.UserUpdateInput = { email, role };
            if (password) {
                const problema = validarClaveAsignada(password, email);
                if (problema) return { success: false, error: problema };
                data.password = await bcrypt.hash(password, 10);
            }

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

            const cambios = [
                existingUser.email !== email ? `correo ${existingUser.email} → ${email}` : null,
                existingUser.role !== role ? `rol ${etiquetaRol(existingUser.role)} → ${etiquetaRol(role)}` : null,
                password ? 'le puso una clave nueva' : null,
            ].filter(Boolean);
            await registrarActividad({
                action: 'USER_UPDATED',
                level: existingUser.role !== role || password ? 'WARNING' : 'EVENT',
                message: `Usuario modificado (${existingUser.email})`,
                actor,
                organizationId,
                metadata: {
                    detalle: `${email}: ${cambios.length ? cambios.join(' · ') : 'sin cambios de correo, rol ni clave'}`,
                    objetivo: { userId: id, email, role, antes: { email: existingUser.email, role: existingUser.role } },
                    claveNueva: !!password,
                },
            });
        } else {
            // MODO CREACIÓN: la clave la pone quien crea la cuenta (antes, vacía, era `temporal123`).
            const problema = validarClaveAsignada(password, email);
            if (problema) return { success: false, error: problema };
            const hashedPassword = await bcrypt.hash(password, 10);
            const creado = await prisma.$transaction(async (tx) => {
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
                return newUser;
            });

            await registrarActividad({
                action: 'USER_CREATED',
                message: `Usuario creado (${email}, ${role})`,
                actor,
                organizationId,
                metadata: {
                    detalle: `Cuenta ${email} como ${etiquetaRol(role)}`,
                    objetivo: { userId: creado.id, email, role },
                },
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
        if (session.role !== 'ORG_ADMIN') return { success: false, error: MSG_SIN_PERMISO };
        if (id === session.userId) return { success: false, error: 'No puede eliminar su propia cuenta.' };

        const borrado = await prisma.user.delete({ where: { id, organizationId: session.organizationId, role: { not: 'SUPER_ADMIN' } } });
        await registrarActividad({
            action: 'USER_DELETED',
            level: 'WARNING',
            message: `Usuario eliminado (${borrado.email})`,
            actor: { userId: session.userId, email: session.email, role: session.role },
            organizationId: session.organizationId,
            metadata: {
                detalle: `Cuenta ${borrado.email} (${etiquetaRol(borrado.role)})`,
                objetivo: { userId: borrado.id, email: borrado.email, role: borrado.role },
            },
        });
        revalidatePath('/dashboard/usuarios');
        return { success: true, error: undefined };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) || 'Error al eliminar el usuario' };
    }
}
