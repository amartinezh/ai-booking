'use client';

import { useState, useTransition } from 'react';
import { updateMyKnowledgeBase } from '@/app/actions/knowledge-base';

export default function KnowledgeBaseEditor({ initialContent }: { initialContent: string }) {
    const [content, setContent] = useState(initialContent);
    const [isPending, startTransition] = useTransition();
    const [saved, setSaved] = useState(false);

    const handleSave = () => {
        setSaved(false);
        startTransition(async () => {
            const res = await updateMyKnowledgeBase(content);
            if (res.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
            } else {
                alert('Error al guardar: ' + res.error);
            }
        });
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    {content.length > 0 ? (
                        <span>{content.length.toLocaleString()} caracteres guardados</span>
                    ) : (
                        <span className="text-amber-500">Sin contenido — el chatbot responderá que no tiene información disponible.</span>
                    )}
                </div>
                <button
                    onClick={handleSave}
                    disabled={isPending}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
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
                        <><span>✅</span> Guardado</>
                    ) : (
                        <><span>💾</span> Guardar Base de Conocimiento</>
                    )}
                </button>
            </div>

            <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={28}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm font-mono text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all resize-y leading-relaxed"
                placeholder={`Escriba aquí la información de su clínica que el chatbot usará para responder preguntas frecuentes. Por ejemplo:\n\n## Horarios de Atención\n- Lunes a Viernes: 7:00 a.m. a 7:00 p.m.\n- Sábados: 7:00 a.m. a 1:00 p.m.\n\n## Urgencias\nAtendemos urgencias las 24 horas...\n\n## Costos\nConsulta general: $90.000 COP...`}
            />

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <p className="font-semibold">💡 Consejos para una buena base de conocimiento:</p>
                <ul className="list-disc list-inside space-y-1 text-blue-600 dark:text-blue-400">
                    <li>Use secciones claras (Horarios, Costos, Servicios, Contacto, etc.).</li>
                    <li>El chatbot solo responderá lo que esté escrito aquí — no inventará datos.</li>
                    <li>Incluya tarifas, EPS convenidas, teléfonos, y protocolos de visita.</li>
                    <li>Puede usar formato libre (texto plano o Markdown).</li>
                </ul>
            </div>
        </div>
    );
}
