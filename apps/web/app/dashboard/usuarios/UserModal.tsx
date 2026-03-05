'use client'

import { useState } from 'react';
import { saveUserAction } from './actions';

type UserData = { id?: string; email: string; role: 'ADMIN' | 'DOCTOR' | 'PATIENT' };

export default function UserModal({ user, onClose }: { user?: UserData | null, onClose: () => void }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const formData = new FormData(e.currentTarget);
        if (user?.id) formData.append('id', user.id);

        const res = await saveUserAction(formData);
        if (!res.success) {
            setError(res.error || 'Ocurrió un error inesperado');
            setLoading(false);
        } else {
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40 backdrop-blur-sm animate-fade-in">
            <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-zinc-200 dark:border-zinc-800 animate-slide-up">
                <div className="px-6 py-5 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50/50 dark:bg-zinc-800/20">
                    <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
                        {user ? 'Editar Usuario' : 'Nuevo Usuario'}
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-2xl transition-colors">&times;</button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 flex items-center gap-2">
                            <span>⚠️</span> {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Correo Electrónico</label>
                        <input
                            name="email"
                            type="email"
                            required
                            defaultValue={user?.email || ''}
                            placeholder="ejemplo@sanvicente.com"
                            className="w-full bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                            Contraseña {user && <span className="text-xs font-normal text-zinc-400">(Dejar en blanco para no cambiar)</span>}
                        </label>
                        <input
                            name="password"
                            type="password"
                            required={!user}
                            placeholder={user ? "••••••••" : "Ingresa una contraseña segura"}
                            className="w-full bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Rol de Acceso</label>
                        <select
                            name="role"
                            defaultValue={user?.role || 'PATIENT'}
                            className="w-full bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                        >
                            <option value="ADMIN">Administrador</option>
                            <option value="DOCTOR">Médico Especialista</option>
                            <option value="PATIENT">Paciente</option>
                        </select>
                    </div>

                    <div className="pt-4 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 rounded-xl font-bold bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-3 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all disabled:opacity-50"
                        >
                            {loading ? 'Guardando...' : 'Guardar Credencial'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
