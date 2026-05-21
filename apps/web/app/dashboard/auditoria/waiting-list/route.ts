import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '../../../../lib/session';
import { prisma } from '../../../../lib/prisma';

// ════════════════════════════════════════════════════════════════
// GET /dashboard/auditoria/waiting-list
// Lista DETALLADA de pacientes en lista de espera (status WAITING),
// estrictamente acotada a la organización de la sesión.
// Soporta búsqueda (nombre o cédula) y paginación (page / pageSize).
// ════════════════════════════════════════════════════════════════

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const OVERDUE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

// Formatea un teléfono "573001234567" → "+57 300 123 4567" (best-effort, no rompe si no es CO)
function formatPhone(raw: string): string {
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length === 12 && digits.startsWith('57')) {
        const cc = digits.slice(0, 2);
        const a = digits.slice(2, 5);
        const b = digits.slice(5, 8);
        const c = digits.slice(8);
        return `+${cc} ${a} ${b} ${c}`;
    }
    return `+${digits}`;
}

// Convierte ms de espera a etiqueta legible: "3 d 4 h", "5 h 12 min", "8 min"
function formatWaitTime(ms: number): string {
    const totalMinutes = Math.max(0, Math.floor(ms / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `${days} d ${hours} h`;
    if (hours > 0) return `${hours} h ${minutes} min`;
    return `${minutes} min`;
}

export async function GET(req: NextRequest) {
    // ── 1. AUTORIZACIÓN + TENANT SCOPING (Nivel Banca) ───────────
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!session.organizationId || session.role !== 'ORG_ADMIN') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const organizationId = session.organizationId;

    // ── 2. PARÁMETROS (búsqueda + paginación) ────────────────────
    const { searchParams } = new URL(req.url);
    const search = (searchParams.get('search') || '').trim();

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const rawPageSize = parseInt(searchParams.get('pageSize') || `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawPageSize));
    const skip = (page - 1) * pageSize;

    // ── 3. FILTRO: SIEMPRE acotado a la org y status WAITING ─────
    // El scoping por organizationId es innegociable: previene cross-tenant leaks.
    const where = {
        organizationId,
        status: 'WAITING' as const,
        ...(search
            ? {
                  patient: {
                      OR: [
                          { fullName: { contains: search, mode: 'insensitive' as const } },
                          { cedula: { contains: search, mode: 'insensitive' as const } },
                      ],
                  },
              }
            : {}),
    };

    try {
        // ── 4. CONSULTA PAGINADA + CONTEO TOTAL (en paralelo) ────
        const [total, entries] = await Promise.all([
            prisma.waitlistEntry.count({ where }),
            prisma.waitlistEntry.findMany({
                where,
                include: {
                    patient: { select: { fullName: true, cedula: true, whatsappId: true } },
                    service: { select: { name: true } },
                    eps: { select: { name: true } },
                    preferredDoctor: { select: { fullName: true } },
                },
                orderBy: { createdAt: 'asc' }, // FIFO: el que más lleva esperando primero
                skip,
                take: pageSize,
            }),
        ]);

        const now = Date.now();

        // ── 5. "LUJO DE DETALLE": joins + cálculos del backend ───
        const items = entries.map((e) => {
            const phoneRaw = e.patient.whatsappId || e.whatsappId;
            const phoneDigits = (phoneRaw || '').replace(/[^0-9]/g, '');
            const waitMs = now - new Date(e.createdAt).getTime();
            const metadata = (e.metadata as { doctorName?: string } | null) || null;

            return {
                id: e.id,
                patientName: e.patient.fullName,
                cedula: e.patient.cedula,
                phone: phoneDigits,
                phoneDisplay: formatPhone(phoneDigits),
                whatsappLink: `https://wa.me/${phoneDigits}`,
                specialty: e.service?.name ?? '—',
                eps: e.eps?.name ?? null,
                // Médico preferido: campo real (relación) con fallback a metadata
                // para entradas antiguas creadas antes de la migración.
                preferredDoctor: e.preferredDoctor?.fullName ?? metadata?.doctorName ?? null,
                registeredAt: e.createdAt,
                waitMs,
                waitLabel: formatWaitTime(waitMs),
                isOverdue: waitMs >= OVERDUE_THRESHOLD_MS,
            };
        });

        return NextResponse.json({
            items,
            total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
        });
    } catch (error) {
        console.error('Error consultando lista de espera detallada:', error);
        return NextResponse.json({ error: 'Error de base de datos' }, { status: 500 });
    }
}
