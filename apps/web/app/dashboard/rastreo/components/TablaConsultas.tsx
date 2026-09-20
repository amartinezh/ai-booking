import Link from 'next/link';
import { formatAppointmentShort } from '@/lib/date';
import type { ListaConsultas } from '@/lib/rastreo/tipos';

const TIPO: Record<string, string> = {
    CEDULA: 'Búsqueda por cédula',
    PHONE: 'Búsqueda por teléfono',
    BSUID: 'Búsqueda por BSUID',
    NAME: 'Búsqueda por nombre',
    OPEN: 'Expediente abierto',
    REVEAL: 'Datos completos mostrados',
};
const MOTIVO: Record<string, string> = {
    PACIENTE_EN_VENTANILLA: 'Paciente en ventanilla',
    RECLAMO_PQRS: 'Reclamo o PQRS',
    SOPORTE_TECNICO: 'Soporte técnico',
    OTRO: 'Otro',
};
const ROL: Record<string, string> = {
    ORG_ADMIN: 'Administrador',
    BOOKING_AGENT: 'Agente',
    DOCTOR: 'Médico',
    SUPER_ADMIN: 'Súper admin',
};

/**
 * La bitácora de consultas (§6, punto 2): quién consultó a quién, cuándo y por
 * qué. Sin esta vista el registro no lo lee nadie. Nunca hay datos completos
 * aquí: la búsqueda va enmascarada desde que se guarda.
 */
export default function TablaConsultas({ lista, hrefBase }: { lista: ListaConsultas; hrefBase: string }) {
    const enlace = (pagina: number) => `${hrefBase}${hrefBase.includes('?') ? '&' : '?'}pagina=${pagina}`;
    return (
        <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                    <caption className="sr-only">Consultas de pacientes registradas</caption>
                    <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                        <tr>
                            <th className="p-3 font-medium">Cuándo</th>
                            <th className="p-3 font-medium">Quién</th>
                            <th className="p-3 font-medium">Qué</th>
                            <th className="p-3 font-medium">Motivo</th>
                            <th className="p-3 font-medium">Resultado</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
                        {lista.filas.length === 0 && (
                            <tr>
                                <td colSpan={5} className="p-4 text-center text-zinc-500">
                                    Todavía no hay consultas registradas.
                                </td>
                            </tr>
                        )}
                        {lista.filas.map((f) => (
                            <tr key={f.id}>
                                <td className="p-3 tabular-nums">{formatAppointmentShort(f.creadoIso)}</td>
                                <td className="p-3">
                                    {f.actorEmail ?? 'Usuario eliminado'}
                                    <span className="block text-xs text-zinc-500">{ROL[f.actorRol] ?? f.actorRol}</span>
                                </td>
                                <td className="p-3">
                                    {TIPO[f.tipo] ?? f.tipo} · {f.modo === 'B' ? 'Lo agendaron en el HIS' : 'Dice que agendó'}
                                    <span className="block font-mono text-xs text-zinc-500">{f.busqueda}</span>
                                </td>
                                <td className="p-3">
                                    {MOTIVO[f.motivo] ?? f.motivo}
                                    {f.nota && <span className="block text-xs text-zinc-500">{f.nota}</span>}
                                </td>
                                <td className="p-3 text-xs">
                                    {f.veredictos.length > 0
                                        ? f.veredictos.join(', ')
                                        : f.tipo === 'OPEN' || f.tipo === 'REVEAL'
                                          ? '—'
                                          : `${f.candidatos} candidato(s)`}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <nav aria-label="Paginación" className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">
                    Página {lista.pagina} de {lista.paginas} · {lista.total} consulta(s)
                </span>
                <span className="flex gap-3">
                    {lista.pagina > 1 && (
                        <Link href={enlace(lista.pagina - 1)} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                            ← Más recientes
                        </Link>
                    )}
                    {lista.pagina < lista.paginas && (
                        <Link href={enlace(lista.pagina + 1)} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                            Más antiguas →
                        </Link>
                    )}
                </span>
            </nav>
        </div>
    );
}
