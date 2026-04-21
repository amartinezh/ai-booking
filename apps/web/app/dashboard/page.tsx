import { prisma } from '@/lib/prisma';
import { Prisma } from '@antigravity/database';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import DashboardClient from './components/DashboardClient';

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

    const whereClause: Prisma.AppointmentWhereInput = { organizationId: session.organizationId };
    const slotWhere: any = {};

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

    if (startDateFilter || endDateFilter) {
        const timeConditions: any = {};
        if (startDateFilter) {
            timeConditions.gte = new Date(`${startDateFilter}T05:00:00.000Z`);
        }
        if (endDateFilter) {
            timeConditions.lte = new Date(new Date(`${endDateFilter}T05:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000 - 1);
        }
        slotWhere.startTime = timeConditions;
    }

    if (Object.keys(slotWhere).length > 0) {
        whereClause.scheduleSlot = slotWhere;
    }

    const appointments = await prisma.appointment.findMany({
        where: whereClause,
        include: {
            patient: { include: { user: true } },
            scheduleSlot: { include: { doctor: true, service: true } },
            eps: true,
            clinicalRecord: { select: { id: true, status: true } }
        },
        orderBy: { scheduleSlot: { startTime: 'asc' } }
    });

    // Catálogos para Filtros
    let epsList: any[] = [];
    let doctorsList: any[] = [];

    if (session.role === 'ORG_ADMIN' || session.role === 'DOCTOR' || session.role === 'BOOKING_AGENT') {
        epsList = await prisma.eps.findMany({ where: { organizationId: session.organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    }
    if (session.role === 'ORG_ADMIN' || session.role === 'BOOKING_AGENT') {
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

            <DashboardClient
                appointments={appointments}
                epsList={epsList}
                doctorsList={doctorsList}
                role={session.role}
            />
        </div>
    );
}