'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatTimeOnly } from '@/lib/date';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Play, Pause, RefreshCw, Trash2, Search, X } from 'lucide-react';
import {
  liveCheck,
  listIncidents,
  getIncidentSummary,
  clearIncidents,
  type LiveCheckResponse,
  type LiveServiceResult,
  type IncidentListResult,
  type IncidentRow,
  type IncidentSummary,
  type MonitorMeta,
} from '@/app/actions/monitor';
import LiveStatusCard from './components/LiveStatusCard';
import IncidentCard from './components/IncidentCard';
import IncidentDetailModal from './components/IncidentDetailModal';
import {
  SERVICE_LINE_COLORS,
  STATUS_COLOR,
  fmtLatency,
  statusLabel,
} from './components/status-ui';

const MAX_BUFFER_POINTS = 300;

type Props = {
  initialIncidents: IncidentListResult;
  initialSummary: IncidentSummary | null;
  meta: MonitorMeta | null;
};

type LivePoint = LiveCheckResponse;

export default function MonitorClientView({
  initialIncidents,
  initialSummary,
  meta,
}: Props) {
  const liveIntervalMs = (meta?.liveIntervalSeconds ?? 5) * 1000;
  const services = meta?.services ?? [];
  const serviceName = useCallback(
    (key: string) =>
      services.find((s) => s.key === key)?.displayName ?? key,
    [services],
  );

  // ── MODO B: estado del monitoreo en vivo ───────────────────────────────────
  const [isLive, setIsLive] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [livePoints, setLivePoints] = useState<LivePoint[]>([]);
  const [currentStatus, setCurrentStatus] = useState<
    Record<string, LiveServiceResult>
  >({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') return; // pausa si tab oculto
      try {
        const data = await liveCheck();
        if (cancelled) return;
        setCurrentStatus((prev) => {
          const next = { ...prev };
          for (const svc of data.services) next[svc.key] = svc;
          return next;
        });
        setLivePoints((prev) => {
          const next = [...prev, data];
          return next.length > MAX_BUFFER_POINTS
            ? next.slice(next.length - MAX_BUFFER_POINTS)
            : next;
        });
      } catch (err) {
        console.error('Live check failed:', err);
      }
    };

    void tick(); // primer check inmediato
    intervalRef.current = setInterval(() => void tick(), liveIntervalMs);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLive, liveIntervalMs]);

  const startLive = () => {
    setStartedAt(new Date().toISOString());
    setIsLive(true);
  };
  const stopLive = () => setIsLive(false);

  // Contadores del panel en vivo.
  const liveChecks = livePoints.length;
  const liveFailures = livePoints.reduce(
    (acc, p) => acc + p.services.filter((s) => s.status !== 'UP').length,
    0,
  );

  // Datos para el gráfico: una serie por servicio (latencia) + estado por punto.
  const chartData = useMemo(() => {
    return livePoints.map((p) => {
      const row: Record<string, number | string | null> = {
        t: formatTimeOnly(p.timestamp, { withSeconds: true }),
      };
      for (const svc of p.services) {
        row[svc.key] = svc.latencyMs;
        row[`${svc.key}__status`] = svc.status;
        row[`${svc.key}__err`] = svc.errorMessage ?? '';
      }
      return row;
    });
  }, [livePoints]);

  // ── MODO A: histórico de incidentes ─────────────────────────────────────────
  const [incidents, setIncidents] = useState<IncidentRow[]>(
    initialIncidents.rows,
  );
  const [total, setTotal] = useState(initialIncidents.total);
  const [summary, setSummary] = useState<IncidentSummary | null>(initialSummary);
  const [selected, setSelected] = useState<IncidentRow | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Filtros
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>(
    'all',
  );
  const [serviceFilter, setServiceFilter] = useState<Set<string>>(new Set());
  const [days, setDays] = useState<number>(30);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const from = new Date(
        Date.now() - days * 24 * 60 * 60 * 1000,
      ).toISOString();
      const [list, sum] = await Promise.all([
        listIncidents({
          from,
          status: statusFilter,
          services: serviceFilter.size ? Array.from(serviceFilter) : undefined,
          search: search || undefined,
          limit: 100,
        }),
        getIncidentSummary(`${days}`),
      ]);
      setIncidents(list.rows);
      setTotal(list.total);
      setSummary(sum);
    } catch (err) {
      console.error('History fetch failed:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [days, statusFilter, serviceFilter, search]);

  // Recargar al cambiar filtros.
  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  // Refresh automático cada 60s (transparente).
  useEffect(() => {
    const id = setInterval(() => void fetchHistory(), 60_000);
    return () => clearInterval(id);
  }, [fetchHistory]);

  const toggleService = (key: string) => {
    setServiceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Limpieza de histórico ────────────────────────────────────────────────────
  const [showClear, setShowClear] = useState(false);

  return (
    <div className="space-y-8">
      {/* Banner del monitor de fondo (MODO A) */}
      <BgBanner meta={meta} />

      {/* ── SECCIÓN LIVE (MODO B) ── */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
              🔴 Monitoreo en vivo
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-xl">
              Verifica los servicios cada {meta?.liveIntervalSeconds ?? 5}{' '}
              segundos en tiempo real, solo mientras tengas esta ventana
              abierta. No se guarda nada en la base de datos.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isLive && startedAt && (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                🟢 Activo desde{' '}
                {formatTimeOnly(startedAt)}
              </span>
            )}
            {!isLive ? (
              <button
                onClick={startLive}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors"
              >
                <Play size={16} /> Iniciar monitoreo en vivo
              </button>
            ) : (
              <button
                onClick={stopLive}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold transition-colors"
              >
                <Pause size={16} /> Detener
              </button>
            )}
          </div>
        </div>

        {(isLive || livePoints.length > 0) && (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {services.map((s) => {
                const cur = currentStatus[s.key];
                return cur ? (
                  <LiveStatusCard key={s.key} service={cur} />
                ) : (
                  <div
                    key={s.key}
                    className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-sm text-zinc-400"
                  >
                    {s.displayName} · esperando…
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#88888822" />
                    <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={32} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      label={{
                        value: 'ms',
                        angle: -90,
                        position: 'insideLeft',
                        fontSize: 11,
                      }}
                    />
                    <Tooltip
                      content={<LiveTooltip serviceName={serviceName} />}
                    />
                    <Legend />
                    {services.map((s, i) => (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.displayName}
                        stroke={SERVICE_LINE_COLORS[i % SERVICE_LINE_COLORS.length]}
                        strokeWidth={2}
                        connectNulls
                        dot={<StatusDot serviceKey={s.key} />}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                ℹ️ {liveChecks} ciclo(s) · {liveFailures} fallo(s) detectado(s)
                {livePoints.length >= MAX_BUFFER_POINTS &&
                  ` · buffer lleno (${MAX_BUFFER_POINTS} puntos máx.)`}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── SECCIÓN HISTÓRICO (MODO A) ── */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
            📜 Histórico de incidentes
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchHistory()}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <RefreshCw size={14} className={loadingHistory ? 'animate-spin' : ''} />
              Refrescar
            </button>
            <button
              onClick={() => setShowClear(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-xl border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={14} /> Limpiar histórico
            </button>
          </div>
        </div>

        {summary && (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            📊 {summary.total} incidente(s) en últimos {summary.periodDays} días ·{' '}
            {summary.open} abierto(s) · {summary.resolved} resuelto(s)
            {summary.avgDurationMs != null &&
              ` · duración media ${Math.round(summary.avgDurationMs / 1000)}s`}
          </p>
        )}

        {/* Filtros */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput.trim());
            }}
            className="relative"
          >
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar error / código…"
              className="pl-9 pr-8 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white w-56"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setSearch('');
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              >
                <X size={15} />
              </button>
            )}
          </form>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | 'open' | 'resolved')
            }
            className="py-2 px-3 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
          >
            <option value="all">Todos los estados</option>
            <option value="open">Solo activos</option>
            <option value="resolved">Solo resueltos</option>
          </select>

          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="py-2 px-3 text-sm rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
          >
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
            <option value={365}>Último año</option>
          </select>

          {/* Chips de servicio */}
          <div className="flex items-center gap-1.5">
            {services.map((s) => {
              const active = serviceFilter.has(s.key);
              return (
                <button
                  key={s.key}
                  onClick={() => toggleService(s.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                    active
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {s.displayName}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista */}
        <div className="mt-4 space-y-3">
          {incidents.length === 0 ? (
            <div className="text-center py-12 text-zinc-400 dark:text-zinc-500">
              ✅ Sin incidentes en el rango seleccionado.
            </div>
          ) : (
            incidents.map((inc) => (
              <IncidentCard
                key={inc.id}
                incident={inc}
                serviceName={serviceName(inc.serviceKey)}
                onOpen={() => setSelected(inc)}
              />
            ))
          )}
          {total > incidents.length && (
            <p className="text-center text-xs text-zinc-400">
              Mostrando {incidents.length} de {total} incidentes.
            </p>
          )}
        </div>
      </section>

      {selected && (
        <IncidentDetailModal
          incident={selected}
          serviceName={serviceName(selected.serviceKey)}
          onClose={() => setSelected(null)}
        />
      )}

      {showClear && (
        <ClearModal
          onClose={() => setShowClear(false)}
          onDone={() => {
            setShowClear(false);
            void fetchHistory();
          }}
        />
      )}
    </div>
  );
}

// ── Banner del cron de fondo ────────────────────────────────────────────────
function BgBanner({ meta }: { meta: MonitorMeta | null }) {
  if (!meta) return null;
  return meta.bgEnabled ? (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
      ✅ Monitor de fondo activo — chequeando cada {meta.bgIntervalMinutes} min
    </div>
  ) : (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
      🚫 Monitor de fondo deshabilitado (MONITOR_ENABLED=false en .env)
    </div>
  );
}

// ── Punto del gráfico coloreado según estado ────────────────────────────────
function StatusDot(props: any) {
  const { cx, cy, payload, serviceKey } = props;
  if (cx == null || cy == null) return null;
  const status = payload?.[`${serviceKey}__status`];
  if (status === 'UP') return null; // sin punto en UP para no saturar la línea
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.DOWN;
  return <circle cx={cx} cy={cy} r={5} fill={color} stroke="#fff" strokeWidth={1.5} />;
}

// ── Tooltip del gráfico en vivo ─────────────────────────────────────────────
function LiveTooltip({
  active,
  payload,
  label,
  serviceName,
}: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Record<string, any>;
  const keys = Object.keys(row).filter(
    (k) => !k.includes('__') && k !== 't',
  );
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-3 text-xs">
      <p className="font-semibold text-zinc-900 dark:text-white mb-1">{label}</p>
      {keys.map((k) => {
        const status = row[`${k}__status`];
        const err = row[`${k}__err`];
        return (
          <div key={k} className="mb-1">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {serviceName(k)}:
            </span>{' '}
            <span
              style={{ color: STATUS_COLOR[status] ?? STATUS_COLOR.DOWN }}
              className="font-mono"
            >
              {statusLabel(status)} · {fmtLatency(row[k])}
            </span>
            {err && (
              <p className="font-mono text-[10px] text-red-500 break-words mt-0.5">
                {err}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Modal de limpieza de histórico ──────────────────────────────────────────
function ClearModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (beforeDaysAgo: number | null) => {
    setBusy(true);
    setMsg(null);
    const before =
      beforeDaysAgo == null
        ? new Date().toISOString()
        : new Date(Date.now() - beforeDaysAgo * 24 * 60 * 60 * 1000).toISOString();
    const res = await clearIncidents(before);
    setBusy(false);
    if ('error' in res) {
      setMsg(res.error);
    } else {
      onDone();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
          Limpiar histórico
        </h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Borra incidentes <strong>resueltos</strong> anteriores al rango
          elegido. Los incidentes activos nunca se borran.
        </p>

        {msg && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{msg}</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <ClearBtn label="Más de 1 año" disabled={busy} onClick={() => run(365)} />
          <ClearBtn label="Más de 90 días" disabled={busy} onClick={() => run(90)} />
          <ClearBtn label="Más de 30 días" disabled={busy} onClick={() => run(30)} />
          <ClearBtn
            label="Borrar todos los resueltos"
            danger
            disabled={busy}
            onClick={() => run(null)}
          />
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full py-2 text-sm font-medium rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function ClearBtn({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`py-2 px-3 text-sm font-medium rounded-xl border transition-colors disabled:opacity-50 ${
        danger
          ? 'border-red-300 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
          : 'border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      {label}
    </button>
  );
}
