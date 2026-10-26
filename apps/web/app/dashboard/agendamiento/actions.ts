'use server';

import { prisma } from '../../../lib/prisma';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { getSession } from '../../../lib/session';
import { findEpsEnrollmentIssue } from '../../../lib/eps-enrollment';
import { getErrorMessage } from '../../../lib/error';
import {
    MSG_FALTA_REGIMEN,
    documentoSinCerosIniciales,
    faltaRegimenParaElEspejo,
    parseRegimen,
    regimenSeguroDelPadron,
    type Regimen,
    destinoDeContacto,
} from '@agenia/shared';
import {
    MSG_FUERA_DE_ALCANCE,
    MSG_SIN_PERMISO_AGENDA,
    alcanceDeLaSesion,
    citaFueraDeAlcance,
    puedeOperarAgenda,
} from '../../../lib/alcance-agente';
import { mensajeDeError, operacionApagada } from '@/lib/interruptores-hospital';
import { actorDeSesion, registrarActividad, registrarDespues } from '@/lib/actividad/registrar';
import { describirCita, enmascarar } from '@/lib/actividad/catalogo';

/** Los nombres que hacen falta para decir en la Actividad de usuarios qué cita fue. */
async function nombresDeLaCita(
    organizationId: string,
    ids: { doctorId: string; serviceId?: string | null; epsId?: string | null },
) {
    const [medico, servicio, eps] = await Promise.all([
        prisma.doctorProfile.findFirst({ where: { id: ids.doctorId, organizationId }, select: { fullName: true } }),
        ids.serviceId
            ? prisma.medicalService.findFirst({ where: { id: ids.serviceId, organizationId }, select: { name: true } })
            : null,
        ids.epsId ? prisma.eps.findFirst({ where: { id: ids.epsId, organizationId }, select: { name: true } }) : null,
    ]);
    return { medico: medico?.fullName ?? null, servicio: servicio?.name ?? null, eps: eps?.name ?? null };
}

/**
 * 🔐 Las tres acciones de este archivo comprobaban SOLO que hubiera sesión con
 * clínica: ni el rol ni el alcance (§12 #12 del plan del rastreo). Una acción de
 * servidor es un endpoint público — cualquier sesión de la clínica, incluida la de un
 * PACIENTE, llega con el id de la acción—, así que por esta vía se podían crear y
 * mover citas de cualquiera. Ahora cada una exige, en este orden: rol de agenda,
 * clínica del token y el alcance con el que la pantalla lista las citas.
 */

