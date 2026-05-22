'use client';

import { useState } from 'react';
import { Star, CheckCircle2 } from 'lucide-react';
import { submitSurvey } from '@/app/actions/survey';

interface SurveyFormProps {
  tokenId: string;
  clinicName: string;
}

export default function SurveyForm({ tokenId, clinicName }: SurveyFormProps) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating < 1) {
      setError('Por favor selecciona una calificación.');
      return;
    }
    setLoading(true);
    setError(null);

    const result = await submitSurvey(tokenId, rating, feedback);
    if (result.success) {
      setDone(true);
    } else {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-emerald-50 to-zinc-100 font-sans p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-zinc-200 p-8">
        {done ? (
          // ✅ Agradecimiento: el formulario se oculta tras enviar.
          <div className="flex flex-col items-center text-center gap-4 py-6">
            <CheckCircle2 className="h-16 w-16 text-emerald-500" />
            <h1 className="text-2xl font-bold text-zinc-800">¡Gracias por tu opinión!</h1>
            <p className="text-zinc-500">
              Tu calificación nos ayuda a mejorar la atención en {clinicName}. Ya puedes cerrar esta ventana. 💚
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <header className="text-center">
              <h1 className="text-2xl font-bold text-zinc-800">¿Cómo fue tu atención?</h1>
              <p className="mt-1 text-sm text-zinc-500">
                Cuéntanos cómo te fue con el asistente de {clinicName}.
              </p>
            </header>

            {/* ⭐ 5 estrellas */}
            <div className="flex justify-center gap-2" role="radiogroup" aria-label="Calificación">
              {[1, 2, 3, 4, 5].map((value) => {
                const active = (hover || rating) >= value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${value} estrella${value > 1 ? 's' : ''}`}
                    aria-pressed={rating === value}
                    onClick={() => setRating(value)}
                    onMouseEnter={() => setHover(value)}
                    onMouseLeave={() => setHover(0)}
                    className="transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded"
                  >
                    <Star
                      className={`h-10 w-10 ${
                        active ? 'fill-amber-400 text-amber-400' : 'text-zinc-300'
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="¿Algún comentario adicional? (opcional)"
              className="w-full resize-none rounded-xl border border-zinc-300 p-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            />

            {error && <p className="text-center text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Enviando…' : 'Enviar calificación'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
