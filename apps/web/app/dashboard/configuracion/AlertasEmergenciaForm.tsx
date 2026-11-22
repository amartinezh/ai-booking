'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Siren } from 'lucide-react';
import {
    CUERPO_PLANTILLA_EMERGENCIA,
    EJEMPLOS_PLANTILLA_EMERGENCIA,
    MAX_DESTINATARIOS_EMERGENCIA,
    NOMBRE_PLANTILLA_EMERGENCIA,
    PIE_PLANTILLA_EMERGENCIA,
    validarCelularEmergencia,
} from '@agenia/shared';
import { guardarAlertasEmergenciaAction, probarAlertaEmergenciaAction } from '@/app/actions/alertas-emergencia';
import type { PersonaAlertaEmergencia } from '@/lib/configuracion/alertas-emergencia';
import { AvisoSinGuardar, useSinGuardar } from './CambiosSinGuardar';

/**
 * 🚑 Quién recibe la alerta de posible emergencia (docs/GUARDRAIL_EMERGENCIAS.md,
 * 2026-11-22). Antes iba al teléfono de soporte, que en Anserma es un fijo: ninguna
 * alerta llegó. Se dice qué falta para que llegue (la plantilla de Meta) y cómo le fue
 * a cada persona con su último envío.
 */

interface Fila {
    /** La fila guardada; `null` = nueva, sin guardar. */
    id: string | null;
    label: string;
    telefono: string;
    isActive: boolean;
}

const TONO: Record<PersonaAlertaEmergencia['estado']['tono'], string> = {
    ok: 'text-emerald-700 dark:text-emerald-400',
    pendiente: 'text-zinc-600 dark:text-zinc-400',
    error: 'font-medium text-red-600 dark:text-red-400',
    nunca: 'text-zinc-500 dark:text-zinc-400',
};

const RUTA_PLANTILLAS = '/dashboard/configuracion/canales#plantillas';

