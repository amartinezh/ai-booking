'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { homologarMedico, deshomologarMedico } from '@/app/actions/homologacion';
import { formatDateShort } from '@/lib/date';

type HisRow = {
    externalKey: string;
    label: string;
    cargo: string | null;
    lastSeenAt: Date;
    mapId: string | null;
    doctorId: string | null;
    doctorNombre: string | null;
};

type AgenIARow = {
    id: string;
    fullName: string;
    cedula: string;
    servicio: string | null;
    isActive: boolean;
    whatsappBookingEnabled: boolean;
    externalKey: string | null;
};

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                ok
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
        >
            {children}
        </span>
    );
}

export default function HomologacionClient({ his, agenia }: { his: HisRow[]; agenia: AgenIARow[] }) {
    const [pendiente, startTransition] = useTransition();
    const [aviso, setAviso] = useState<string | null>(null);
    const [busqueda, setBusqueda] = useState('');
    const [seleccion, setSeleccion] = useState<Record<string, string>>({});

    const ageniaPorId = useMemo(() => new Map(agenia.map((d) => [d.id, d])), [agenia]);
    const doctoresLibres = useMemo(() => agenia.filter((d) => !d.externalKey), [agenia]);

    const filas = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        const filtradas = q
            ? his.filter(
                  (r) =>
                      r.label.toLowerCase().includes(q) ||
                      r.externalKey.toLowerCase().includes(q) ||
                      (r.cargo ?? '').toLowerCase().includes(q) ||
                      (r.doctorNombre ?? '').toLowerCase().includes(q),
              )
            : his;
        // Sin vincular primero: es lo que hay que revisar.
        return [...filtradas].sort((a, b) => Number(!!a.mapId) - Number(!!b.mapId));
    }, [his, busqueda]);

    const vincular = (externalKey: string) => {
        const doctorId = seleccion[externalKey];
        if (!doctorId) {
            setAviso('Elige primero con qué médico de AgenIA lo vinculas.');
            return;
        }
        setAviso(null);
        startTransition(async () => {
            const r = await homologarMedico(externalKey, doctorId);
            if (r.success) {
                setSeleccion((s) => {
                    const copia = { ...s };
                    delete copia[externalKey];
                    return copia;
                });
                setAviso(`Vinculado: ${externalKey} → ${ageniaPorId.get(doctorId)?.fullName ?? 'médico de AgenIA'}.`);
            } else {
                setAviso(r.error ?? 'No se pudo vincular.');
            }
        });
    };

    const desvincular = (mapId: string, label: string) => {
        if (
            !confirm(
                `¿Desvincular "${label}"? Deja de recibir cupos y citas del HIS. Si ya tenía cupos generados, esos NO se borran solos — apágalos en /dashboard/medicos si hace falta.`,
            )
        )
            return;
        setAviso(null);
        startTransition(async () => {
            const r = await deshomologarMedico(mapId);
            setAviso(r.success ? `"${label}" quedó sin vincular.` : (r.error ?? 'No se pudo desvincular.'));
        });
    };

    const sinVincular = his.filter((r) => !r.mapId).length;

    return (
        <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                        Homologación de médicos
                    </h1>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Empareja cada médico que reporta el HIS con su perfil en AgenIA. Sin este paso,
                        el médico no recibe cupos ni citas — es intencional, lo decide una persona.
                    </p>
                </div>
                <Link
                    href="/dashboard/espejo"
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                    ← Volver al espejo
                </Link>
            </header>

            <section className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
                    <p className="text-2xl font-bold text-amber-900 dark:text-amber-200">{sinVincular}</p>
                    <p className="text-sm text-amber-800 dark:text-amber-300">médico(s) del HIS sin vincular</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                    <p className="text-2xl font-bold text-zinc-900 dark:text-white">{his.length - sinVincular}</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">ya homologados</p>
                </div>
            </section>

            <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por código, nombre o cargo…"
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            />

            {aviso && (
                <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                    {aviso}
                </p>
            )}

            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                    <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
                        <tr className="text-zinc-600 dark:text-zinc-400">
                            <th className="p-3 font-medium">Código HIS</th>
                            <th className="p-3 font-medium">Médico (HIS)</th>
                            <th className="p-3 font-medium">Vinculado con (AgenIA)</th>
                            <th className="p-3 font-medium">Acción</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
                        {filas.map((r) => {
                            const doctor = r.doctorId ? ageniaPorId.get(r.doctorId) : null;
                            return (
                                <tr key={r.externalKey}>
                                    <td className="p-3 font-mono text-xs text-zinc-500">{r.externalKey}</td>
                                    <td className="p-3">
                                        <span className="font-medium text-zinc-900 dark:text-white">{r.label}</span>
                                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                                            {r.cargo ?? 'sin cargo'} · visto {formatDateShort(r.lastSeenAt)}
                                        </span>
                                    </td>
                                    <td className="p-3">
                                        {doctor ? (
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="font-medium text-zinc-900 dark:text-white">
                                                    {doctor.fullName}
                                                </span>
                                                <Badge ok={doctor.isActive}>
                                                    {doctor.isActive ? 'activo' : 'inactivo'}
                                                </Badge>
                                                <Badge ok={doctor.whatsappBookingEnabled}>
                                                    {doctor.whatsappBookingEnabled ? 'WhatsApp ON' : 'WhatsApp OFF'}
                                                </Badge>
                                            </div>
                                        ) : (
                                            <span className="text-zinc-400 dark:text-zinc-600">— sin vincular —</span>
                                        )}
                                    </td>
                                    <td className="p-3">
                                        {r.mapId ? (
                                            <button
                                                onClick={() => desvincular(r.mapId as string, r.label)}
                                                disabled={pendiente}
                                                className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                                            >
                                                Desvincular
                                            </button>
                                        ) : (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <select
                                                    value={seleccion[r.externalKey] ?? ''}
                                                    onChange={(e) =>
                                                        setSeleccion((s) => ({ ...s, [r.externalKey]: e.target.value }))
                                                    }
                                                    disabled={pendiente}
                                                    className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                                                >
                                                    <option value="">Elegir médico de AgenIA…</option>
                                                    {doctoresLibres.map((d) => (
                                                        <option key={d.id} value={d.id}>
                                                            {d.fullName} · {d.cedula}
                                                        </option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => vincular(r.externalKey)}
                                                    disabled={pendiente || !seleccion[r.externalKey]}
                                                    className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-default disabled:opacity-40 dark:border-white dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
                                                >
                                                    Vincular
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        {filas.length === 0 && (
                            <tr>
                                <td colSpan={4} className="p-6 text-center text-zinc-500 dark:text-zinc-400">
                                    Ningún médico del HIS coincide con la búsqueda.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {doctoresLibres.length > 0 && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {doctoresLibres.length} médico(s) de AgenIA todavía sin vincular a ningún código del HIS:{' '}
                    {doctoresLibres.map((d) => d.fullName).join(', ')}.
                </p>
            )}
        </div>
    );
}
