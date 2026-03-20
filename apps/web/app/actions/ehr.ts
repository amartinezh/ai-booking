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
