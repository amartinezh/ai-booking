'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

export async function createClinicalRecord(data: any) {
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

        revalidatePath('/dashboard');
        return { success: true };
    } catch (error: any) {
        console.error('Error creating EHR:', error);
        return { success: false, error: error.message || 'Error guardando la historia clínica' };
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
        return { success: true, data };
    } catch (error: any) {
        console.error('fetchClinicalRecord error:', error);
        return { success: false, error: error.message };
    }
}

export async function updateClinicalRecordAction(recordId: string, data: any) {
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

        revalidatePath('/dashboard');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
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
            body: JSON.stringify({ userId, ipAddress: 'Vía Web' })
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'Error al sellar historia clínica');
        }

        revalidatePath('/dashboard');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
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
            body: JSON.stringify({ doctorId, content, ipAddress: 'Vía Web' })
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'Error al registrar la nota aclaratoria');
        }

        revalidatePath('/dashboard');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
