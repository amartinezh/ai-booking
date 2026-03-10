import { prisma } from '@/lib/prisma';
import { Prisma } from '@antigravity/database';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import DashboardClient from './components/DashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
    searchParams
}: {
    searchParams: Promise<{ eps?: string, doctor?: string }>
}) {
    const session = await getSession();
    if (!session) redirect('/login');

    const resolvedParams = await searchParams;

    // Filtros
    const epsFilter = resolvedParams.eps;
    const doctorFilter = resolvedParams.doctor;

    const whereClause: Prisma.AppointmentWhereInput = {};

    if (session.role === 'PATIENT') {
        const profile = await prisma.patientProfile.findUnique({ where: { userId: session.userId } });
        if (profile) whereClause.patientId = profile.id;
    } else if (session.role === 'DOCTOR') {
        const dProfile = await prisma.doctorProfile.findUnique({ where: { userId: session.userId } });
        if (dProfile) whereClause.scheduleSlot = { doctorId: dProfile.id };

        // El doctor puede filtrar por EPS de sus pacientes
        if (epsFilter) whereClause.epsId = epsFilter;
    } else {
        // ADMIN filters
        if (epsFilter) whereClause.epsId = epsFilter;
        if (doctorFilter) whereClause.scheduleSlot = { doctorId: doctorFilter };
    }

    const appointments = await prisma.appointment.findMany({
        where: whereClause,
        include: {
            patient: { include: { user: true } },
            scheduleSlot: { include: { doctor: true, service: true } },
            eps: true
        },
        orderBy: { scheduleSlot: { startTime: 'asc' } }
    });

    // Catálogos para Filtros
    let epsList: any[] = [];
    let doctorsList: any[] = [];

    if (session.role === 'ADMIN' || session.role === 'DOCTOR') {
        epsList = await prisma.eps.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
    }
    if (session.role === 'ADMIN') {
        doctorsList = await prisma.doctorProfile.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
    }

    const greeting = {
        'PATIENT': '¡Hola! Aquí puedes ver el listado de tus próximas citas médicas programadas y su estado.',
        'DOCTOR': '¡Bienvenido, Doctor! Conozca el flujo de atención para el día de hoy.',
        'ADMIN': 'Panel Central HIS. Monitoreo, Búsqueda y Liberación de Agendas Clínicas.'
    }[session.role];

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