// Mock del Outbound de Whatsapp desde NestJS API (o invocación HTTP a nuestro NestJS)
export async function sendManualWhatsappAction(appointmentId: string, message: string) {
    if (!message || message.trim() === '') return { success: false, error: 'Mensaje vacío.' };

    try {
        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };
        if (!puedeOperarAgenda(session.role)) {
            return { success: false, error: MSG_SIN_PERMISO_AGENDA };
        }

        const appointment = await prisma.appointment.findFirst({
            where: { id: appointmentId, organizationId: session.organizationId },
            include: {
                patient: true,
                scheduleSlot: {
                    select: {
                        doctorId: true,
                        startTime: true,
                        doctor: { select: { fullName: true } },
                        service: { select: { name: true } },
                    },
                },
            },
        });

        if (!appointment) return { success: false, error: 'Cita no encontrada.' };

        const alcance = await alcanceDeLaSesion(prisma, session);
        if (citaFueraDeAlcance(alcance, { epsId: appointment.epsId, doctorId: appointment.scheduleSlot.doctorId })) {
            return { success: false, error: MSG_FUERA_DE_ALCANCE };
        }

        // Destinatario: el BSUID manda sobre el teléfono (es el identificador
        // estable). Antes esto caía en `|| patient.cedula` — una cédula NO es
        // un destinatario de WhatsApp: el envío fallaba o, peor, llegaba a
        // quien tuviera ese número. Sin identificador, no se envía.
        //
        // ✈️ Telegram (docs/PLAN_TELEGRAM.md, T4): el canal lo decide la MISMA
        // regla que el recordatorio (`destinoDeContacto`): el de la cita, con
        // caída al otro. Para una cita de WhatsApp da el destinatario de siempre.
        const destino = destinoDeContacto(appointment.patient, appointment.origin);
        if (!destino) {
            return {
                success: false,
                error: 'El paciente no tiene un identificador de WhatsApp registrado.',
            };
        }
        const recipient = destino.destinatario;

        // El endpoint /chatbot/outbound ahora exige sesión (RolesGuard) y envía
        // por la línea de la clínica del token, así que reenviamos la cookie.
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/chatbot/outbound`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Cookie: `auth_token=${token}` } : {})
            },
            body: JSON.stringify({
                to: recipient,
                message
            })
        });

        if (!res.ok) {
            throw new Error('Error enviando mensaje via API');
        }

        // Quién le escribió, por dónde y sobre qué cita. El texto NO se guarda: la
        // bitácora no se purga y las conversaciones sí (180 días, Habeas Data).
        await registrarActividad({
            action: 'PATIENT_MESSAGE_SENT',
            message: `Mensaje manual al paciente de la cita ${appointment.id} (${destino.canal})`,
            actor: actorDeSesion(session),
            organizationId: session.organizationId,
            metadata: {
                detalle: [
                    `Por ${destino.canal === 'TELEGRAM' ? 'Telegram' : 'WhatsApp'}`,
                    describirCita({
                        inicio: appointment.scheduleSlot.startTime,
                        servicio: appointment.scheduleSlot.service?.name,
                        medico: appointment.scheduleSlot.doctor?.fullName,
                    }),
                    `paciente ${enmascarar(appointment.patient.cedula)}`,
                ].join(' · '),
                cita: appointment.id,
                canal: destino.canal,
                caracteres: message.trim().length,
            },
        });

        return { success: true, canal: destino.canal };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}

/** El régimen elegido en el formulario, o null si se dejó en «no registrado». */
function regimenDelFormulario(formData: FormData): 'SUBSIDIADO' | 'CONTRIBUTIVO' | null {
    const valor = formData.get('regime');
    return typeof valor === 'string' ? parseRegimen(valor) : null;
}

/**
 * El régimen del padrón para agendar a esta cédula con `epsId`, solo si no hay NINGUNA
 * duda (`regimenSeguroDelPadron`, la misma regla del bot y de la reserva de la API):
 * una sola EPS en el padrón, la de la cita, y un solo régimen. Si no, null.
 */
async function regimenDelPadron(
    organizationId: string,
    cedula: string,
    epsId: string,
): Promise<Regimen | null> {
    if (!cedula || !epsId) return null;
    const filas = await prisma.epsEnrolledPatient.findMany({
        where: {
            organizationId,
            isActive: true,
            cedula: { in: [...new Set([cedula, documentoSinCerosIniciales(cedula)])] },
        },
        select: { epsId: true, regime: true },
        take: 10,
    });
    return regimenSeguroDelPadron(filas, epsId);
}

/**
 * 🧾 ¿Esta cita llegaría al hospital sin el régimen con el que se elige el convenio?
 *
 * Misma regla que la reserva por WhatsApp (`faltaRegimenParaElEspejo`, gemela de
 * `resolveConvenio` del driver): con espejo activo, una EPS con NIT exige régimen.
 * Sin él el agente rechaza la cita diez veces y se rinde, y el hospital nunca la
 * tiene — caso real del 2026-09-26. Se comprueba ANTES de escribir nada.
 */
async function faltaRegimen(
    organizationId: string,
    epsId: string,
    regimen: string | null | undefined,
): Promise<boolean> {
    const [espejo, eps] = await Promise.all([
        prisma.hospitalMirrorConfig.findUnique({ where: { organizationId }, select: { enabled: true } }),
        prisma.eps.findFirst({ where: { id: epsId, organizationId }, select: { nit: true } }),
    ]);
    return faltaRegimenParaElEspejo({ espejoActivo: !!espejo?.enabled, epsNit: eps?.nit, regimen });
}

export async function createManualAppointmentAction(formData: FormData) {
    try {
        const patientCedula = formData.get('cedula') as string;
        const patientName = formData.get('fullName') as string;
        const epsId = formData.get('epsId') as string;
        const serviceId = formData.get('serviceId') as string;
        const doctorId = formData.get('doctorId') as string;
        const startDateStr = formData.get('startDate') as string;

        if (!patientCedula || !patientName || !epsId || !serviceId || !doctorId || !startDateStr) {
            return { success: false, error: 'Faltan campos obligatorios.' };
        }

        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };
        if (!puedeOperarAgenda(session.role)) {
            return { success: false, error: MSG_SIN_PERMISO_AGENDA };
        }
        // Capturado tras el guard: TS no propaga el narrowing al closure de la transacción.
        const organizationId = session.organizationId;

        // 🚪 Con la clínica conectada al hospital, «Agendar» apagado = no se agenda en
        // AgenIA (se hace en el sistema del hospital). Antes de escribir nada.
        const agendarApagado = await operacionApagada(prisma, organizationId, 'AGENDAR');
        if (agendarApagado) return { success: false, error: agendarApagado };

        // 🔐 La cita que se va a crear tiene que caber en el alcance de quien la crea:
        // la EPS y el médico salen del formulario, así que se comprueban esos.
        const alcance = await alcanceDeLaSesion(prisma, session);
        if (citaFueraDeAlcance(alcance, { epsId, doctorId })) {
            return { success: false, error: MSG_FUERA_DE_ALCANCE };
        }

        // 🪪 PADRÓN EPS: agendar por EPS exige que la cédula esté dada de alta.
        // Read puro previo a la transacción: falla rápido, sin escrituras a medias.
        const enrollmentIssue = await findEpsEnrollmentIssue(prisma, {
            organizationId,
            epsId,
            cedula: patientCedula,
        });
        if (enrollmentIssue) return { success: false, error: enrollmentIssue };

        // 🧾 El régimen del formulario manda; si se dejó vacío, vale el que ya tenga la
        // ficha, y si tampoco, el del padrón cuando no hay ninguna duda.
        const regimenForm = regimenDelFormulario(formData);
        const fichaPrevia = await prisma.patientProfile.findFirst({
            where: { cedula: patientCedula, organizationId },
            select: { regime: true },
        });
        const regimenPadron =
            regimenForm || fichaPrevia?.regime ? null : await regimenDelPadron(organizationId, patientCedula, epsId);
        const regimenAGuardar = regimenForm ?? regimenPadron;
        if (await faltaRegimen(organizationId, epsId, regimenAGuardar ?? fichaPrevia?.regime)) {
            return { success: false, error: MSG_FALTA_REGIMEN };
        }

        // 1. Transaction to find/create patient and assign slot
        const creada = await prisma.$transaction(async (tx) => {
            // Find or insert Patient
            let patient = await tx.patientProfile.findFirst({ where: { cedula: patientCedula, organizationId } });
            const pacienteNuevo = !patient;

            if (!patient) {
                // To create a patient, we need a base user on this architecture
                const tempEmail = `${patientCedula}@paciente.temporal.com`;
                const user = await tx.user.create({
                    data: { email: tempEmail, password: 'manual_created_hash', role: 'PATIENT', organizationId }
                });
                patient = await tx.patientProfile.create({
                    data: {
                        cedula: patientCedula,
                        fullName: patientName,
                        userId: user.id,
                        epsId: epsId,
                        organizationId,
                        ...(regimenAGuardar ? { regime: regimenAGuardar } : {}),
                    }
                });
            } else if (regimenAGuardar && regimenAGuardar !== patient.regime) {
                // Lo eligió el personal a propósito (completa o corrige la ficha), o
                // la ficha no lo tenía y el padrón lo da sin duda.
                patient = await tx.patientProfile.update({
                    where: { id: patient.id },
                    data: { regime: regimenAGuardar },
                });
            }

            // 2. We don't have a schedule slot picker yet, so let's mock creating an on-the-fly ScheduleSlot 
            // for the selected date and Doctor/Service if it doesn't collide
            const startDate = new Date(startDateStr);
            const endDate = new Date(startDate.getTime() + 30 * 60000); // 30 mins later
            
            // Check if ANY slot exists at this exact time (available or not)
            const existingSlot = await tx.scheduleSlot.findFirst({
                where: { doctorId, startTime: startDate, organizationId }
            });

            let slot = null;
            if (existingSlot) {
                if (!existingSlot.isAvailable) {
                    throw new Error('El médico ya tiene una cita ocupada a esta hora exacta.');
                }
                // Si existe y está libre, lo usamos
                slot = existingSlot;
                await tx.scheduleSlot.update({ where: { id: slot.id }, data: { isAvailable: false } });
            } else {
                // Force Create for Admins (manual booking bypassing regular slots if needed - just for testing POC)
                slot = await tx.scheduleSlot.create({
                    data: {
                        startTime: startDate,
                        endTime: endDate,
                        doctorId,
                        serviceId,
                        isAvailable: false,
                        organizationId
                    }
                });
            }

            // 3. Create Appointment Origin MANUAL
            const cita = await tx.appointment.create({
                data: {
                    scheduleSlotId: slot.id,
                    patientId: patient.id,
                    epsId: epsId,
                    origin: 'MANUAL',
                    reason: formData.get('reason') as string || 'Agendamiento Manual Panel',
                    organizationId
                }
            });
            return { citaId: cita?.id ?? null, inicio: slot.startTime, cupoNuevo: !existingSlot, pacienteNuevo };
        });

        await registrarDespues(async () => {
            const nombres = await nombresDeLaCita(organizationId, { doctorId, serviceId, epsId });
            return {
                action: 'APPOINTMENT_BOOKED_PANEL',
                message: `Cita ${creada.citaId} agendada desde el panel`,
                actor: actorDeSesion(session),
                organizationId,
                metadata: {
                    detalle: [
                        describirCita({ inicio: creada.inicio, servicio: nombres.servicio, medico: nombres.medico }),
                        `paciente ${enmascarar(patientCedula)}${creada.pacienteNuevo ? ' (ficha nueva)' : ''}`,
                        nombres.eps ? `EPS ${nombres.eps}` : null,
                        creada.cupoNuevo ? 'en un cupo creado en ese momento' : null,
                    ]
                        .filter(Boolean)
                        .join(' · '),
                    cita: creada.citaId,
                    pacienteNuevo: creada.pacienteNuevo,
                    cupoNuevo: creada.cupoNuevo,
                },
            };
        });

        revalidatePath('/dashboard/agendamiento');
        return { success: true };
    } catch (e) {
        return { success: false, error: mensajeDeError(e) };
    }
}

export async function updateManualAppointmentAction(appointmentId: string, formData: FormData) {
    try {
        const patientCedula = formData.get('cedula') as string;
        const patientName = formData.get('fullName') as string;
        const epsId = formData.get('epsId') as string;
        const serviceId = formData.get('serviceId') as string;
        const doctorId = formData.get('doctorId') as string;
        const startDateStr = formData.get('startDate') as string;

        if (!appointmentId || !patientCedula || !patientName || !epsId || !serviceId || !doctorId || !startDateStr) {
            return { success: false, error: 'Faltan campos obligatorios para actualizar.' };
        }

        const session = await getSession();
        if (!session?.organizationId) return { success: false, error: 'Tenant inválido' };
        if (!puedeOperarAgenda(session.role)) {
            return { success: false, error: MSG_SIN_PERMISO_AGENDA };
        }
        // Capturado tras el guard: TS no propaga el narrowing al closure de la transacción.
        const organizationId = session.organizationId;

        // 🔐 Alcance por DUPLICADO: la cita como está HOY y como va a quedar. Con solo
        // una de las dos, un agente acotado podría sacar una cita suya hacia otro
        // médico, o traerse la de un compañero hacia el suyo.
        const alcance = await alcanceDeLaSesion(prisma, session);
        if (alcance) {
            const original = await prisma.appointment.findFirst({
                where: { id: appointmentId, organizationId },
                select: { epsId: true, scheduleSlot: { select: { doctorId: true } } },
            });
            if (!original) return { success: false, error: 'Cita original no encontrada.' };
            const fuera =
                citaFueraDeAlcance(alcance, { epsId: original.epsId, doctorId: original.scheduleSlot.doctorId }) ||
                citaFueraDeAlcance(alcance, { epsId, doctorId });
            if (fuera) return { success: false, error: MSG_FUERA_DE_ALCANCE };
        }

        // 🪪 PADRÓN EPS: reagendar/actualizar por EPS también exige estar de alta.
        const enrollmentIssue = await findEpsEnrollmentIssue(prisma, {
            organizationId,
            epsId,
            cedula: patientCedula,
        });
        if (enrollmentIssue) return { success: false, error: enrollmentIssue };

        // 🧾 Misma barrera que al crear: la cita reagendada también viaja al HIS.
        const regimenForm = regimenDelFormulario(formData);
        const actual = await prisma.appointment.findFirst({
            where: { id: appointmentId, organizationId },
            select: {
                epsId: true,
                patient: { select: { regime: true, cedula: true, fullName: true } },
                scheduleSlot: {
                    select: {
                        doctorId: true,
                        startTime: true,
                        doctor: { select: { fullName: true } },
                        service: { select: { name: true } },
                    },
                },
            },
        });
        if (!actual) return { success: false, error: 'Cita original no encontrada.' };

        // 🚪 Mover la cita (otro médico u otra hora) es CAMBIAR LA FECHA: con la
        // clínica conectada al hospital, solo con ese interruptor encendido.
        const fechaPedida = new Date(startDateStr);
        const mueveLaCita =
            actual.scheduleSlot.doctorId !== doctorId ||
            actual.scheduleSlot.startTime.getTime() !== fechaPedida.getTime();
        if (mueveLaCita) {
            const cambiarApagado = await operacionApagada(prisma, organizationId, 'MODIFICAR');
            if (cambiarApagado) return { success: false, error: cambiarApagado };
        }
        const regimenPadron =
            regimenForm || actual.patient.regime
                ? null
                : await regimenDelPadron(organizationId, actual.patient.cedula, epsId);
        const regimenAGuardar = regimenForm ?? regimenPadron;
        if (await faltaRegimen(organizationId, epsId, regimenAGuardar ?? actual.patient.regime)) {
            return { success: false, error: MSG_FALTA_REGIMEN };
        }

        await prisma.$transaction(async (tx) => {
            const appointment = await tx.appointment.findFirst({
                where: { id: appointmentId, organizationId },
                include: { patient: true, scheduleSlot: { select: { doctorId: true, startTime: true } } }
            });

            if (!appointment) throw new Error('Cita original no encontrada.');

            // 1. Actulizar Datos de Paciente Básicos
            await tx.patientProfile.update({
                where: { id: appointment.patientId },
                data: { fullName: patientName, epsId: epsId, ...(regimenAGuardar ? { regime: regimenAGuardar } : {}) }
            });

            const startDate = new Date(startDateStr);

            // Mismo médico y misma hora: la cita se queda en SU cupo. Antes se buscaba
            // un cupo LIBRE a esa hora —el suyo está ocupado por ella misma—, se creaba
            // otro igual y se movía la cita: con el hospital conectado, editar solo la
            // EPS viajaba como un cambio de fecha (anular y volver a crear allá).
            if (
                appointment.scheduleSlot.doctorId === doctorId &&
                appointment.scheduleSlot.startTime.getTime() === startDate.getTime()
            ) {
                await tx.appointment.update({
                    where: { id: appointmentId },
                    data: { epsId: epsId },
                });
                return;
            }
            const endDate = new Date(startDate.getTime() + 30 * 60000);

            // 2. Gestionar la reagendación logica de Slots
            let newSlot = await tx.scheduleSlot.findFirst({
                where: { doctorId, startTime: startDate, isAvailable: true, organizationId }
            });

            if (!newSlot) {
                // Si la fecha combinada con el medico es totalmente nueva, crearla:
                newSlot = await tx.scheduleSlot.create({
                    data: {
                        startTime: startDate,
                        endTime: endDate,
                        doctorId,
                        serviceId,
                        isAvailable: false,
                        organizationId
                    }
                });
            } else {
                // Si estaba libre, pero existía, Ocuparla
                newSlot = await tx.scheduleSlot.update({ where: { id: newSlot.id }, data: { isAvailable: false } });
            }

            // 3. Si el slot original era distinto, liberar el antiguo de nuevo al pool
            if (appointment.scheduleSlotId !== newSlot.id) {
                await tx.scheduleSlot.update({ where: { id: appointment.scheduleSlotId }, data: { isAvailable: true } });
            }

            // 4. Conectar la nueva modificación en Appointment
            await tx.appointment.update({
                where: { id: appointmentId },
                data: {
                    epsId: epsId,
                    scheduleSlotId: newSlot.id,
                }
            });
        });

        await registrarDespues(async () => {
            const nuevos = await nombresDeLaCita(organizationId, { doctorId, serviceId, epsId });
            const antes = describirCita({
                inicio: actual.scheduleSlot.startTime,
                servicio: actual.scheduleSlot.service?.name,
                medico: actual.scheduleSlot.doctor?.fullName,
            });
            const otrosCambios = [
                actual.epsId !== epsId ? `EPS: ${nuevos.eps ?? '—'}` : null,
                actual.patient.fullName !== patientName ? 'nombre del paciente corregido' : null,
                regimenAGuardar && regimenAGuardar !== actual.patient.regime
                    ? `régimen: ${regimenAGuardar.toLowerCase()}`
                    : null,
            ].filter(Boolean);
            return {
                action: mueveLaCita ? 'APPOINTMENT_MOVED_PANEL' : 'APPOINTMENT_EDITED_PANEL',
                level: mueveLaCita ? 'WARNING' : 'EVENT',
                message: `Cita ${appointmentId} ${mueveLaCita ? 'movida' : 'corregida'} desde el panel`,
                actor: actorDeSesion(session),
                organizationId,
                metadata: {
                    detalle: [
                        mueveLaCita
                            ? `${antes} → ${describirCita({ inicio: fechaPedida, servicio: nuevos.servicio, medico: nuevos.medico })}`
                            : antes,
                        `paciente ${enmascarar(actual.patient.cedula)}`,
                        ...otrosCambios,
                    ].join(' · '),
                    cita: appointmentId,
                    antes: {
                        doctorId: actual.scheduleSlot.doctorId,
                        inicio: actual.scheduleSlot.startTime.toISOString(),
                        epsId: actual.epsId,
                    },
                    despues: { doctorId, inicio: fechaPedida.toISOString(), epsId },
                },
            };
        });

        revalidatePath('/dashboard/agendamiento');
        revalidatePath('/dashboard');
        return { success: true };
    } catch (e) {
        return { success: false, error: mensajeDeError(e) };
    }
}
