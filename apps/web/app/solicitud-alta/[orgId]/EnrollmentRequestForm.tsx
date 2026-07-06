'use client';

import { useState } from 'react';
import { CheckCircle2, IdCard } from 'lucide-react';
import { submitEnrollmentRequest } from '@/app/actions/enrollment-request';

interface EnrollmentRequestFormProps {
    orgId: string;
    clinicName: string;
    epsNames: string[];
}

// ─────────────────────────────────────────────────────────────
// Formulario público de SOLICITUD DE ALTA en el padrón EPS.
// Mismo lenguaje visual que la encuesta de satisfacción (tarjeta
// centrada sobre degradado esmeralda, estado de agradecimiento).
// ─────────────────────────────────────────────────────────────
export default function EnrollmentRequestForm({
    orgId,
    clinicName,
    epsNames,
}: EnrollmentRequestFormProps) {
    const [cedula, setCedula] = useState('');
    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
    const [epsName, setEpsName] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setLoading(true);
        setError(null);

        const result = await submitEnrollmentRequest(orgId, {
            cedula,
            fullName,
            phone,
            epsName,
            message,
        });
        if (result.success) {
            setDone(true);
        } else {
            setError(result.error);
            setLoading(false);
        }
    }

    const inputClass =
        'w-full rounded-xl border border-zinc-300 p-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200';

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-emerald-50 to-zinc-100 font-sans p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-zinc-200 p-8">
                {done ? (
                    // ✅ Radicada: se oculta el formulario tras enviar.
                    <div className="flex flex-col items-center text-center gap-4 py-6">
                        <CheckCircle2 className="h-16 w-16 text-emerald-500" />
                        <h1 className="text-2xl font-bold text-zinc-800">¡Solicitud radicada!</h1>
                        <p className="text-zinc-500">
                            El equipo de {clinicName} revisará tu caso. Si procede el alta, podrás agendar tu
                            cita por EPS a través del asistente de WhatsApp. 💚
                        </p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                        <header className="text-center">
                            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100">
                                <IdCard className="h-7 w-7 text-emerald-600" />
                            </div>
                            <h1 className="text-2xl font-bold text-zinc-800">Solicitud de alta EPS</h1>
                            <p className="mt-1 text-sm text-zinc-500">
                                ¿Crees que deberías estar habilitado(a) para agendar por tu EPS en {clinicName}?
                                Déjanos tus datos y tu caso; lo revisaremos.
                            </p>
                        </header>

                        <input
                            value={cedula}
                            onChange={(e) => setCedula(e.target.value)}
                            required
                            inputMode="numeric"
                            maxLength={20}
                            placeholder="Número de documento *"
                            className={inputClass}
                        />

                        <input
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            required
                            maxLength={120}
                            placeholder="Nombre completo *"
                            className={inputClass}
                        />

                        <input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            maxLength={20}
                            placeholder="Teléfono / WhatsApp (opcional)"
                            className={inputClass}
                        />

                        <select
                            value={epsName}
                            onChange={(e) => setEpsName(e.target.value)}
                            className={`${inputClass} bg-white`}
                        >
                            <option value="">¿A qué EPS estás afiliado(a)? (opcional)</option>
                            {epsNames.map((name) => (
                                <option key={name} value={name}>
                                    {name}
                                </option>
                            ))}
                            <option value="Otra">Otra</option>
                        </select>

                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            required
                            minLength={10}
                            maxLength={2000}
                            rows={4}
                            placeholder="Cuéntanos tu caso: ¿por qué deberías estar dado(a) de alta? *"
                            className={`${inputClass} resize-none`}
                        />

                        {error && <p className="text-center text-sm text-red-500">{error}</p>}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loading ? 'Enviando…' : 'Enviar solicitud de revisión'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
