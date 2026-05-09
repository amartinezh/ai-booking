import { redirect } from 'next/navigation';

export default function KnowledgeBasePage() {
    redirect('/dashboard/configuracion?tab=kb');
}
