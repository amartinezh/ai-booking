/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useMemo, useEffect } from 'react';
import WaitlistModal from './WaitlistModal';
import { formatAppointmentCompact, formatAppointmentShort } from '@/lib/date';

type InteractionLog = {
    id: string;
    whatsappId: string;
    status: string;
    failureReason: string | null;
    userMessage: string | null;
    botReply: string | null;
    metadata: any;
    createdAt: Date;
    patientId: string | null;
    // Campos opcionales agregados (ver back fix)
    contactedAt?: Date | null;
    contactedBy?: string | null;
    contactNotes?: string | null;
};

// ══════════════════════════════════════════════════════════════
// MAPEO DE RAZONES DE FALLO CON METADATA VISUAL Y DE NEGOCIO
// ══════════════════════════════════════════════════════════════
const FAILURE_META: Record<
    string,
    {
        label: string;
        icon: string;
        severity: 'critical' | 'warning' | 'info';
        actionable: boolean; // ¿Vale la pena llamar al paciente?
        description: string;
    }
> = {
    NO_AGENDA: {
        label: 'Sin agenda disponible',
        icon: '📅',
        severity: 'critical',
        actionable: true,
        description: 'El paciente buscó cita pero no había cupos. Posible cliente perdido.',
    },
    EPS_NOT_FOUND: {
        label: 'EPS no encontrada',
        icon: '🏥',
        severity: 'warning',
        actionable: true,
        description: 'La EPS que mencionó no está en el sistema. Posible nuevo convenio.',
    },
    EPS_INACTIVE: {
        label: 'EPS inactiva',
        icon: '⚠️',
        severity: 'warning',
        actionable: true,
        description: 'La EPS está suspendida. El paciente quería agendar pero no se pudo.',
    },
    DOCTOR_NOT_FOUND: {
        label: 'Médico no encontrado',
        icon: '👨‍⚕️',
        severity: 'warning',
        actionable: true,
        description: 'El paciente pidió un doctor que no existe en la base.',
    },
    UNINTELLIGIBLE_AUDIO: {
        label: 'Audio inentendible',
        icon: '🎙️',
        severity: 'info',
        actionable: false,
        description: 'No se pudo procesar el audio del paciente.',
    },
    GEMINI_DOWN: {
        label: 'IA caída',
        icon: '🤖',
        severity: 'critical',
        actionable: true,
        description: 'El servicio de IA falló. Revisar conexión.',
    },
    TOKEN_EXPIRED: {
        label: 'Token Meta expirado',
        icon: '🔑',
        severity: 'critical',
        actionable: false,
        description: 'Renueva el token de Meta inmediatamente.',
    },
    MAX_RETRIES: {
        label: 'Paciente abandonó',
        icon: '😞',
        severity: 'warning',
        actionable: true,
        description: 'El paciente intentó pero no logró agendar. Recuperar urgente.',
    },
    SLOT_TAKEN: {
        label: 'Cupo se ocupó',
        icon: '⏱️',
        severity: 'info',
        actionable: false,
        description: 'Otro paciente tomó el slot mientras este confirmaba.',
    },
    PATIENT_NOT_FOUND: {
        label: 'Paciente no registrado',
        icon: '❓',
        severity: 'info',
        actionable: false,
        description: 'Cédula no existe en sistema (intento de cancelación).',
    },
    NO_APPOINTMENTS_TO_CANCEL: {
        label: 'Sin citas para cancelar',
        icon: '🚫',
        severity: 'info',
        actionable: false,
        description: 'El paciente intentó cancelar pero no tiene citas.',
    },
    OUT_OF_CONTEXT: {
        label: 'Fuera de contexto',
        icon: '💭',
        severity: 'info',
        actionable: false,
        description: 'El paciente preguntó algo sin relación con citas.',
    },
    SESSION_EXPIRED: {
        label: 'Sesión expirada',
        icon: '⌛',
        severity: 'info',
        actionable: false,
        description: 'El paciente tardó demasiado en responder.',
    },
    CANCEL_ERROR: {
        label: 'Error al cancelar',
        icon: '❌',
        severity: 'critical',
        actionable: true,
        description: 'Falló la cancelación. Revisar manualmente.',
    },
    UNHANDLED_ERROR: {
        label: 'Error técnico',
        icon: '⚙️',
        severity: 'critical',
        actionable: true,
        description: 'Error no esperado. Revisar logs del servidor.',
    },
    ORG_INACTIVE: {
        label: 'Organización inactiva',
        icon: '🏢',
        severity: 'critical',
        actionable: false,
        description: 'La clínica está suspendida.',
    },
    META_API_ERROR: {
        label: 'Error de WhatsApp',
        icon: '📱',
        severity: 'critical',
        actionable: false,
        description: 'Falló el envío del mensaje a Meta.',
    },
};

