'use client';

import { formatAppointmentCompact, formatDateShort } from '@/lib/date';
import type { AvisosRecipientView } from '@/app/actions/avisos';

/**
 * Paso 2 — tabla de destinatarios. Puramente de presentación: el estado
 * (selección, filtros) vive en `AvisosClient`, que es quien orquesta las
 * llamadas al server action por cada cambio.
 */
export default function RecipientsTable({
    recipients,
    onToggle,
    disabled,
}: {
    recipients: AvisosRecipientView[];
    onToggle: (recipientId: string, selected: boolean) => void;
    disabled: boolean;
}) {
    const conCelular = recipients.filter((r) => r.hasValidPhone);
    const sinCelular = recipients.filter((r) => !r.hasValidPhone);

    return (
        <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                <table className="min-w-full text-sm">
                    <thead className="bg-zinc-50 dark:bg-zinc-900/60">
                        <tr className="text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                            <th className="px-3 py-2 w-10"></th>
                            <th className="px-3 py-2">Paciente</th>
                            <th className="px-3 py-2">Documento</th>
                            <th className="px-3 py-2">Cita</th>
                            <th className="px-3 py-2">Teléfono</th>
                            <th className="px-3 py-2">Aviso previo</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {conCelular.map((r) => (
                            <tr key={r.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                                <td className="px-3 py-2">
                                    <input
                                        type="checkbox"
                                        checked={r.selected}
                                        disabled={disabled}
                                        onChange={(e) => onToggle(r.id, e.target.checked)}
                                        className="h-4 w-4 rounded border-zinc-300 text-rose-600 focus:ring-rose-500 disabled:opacity-50"
                                        aria-label={`Seleccionar a ${r.patientName ?? r.patientDocument}`}
                                    />
                                </td>
                                <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                                    {r.patientName ?? <span className="text-zinc-400 italic">Sin nombre</span>}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                                    {r.patientDocument}
                                </td>
                                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                                    {formatAppointmentCompact(r.appointmentAtUtc)}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs text-zinc-500">{r.phoneMasked}</td>
                                <td className="px-3 py-2">
                                    {r.previousSentAt ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                                            ⚠️ Enviado el {formatDateShort(r.previousSentAt)}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-zinc-400">—</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {sinCelular.length > 0 && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                        {sinCelular.length} paciente(s) sin celular válido — no se les puede enviar WhatsApp
                    </p>
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        No se cuelan entre los enviados. Alguien tiene que llamarlos:
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-300">
                        {sinCelular.map((r) => (
                            <li key={r.id} className="flex gap-2">
                                <span className="font-mono text-xs">{r.patientDocument}</span>
                                <span>{r.patientName ?? 'Sin nombre'}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
