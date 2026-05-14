'use client';

import { useState, useTransition } from 'react';
import { MessageCircle, Sparkles, GraduationCap } from 'lucide-react';
import { updateMyOrgSettings, type CommStyle } from '@/app/actions/settings';

type Props = {
    initial: {
        botName: string;
        communicationStyle: CommStyle;
    };
};

const PREVIEW_FORMAL = (botName: string) =>
    `¡Hola, bienvenido(a)! 🌟 Soy ${botName || 'Vicente'}, su acompañante virtual de su Clínica. Estoy aquí para que su agendamiento sea facilito. 🏥\n\n¿Cuál de estos servicios necesita hoy?\nA) Medicina General\nB) Odontología`;

const PREVIEW_INFORMAL = (botName: string) =>
    `¡Hola, ¿cómo estás? 😊 Mi nombre es ${botName || 'Vicente'} y te escribo desde tu Clínica. Espero que estés muy bien y gracias por escribirnos. Te cuento que puedo ayudarte a agendar tu cita médica. De momento tengo A) Medicina General y B) Odontología. Cuéntame con cuál te puedo ayudar.`;

export default function SettingsForm({ initial }: Props) {
    const [botName, setBotName] = useState(initial.botName);
    const [style, setStyle] = useState<CommStyle>(initial.communicationStyle);
    const [isPending, startTransition] = useTransition();
    const [saved, setSaved] = useState(false);

    const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaved(false);
        startTransition(async () => {
            const res = await updateMyOrgSettings({ botName, communicationStyle: style });
            if (res.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
            } else {
                alert('Error al guardar: ' + res.error);
            }
        });
    };

    return (
        <form onSubmit={handleSave} className="space-y-10">

            {/* ── Sección: Identidad del asistente ──────────── */}
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

            {/* ── Sección: Tono de Voz ───────────────────────── */}
            <section>
                <div className="mb-5 flex items-start gap-3">
                    <div className="rounded-xl bg-fuchsia-100 dark:bg-fuchsia-900/30 p-2.5 text-fuchsia-600 dark:text-fuchsia-400">
                        <MessageCircle className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Tono de Voz del Chatbot</h2>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            Elija cómo se comunica el asistente con sus pacientes. Puede cambiarlo en cualquier momento.
                        </p>
                    </div>
                </div>

                {/* Cards selector tipo radio */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <StyleOption
                        label="Formal"
                        description={'Trato de "usted", estructura clara con A/B/C. Profesional y respetuoso.'}
                        Icon={GraduationCap}
                        accent="indigo"
                        active={style === 'FORMAL'}
                        onClick={() => setStyle('FORMAL')}
                    />
                    <StyleOption
                        label="Informal"
                        description={'Trato de "tú", conversacional tipo charla. Cercano y humano.'}
                        Icon={Sparkles}
                        accent="fuchsia"
                        active={style === 'INFORMAL'}
                        onClick={() => setStyle('INFORMAL')}
                    />
                </div>

                {/* Preview en vivo */}
                <div className="mt-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-900 dark:to-zinc-950 p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                            Vista previa · estilo {style === 'FORMAL' ? 'Formal' : 'Informal'}
                        </span>
                    </div>
                    <div className="rounded-xl bg-green-50 dark:bg-green-900/10 border border-green-200/60 dark:border-green-800/40 px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-line leading-relaxed">
                        {style === 'FORMAL' ? PREVIEW_FORMAL(botName) : PREVIEW_INFORMAL(botName)}
                    </div>
                    <p className="text-xs text-zinc-400 mt-3">
                        El tono solo afecta el lenguaje y la estructura visual de los mensajes. La lógica de agendamiento, validaciones y conexión con la base de datos no se ve afectada.
                    </p>
                </div>
            </section>

            {/* ── Footer: Guardar ────────────────────────────── */}
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

// ─────────────────────────────────────────────────────────────
// Sub-componente: tarjeta selector de estilo
// ─────────────────────────────────────────────────────────────
function StyleOption({
    label,
    description,
    Icon,
    accent,
    active,
    onClick,
}: {
    label: string;
    description: string;
    Icon: React.ComponentType<{ className?: string }>;
    accent: 'indigo' | 'fuchsia';
    active: boolean;
    onClick: () => void;
}) {
    const ringClass =
        accent === 'indigo'
            ? active
                ? 'ring-2 ring-indigo-500 border-indigo-500 bg-indigo-50/60 dark:bg-indigo-900/20'
                : 'border-zinc-200 dark:border-zinc-700 hover:border-indigo-300'
            : active
                ? 'ring-2 ring-fuchsia-500 border-fuchsia-500 bg-fuchsia-50/60 dark:bg-fuchsia-900/20'
                : 'border-zinc-200 dark:border-zinc-700 hover:border-fuchsia-300';

    const iconBg =
        accent === 'indigo'
            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300'
            : 'bg-fuchsia-100 dark:bg-fuchsia-900/40 text-fuchsia-600 dark:text-fuchsia-300';

    return (
        <button
            type="button"
            onClick={onClick}
            className={`text-left w-full rounded-2xl border bg-white dark:bg-zinc-900 p-4 transition-all ${ringClass}`}
        >
            <div className="flex items-start gap-3">
                <div className={`rounded-xl p-2.5 ${iconBg}`}>
                    <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-zinc-900 dark:text-white">{label}</span>
                        <span
                            className={`text-xs font-semibold ${
                                active
                                    ? accent === 'indigo'
                                        ? 'text-indigo-600 dark:text-indigo-300'
                                        : 'text-fuchsia-600 dark:text-fuchsia-300'
                                    : 'text-zinc-400'
                            }`}
                        >
                            {active ? '● Activo' : 'Inactivo'}
                        </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">{description}</p>
                </div>
            </div>
        </button>
    );
}