const DEFAULT_META = {
    label: 'Otro',
    icon: '❔',
    severity: 'info' as const,
    actionable: false,
    description: 'Razón no clasificada.',
};

const getMeta = (reason: string | null) => FAILURE_META[reason || ''] || DEFAULT_META;

// ══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════════════
export default function AuditoriaClientView({
    logs: initialLogs,
    waitlistCount = 0,
    organizationName = 'nuestra clínica',
}: {
    logs: InteractionLog[];
    waitlistCount?: number;
    organizationName?: string;
}) {
    const [logs, setLogs] = useState(initialLogs);
    const [showWaitlist, setShowWaitlist] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedReason, setSelectedReason] = useState<string | null>(null);
    const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null);
    const [showOnlyActionable, setShowOnlyActionable] = useState(false);
    const [showOnlyPending, setShowOnlyPending] = useState(true); // No contactados aún
    const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'all'>('7d');
    const [sortBy, setSortBy] = useState<'recent' | 'oldest' | 'severity'>('recent');
    const [selectedLog, setSelectedLog] = useState<InteractionLog | null>(null);

    // ══════════════════════════════════════════════════════════
    // CÁLCULOS DE KPIs (memoizados)
    // ══════════════════════════════════════════════════════════
    const kpis = useMemo(() => {
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

        const last24h = logs.filter(l => new Date(l.createdAt).getTime() > oneDayAgo);
        const last7d = logs.filter(l => new Date(l.createdAt).getTime() > sevenDaysAgo);

        const actionableLast7d = last7d.filter(l => getMeta(l.failureReason).actionable);
        const pendingContact = actionableLast7d.filter(l => !l.contactedAt);

        // Top razón de fallo en últimos 7 días
        const reasonCounts: Record<string, number> = {};
        last7d.forEach(l => {
            const reason = l.failureReason || 'OTHER';
            reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        });
        const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];

        return {
            pendingContact: pendingContact.length,
            last24h: last24h.length,
            last7d: last7d.length,
            actionableLast7d: actionableLast7d.length,
            topReason: topReason ? { reason: topReason[0], count: topReason[1] } : null,
        };
    }, [logs]);

    // ══════════════════════════════════════════════════════════
    // BREAKDOWN POR ESPECIALIDAD (qué servicios buscan más)
    // ══════════════════════════════════════════════════════════
    const specialtyBreakdown = useMemo(() => {
        const map: Record<string, number> = {};
        logs
            .filter(l => l.failureReason === 'NO_AGENDA' && l.metadata?.specialty)
            .forEach(l => {
                const spec = l.metadata.specialty;
                map[spec] = (map[spec] || 0) + 1;
            });
        return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
    }, [logs]);

    // ══════════════════════════════════════════════════════════
    // FILTROS
    // ══════════════════════════════════════════════════════════
    const filteredLogs = useMemo(() => {
        const now = Date.now();
        const ranges = {
            today: 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000,
            all: Infinity,
        };
        const cutoff = now - ranges[dateRange];

        let result = logs.filter(log => {
            if (new Date(log.createdAt).getTime() < cutoff) return false;

            if (selectedReason && log.failureReason !== selectedReason) return false;
            if (selectedSeverity && getMeta(log.failureReason).severity !== selectedSeverity) return false;
            if (showOnlyActionable && !getMeta(log.failureReason).actionable) return false;
            if (showOnlyPending && log.contactedAt) return false;

            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                const inPhone = log.whatsappId.includes(searchTerm);
                const inMessage = log.userMessage?.toLowerCase().includes(term);
                const inReason = log.failureReason?.toLowerCase().includes(term);
                const inSpecialty = log.metadata?.specialty?.toLowerCase().includes(term);
                if (!inPhone && !inMessage && !inReason && !inSpecialty) return false;
            }

            return true;
        });

        // Ordenamiento
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        if (sortBy === 'recent') {
            result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        } else if (sortBy === 'oldest') {
            result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        } else if (sortBy === 'severity') {
            result.sort((a, b) => {
                const aSev = severityOrder[getMeta(a.failureReason).severity];
                const bSev = severityOrder[getMeta(b.failureReason).severity];
                if (aSev !== bSev) return aSev - bSev;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
        }

        return result;
    }, [logs, searchTerm, selectedReason, selectedSeverity, showOnlyActionable, showOnlyPending, dateRange, sortBy]);

    // ══════════════════════════════════════════════════════════
    // ACCIÓN: marcar como contactado
    // ══════════════════════════════════════════════════════════
    const markAsContacted = async (logId: string, notes?: string) => {
        try {
            const res = await fetch(`/api/auditoria/${logId}/contactar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: notes || '' }),
            });
            if (res.ok) {
                setLogs(prev =>
                    prev.map(l =>
                        l.id === logId
                            ? { ...l, contactedAt: new Date(), contactNotes: notes || l.contactNotes }
                            : l
                    )
                );
                setSelectedLog(null);
            }
        } catch (e) {
            console.error('Error marcando como contactado', e);
        }
    };

    // ══════════════════════════════════════════════════════════
    // RENDER
    // ══════════════════════════════════════════════════════════
    return (
        <div className="space-y-6">
            {/* HEADER */}
            <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900 dark:text-white mb-2 flex items-center gap-3">
                        <span>🕵️</span> Caja Negra — Recuperación de pacientes
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-base leading-relaxed max-w-2xl">
                        Pacientes que intentaron agendar y no lo lograron. Contactarlos manualmente para no perderlos.
                    </p>
                </div>
            </header>

            {/* KPIs PRINCIPALES */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {/* EN LISTA DE ESPERA — pacientes que pidieron cupo (WaitlistEntry) */}
                <div className="relative bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-900/40 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-base">📜</span>
                        <p className="text-xs font-semibold text-cyan-900 dark:text-cyan-300 uppercase tracking-wide">
                            En lista de espera
                        </p>
                    </div>
                    <div className="flex items-end justify-between gap-2">
                        <p className="text-3xl font-bold text-cyan-900 dark:text-cyan-200">
                            {waitlistCount}
                        </p>
                        <button
                            onClick={() => setShowWaitlist(true)}
                            title="Ver detalle de la cola de espera"
                            aria-label="Ver detalle de la cola de espera"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold shadow-sm transition-all"
                        >
                            <span>👁️</span> Ver detalle
                        </button>
                    </div>
                    <p className="text-xs text-cyan-700 dark:text-cyan-400 mt-1">
                        pendientes de cupo
                    </p>
                </div>

                {/* PENDIENTES DE CONTACTAR — el más importante */}
                <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-base">🚨</span>
                        <p className="text-xs font-semibold text-rose-900 dark:text-rose-300 uppercase tracking-wide">
                            Por contactar
                        </p>
                    </div>
                    <p className="text-3xl font-bold text-rose-900 dark:text-rose-200">
                        {kpis.pendingContact}
                    </p>
                    <p className="text-xs text-rose-700 dark:text-rose-400 mt-1">
                        últimos 7 días
                    </p>
                </div>

                {/* ÚLTIMAS 24H */}
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-base">⏰</span>
                        <p className="text-xs font-semibold text-amber-900 dark:text-amber-300 uppercase tracking-wide">
                            Últimas 24h
                        </p>
                    </div>
                    <p className="text-3xl font-bold text-amber-900 dark:text-amber-200">
                        {kpis.last24h}
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                        fallos detectados
                    </p>
                </div>

                {/* TOTALES SEMANA */}
                <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-base">📊</span>
                        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                            Esta semana
                        </p>
                    </div>
                    <p className="text-3xl font-bold text-zinc-900 dark:text-white">
                        {kpis.last7d}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        registros totales
                    </p>
                </div>

                {/* TOP RAZÓN */}
                <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/40 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-base">{kpis.topReason ? getMeta(kpis.topReason.reason).icon : '📈'}</span>
                        <p className="text-xs font-semibold text-indigo-900 dark:text-indigo-300 uppercase tracking-wide">
                            Causa principal
                        </p>
                    </div>
                    <p className="text-base font-bold text-indigo-900 dark:text-indigo-200 leading-tight">
                        {kpis.topReason ? getMeta(kpis.topReason.reason).label : 'Sin datos'}
                    </p>
                    <p className="text-xs text-indigo-700 dark:text-indigo-400 mt-1">
                        {kpis.topReason ? `${kpis.topReason.count} casos esta semana` : '—'}
                    </p>
                </div>
            </div>

            {/* DEMANDA INSATISFECHA POR ESPECIALIDAD */}
            {specialtyBreakdown.length > 0 && (
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2">
                        <span>📈</span> Especialidades con más demanda insatisfecha
                    </h3>
                    <div className="space-y-2">
                        {specialtyBreakdown.map(([spec, count]) => {
                            const max = specialtyBreakdown[0][1];
                            const pct = (count / max) * 100;
                            return (
                                <div key={spec} className="flex items-center gap-3">
                                    <span className="text-sm text-zinc-700 dark:text-zinc-300 w-40 truncate font-medium">
                                        {spec}
                                    </span>
                                    <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
                                        <div
                                            className="bg-gradient-to-r from-rose-500 to-rose-600 h-full rounded-full transition-all duration-500"
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                    <span className="text-sm font-bold text-zinc-900 dark:text-white w-10 text-right">
                                        {count}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-3">
                        💡 Considere abrir más cupos o nuevas franjas para estas especialidades.
                    </p>
                </div>
            )}

            {/* BARRA DE FILTROS */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
                {/* Búsqueda + ordenamiento */}
                <div className="flex flex-col md:flex-row gap-3">
                    <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">🔍</span>
                        <input
                            type="text"
                            placeholder="Buscar por teléfono, mensaje, razón o especialidad..."
                            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="px-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="recent">Más recientes</option>
                        <option value="oldest">Más antiguos</option>
                        <option value="severity">Por urgencia</option>
                    </select>

                    <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value as any)}
                        className="px-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="today">Últimas 24h</option>
                        <option value="7d">Últimos 7 días</option>
                        <option value="30d">Últimos 30 días</option>
                        <option value="all">Todo el tiempo</option>
                    </select>
                </div>

                {/* Toggles rápidos */}
                <div className="flex flex-wrap gap-2 items-center">
                    <button
                        onClick={() => setShowOnlyPending(!showOnlyPending)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${showOnlyPending
                                ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800'
                                : 'bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
                            }`}
                    >
                        {showOnlyPending ? '✓ ' : ''}Solo pendientes
                    </button>

                    <button
                        onClick={() => setShowOnlyActionable(!showOnlyActionable)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${showOnlyActionable
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800'
                                : 'bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
                            }`}
                    >
                        {showOnlyActionable ? '✓ ' : ''}Solo recuperables
                    </button>

                    {/* Severidad chips */}
                    <div className="flex gap-1 ml-2">
                        {(['critical', 'warning', 'info'] as const).map(sev => (
                            <button
                                key={sev}
                                onClick={() => setSelectedSeverity(selectedSeverity === sev ? null : sev)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${selectedSeverity === sev
                                        ? sev === 'critical'
                                            ? 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800'
                                            : sev === 'warning'
                                                ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800'
                                                : 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800'
                                        : 'bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
                                    }`}
                            >
                                {sev === 'critical' ? '🔴 Crítico' : sev === 'warning' ? '🟡 Atención' : '🔵 Info'}
                            </button>
                        ))}
                    </div>

                    {/* Limpiar todo */}
                    {(selectedReason || selectedSeverity || searchTerm || showOnlyActionable) && (
                        <button
                            onClick={() => {
                                setSelectedReason(null);
                                setSelectedSeverity(null);
                                setSearchTerm('');
                                setShowOnlyActionable(false);
                            }}
                            className="ml-auto text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-white underline"
                        >
                            Limpiar filtros
                        </button>
                    )}

                    <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
                        Mostrando <strong className="text-zinc-900 dark:text-white">{filteredLogs.length}</strong> de {logs.length}
                    </span>
                </div>
            </div>

            {/* LISTA DE TARJETAS */}
            <div className="space-y-3">
                {filteredLogs.length === 0 ? (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
                        <p className="text-4xl mb-2">🎉</p>
                        <p className="text-zinc-700 dark:text-zinc-300 font-medium mb-1">
                            No hay registros para los filtros aplicados
                        </p>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            {showOnlyPending
                                ? 'Todos los pacientes han sido contactados.'
                                : 'Pruebe ampliar el rango de fechas o cambiar los filtros.'}
                        </p>
                    </div>
                ) : (
                    filteredLogs.map(log => {
                        const meta = getMeta(log.failureReason);
                        const severityStyles = {
                            critical: 'border-l-rose-500 bg-rose-50/30 dark:bg-rose-950/10',
                            warning: 'border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/10',
                            info: 'border-l-sky-500 bg-sky-50/30 dark:bg-sky-950/10',
                        };
                        const isContacted = !!log.contactedAt;

                        return (
                            <div
                                key={log.id}
                                className={`bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 border-l-4 ${severityStyles[meta.severity]
                                    } ${isContacted ? 'opacity-60' : ''} p-4 hover:shadow-md transition-all`}
                            >
                                <div className="flex flex-col md:flex-row md:items-start gap-4">
                                    {/* Info principal */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 mb-2">
                                            <span className="text-xl">{meta.icon}</span>
                                            <span
                                                className={`px-2.5 py-0.5 rounded-md text-xs font-semibold ${meta.severity === 'critical'
                                                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'
                                                        : meta.severity === 'warning'
                                                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                                                            : 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
                                                    }`}
                                            >
                                                {meta.label}
                                            </span>

                                            {meta.actionable && !isContacted && (
                                                <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                                                    ⚡ Recuperable
                                                </span>
                                            )}

                                            {isContacted && (
                                                <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                                                    ✓ Contactado
                                                </span>
                                            )}

                                            <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-auto">
                                                {formatAppointmentCompact(log.createdAt)}
                                            </span>
                                        </div>

                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 italic mb-2">
                                            {meta.description}
                                        </p>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                            <div>
                                                <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide font-medium mb-0.5">
                                                    📞 Teléfono
                                                </p>
                                                <p className="font-mono font-semibold text-zinc-900 dark:text-white">
                                                    +{log.whatsappId}
                                                </p>
                                            </div>

                                            {log.metadata?.specialty && (
                                                <div>
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide font-medium mb-0.5">
                                                        🏥 Buscaba
                                                    </p>
                                                    <p className="font-semibold text-zinc-900 dark:text-white truncate">
                                                        {log.metadata.specialty}
                                                        {log.metadata.eps && (
                                                            <span className="text-zinc-500 dark:text-zinc-400 font-normal">
                                                                {' '}· {log.metadata.eps}
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        {log.userMessage && (
                                            <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-0.5">Última frase del paciente:</p>
                                                <p className="text-sm text-zinc-700 dark:text-zinc-300 italic line-clamp-1">
                                                    &ldquo;{log.userMessage}&rdquo;
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Acciones */}
                                    <div className="flex md:flex-col gap-2 md:w-48 shrink-0">
                                        <a
                                            href={`https://wa.me/${log.whatsappId.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                                                `Hola, le escribimos de ${organizationName}. Vimos que intentó agendar una cita y queremos ayudarle a completarla. ¿Le puedo asistir?`
                                            )}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-all"
                                        >
                                            <span>💬</span> WhatsApp
                                        </a>

                                        <button
                                            onClick={() => setSelectedLog(log)}
                                            className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-all"
                                        >
                                            Ver detalle
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* MODAL DE LISTA DE ESPERA (lujo de detalle) */}
            {showWaitlist && (
                <WaitlistModal organizationName={organizationName} onClose={() => setShowWaitlist(false)} />
            )}

            {/* MODAL DE DETALLE */}
            {selectedLog && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                    onClick={() => setSelectedLog(null)}
                >
                    <div
                        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 p-5 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                <span>{getMeta(selectedLog.failureReason).icon}</span>
                                Detalle del registro
                            </h2>
                            <button
                                onClick={() => setSelectedLog(null)}
                                className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white text-2xl leading-none"
                            >
                                ×
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide font-medium mb-1">
                                        Razón del fallo
                                    </p>
                                    <p className="font-mono text-zinc-900 dark:text-white">
                                        {selectedLog.failureReason || 'N/A'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide font-medium mb-1">
                                        Fecha completa
                                    </p>
                                    <p className="text-zinc-900 dark:text-white">
                                        {formatAppointmentShort(selectedLog.createdAt)}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide font-medium mb-1">
                                        Teléfono
                                    </p>
                                    <p className="font-mono text-zinc-900 dark:text-white">+{selectedLog.whatsappId}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide font-medium mb-1">
                                        Estado
                                    </p>
                                    <p className="text-zinc-900 dark:text-white">{selectedLog.status}</p>
                                </div>
                            </div>

                            {selectedLog.userMessage && (
                                <div>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide font-medium mb-1">
                                        Mensaje del paciente
                                    </p>
                                    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3 text-sm text-zinc-800 dark:text-zinc-200">
                                        {selectedLog.userMessage}
                                    </div>
                                </div>
                            )}

                            {selectedLog.botReply && (
                                <div>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide font-medium mb-1">
                                        Respuesta del bot
                                    </p>
                                    <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-3 text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                                        {selectedLog.botReply}
                                    </div>
                                </div>
                            )}

                            {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                                <div>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide font-medium mb-1">
                                        Metadata técnica
                                    </p>
                                    <pre className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3 text-xs text-zinc-700 dark:text-zinc-300 overflow-x-auto">
                                        {JSON.stringify(selectedLog.metadata, null, 2)}
                                    </pre>
                                </div>
                            )}

                            {/* Sección de seguimiento */}
                            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide font-medium mb-2">
                                    Seguimiento
                                </p>
                                {selectedLog.contactedAt ? (
                                    <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 border border-emerald-200 dark:border-emerald-900">
                                        <p className="text-sm text-emerald-900 dark:text-emerald-200 font-medium">
                                            ✓ Contactado el {formatAppointmentShort(selectedLog.contactedAt)}
                                        </p>
                                        {selectedLog.contactNotes && (
                                            <p className="text-sm text-emerald-800 dark:text-emerald-300 mt-2">
                                                Notas: {selectedLog.contactNotes}
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    <ContactForm
                                        onConfirm={(notes) => markAsContacted(selectedLog.id, notes)}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="sticky bottom-0 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 p-4 flex gap-2">
                            <a
                                href={`https://wa.me/${selectedLog.whatsappId.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                                    `Hola, le escribimos de ${organizationName}. Vimos que intentó agendar una cita y queremos ayudarle a completarla.`
                                )}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-all"
                            >
                                <span>💬</span> Abrir WhatsApp
                            </a>
                            <button
                                onClick={() => setSelectedLog(null)}
                                className="px-4 py-2.5 font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-all"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════
// FORM PARA REGISTRAR CONTACTO (sub-componente)
// ══════════════════════════════════════════════════════════════
function ContactForm({ onConfirm }: { onConfirm: (notes: string) => void }) {
    const [notes, setNotes] = useState('');
    const [showForm, setShowForm] = useState(false);

    if (!showForm) {
        return (
            <button
                onClick={() => setShowForm(true)}
                className="w-full px-4 py-2.5 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-all"
            >
                ✓ Marcar como contactado
            </button>
        );
    }

    return (
        <div className="space-y-2">
            <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="¿Qué resultado tuvo el contacto? (opcional)"
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex gap-2">
                <button
                    onClick={() => onConfirm(notes)}
                    className="flex-1 px-3 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-all"
                >
                    Confirmar contacto
                </button>
                <button
                    onClick={() => {
                        setShowForm(false);
                        setNotes('');
                    }}
                    className="px-3 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-all"
                >
                    Cancelar
                </button>
            </div>
        </div>
    );
}