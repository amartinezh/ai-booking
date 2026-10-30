'use client';

import { useState } from 'react';
import { Star, CheckCircle2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { submitSurvey } from '@/app/actions/survey';
import type { SurveyExperience } from '@/app/actions/surveys.types';

interface SurveyFormProps {
  tokenId: string;
  clinicName: string;
}

// Lo que ve el paciente en cada estrella.
const RATING_LABELS = ['', 'Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'];

const EXPERIENCE_OPTIONS: { value: SurveyExperience; label: string; emoji: string }[] = [
  { value: 'GOOD', label: 'Buena', emoji: '😊' },
  { value: 'FAIR', label: 'Regular', emoji: '😐' },
  { value: 'BAD', label: 'Mala', emoji: '😞' },
];

type Pregunta = 'recommend' | 'experience' | 'rating';

const optionBase =
  'flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-3 text-base font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400';
const optionOff = 'border-zinc-200 bg-white text-zinc-700 hover:border-emerald-300 hover:bg-emerald-50/40';
const optionOn = 'border-emerald-500 bg-emerald-50 text-emerald-800';

function Bloque({
  numero,
  titulo,
  falta,
  children,
}: {
  numero: number;
  titulo: string;
  falta: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      className={`rounded-2xl p-4 transition-colors ${falta ? 'bg-red-50 ring-2 ring-red-300' : 'bg-zinc-50'}`}
    >
      <legend className="sr-only">{titulo}</legend>
      <p className="mb-3 flex gap-2 text-[15px] font-semibold leading-snug text-zinc-800" aria-hidden>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
          {numero}
        </span>
        {titulo}
      </p>
      {children}
      {falta && <p className="mt-2 text-sm font-medium text-red-600">Falta esta respuesta.</p>}
    </fieldset>
  );
}

export default function SurveyForm({ tokenId, clinicName }: SurveyFormProps) {
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [experience, setExperience] = useState<SurveyExperience | null>(null);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [faltan, setFaltan] = useState<Set<Pregunta>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const respondida = (p: Pregunta) =>
    setFaltan((prev) => {
      if (!prev.has(p)) return prev;
      const next = new Set(prev);
      next.delete(p);
      return next;
    });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sinResponder = new Set<Pregunta>();
    if (wouldRecommend === null) sinResponder.add('recommend');
    if (experience === null) sinResponder.add('experience');
    if (rating < 1) sinResponder.add('rating');
    setFaltan(sinResponder);
    if (sinResponder.size > 0) {
      setError(
        sinResponder.size === 1
          ? 'Falta una respuesta: está marcada en rojo.'
          : `Faltan ${sinResponder.size} respuestas: están marcadas en rojo.`,
      );
      return;
    }
    setLoading(true);
    setError(null);

    const result = await submitSurvey(tokenId, { wouldRecommend, experience, rating, feedback });
    if (result.success) {
      setDone(true);
    } else {
      setError(result.error);
      setLoading(false);
    }
  }

  const estrellas = hover || rating;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-50 to-zinc-100 p-4 font-sans">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-zinc-200 sm:p-8">
        {done ? (
          // ✅ Agradecimiento: el formulario se oculta tras enviar.
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="h-16 w-16 text-emerald-500" />
            <h1 className="text-2xl font-bold text-zinc-800">¡Gracias por su opinión!</h1>
            <p className="text-zinc-500">
              Sus respuestas nos ayudan a mejorar la atención en {clinicName}. Ya puede cerrar esta ventana. 💚
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <header className="text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Encuesta de satisfacción
              </p>
              <h1 className="mt-1 text-2xl font-bold text-zinc-800">¿Cómo le fue con nosotros?</h1>
              <p className="mt-1 text-sm text-zinc-500">
                Son 3 preguntas cortas sobre {clinicName}.
              </p>
            </header>

            <Bloque
              numero={1}
              titulo={`¿Recomendaría ${clinicName} a sus familiares y amigos?`}
              falta={faltan.has('recommend')}
            >
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="¿Recomendaría la IPS?">
                {[
                  { value: true, label: 'Sí', Icon: ThumbsUp },
                  { value: false, label: 'No', Icon: ThumbsDown },
                ].map(({ value, label, Icon }) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={wouldRecommend === value}
                    onClick={() => {
                      setWouldRecommend(value);
                      respondida('recommend');
                    }}
                    className={`${optionBase} ${wouldRecommend === value ? optionOn : optionOff}`}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </Bloque>

            <Bloque numero={2} titulo="¿Cómo le fue en su experiencia?" falta={faltan.has('experience')}>
              <div role="radiogroup" aria-label="¿Cómo le fue en su experiencia?" className="flex flex-col gap-2">
                <div className="grid grid-cols-3 gap-2">
                  {EXPERIENCE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={experience === o.value}
                      onClick={() => {
                        setExperience(o.value);
                        respondida('experience');
                      }}
                      className={`${optionBase} flex-col !gap-1 ${experience === o.value ? optionOn : optionOff}`}
                    >
                      <span className="text-2xl" aria-hidden>
                        {o.emoji}
                      </span>
                      {o.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  role="radio"
                  aria-checked={experience === 'NO_ANSWER'}
                  onClick={() => {
                    setExperience('NO_ANSWER');
                    respondida('experience');
                  }}
                  className={`rounded-xl border-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                    experience === 'NO_ANSWER'
                      ? 'border-zinc-500 bg-zinc-100 text-zinc-800'
                      : 'border-transparent text-zinc-500 hover:bg-zinc-100'
                  }`}
                >
                  Prefiero no responder
                </button>
              </div>
            </Bloque>

            <Bloque
              numero={3}
              titulo="¿Cómo lo atendió el asistente virtual por chat?"
              falta={faltan.has('rating')}
            >
              <div className="flex justify-center gap-1.5" role="radiogroup" aria-label="Calificación del asistente">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-label={`${value} estrella${value > 1 ? 's' : ''}: ${RATING_LABELS[value]}`}
                    aria-checked={rating === value}
                    onClick={() => {
                      setRating(value);
                      respondida('rating');
                    }}
                    onMouseEnter={() => setHover(value)}
                    onMouseLeave={() => setHover(0)}
                    className="rounded p-0.5 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    <Star
                      className={`h-10 w-10 ${estrellas >= value ? 'fill-amber-400 text-amber-400' : 'text-zinc-300'}`}
                    />
                  </button>
                ))}
              </div>
              <p className="mt-1 h-5 text-center text-sm font-medium text-zinc-600" aria-live="polite">
                {RATING_LABELS[estrellas] ?? ''}
              </p>
            </Bloque>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-zinc-700">
                ¿Algo más que quiera contarnos? <span className="font-normal text-zinc-400">(opcional)</span>
              </span>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Escriba aquí su comentario"
                className="w-full resize-none rounded-xl border border-zinc-300 p-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              />
            </label>

            {error && (
              <p className="text-center text-sm font-medium text-red-600" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Enviando…' : 'Enviar respuestas'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
