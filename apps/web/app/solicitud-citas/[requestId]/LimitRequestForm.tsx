'use client';

import { useState } from 'react';
import { CalendarClock, CheckCircle2, Clock, Phone, XCircle } from 'lucide-react';
import { MOTIVOS_SOLICITUD_CITAS, SOLICITUD_CITAS } from '@agenia/shared';
import { submitLimitRequest } from '@/app/actions/limit-request';

type Estado = 'FORMULARIO' | 'VENCIDA' | 'PENDING' | 'APPROVED' | 'REJECTED';

interface Props {
    requestId: string;
    estado: Estado;
    clinicName: string;
    telefonoHospital: string | null;
    primerNombre: string;
    tipo: 'DAILY' | 'MONTHLY';
    /** «martes, 20 de octubre de 2026» o «octubre de 2026». */
    periodo: string;
    limite: number;
    citas: number;
    servicio: string | null;
    esCambio: boolean;
    telefonoInicial: string;
    adicionalesConcedidas: number | null;
}

const citasTxt = (n: number) => (n === 1 ? 'una cita' : `${n} citas`);

// ─────────────────────────────────────────────────────────────
// Formulario público de SOLICITUD DE MÁS CITAS. Mismo lenguaje visual que la
// solicitud de alta EPS y la encuesta (tarjeta centrada sobre degradado).
// Muestra el formulario solo con la invitación vigente; en cualquier otro
// estado, lo que pasó con la solicitud.
// ─────────────────────────────────────────────────────────────
export default function LimitRequestForm(props: Props) {
    const { requestId, clinicName, telefonoHospital, primerNombre, tipo, periodo, limite, citas } = props;
    const [estado, setEstado] = useState<Estado>(props.estado);
    const [motivo, setMotivo] = useState('');
    const [argumento, setArgumento] = useState('');
    const [adicionales, setAdicionales] = useState(1);
    const [telefono, setTelefono] = useState(props.telefonoInicial);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setLoading(true);
        setError(null);
        const result = await submitLimitRequest(requestId, { motivo, argumento, adicionales, telefono });
        if (result.success) {
            setEstado('PENDING');
        } else {
            setError(result.error);
            setLoading(false);
        }
    }

    const inputClass =
        'w-full rounded-xl border border-zinc-300 p-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200';

    const contactoHospital = telefonoHospital ? (
        <p className="flex items-center justify-center gap-2 text-sm text-zinc-600">
            <Phone className="h-4 w-4" /> Teléfono del hospital: <strong>{telefonoHospital}</strong>
        </p>
    ) : null;

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-zinc-100 font-sans p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-zinc-200 p-8">
                {estado === 'FORMULARIO' ? (
                    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                        <header className="text-center">
                            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
                                <CalendarClock className="h-7 w-7 text-amber-600" />
                            </div>
                            <h1 className="text-2xl font-bold text-zinc-800">Solicitud de más citas</h1>
                            <p className="mt-1 text-sm text-zinc-500">
                                {primerNombre ? `Hola, ${primerNombre}. ` : ''}
                                {props.esCambio
                                    ? 'No pudimos cambiar tu cita a esa fecha'
                                    : `No pudimos agendar tu cita${props.servicio ? ` de ${props.servicio}` : ''}`}
                                : en {clinicName} cada paciente puede tener máximo <strong>{citasTxt(limite)}</strong>{' '}
                                {tipo === 'DAILY' ? 'el mismo día' : 'en un mismo mes'} y ya tienes{' '}
                                <strong>{citasTxt(citas)}</strong> {tipo === 'DAILY' ? 'para el' : 'en'} <strong>{periodo}</strong>.
                            </p>
                            <p className="mt-2 text-sm text-zinc-500">
                                Si necesitas más citas, cuéntanos por qué y el equipo revisará tu caso.
                            </p>
                        </header>

                        <label className="flex flex-col gap-1 text-sm text-zinc-600">
                            ¿Por qué necesitas más citas? *
                            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} required className={`${inputClass} bg-white`}>
                                <option value="">Elige un motivo</option>
                                {MOTIVOS_SOLICITUD_CITAS.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.etiqueta}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm text-zinc-600">
                            Cuéntanos tu caso *
                            <textarea
                                value={argumento}
                                onChange={(e) => setArgumento(e.target.value)}
                                required
                                minLength={SOLICITUD_CITAS.MIN_ARGUMENTO}
                                maxLength={SOLICITUD_CITAS.MAX_ARGUMENTO}
                                rows={4}
                                placeholder="Ej.: estoy en terapia dos veces por semana por orden de mi médico."
                                className={`${inputClass} resize-none`}
                            />
                        </label>

                        <label className="flex flex-col gap-1 text-sm text-zinc-600">
                            ¿Cuántas citas adicionales necesitas {tipo === 'DAILY' ? 'ese día' : 'ese mes'}? *
                            <select
                                value={adicionales}
                                onChange={(e) => setAdicionales(Number(e.target.value))}
                                className={`${inputClass} bg-white`}
                            >
                                {Array.from({ length: SOLICITUD_CITAS.MAX_ADICIONALES }, (_, i) => i + 1).map((n) => (
                                    <option key={n} value={n}>
                                        {n}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm text-zinc-600">
                            Teléfono para contactarte
                            <input
                                value={telefono}
                                onChange={(e) => setTelefono(e.target.value)}
                                inputMode="tel"
                                maxLength={20}
                                placeholder="Teléfono / WhatsApp (opcional)"
                                className={inputClass}
                            />
                        </label>

                        {error && <p className="text-center text-sm text-red-500">{error}</p>}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-xl bg-amber-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loading ? 'Enviando…' : 'Enviar solicitud de revisión'}
                        </button>
                        {contactoHospital}
                    </form>
                ) : (
                    <div className="flex flex-col items-center text-center gap-4 py-6">
                        {estado === 'PENDING' && (
                            <>
                                <CheckCircle2 className="h-16 w-16 text-emerald-500" />
                                <h1 className="text-2xl font-bold text-zinc-800">¡Solicitud radicada!</h1>
                                <p className="text-zinc-500">
                                    El equipo de {clinicName} revisará tu caso. Si la aprueban, podrás agendar escribiéndole
                                    de nuevo al asistente virtual. Si es urgente, comunícate con el hospital. 💛
                                </p>
                            </>
                        )}
                        {estado === 'APPROVED' && (
                            <>
                                <CheckCircle2 className="h-16 w-16 text-emerald-500" />
                                <h1 className="text-2xl font-bold text-zinc-800">Solicitud aprobada</h1>
                                <p className="text-zinc-500">
                                    {props.adicionalesConcedidas
                                        ? `Te aprobaron ${citasTxt(props.adicionalesConcedidas)} adicional${props.adicionalesConcedidas === 1 ? '' : 'es'} para ${periodo}. `
                                        : ''}
                                    Ya puedes agendar escribiéndole al asistente virtual de {clinicName}.
                                </p>
                            </>
                        )}
                        {estado === 'REJECTED' && (
                            <>
                                <XCircle className="h-16 w-16 text-rose-500" />
                                <h1 className="text-2xl font-bold text-zinc-800">Solicitud no aprobada</h1>
                                <p className="text-zinc-500">
                                    El equipo de {clinicName} revisó tu caso y no fue posible aprobar más citas para{' '}
                                    {periodo}. Si tienes dudas, comunícate con el hospital.
                                </p>
                            </>
                        )}
                        {estado === 'VENCIDA' && (
                            <>
                                <Clock className="h-16 w-16 text-zinc-400" />
                                <h1 className="text-2xl font-bold text-zinc-800">Este enlace venció</h1>
                                <p className="text-zinc-500">
                                    Si todavía necesitas más citas, escríbele de nuevo al asistente virtual de {clinicName}{' '}
                                    o comunícate con el hospital.
                                </p>
                            </>
                        )}
                        {contactoHospital}
                    </div>
                )}
            </div>
        </div>
    );
}