export default function AlertasEmergenciaForm({
    personas,
    plantilla,
    telefonoSoporte,
}: {
    personas: PersonaAlertaEmergencia[];
    plantilla: { name: string; language: string; isActive: boolean } | null;
    telefonoSoporte: string | null;
}) {
    const inicial: Fila[] = personas.map((p) => ({ id: p.id, label: p.label, telefono: p.telefono, isActive: p.isActive }));
    const [filas, setFilas] = useState<Fila[]>(inicial);
    const { sucio, marcarGuardado } = useSinGuardar(filas);
    const [error, setError] = useState<string | null>(null);
    const [listo, setListo] = useState(false);
    const [prueba, setPrueba] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
    const [copiado, setCopiado] = useState(false);
    const [isPending, startTransition] = useTransition();

    const plantillaLista = !!plantilla?.isActive;
    const activas = filas.filter((f) => f.isActive).length;
    const estadoDe = (id: string | null) => personas.find((p) => p.id === id)?.estado ?? null;
    const sinCambios = (f: Fila) => {
        const p = personas.find((x) => x.id === f.id);
        return !!p && p.label === f.label && p.telefono === f.telefono && p.isActive === f.isActive;
    };

    const cambiar = (i: number, cambio: Partial<Fila>) => {
        setFilas((prev) => prev.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
        setError(null);
        setListo(false);
    };

    const guardar = () => {
        setError(null);
        setListo(false);
        startTransition(async () => {
            const res = await guardarAlertasEmergenciaAction(filas);
            if (res.success) {
                marcarGuardado();
                setListo(true);
                setTimeout(() => setListo(false), 3000);
            } else {
                setError(res.error);
            }
        });
    };

    const probar = (id: string) => {
        setPrueba(null);
        startTransition(async () => {
            const res = await probarAlertaEmergenciaAction(id);
            setPrueba(
                res.success
                    ? { id, ok: true, msg: 'Meta la aceptó. Pregúntele si le llegó: el estado de abajo se actualiza al recargar.' }
                    : { id, ok: false, msg: res.error },
            );
        });
    };

    const copiar = async () => {
        try {
            await navigator.clipboard.writeText(CUERPO_PLANTILLA_EMERGENCIA);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2500);
        } catch {
            setCopiado(false);
        }
    };

    const soporteEsCelular = /^(57)?3\d{9}$/.test((telefonoSoporte ?? '').replace(/\D/g, ''));

    return (
        <section className="space-y-4">
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-red-100 p-2.5 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    <Siren className="h-5 w-5" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Alertas de posible emergencia</h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Cuando el asistente le indica a un paciente llamar al 123 o ir a Urgencias, les avisa por WhatsApp a
                        estas personas, a cualquier hora, con el teléfono del paciente y lo que escribió, para que alguien lo
                        llame. Elija a quien pueda hacer ese seguimiento: por ejemplo, el jefe de enfermería de Urgencias o la
                        coordinación médica. Cada caso queda también en la{' '}
                        <Link href="/dashboard/auditoria" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                            Caja Negra
                        </Link>
                        .
                    </p>
                </div>
            </div>

            {/* La plantilla de Meta: sin ella, la alerta solo llega a quien escribió en 24 h. */}
            <div
                className={`rounded-2xl border p-4 text-sm ${
                    plantillaLista
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
                        : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
                }`}
            >
                {plantillaLista ? (
                    <p>
                        ✓ Plantilla registrada: <code className="font-mono">{plantilla!.name}</code> ({plantilla!.language}). La
                        alerta sale aunque la persona nunca le haya escrito al asistente.
                    </p>
                ) : (
                    <p>
                        <strong>Falta la plantilla de Meta.</strong>{' '}
                        {plantilla
                            ? 'Está registrada pero apagada.'
                            : 'Sin ella, WhatsApp solo le entrega la alerta a quien le haya escrito al asistente en las últimas 24 horas.'}{' '}
                        Créela en Meta con los datos de abajo y, cuando la aprueben, regístrela en{' '}
                        <Link href={RUTA_PLANTILLAS} className="font-semibold underline">
                            Canales › Plantillas
                        </Link>{' '}
                        como «Alerta de posible emergencia (al personal)».
                    </p>
                )}
                <details className="mt-3" open={!plantillaLista}>
                    <summary className="cursor-pointer font-semibold">Cómo crear la plantilla en Meta</summary>
                    <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
                        <dt className="font-medium">Nombre</dt>
                        <dd>
                            <code className="font-mono">{NOMBRE_PLANTILLA_EMERGENCIA}</code>
                        </dd>
                        <dt className="font-medium">Categoría</dt>
                        <dd>Utilidad</dd>
                        <dt className="font-medium">Idioma</dt>
                        <dd>Español (Colombia) · es_CO</dd>
                        <dt className="font-medium">Encabezado y botones</dt>
                        <dd>Ninguno</dd>
                        <dt className="font-medium">Pie de página</dt>
                        <dd>{PIE_PLANTILLA_EMERGENCIA}</dd>
                    </dl>
                    <p className="mt-3 font-medium">Cuerpo</p>
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 font-sans text-zinc-800 ring-1 ring-black/5 dark:bg-zinc-900/60 dark:text-zinc-200">
                        {CUERPO_PLANTILLA_EMERGENCIA}
                    </pre>
                    <button
                        type="button"
                        onClick={copiar}
                        className="mt-2 rounded-lg border border-current/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/50 dark:hover:bg-black/20"
                    >
                        {copiado ? '✓ Copiado' : 'Copiar el cuerpo'}
                    </button>
                    <p className="mt-3 font-medium">Ejemplos que pide Meta para cada variable</p>
                    <ul className="mt-1 list-inside list-disc">
                        {EJEMPLOS_PLANTILLA_EMERGENCIA.map((e, i) => (
                            <li key={i}>
                                <code className="font-mono">{`{{${i + 1}}}`}</code>: {e}
                            </li>
                        ))}
                    </ul>
                </details>
            </div>

            <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                {filas.length === 0 ? (
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                        Nadie recibe las alertas.{' '}
                        {soporteEsCelular
                            ? `Mientras la lista esté vacía van al teléfono de soporte (${telefonoSoporte}).`
                            : `Mientras la lista esté vacía no le llegan a nadie: el teléfono de soporte${
                                  telefonoSoporte ? ` (${telefonoSoporte})` : ''
                              } no es un celular y un fijo no recibe WhatsApp.`}
                    </p>
                ) : (
                    <ul className="space-y-4">
                        {filas.map((f, i) => {
                            const estado = estadoDe(f.id);
                            const v = validarCelularEmergencia(f.telefono);
                            return (
                                <li key={f.id ?? `nueva-${i}`} className="space-y-2 border-b border-zinc-100 pb-4 last:border-0 last:pb-0 dark:border-zinc-800">
                                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
                                        <label className="text-sm">
                                            <span className="mb-1 block font-semibold text-zinc-700 dark:text-zinc-300">Nombre o cargo</span>
                                            <input
                                                value={f.label}
                                                maxLength={60}
                                                onChange={(e) => cambiar(i, { label: e.target.value })}
                                                placeholder="Ej: Jefe de enfermería de Urgencias"
                                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                                            />
                                        </label>
                                        <label className="text-sm">
                                            <span className="mb-1 block font-semibold text-zinc-700 dark:text-zinc-300">Celular con WhatsApp</span>
                                            <input
                                                type="tel"
                                                value={f.telefono}
                                                maxLength={30}
                                                onChange={(e) => cambiar(i, { telefono: e.target.value })}
                                                placeholder="Ej: 300 123 4567"
                                                aria-invalid={f.telefono.trim() !== '' && !v.ok}
                                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                                            />
                                        </label>
                                    </div>
                                    {f.telefono.trim() !== '' && !v.ok && (
                                        <p className="text-sm text-red-600 dark:text-red-400">{v.error}</p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                                        <label className="inline-flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={f.isActive}
                                                onChange={(e) => cambiar(i, { isActive: e.target.checked })}
                                                className="h-4 w-4 rounded border-zinc-300"
                                            />
                                            Recibe las alertas
                                        </label>
                                        {estado && <span className={TONO[estado.tono]}>{estado.texto}</span>}
                                        <span className="ml-auto flex gap-3">
                                            {f.id && sinCambios(f) && (
                                                <button
                                                    type="button"
                                                    disabled={isPending || !plantillaLista}
                                                    title={plantillaLista ? undefined : 'Primero registre la plantilla de Meta'}
                                                    onClick={() => probar(f.id!)}
                                                    className="font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400"
                                                >
                                                    Enviar prueba
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setFilas((prev) => prev.filter((_, j) => j !== i))}
                                                className="font-medium text-red-600 hover:underline dark:text-red-400"
                                            >
                                                Quitar
                                            </button>
                                        </span>
                                    </div>
                                    {prueba?.id === f.id && (
                                        <p
                                            role="status"
                                            className={`text-sm ${prueba.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                                        >
                                            {prueba.msg}
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
                <button
                    type="button"
                    disabled={activas >= MAX_DESTINATARIOS_EMERGENCIA}
                    onClick={() => setFilas((prev) => [...prev, { id: null, label: '', telefono: '', isActive: true }])}
                    className="mt-4 rounded-xl border border-dashed border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                    + Agregar persona
                </button>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Hasta {MAX_DESTINATARIOS_EMERGENCIA} personas. Solo celulares de Colombia: un fijo no recibe WhatsApp.
                </p>
                {error && (
                    <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                        {error}
                    </p>
                )}
            </div>
            <div className="flex justify-end">
                {listo && <span className="mr-3 self-center text-sm text-emerald-600 dark:text-emerald-400">✓ Guardado</span>}
                <AvisoSinGuardar visible={sucio} />
                <button
                    type="button"
                    onClick={guardar}
                    disabled={isPending || !sucio}
                    className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                    {isPending ? 'Guardando…' : 'Guardar la lista'}
                </button>
            </div>
        </section>
    );
}
