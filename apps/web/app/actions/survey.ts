'use server';

// Encuesta de satisfacción (CSAT). El envío de la calificación se delega al
// endpoint público de NestJS (POST /surveys/:id), que es la ÚNICA fuente de
// verdad para la escritura y re-verifica la "regla de oro" (isUsed/expiresAt).
// Es un flujo sin sesión: el paciente abre el enlace desde WhatsApp.

// Misma resolución de URL que las demás server actions hacia el backend.
const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

export async function submitSurvey(
  tokenId: string,
  rating: number,
  feedback: string,
): Promise<{ success: true } | { success: false; error: string }> {
  if (!tokenId) {
    return { success: false, error: 'Enlace inválido.' };
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { success: false, error: 'Selecciona una calificación de 1 a 5.' };
  }

  let res: Response;
  try {
    res = await fetch(`${INTERNAL_API_URL}/surveys/${encodeURIComponent(tokenId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, feedback: feedback?.trim() || null }),
      cache: 'no-store',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'network';
    console.error(`[survey] POST /surveys/${tokenId} fetch error:`, msg);
    return { success: false, error: 'No se pudo enviar tu respuesta. Intenta de nuevo.' };
  }

  if (!res.ok) {
    // 404 = token inválido / usado / expirado (regla de oro del backend).
    console.error(`[survey] POST /surveys/${tokenId} -> ${res.status}`);
    return {
      success: false,
      error: 'Este enlace ya no es válido (puede que ya lo hayas usado o que haya expirado).',
    };
  }

  return { success: true };
}
