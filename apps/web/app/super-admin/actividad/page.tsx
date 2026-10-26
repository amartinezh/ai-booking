import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { cargarActividad, resumenDeIngresos } from '@/app/actions/actividad';
import { filtrosATexto, leerFiltros, type FiltrosEnTexto } from '@/lib/actividad/filtros';
import ActividadClient from './ActividadClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 👣 Actividad de usuarios (2026-10-26). Solo SUPER_ADMIN: qué hizo cada persona
 * de cada clínica, en orden, con cada ingreso al panel (y cada intento fallido),
 * desde dónde y con qué navegador. Lee lo que el sistema ya guarda; no escribe.
 */
export default async function ActividadPage({ searchParams }: { searchParams: Promise<FiltrosEnTexto> }) {
    const session = await getSession();
    if (!session || session.role !== 'SUPER_ADMIN') redirect('/dashboard');

    const sp = await searchParams;
    const filtros = leerFiltros(sp);
    const texto = filtrosATexto(filtros);

    const [clinicas, usuarios, pagina, resumen] = await Promise.all([
        prisma.organization.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
        filtros.clinica.tipo === 'TODAS'
            ? Promise.resolve([])
            : prisma.user.findMany({
                  where:
                      filtros.clinica.tipo === 'CLINICA'
                          ? { organizationId: filtros.clinica.id, role: { not: 'PATIENT' } }
                          : { role: 'SUPER_ADMIN' },
                  select: { id: true, email: true, role: true },
                  orderBy: { email: 'asc' },
                  take: 500,
              }),
        cargarActividad(texto),
        resumenDeIngresos(texto),
    ]);

    return (
        <div className="max-w-7xl mx-auto animate-fade-in pb-10">
            <header className="mb-6">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                    👣 Actividad de usuarios
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-3xl">
                    Lo que hace cada persona en cada clínica, en orden: cada ingreso al panel y cada intento
                    fallido (desde qué IP y con qué navegador), cuentas creadas o cambiadas, pacientes consultados,
                    casos de la Bandeja, cargas del padrón, avisos, cambios de configuración y citas anuladas. Solo
                    aparece lo que el sistema registra; los datos de pacientes salen enmascarados.
                </p>
            </header>
            <ActividadClient
                filtros={texto}
                clinicas={clinicas}
                usuarios={usuarios}
                pagina={pagina}
                resumen={resumen}
            />
        </div>
    );
}
