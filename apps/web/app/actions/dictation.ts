'use server';

import { cookies } from 'next/headers';

export async function transcribeAudioAction(audioBase64: string) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value || '';
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        const res = await fetch(`${apiUrl}/clinical-ai/dictate`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Cookie': `auth_token=${token}`,
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ audioBase64 })
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'Error en conectividad del IA Dictation Endpoint');
        }

        const data = await res.json();
        return { success: true, data };
    } catch (error: any) {
        console.error('transcribeAudioAction error:', error);
        return { success: false, error: error.message };
    }
}
