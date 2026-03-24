import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';
import CalendarClient from './client';

export const dynamic = 'force-dynamic';

export default async function AgendamientoPage({
    searchParams
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const session = await getSession();

    // Permissions: Admins, Doctors, and Booking Agents
    if (!session || (session.role !== 'ORG_ADMIN' && session.role !== 'DOCTOR' && session.role !== 'BOOKING_AGENT')) {
        redirect('/dashboard');
    }

    // Agent Scope logic (if BOOKING_AGENT, limit what they can see)
    let agentEpsId = undefined;
    let agentDoctorId = undefined;
    
    if (session.role === 'BOOKING_AGENT') {
        const agentProfile = await prisma.agentProfile.findUnique({ where: { userId: session.userId } });
        agentEpsId = agentProfile?.epsId || undefined;
        agentDoctorId = agentProfile?.doctorId || undefined;
    } else if (session.role === 'DOCTOR') {
        const doctorProfile = await prisma.doctorProfile.findUnique({ where: { userId: session.userId } });
        agentDoctorId = doctorProfile?.id || undefined;
    }

    // Wait for searchParams (Next 15+ promise behavior)
    const resolvedParams = await searchParams;

    // Extract filters from URL
    const qsSearch = typeof resolvedParams.search === 'string' ? resolvedParams.search : undefined;
    const qsEps = typeof resolvedParams.epsId === 'string' ? resolvedParams.epsId : undefined;
    const qsDoctor = typeof resolvedParams.doctorId === 'string' ? resolvedParams.doctorId : undefined;
    const qsService = typeof resolvedParams.serviceId === 'string' ? resolvedParams.serviceId : undefined;

    // Prisma WHERE clause construction
    const whereClause: any = { organizationId: session.organizationId };
    const slotWhere: any = {};

    // 1. Omnibox Search (Patient cedula, fullName. Also checking reason)
    if (qsSearch) {
        whereClause.OR = [
            { patient: { fullName: { contains: qsSearch, mode: 'insensitive' } } },
            { patient: { cedula: { contains: qsSearch } } },
            { reason: { contains: qsSearch, mode: 'insensitive' } },
        ];
    }

    // 2. Exact Filters (UI sidebar) + Scopes
    const finalEpsId = session.role === 'BOOKING_AGENT' && agentEpsId ? agentEpsId : qsEps;
    if (finalEpsId) {
        whereClause.epsId = finalEpsId;
    }

    const finalDoctorId = (session.role === 'BOOKING_AGENT' || session.role === 'DOCTOR') && agentDoctorId ? agentDoctorId : qsDoctor;
    if (finalDoctorId) {
        slotWhere.doctorId = finalDoctorId;
    }

    if (qsService) {
        slotWhere.serviceId = qsService;
    }

    if (Object.keys(slotWhere).length > 0) {
        whereClause.scheduleSlot = { ...slotWhere };
    }

    // Fetch Appointments for Calendar Events
    const appointments = await prisma.appointment.findMany({
        where: whereClause,
        include: {
            scheduleSlot: {
                include: { doctor: true, service: true }
            },
            patient: true,
            eps: true
        },
        orderBy: { scheduleSlot: { startTime: 'asc' } }
    });

    // Fetch Lookups for filter selectors
    const epsList = await prisma.eps.findMany({ where: { organizationId: session.organizationId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const servicesList = await prisma.medicalService.findMany({ where: { organizationId: session.organizationId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const doctorList = session.role === 'DOCTOR' 
      ? await prisma.doctorProfile.findMany({ where: { id: agentDoctorId, organizationId: session.organizationId }, select: { id: true, fullName: true, cedula: true, serviceId: true } })
      : await prisma.doctorProfile.findMany({ where: { organizationId: session.organizationId }, select: { id: true, fullName: true, cedula: true, serviceId: true }, orderBy: { fullName: 'asc' } });

    return (
        <CalendarClient
            appointments={appointments}
            epsList={epsList}
            doctorList={doctorList}
            servicesList={servicesList}
            role={session.role}
        />
    );
}
