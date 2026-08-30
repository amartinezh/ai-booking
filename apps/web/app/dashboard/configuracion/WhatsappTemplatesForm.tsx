'use client';

import { useState, useTransition } from 'react';
import {
    saveMyWhatsappTemplate,
    deleteMyWhatsappTemplate,
} from '@/app/actions/whatsapp-templates';
import {
    TEMPLATE_CONTRACTS,
    type WhatsappTemplateDto,
    type WhatsappTemplateKind,
} from '@/app/actions/whatsapp-templates.types';

const KINDS = Object.keys(TEMPLATE_CONTRACTS) as WhatsappTemplateKind[];

/**
 * Configuración de las plantillas aprobadas de cada clínica.
 *
 * Meta sólo acepta texto libre dentro de las 24 h siguientes al último mensaje
 * del paciente. Un recordatorio sale el día ANTES de la cita, así que casi
 * siempre cae fuera: sin plantilla registrada aquí, no se envía.
 */
export default function WhatsappTemplatesForm({
    initial,
}: {
    initial: WhatsappTemplateDto[];
}) {
    const [templates, setTemplates] = useState<WhatsappTemplateDto[]>(initial);
    const [pending, startTransition] = useTransition();
    const [feedback, setFeedback] = useState<{ kind: WhatsappTemplateKind; ok: boolean; msg: string } | null>(null);

    const byKind = (kind: WhatsappTemplateKind) =>
        templates.find((t) => t.kind === kind);

    const handleSave = (kind: WhatsappTemplateKind, form: HTMLFormElement) => {
        const data = new FormData(form);
        const name = String(data.get('name') ?? '').trim();
        const language = String(data.get('language') ?? '').trim() || 'es';
        const requestsContactInfo = data.get('requestsContactInfo') === 'on';
        const isActive = data.get('isActive') === 'on';

        startTransition(async () => {
            const res = await saveMyWhatsappTemplate({
                kind,
                name,
                language,
                requestsContactInfo,
                isActive,
            });
            if (res.success) {
                setTemplates((prev) => [
                    ...prev.filter((t) => t.kind !== kind),
                    res.data,
                ]);
                setFeedback({ kind, ok: true, msg: 'Plantilla guardada.' });
            } else {
                setFeedback({ kind, ok: false, msg: res.error });
            }
        });
    };

    const handleDelete = (kind: WhatsappTemplateKind) => {
        startTransition(async () => {
            const res = await deleteMyWhatsappTemplate(kind);
            if (res.success) {
                setTemplates((prev) => prev.filter((t) => t.kind !== kind));
                setFeedback({ kind, ok: true, msg: 'Plantilla eliminada.' });
            } else {
                setFeedback({ kind, ok: false, msg: res.error });
            }
        });
    };

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                    📨 Plantillas de WhatsApp
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                    WhatsApp solo permite mensajes de texto libre durante las 24 horas
                    siguientes al último mensaje del paciente. Fuera de esa ventana hay que
                    usar una plantilla aprobada por Meta. Registre aquí el nombre exacto con
                    el que quedó aprobada en su cuenta.
                </p>
            </div>

            {KINDS.map((kind) => {
                const contract = TEMPLATE_CONTRACTS[kind];
                const current = byKind(kind);
                const msg = feedback?.kind === kind ? feedback : null;

                return (
                    <form
                        key={kind}
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleSave(kind, e.currentTarget);
                        }}
                        className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="font-semibold text-zinc-900 dark:text-white">
                                    {contract.label}
                                </p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                    {contract.description}
                                </p>
                            </div>
                            <span
                                className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full ${
                                    current?.isActive
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                }`}
                            >
                                {current?.isActive ? 'Configurada' : 'Sin configurar'}
                            </span>
                        </div>

                        {/* Contrato de variables: el orden importa y Meta lo valida al enviar. */}
                        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                Variables del cuerpo, en este orden exacto:
                            </p>
                            <ol className="text-xs text-zinc-600 dark:text-zinc-400 space-y-0.5">
                                {contract.variables.map((v, i) => (
                                    <li key={v}>
                                        <span className="font-mono">{`{{${i + 1}}}`}</span> — {v}
                                    </li>
                                ))}
                            </ol>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="sm:col-span-2">
                                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                    Nombre aprobado en Meta
                                </label>
                                <input
                                    name="name"
                                    type="text"
                                    required
                                    defaultValue={current?.name ?? ''}
                                    placeholder="recordatorio_cita"
                                    pattern="[a-z0-9_]+"
                                    title="Solo minúsculas, dígitos y guión bajo (lo que exige Meta)."
                                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-white font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                    Idioma
                                </label>
                                <input
                                    name="language"
                                    type="text"
                                    defaultValue={current?.language ?? 'es'}
                                    placeholder="es"
                                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-white font-mono"
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-4">
                            <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                                <input
                                    name="isActive"
                                    type="checkbox"
                                    defaultChecked={current?.isActive ?? true}
                                    className="rounded"
                                />
                                Activa
                            </label>
                            <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                                <input
                                    name="requestsContactInfo"
                                    type="checkbox"
                                    defaultChecked={current?.requestsContactInfo ?? false}
                                    className="rounded"
                                />
                                <span>
                                    Incluye botón para pedir el número
                                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                                        Marque si la plantilla aprobada lleva el botón
                                        REQUEST_CONTACT_INFO, que permite recuperar el teléfono de
                                        pacientes que lo tienen oculto.
                                    </span>
                                </span>
                            </label>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                type="submit"
                                disabled={pending}
                                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold transition-all"
                            >
                                {pending ? 'Guardando…' : 'Guardar'}
                            </button>
                            {current && (
                                <button
                                    type="button"
                                    onClick={() => handleDelete(kind)}
                                    disabled={pending}
                                    className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 text-sm text-zinc-700 dark:text-zinc-300 transition-all"
                                >
                                    Eliminar
                                </button>
                            )}
                            {msg && (
                                <span
                                    className={`text-sm ${
                                        msg.ok
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : 'text-red-600 dark:text-red-400'
                                    }`}
                                >
                                    {msg.msg}
                                </span>
                            )}
                        </div>
                    </form>
                );
            })}
        </div>
    );
}
