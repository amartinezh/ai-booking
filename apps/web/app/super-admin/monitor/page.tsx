import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import {
  listIncidents,
  getIncidentSummary,
  getMonitorMeta,
} from '@/app/actions/monitor';
import MonitorClientView from './MonitorClientView';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MonitorPage() {
  const session = await getSession();
  if (!session || session.role !== 'SUPER_ADMIN') redirect('/dashboard');

  const [incidents, summary, meta] = await Promise.all([
    listIncidents({ status: 'all', limit: 50 }),
    getIncidentSummary('30d'),
    getMonitorMeta(),
  ]);

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
          📡 Monitor de Servicios
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
          Diagnóstico en tiempo real y registro histórico de fallos de las
          integraciones externas (Google y Meta).
        </p>
      </header>

      <MonitorClientView
        initialIncidents={incidents}
        initialSummary={summary}
        meta={meta}
      />
    </div>
  );
}
