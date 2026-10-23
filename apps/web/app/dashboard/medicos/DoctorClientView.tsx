'use client'

import { useMemo, useState, useTransition } from 'react';
import DoctorModal from './DoctorModal';
import { deleteDoctorAction } from './actions';
import type { MedicalService } from '@agenia/database';
import {
    SIN_FILTROS,
    cumpleFiltros,
    filtrarMedicos,
    hayFiltros,
    type FiltroEstado,
    type FiltroWhatsapp,
    type FiltrosMedicos,
    type MedicoVista,
} from '@/lib/medicos/buscar';

type DoctorWithRelations = MedicoVista;

/** Un grupo de botones de filtro («Todos · ON · OFF»), con cuántos hay en cada uno. */
function GrupoFiltro<T extends string>({
    etiqueta,
    valor,
    opciones,
    onCambio,
}: {
    etiqueta: string;
    valor: T;
    opciones: { valor: T; texto: string; cuantos: number }[];
    onCambio: (v: T) => void;
}) {
    return (
        <div role="group" aria-label={etiqueta} className="flex items-center gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-zinc-400 mr-1">{etiqueta}</span>
            {opciones.map((o) => (
                <button
                    key={o.valor}
                    type="button"
                    onClick={() => onCambio(o.valor)}
                    aria-pressed={valor === o.valor}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        valor === o.valor
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-blue-300'
                    }`}
                >
                    {o.texto} <span className={valor === o.valor ? 'text-blue-100' : 'text-zinc-400'}>({o.cuantos})</span>
                </button>
            ))}
        </div>
    );
}

export default function DoctorClientView({
    doctors,
    services,
    codigosHis = {},
}: {
    doctors: DoctorWithRelations[];
    services: MedicalService[];
    /** Código de cada médico en el sistema del hospital, por id (solo con la clínica conectada). */
    codigosHis?: Record<string, string>;
}) {
    const [editingDoctor, setEditingDoctor] = useState<DoctorWithRelations | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [filtros, setFiltros] = useState<FiltrosMedicos>(SIN_FILTROS);

    const visibles = useMemo(() => filtrarMedicos(doctors, filtros, codigosHis), [doctors, filtros, codigosHis]);
    // Cuántos quedarían con cada botón, respetando lo demás que ya está filtrado.
    const cuantos = (cambio: Partial<FiltrosMedicos>) =>
        doctors.filter((d) => cumpleFiltros(d, { ...filtros, ...cambio }, codigosHis[d.id])).length;

    const handleDelete = (id: string) => {
        if (!confirm('¿Estás seguro de eliminar este médico? Se borrará su acceso (User) y su agenda futura.')) return;
        startTransition(async () => {
            const res = await deleteDoctorAction(id);
            if (!res.success) alert(res.error);
        });
    };

    return (
        <div className="animate-fade-in space-y-8">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                        Plantilla Médica
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">
                        Gestiona los perfiles, credenciales y especialidades de los doctores del Hospital.
                    </p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-white bg-blue-600 rounded-xl shadow-xl shadow-blue-600/30 hover:bg-blue-700 hover:scale-105 transition-all"
                >
                    <span className="text-lg">🩺</span> Agregar Médico
                </button>
            </header>

            {(isCreating || editingDoctor) && (
                <DoctorModal
                    doctor={editingDoctor}
                    services={services}
                    onClose={() => { setIsCreating(false); setEditingDoctor(null); }}
                />
            )}

            {/* 🔎 Buscar por lo que sea */}
            {doctors.length > 0 && (
                <section aria-label="Buscar médicos" className="space-y-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="relative">
                        <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400">🔎</span>
                        <input
                            type="search"
                            value={filtros.texto}
                            onChange={(e) => setFiltros((f) => ({ ...f, texto: e.target.value }))}
                            placeholder="Buscar por nombre, cédula, servicio, código del hospital, teléfono o correo…"
                            aria-label="Buscar médicos"
                            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 py-3 pl-11 pr-4 text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                        <GrupoFiltro<FiltroWhatsapp>
                            etiqueta="WhatsApp"
                            valor={filtros.whatsapp}
                            onCambio={(whatsapp) => setFiltros((f) => ({ ...f, whatsapp }))}
                            opciones={[
                                { valor: 'todos', texto: 'Todos', cuantos: cuantos({ whatsapp: 'todos' }) },
                                { valor: 'on', texto: 'ON', cuantos: cuantos({ whatsapp: 'on' }) },
                                { valor: 'off', texto: 'OFF', cuantos: cuantos({ whatsapp: 'off' }) },
                            ]}
                        />
                        <GrupoFiltro<FiltroEstado>
                            etiqueta="Estado"
                            valor={filtros.estado}
                            onCambio={(estado) => setFiltros((f) => ({ ...f, estado }))}
                            opciones={[
                                { valor: 'todos', texto: 'Todos', cuantos: cuantos({ estado: 'todos' }) },
                                { valor: 'activos', texto: 'Activos', cuantos: cuantos({ estado: 'activos' }) },
                                { valor: 'inactivos', texto: 'Inactivos', cuantos: cuantos({ estado: 'inactivos' }) },
                            ]}
                        />
                        <p role="status" className="ml-auto text-sm text-zinc-500 dark:text-zinc-400">
                            Mostrando <strong className="text-zinc-900 dark:text-white">{visibles.length}</strong> de {doctors.length} médicos
                            {hayFiltros(filtros) && (
                                <button
                                    type="button"
                                    onClick={() => setFiltros(SIN_FILTROS)}
                                    className="ml-3 font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                    Limpiar
                                </button>
                            )}
                        </p>
                    </div>
                </section>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {visibles.map(doctor => (
                    <div key={doctor.id} className="group bg-white dark:bg-zinc-900 rounded-3xl p-6 shadow-xl shadow-zinc-200/50 dark:shadow-none border border-zinc-100 dark:border-zinc-800 hover:border-blue-500/50 transition-all flex flex-col justify-between">
                        <div>
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="h-12 w-12 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-xl text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800/50 font-bold">
                                        {doctor.fullName.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-zinc-900 dark:text-white leading-tight">{doctor.fullName}</h3>
                                        <p className="text-sm font-medium text-blue-600 dark:text-blue-400">{doctor.service?.name || 'Servicio no asignado'}</p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1.5">
                                    <span className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-lg border ${doctor.isActive ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-800' : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:border-red-800'}`}>
                                        {doctor.isActive ? 'Activo' : 'Inactivo'}
                                    </span>
                                    <span
                                        className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded-lg border ${doctor.whatsappBookingEnabled ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800' : 'bg-zinc-50 text-zinc-500 border-zinc-200 dark:bg-zinc-800/50 dark:border-zinc-700'}`}
                                        title="Reservas por WhatsApp"
                                    >
                                        📱 {doctor.whatsappBookingEnabled ? 'WhatsApp ON' : 'WhatsApp OFF'}
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-2 mt-5 text-sm">
                                <div className="flex justify-between border-b border-zinc-100 dark:border-zinc-800/30 pb-2">
                                    <span className="text-zinc-500 dark:text-zinc-400">T.P (Licencia)</span>
                                    <span className="font-medium text-zinc-900 dark:text-white">{doctor.medicalLicense || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between border-b border-zinc-100 dark:border-zinc-800/30 pb-2">
                                    <span className="text-zinc-500 dark:text-zinc-400">Cédula</span>
                                    <span className="font-medium text-zinc-900 dark:text-white">{doctor.cedula}</span>
                                </div>
                                <div className="flex justify-between pb-2">
                                    <span className="text-zinc-500 dark:text-zinc-400">Contacto</span>
                                    <span className="font-medium text-zinc-900 dark:text-white">{doctor.phone || 'Sin número'}</span>
                                </div>
                                {codigosHis[doctor.id] && (
                                    <div className="flex justify-between border-t border-zinc-100 dark:border-zinc-800/30 pt-2">
                                        <span className="text-zinc-500 dark:text-zinc-400">Código en el hospital</span>
                                        <span className="font-mono font-medium text-zinc-900 dark:text-white">{codigosHis[doctor.id]}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                            <button
                                onClick={() => setEditingDoctor(doctor)}
                                className="flex-1 py-2 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold py-2 px-4 rounded-xl text-sm transition-colors text-center"
                            >
                                Modificar Perfil
                            </button>
                            <button
                                onClick={() => handleDelete(doctor.id)}
                                disabled={isPending}
                                className="w-12 h-10 flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-xl text-sm transition-colors disabled:opacity-50"
                                title="Dar de baja"
                            >
                                🗑️
                            </button>
                        </div>
                    </div>
                ))}

                {doctors.length > 0 && visibles.length === 0 && (
                    <div className="col-span-1 lg:col-span-3 text-center py-16 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl">
                        <span className="text-4xl mb-4 block">🔎</span>
                        <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-1">Ningún médico coincide con la búsqueda</h3>
                        <p className="text-zinc-500 dark:text-zinc-400 mb-4">Pruebe con otra palabra o quite los filtros.</p>
                        <button
                            type="button"
                            onClick={() => setFiltros(SIN_FILTROS)}
                            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700"
                        >
                            Limpiar filtros
                        </button>
                    </div>
                )}

                {doctors.length === 0 && (
                    <div className="col-span-1 lg:col-span-3 text-center py-20 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl">
                        <span className="text-4xl mb-4 block">🩺</span>
                        <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-1">Sin médicos registrados</h3>
                        <p className="text-zinc-500 dark:text-zinc-400">Aún no hay perfiles médicos para agendar citas.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
