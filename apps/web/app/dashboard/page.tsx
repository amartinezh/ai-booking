import { prisma } from '@/lib/prisma';
import { Prisma } from '@agenia/database';
import { getSession } from '@/lib/session';
import { getTenantMirrorFlags } from '@/lib/mirror-flags';
import { pendientesParaMenu } from '@/lib/bandeja/pendientes';
import { solicitudesCitasPendientes } from '@/lib/limite-citas/acceso';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import DashboardClient from './components/DashboardClient';
import PageSkeleton from './components/PageSkeleton';
import QuickAccessGrid from './components/QuickAccessGrid';
import { SELECT_CITA_INICIO, TOPE_CITAS_INICIO, ventanaDeCitas } from '@/lib/dashboard/citas-inicio';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
    searchParams
}: {
    searchParams: Promise<{ eps?: string, doctor?: string, startDate?: string, endDate?: string }>
}) {
    const session = await getSession();
    if (!session) redirect('/login');

    const resolvedParams = await searchParams;

    // Filtros
    const epsFilter = resolvedParams.eps;
    const doctorFilter = resolvedParams.doctor;
    const startDateFilter = resolvedParams.startDate;
    const endDateFilter = resolvedParams.endDate;

    // SUPER_ADMIN no tiene tenant: sin filtro ve la plataforma completa.
    // Los roles clínicos siempre traen organizationId en el token.
    const whereClause: Prisma.AppointmentWhereInput = { organizationId: session.organizationId ?? undefined };
    const slotWhere: Prisma.ScheduleSlotWhereInput = {};

    if (session.role === 'PATIENT') {
        const profile = await prisma.patientProfile.findUnique({ where: { userId: session.userId } });
        if (profile) whereClause.patientId = profile.id;
    } else if (session.role === 'DOCTOR') {
        const dProfile = await prisma.doctorProfile.findUnique({ where: { userId: session.userId } });
        if (dProfile) slotWhere.doctorId = dProfile.id;
        if (epsFilter) whereClause.epsId = epsFilter;
    } else if (session.role === 'BOOKING_AGENT') {
        const aProfile = await prisma.agentProfile.findUnique({ where: { userId: session.userId } });
        const finalEpsId = aProfile?.epsId || epsFilter;
        if (finalEpsId) whereClause.epsId = finalEpsId;
        const finalDocId = aProfile?.doctorId || doctorFilter;
        if (finalDocId) slotWhere.doctorId = finalDocId;
    } else {
        // ADMIN filters
        if (epsFilter) whereClause.epsId = epsFilter;
        if (doctorFilter) slotWhere.doctorId = doctorFilter;
    }

    // Sin fecha inicial, desde hoy; y nunca más de TOPE_CITAS_INICIO filas
    // (lib/dashboard/citas-inicio.ts: antes traía todas, 12,5 MB).
    const ventana = ventanaDeCitas({ startDate: startDateFilter, endDate: endDateFilter });
    if (ventana.gte || ventana.lte) {
        slotWhere.startTime = { ...(ventana.gte && { gte: ventana.gte }), ...(ventana.lte && { lte: ventana.lte }) };
    }

    if (Object.keys(slotWhere).length > 0) {
        whereClause.scheduleSlot = slotWhere;
    }

    // Las tarjetas de espejo/avisos solo se ofrecen a las clínicas que las tienen.
    const { conEspejo, conAvisos, conAvisosDriver } = await getTenantMirrorFlags(session.organizationId);
    const pendientesBandeja = await pendientesParaMenu(prisma, session, conEspejo);
    const pendientesSolicitudesCitas = await solicitudesCitasPendientes(prisma, session);

    // Se pide una de más para saber si quedaron citas por fuera del tope.
    const encontradas = await prisma.appointment.findMany({
        where: whereClause,
        select: SELECT_CITA_INICIO,
        orderBy: [{ scheduleSlot: { startTime: 'asc' } }, { id: 'asc' }],
        take: TOPE_CITAS_INICIO + 1,
    });
    const hayMas = encontradas.length > TOPE_CITAS_INICIO;
    const appointments = hayMas ? encontradas.slice(0, TOPE_CITAS_INICIO) : encontradas;

    // Catálogos para Filtros
    let epsList: { id: string, name: string }[] = [];
    let doctorsList: { id: string, fullName: string }[] = [];

    if (session.organizationId && (session.role === 'ORG_ADMIN' || session.role === 'DOCTOR' || session.role === 'BOOKING_AGENT')) {
        epsList = await prisma.eps.findMany({ where: { organizationId: session.organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    }
    if (session.organizationId && (session.role === 'ORG_ADMIN' || session.role === 'BOOKING_AGENT')) {
        doctorsList = await prisma.doctorProfile.findMany({ where: { organizationId: session.organizationId }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
    }

    const greetingMap: Record<string, string> = {
        'PATIENT': '¡Hola! Aquí puedes ver el listado de tus próximas citas médicas programadas y su estado.',
        'DOCTOR': '¡Bienvenido, Doctor! Conozca el flujo de atención para el día de hoy.',
        'ORG_ADMIN': 'Panel Central HIS. Monitoreo, Búsqueda y Liberación de Agendas Clínicas.',
        'BOOKING_AGENT': 'Panel de Gestión de Reservas. Atención prioritaria de Citas y control Omnicanal.',
        'GENERAL_OBSERVER': 'Panel de Inteligencia de Negocios. Visualización y monitoreo de analíticas en tiempo real.'
    };
    
    const greeting = greetingMap[session.role as string] || '';

    return (
        <div className="max-w-7xl mx-auto animate-fade-in">
            <header className="mb-8">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    {session.role === 'PATIENT' ? 'Mis Citas Programadas' : session.role === 'DOCTOR' ? 'Mi Agenda de Pacientes' : 'Visor Avanzado y Operaciones'}
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">{greeting}</p>
            </header>

            {/* Accesos rápidos: iconos a las opciones del menú, según el rol. */}
            <QuickAccessGrid role={session.role} conEspejo={conEspejo} conAvisos={conAvisos} conAvisosDriver={conAvisosDriver} pendientesBandeja={pendientesBandeja} pendientesSolicitudesCitas={pendientesSolicitudesCitas} />

            <Suspense fallback={<PageSkeleton />}>
                <DashboardClient
                    appointments={appointments}
                    epsList={epsList}
                    doctorsList={doctorsList}
                    role={session.role}
                    desdeHoy={ventana.desdeHoy}
                    hayMas={hayMas}
                    tope={TOPE_CITAS_INICIO}
                />
            </Suspense>
        </div>
    );
}