// apps/web/app/dashboard/page.tsx
import { prisma } from '../../lib/prisma';

// Forzamos a Next.js a no cachear esta página (queremos ver citas en tiempo real)
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    // 1. Lógica de Negocio (Server-side)
    // Consultamos Postgres. Ordenamos para que las citas más próximas salgan primero.
    const appointments = await prisma.appointment.findMany({
        orderBy: { date: 'asc' },
        include: {
            user: true, // Hacemos un JOIN para traer los datos del paciente (CC/WhatsApp)
        },
    });

    // 2. Renderizado de la Vista (Client-side HTML)
    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">Hospital San Vicente</h1>
                    <p className="text-gray-500 mt-2">Panel de Control de Agendamiento Automático</p>
                </header>

                {/* Tarjeta de la Tabla */}
                <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Fecha y Hora
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Paciente (CC/Teléfono)
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Especialidad
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Estado
                                </th>
                                {/* 🛑 NUEVA COLUMNA: ORIGEN DE LA CITA */}
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Origen
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {appointments.length === 0 ? (
                                <tr>
                                    {/* 🛑 Ajustamos el colSpan a 5 para cubrir la nueva columna */}
                                    <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                                        No hay citas agendadas aún.
                                    </td>
                                </tr>
                            ) : (
                                appointments.map((apt) => (
                                    <tr key={apt.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">
                                                {apt.date.toLocaleDateString('es-CO')}
                                            </div>
                                            <div className="text-sm text-gray-500">
                                                {apt.date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">
                                                {/* Si tuviéramos el nombre real lo pondríamos aquí. Por ahora mostramos el ID de WhatsApp */}
                                                Usuario ID: {apt.userId.slice(0, 8)}...
                                            </div>
                                            <div className="text-sm text-gray-500">
                                                {apt.user?.whatsappId || 'Sin teléfono'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                                {apt.specialty}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${apt.status === 'SCHEDULED' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                {apt.status}
                                            </span>
                                        </td>
                                        {/* 🛑 NUEVO DATO: INDICADOR VISUAL (IA VS CHAT) */}
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {apt.bookedViaAi ? (
                                                <span className="px-3 py-1 inline-flex items-center gap-1.5 text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                                                    🤖 IA / Voz
                                                </span>
                                            ) : (
                                                <span className="px-3 py-1 inline-flex items-center gap-1.5 text-xs leading-5 font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                    💬 Chat
                                                </span>
                                            )}
                                        </td>
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