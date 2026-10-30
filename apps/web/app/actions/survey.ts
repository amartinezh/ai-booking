'use server';

// Encuesta de satisfacción. El envío de las respuestas se delega al endpoint
// público de NestJS (POST /surveys/:id), que es la ÚNICA fuente de verdad para
// la escritura y re-verifica la "regla de oro" (isUsed/expiresAt).
// Es un flujo sin sesión: el paciente abre el enlace desde WhatsApp.

import type { SurveyExperience } from './surveys.types';

// Misma resolución de URL que las demás server actions hacia el backend.
const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

const EXPERIENCES: SurveyExperience[] = ['GOOD', 'FAIR', 'BAD', 'NO_ANSWER'];

export interface SurveyAnswers {
  /** ¿Recomendaría la IPS a familiares y amigos? */
  wouldRecommend: boolean | null;
  /** ¿Cómo le fue en su experiencia? */
  experience: SurveyExperience | null;
  /** Estrellas para el asistente virtual (1 a 5). */
  rating: number;
  feedback: string;
}

/**
 * Paso 1: guarda solo la estrella, al tocarla. No cierra la encuesta: si el
 * paciente se va sin responder lo demás, su calificación queda.
 */
export async function saveSurveyRating(
  tokenId: string,
  rating: number,
): Promise<{ success: true } | { success: false; error: string; invalidLink?: boolean }> {
  if (!tokenId) return { success: false, error: 'Enlace inválido.', invalidLink: true };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { success: false, error: 'Elija de 1 a 5 estrellas.' };
  }
  let res: Response;
  try {
    res = await fetch(`${INTERNAL_API_URL}/surveys/${encodeURIComponent(tokenId)}/rating`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
      cache: 'no-store',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'network';
    console.error(`[survey] POST /surveys/${tokenId}/rating fetch error:`, msg);
    return { success: false, error: 'No se pudo guardar su calificación. Toque la estrella de nuevo.' };
  }
  if (!res.ok) {
    console.error(`[survey] POST /surveys/${tokenId}/rating -> ${res.status}`);
    return res.status === 404
      ? {
          success: false,
          invalidLink: true,
          error: 'Este enlace ya no es válido (puede que ya lo haya usado o que haya vencido).',
        }
      : { success: false, error: 'No se pudo guardar su calificación. Toque la estrella de nuevo.' };
  }
  return { success: true };
}

/** Paso 2: el envío completo (las estrellas otra vez, más las preguntas de la IPS). */
export async function submitSurvey(
  tokenId: string,
  answers: SurveyAnswers,
): Promise<{ success: true } | { success: false; error: string }> {
  if (!tokenId) {
    return { success: false, error: 'Enlace inválido.' };
  }
  const { wouldRecommend, experience, rating, feedback } = answers ?? ({} as SurveyAnswers);
  if (typeof wouldRecommend !== 'boolean') {
    return { success: false, error: 'Responda si recomendaría la IPS.' };
  }
  if (!experience || !EXPERIENCES.includes(experience)) {
    return { success: false, error: 'Responda cómo le fue en su experiencia.' };
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { success: false, error: 'Califique al asistente de 1 a 5 estrellas.' };
  }

  let res: Response;
  try {
    res = await fetch(`${INTERNAL_API_URL}/surveys/${encodeURIComponent(tokenId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating,
        wouldRecommend,
        experience,
        feedback: feedback?.trim() || null,
      }),
      cache: 'no-store',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'network';
    console.error(`[survey] POST /surveys/${tokenId} fetch error:`, msg);
    return { success: false, error: 'No se pudo enviar su respuesta. Intente de nuevo.' };
  }

  if (!res.ok) {
    console.error(`[survey] POST /surveys/${tokenId} -> ${res.status}`);
    if (res.status === 400) {
      return { success: false, error: 'Faltan respuestas. Revise las preguntas e intente de nuevo.' };
    }
    // 404 = token inválido / usado / expirado (regla de oro del backend).
    return {
      success: false,
      error: 'Este enlace ya no es válido (puede que ya lo haya usado o que haya vencido).',
    };
  }

  return { success: true };
}
