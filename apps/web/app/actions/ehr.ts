'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { getErrorMessage } from '@/lib/error';
import type { CreateClinicalRecordDto, UpdateClinicalRecordDto } from './ehr.types';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { actorDeSesion, origenDeLaPeticion, registrarDespues } from '@/lib/actividad/registrar';
import { describirCita, enmascarar } from '@/lib/actividad/catalogo';

/**
 * 🩺 Historia clínica en la Actividad de usuarios (2026-10-27): quién la abrió, la
 * escribió, la corrigió, la firmó o le agregó una nota, y de qué cita. Nunca su
 * contenido: solo la cita (servicio, médico, hora) y el paciente enmascarado.
 */
async function anotarHistoria(
    action:
        | 'CLINICAL_RECORD_VIEWED'
        | 'CLINICAL_RECORD_CREATED'
        | 'CLINICAL_RECORD_UPDATED'
        | 'CLINICAL_RECORD_SIGNED'
        | 'CLINICAL_RECORD_ADDENDUM',
    donde: { recordId?: string; appointmentId?: string },
): Promise<void> {
    const session = await getSession();
    if (!session) return;
    await registrarDespues(async () => {
        const cita = await prisma.appointment.findFirst({
            where: donde.appointmentId
                ? { id: donde.appointmentId }
                : { clinicalRecord: { id: donde.recordId } },
            select: {
                id: true,
                organizationId: true,
                patient: { select: { cedula: true } },
                clinicalRecord: { select: { id: true, recordNumber: true } },
                scheduleSlot: {
                    select: {
                        startTime: true,
                        doctor: { select: { fullName: true } },
                        service: { select: { name: true } },
                    },
                },
            },
        });
        return {
            action,
            level: action === 'CLINICAL_RECORD_SIGNED' ? 'WARNING' : 'EVENT',
            message: `Historia clínica (${action})`,
            actor: actorDeSesion(session),
            organizationId: cita?.organizationId ?? session.organizationId ?? null,
            metadata: {
                detalle: cita
                    ? [
                          cita.clinicalRecord ? `Historia #${cita.clinicalRecord.recordNumber}` : null,
                          describirCita({
                              inicio: cita.scheduleSlot.startTime,
                              servicio: cita.scheduleSlot.service?.name,
                              medico: cita.scheduleSlot.doctor?.fullName,
                          }),
                          `paciente ${enmascarar(cita.patient.cedula)}`,
                      ]
                          .filter(Boolean)
                          .join(' · ')
                    : null,
                cita: cita?.id ?? donde.appointmentId ?? null,
                historia: cita?.clinicalRecord?.id ?? donde.recordId ?? null,
            },
        };
    });
}

/** La IP real de quien firma (antes la firma guardaba «Vía Web»). */
async function ipDeQuienFirma(): Promise<string> {
    return (await origenDeLaPeticion()).ip ?? 'Vía Web';
}

export async function createClinicalRecord(data: CreateClinicalRecordDto) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value || '';
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        const res = await fetch(`${apiUrl}/clinical-records`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `auth_token=${token}`,
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'Error al guardar la historia clínica');
        }

        await anotarHistoria('CLINICAL_RECORD_CREATED', { appointmentId: data.appointmentId });
        revalidatePath('/dashboard');
        return { success: true };
    } catch (error) {
        console.error('Error creating EHR:', error);
        return { success: false, error: getErrorMessage(error) || 'Error guardando la historia clínica' };
    }
}

export async function fetchClinicalRecordByAppointment(appointmentId: string) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value || '';
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        const res = await fetch(`${apiUrl}/clinical-records/appointment/${appointmentId}`, {
            headers: {
                'Cookie': `auth_token=${token}`,
                'Authorization': `Bearer ${token}`
            },
            cache: 'no-store'
        });

        if (!res.ok) {
            if (res.status === 404) return { success: true, data: null }; // No hay HC aún
            throw new Error('Error al obtener la historia clínica');
        }

        const rawText = await res.text();
        const data = rawText ? JSON.parse(rawText) : null;
        // Abrir una historia que existe es un acceso a datos clínicos: queda quién y cuándo.
        if (data) await anotarHistoria('CLINICAL_RECORD_VIEWED', { appointmentId });
        return { success: true, data };
    } catch (error) {
        console.error('fetchClinicalRecord error:', error);
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function updateClinicalRecordAction(recordId: string, data: UpdateClinicalRecordDto) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value || '';
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        const res = await fetch(`${apiUrl}/clinical-records/${recordId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `auth_token=${token}`,
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'Error al actualizar el borrador');
        }

        await anotarHistoria('CLINICAL_RECORD_UPDATED', { recordId });
        revalidatePath('/dashboard');
        return { success: true };
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function signClinicalRecordAction(recordId: string, userId: string) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value || '';
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        const res = await fetch(`${apiUrl}/clinical-records/${recordId}/sign`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `auth_token=${token}`,
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ userId, ipAddress: await ipDeQuienFirma() })
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'Error al sellar historia clínica');
        }

        await anotarHistoria('CLINICAL_RECORD_SIGNED', { recordId });
        revalidatePath('/dashboard');
        return { success: true };
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function createAddendumAction(recordId: string, doctorId: string, content: string) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value || '';
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        const res = await fetch(`${apiUrl}/clinical-records/${recordId}/addendum`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': `auth_token=${token}`,
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ doctorId, content, ipAddress: await ipDeQuienFirma() })
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'Error al registrar la nota aclaratoria');
        }

        await anotarHistoria('CLINICAL_RECORD_ADDENDUM', { recordId });
        revalidatePath('/dashboard');
        return { success: true };
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}
