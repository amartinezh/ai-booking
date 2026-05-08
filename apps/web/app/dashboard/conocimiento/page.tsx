import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getMyKnowledgeBase } from '@/app/actions/knowledge-base';
import KnowledgeBaseEditor from './KnowledgeBaseEditor';

export const dynamic = 'force-dynamic';

export default async function KnowledgeBasePage() {
    const session = await getSession();
    if (!session) redirect('/login');
    if (session.role !== 'ORG_ADMIN') redirect('/dashboard');

    const content = await getMyKnowledgeBase();

    return (
        <div className="max-w-5xl mx-auto animate-fade-in">
            <header className="mb-8">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    Base de Conocimiento del Chatbot
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
                    Escriba aquí toda la información de su clínica. El asistente virtual usará este texto
                    para responder preguntas frecuentes de los pacientes por WhatsApp (horarios, tarifas, EPS, servicios, etc.).
                </p>
            </header>

            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 p-6">
                <KnowledgeBaseEditor initialContent={content ?? ''} />
            </div>
        </div>
    );
}
