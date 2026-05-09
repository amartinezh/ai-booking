'use client';

import { useState, useTransition } from 'react';
import { updateMyOrgSettings } from '@/app/actions/settings';

export default function SettingsForm({ initial }: { initial: { botName: string } }) {
    const [botName, setBotName] = useState(initial.botName);
    const [isPending, startTransition] = useTransition();
    const [saved, setSaved] = useState(false);

    const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaved(false);
        startTransition(async () => {
            const res = await updateMyOrgSettings({ botName });
            if (res.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
            } else {
                alert('Error al guardar: ' + res.error);
            }
        });
    };

    return (
        <form onSubmit={handleSave} className="space-y-8">

            {/* Sección: Chatbot */}
            <section>
                <div className="mb-5">
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Asistente Virtual (Chatbot WhatsApp)</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Personalice la identidad del bot que interactúa con sus pacientes en WhatsApp.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                            Nombre del asistente virtual
                        </label>
                        <input
                            type="text"
                            required
                            maxLength={40}
                            value={botName}
                            onChange={e => setBotName(e.target.value)}
                            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                            placeholder="Ej: Vicente, Sofía, MedBot..."
                        />
                        <p className="text-xs text-zinc-400 mt-1.5">
                            Este nombre aparece en los mensajes de bienvenida: <em>"Soy <strong>{botName || 'Vicente'}</strong>, el asistente de su clínica."</em>
                        </p>
                    </div>

                    <div className="flex items-start pt-6">
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 text-sm text-indigo-700 dark:text-indigo-300 w-full">
                            <p className="font-semibold mb-1">💡 Vista previa del mensaje</p>
                            <p className="text-indigo-600 dark:text-indigo-400 italic">
                                "¡Hola! 👋 Soy <strong>{botName || 'Vicente'}</strong>, el asistente de su clínica. Estoy aquí para ayudarle a agendar su cita médica..."
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6 flex justify-end">
                <button
                    type="submit"
                    disabled={isPending}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                    {isPending ? (
                        <>
                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                            Guardando...
                        </>
                    ) : saved ? (
                        <><span>✅</span> Configuración guardada</>
                    ) : (
                        <><span>💾</span> Guardar configuración</>
                    )}
                </button>
            </div>
        </form>
    );
}
