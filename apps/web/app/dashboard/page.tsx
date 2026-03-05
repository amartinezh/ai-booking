import { prisma } from '../../lib/prisma';
import { Prisma } from '@antigravity/database';
import { getSession } from '../../lib/session';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    const session = await getSession();
    if (!session) redirect('/login');

    // 1. Lógica de negocio dinámica según el ROL
    type AppointmentWithRelations = Prisma.AppointmentGetPayload<{ include: { patient: { include: { user: true } }, doctor: true } }>;
    let appointments: AppointmentWithRelations[] = [];

    if (session.role === 'ADMIN') {
        appointments = await prisma.appointment.findMany({
            orderBy: { date: 'asc' },
            include: { patient: { include: { user: true } }, doctor: true },
        });
    } else if (session.role === 'PATIENT') {
        const profile = await prisma.patientProfile.findUnique({ where: { userId: session.userId } });
        if (profile) {
            appointments = await prisma.appointment.findMany({
                where: { patientId: profile.id },
                orderBy: { date: 'asc' },
                include: { patient: { include: { user: true } }, doctor: true },
            });
        }
    } else if (session.role === 'DOCTOR') {
        const dProfile = await prisma.doctorProfile.findUnique({ where: { userId: session.userId } });
        if (dProfile) {
            appointments = await prisma.appointment.findMany({
                where: { doctorId: dProfile.id },
                orderBy: { date: 'asc' },
                include: { patient: { include: { user: true } }, doctor: true },
            });
        }
    }

    const greeting = {
        'PATIENT': '¡Hola! Aquí puedes ver el listado de tus próximas citas médicas programadas y su estado.',
        'DOCTOR': '¡Bienvenido, Doctor! Conozca el flujo de atención para el día de hoy.',
        'ADMIN': 'Panel de Control Central. Gestione y audite el tráfico completo de agendamiento.'
    }[session.role];

    return (
        <div className="max-w-7xl mx-auto animate-fade-in">
            <header className="mb-10">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    {session.role === 'PATIENT' ? 'Mis Citas Programadas' : session.role === 'DOCTOR' ? 'Mi Agenda de Turnos' : 'Visión General del Sistema'}
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">{greeting}</p>
            </header>

            <div className="bg-white dark:bg-zinc-900 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
                        <thead className="bg-zinc-50/50 dark:bg-zinc-800/20">
                            <tr>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Fecha y Hora</th>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Especialidad</th>
                                {session.role !== 'PATIENT' && (
                                    <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Paciente</th>
                                )}
                                {session.role !== 'DOCTOR' && (
                                    <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Médico</th>
                                )}
                                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Estado</th>
                                {(session.role === 'ADMIN' || session.role === 'DOCTOR') && (
                                    <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Origen AI</th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
                            {appointments.length === 0 ? (
                                <tr>
                                    <td colSpan={session.role === 'ADMIN' ? 6 : 5} className="px-6 py-12 text-center text-zinc-500 dark:text-zinc-400 flex flex-col items-center justify-center">
                                        <span className="text-4xl mb-3">📭</span>
                                        No hay citas registradas en este momento.
                                    </td>
                                </tr>
                            ) : (
                                appointments.map((apt) => (
                                    <tr key={apt.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                                        <td className="px-6 py-5 whitespace-nowrap">
                                            <div className="font-semibold text-zinc-900 dark:text-white">
                                                {apt.date.toLocaleDateString('es-CO')}
                                            </div>
                                            <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                                                {apt.date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5 whitespace-nowrap">
                                            <span className="px-4 py-1.5 inline-flex text-xs font-bold rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">
                                                {apt.specialty}
                                            </span>
                                        </td>

                                        {/* Columna Paciente (Oculta para PACIENT) */}
                                        {session.role !== 'PATIENT' && (
                                            <td className="px-6 py-5 whitespace-nowrap">
                                                <div className="text-sm font-bold text-zinc-900 dark:text-white">
                                                    {apt.patient.fullName}
                                                </div>
                                                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                                    CC: {apt.patient.cedula}
                                                </div>
                                            </td>
                                        )}

                                        {/* Columna Doctor (Oculta para DOCTOR) */}
                                        {session.role !== 'DOCTOR' && (
                                            <td className="px-6 py-5 whitespace-nowrap">
                                                {apt.doctor ? (
                                                    <div>
                                                        <div className="text-sm font-bold text-zinc-900 dark:text-white">
                                                            {apt.doctor.fullName}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-zinc-400 italic">Por asignar</span>
                                                )}
                                            </td>
                                        )}


                                        <td className="px-6 py-5 whitespace-nowrap">
                                            <span className={`px-4 py-1.5 inline-flex text-xs font-bold rounded-full border ${apt.status === 'SCHEDULED'
                                                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40'
                                                : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
                                                }`}>
                                                {apt.status}
                                            </span>
                                        </td>
                                        {(session.role === 'ADMIN' || session.role === 'DOCTOR') && (
                                            <td className="px-6 py-5 whitespace-nowrap">
                                                {apt.bookedViaAi ? (
                                                    <span className="px-3 py-1 inline-flex items-center gap-1.5 text-xs font-bold rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/40">
                                                        🤖 Voz/IA
                                                    </span>
                                                ) : (
                                                    <span className="px-3 py-1 inline-flex items-center gap-1.5 text-xs font-bold rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40">
                                                        💬 Chat
                                                    </span>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}