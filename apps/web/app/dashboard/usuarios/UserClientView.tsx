/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
'use client'

import { useState, useTransition } from 'react';
import UserModal from './UserModal';
import { deleteUserAction } from './actions';
import { useRouter } from 'next/navigation';

export default function UserClientView({ users }: { users: any[] }) {
    const [editingUser, setEditingUser] = useState<any | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const handleDelete = (id: string) => {
        if (!confirm('¿Estás seguro de que deseas eliminar este usuario? Esto no se puede deshacer y borrará sus perfiles asociados.')) return;
        startTransition(async () => {
            const res = await deleteUserAction(id);
            if (!res.success) alert(res.error);
        });
    };

    return (
        <div className="animate-fade-in space-y-8">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-2">
                        Gestión de Usuarios
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-lg leading-relaxed max-w-2xl">
                        Administra las credenciales de acceso de Pacientes, Médicos y Administradores.
                    </p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-white bg-zinc-900 dark:bg-white dark:text-zinc-900 rounded-xl shadow-xl shadow-zinc-200 dark:shadow-none hover:scale-105 transition-transform"
                >
                    <span>+</span> Nuevo Usuario
                </button>
            </header>

            {(isCreating || editingUser) && (
                <UserModal
                    user={editingUser}
                    onClose={() => { setIsCreating(false); setEditingUser(null); }}
                />
            )}

            <div className="bg-white dark:bg-zinc-900 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-black/20 rounded-3xl overflow-hidden border border-zinc-100 dark:border-zinc-800">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
                        <thead className="bg-zinc-50/80 dark:bg-zinc-800/40 backdrop-blur-md">
                            <tr>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Credencial (Email)</th>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Rol Asignado</th>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Perfiles Vinculados</th>
                                <th scope="col" className="px-6 py-5 text-left text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Registro</th>
                                <th scope="col" className="relative px-6 py-5"><span className="sr-only">Acciones</span></th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800/60">
                            {users.map(user => (
                                <tr key={user.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors group">
                                    <td className="px-6 py-5 whitespace-nowrap">
                                        <div className="flex items-center">
                                            <div className="flex-shrink-0 h-10 w-10 bg-gradient-to-tr from-blue-100 to-indigo-100 dark:from-blue-900/40 dark:to-indigo-900/40 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-bold text-lg border border-blue-200/50 dark:border-blue-800/50">
                                                {user.email.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="ml-4">
                                                <div className="text-sm font-bold text-zinc-900 dark:text-white">
                                                    {user.email}
                                                </div>
                                                <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono mt-0.5">
                                                    ID: {user.id.slice(0, 8)}...
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 whitespace-nowrap">
                                        <span className={`px-3 py-1 inline-flex text-xs font-bold rounded-lg border ${user.role === 'ADMIN' ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400' :
                                            user.role === 'DOCTOR' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400' :
                                                'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
                                            }`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td className="px-6 py-5 whitespace-nowrap">
                                        {user.patientProfile && <span className="text-xs font-semibold mr-2 bg-blue-100 text-blue-700 px-2 py-0.5 rounded">🏥 Paciente</span>}
                                        {user.doctorProfile && <span className="text-xs font-semibold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">🩺 Médico</span>}
                                        {!user.patientProfile && !user.doctorProfile && <span className="text-xs text-zinc-400 italic">Solo Credenciales</span>}
                                    </td>
                                    <td className="px-6 py-5 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                                        {new Date(user.createdAt).toLocaleDateString('es-CO')}
                                    </td>
                                    <td className="px-6 py-5 whitespace-nowrap text-right text-sm font-medium">
                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex justify-end gap-2">
                                            <button
                                                onClick={() => setEditingUser(user)}
                                                className="p-2 text-zinc-400 hover:text-blue-600 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 hover:border-blue-300 transition-all"
                                                title="Editar"
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                onClick={() => handleDelete(user.id)}
                                                disabled={isPending}
                                                className="p-2 text-zinc-400 hover:text-red-600 bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 hover:border-red-300 transition-all disabled:opacity-50"
                                                title="Eliminar"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {users.length === 0 && (
                        <div className="text-center py-16 text-zinc-500">
                            No hay usuarios registrados.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
