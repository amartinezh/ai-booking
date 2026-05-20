"use client";

import { useEffect, useState } from "react";
import { getOrganizationQuickStats, type OrgQuickStats } from "../../../actions/organizations";

interface QuickStatsModalProps {
  org: { id: string; name: string };
  onClose: () => void;
}

/** Tarjeta métrica corporativa reutilizable. */
function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm flex items-start gap-3">
      <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-lg ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-zinc-900 dark:text-white tabular-nums leading-tight">
          {value.toLocaleString()}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">{label}</div>
      </div>
    </div>
  );
}

export default function QuickStatsModal({ org, onClose }: QuickStatsModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<OrgQuickStats | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getOrganizationQuickStats(org.id)
      .then((res) => {
        if (!active) return;
        if (res.success) setStats(res.data);
        else setError(res.error);
      })
      .catch((e) => active && setError(e?.message ?? "Error inesperado"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [org.id]);

  const m = stats?.metrics;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm animate-fade-in">
      {/* Sidebar deslizante */}
      <div className="h-full w-full max-w-md bg-zinc-50 dark:bg-zinc-950 shadow-2xl border-l border-zinc-200 dark:border-zinc-800 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-start bg-white dark:bg-zinc-900 shrink-0">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              📊 Resumen de la clínica
            </p>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white mt-1">{org.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors text-2xl leading-none"
            aria-label="Cerrar"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-20 text-zinc-400">
              <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Cargando estadísticas...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300">
              <p className="font-semibold">No se pudieron cargar las estadísticas</p>
              <p className="mt-1 text-xs opacity-80 break-words">{error}</p>
            </div>
          )}

          {!loading && !error && m && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Médicos (DOCTOR)"
                  value={m.totalDoctors}
                  icon="🩺"
                  accent="bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"
                />
                <StatCard
                  label="Pacientes"
                  value={m.totalPatients}
                  icon="🧑‍🤝‍🧑"
                  accent="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300"
                />
                <StatCard
                  label="Agendadores"
                  value={m.totalSchedulers}
                  icon="🗓️"
                  accent="bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300"
                />
                <StatCard
                  label="Citas agendadas"
                  value={m.totalScheduledAppointments}
                  icon="📅"
                  accent="bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300"
                />
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                  Citas cerradas
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-green-50 dark:bg-green-950/30 p-3 text-center">
                    <div className="text-2xl font-bold text-green-700 dark:text-green-300 tabular-nums">
                      {m.closedAppointmentsWithRecord.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-green-700/80 dark:text-green-400/80 mt-1 leading-snug">
                      Con historia clínica
                    </div>
                  </div>
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 p-3 text-center">
                    <div className="text-2xl font-bold text-amber-700 dark:text-amber-300 tabular-nums">
                      {m.closedAppointmentsWithoutRecord.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-1 leading-snug">
                      Sin historia clínica
                    </div>
                  </div>
                </div>
              </div>

              <StatCard
                label="Mensajes de IA procesados"
                value={m.aiMessagesProcessed}
                icon="🤖"
                accent="bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-900/40 dark:text-fuchsia-300"
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 rounded-xl text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
