'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatTimeOnly } from '@/lib/date';
import { verificarFechaResumenAction } from '@/app/actions/resumen-publico';

const MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * La puerta de la página del resumen: la fecha de nacimiento del paciente en
 * tres partes (día, mes y año), más fácil en un celular que un calendario para
 * buscar el año. La API la compara; con 5 equivocadas, una hora de bloqueo.
 */
export default function FormularioFecha({ token, hospital }: { token: string; hospital: string }) {
    const router = useRouter();
    const [dia, setDia] = useState('');
    const [mes, setMes] = useState('');
    const [anio, setAnio] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [verificando, startVerificar] = useTransition();

    const entrar = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const d = Number(dia);
        const a = Number(anio);
        if (!d || d < 1 || d > 31 || !mes || !/^\d{4}$/.test(anio) || a < 1900) {
            setError('Escriba el día, el mes y el año completos (por ejemplo: 17, mayo, 1963).');
            return;
        }
        const fecha = `${anio}-${mes.padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        startVerificar(async () => {
            const r = await verificarFechaResumenAction(token, fecha);
            if (r.success) {
                router.refresh();
                return;
            }
            if (r.estado === 'FECHA_INCORRECTA') {
                setError(
                    r.intentosRestantes > 0
                        ? `La fecha no coincide. Le quedan ${r.intentosRestantes} intento${r.intentosRestantes === 1 ? '' : 's'}.`
                        : 'La fecha no coincide.',
                );
            } else if (r.estado === 'BLOQUEADO') {
                setError(`Por seguridad, el enlace quedó bloqueado. Intente después de las ${formatTimeOnly(new Date(r.hastaIso))}.`);
            } else if (r.estado === 'ERROR') {
                setError('Hubo un problema de conexión. Intente de nuevo.');
            } else {
                router.refresh();
            }
        });
    };

    const caja =
        'w-full rounded-xl border border-[#dde3eb] bg-white px-3 py-3 text-lg outline-none focus:border-[#2a78d6] focus:ring-2 focus:ring-[#2a78d6]/30';

    return (
        <form onSubmit={entrar} className="space-y-5 rounded-2xl border border-[#dde3eb] bg-white p-6 shadow-sm">
            <div className="space-y-1">
                <p className="text-sm uppercase tracking-wider text-[#586378]">{hospital}</p>
                <h1 className="text-2xl font-semibold">Resumen de su atención</h1>
                <p className="text-lg text-[#38445a]">
                    Para proteger su información, escriba la fecha de nacimiento del paciente.
                </p>
            </div>
            <fieldset className="grid grid-cols-[1fr_2fr_1.4fr] gap-2">
                <legend className="mb-2 text-base font-medium">Fecha de nacimiento</legend>
                <label className="space-y-1">
                    <span className="text-sm text-[#586378]">Día</span>
                    <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={2}
                        value={dia}
                        onChange={(e) => setDia(e.target.value.replace(/\D/g, ''))}
                        aria-label="Día"
                        className={caja}
                    />
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-[#586378]">Mes</span>
                    <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes" className={caja}>
                        <option value="">—</option>
                        {MESES.map((m, i) => (
                            <option key={m} value={String(i + 1)}>
                                {m}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="space-y-1">
                    <span className="text-sm text-[#586378]">Año</span>
                    <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={4}
                        value={anio}
                        onChange={(e) => setAnio(e.target.value.replace(/\D/g, ''))}
                        aria-label="Año"
                        className={caja}
                    />
                </label>
            </fieldset>
            {error && (
                <p role="alert" className="text-base text-red-700">
                    {error}
                </p>
            )}
            <button
                type="submit"
                disabled={verificando}
                className="w-full rounded-xl bg-[#2a78d6] px-4 py-3 text-lg font-medium text-white disabled:opacity-50"
            >
                {verificando ? 'Verificando…' : 'Ver mis documentos'}
            </button>
        </form>
    );
}
