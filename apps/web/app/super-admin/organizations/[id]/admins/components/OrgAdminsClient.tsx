"use client";

import { useState, useTransition } from "react";
import { createOrgAdmin, deleteOrgAdmin } from "../../../../../actions/org-admins";

export default function OrgAdminsClient({ organizationId, initialAdmins }: { organizationId: string; initialAdmins: any[] }) {
  const [admins, setAdmins] = useState(initialAdmins);
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    email: "",
    password: ""
  });

  const handleDelete = async (userId: string) => {
    if (!confirm('¿Seguro que deseas eliminar a este administrador? PERDERÁ el acceso total a esta organización.')) return;
    
    startTransition(async () => {
      const res = await deleteOrgAdmin(organizationId, userId);
      if (res.success) {
        setAdmins(prev => prev.filter(a => a.id !== userId));
      } else {
        alert('Error eliminando: ' + res.error);
      }
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email) return;

    startTransition(async () => {
      const res = await createOrgAdmin(organizationId, formData.email, formData.password);
      if (res.success) {
        setIsModalOpen(false);
        window.location.reload();
      } else {
        alert('Error al crear usuario admnistrador: ' + res.error);
      }
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Administradores del Tenant</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Usuarios líderes (ORG_ADMIN) que gestionarán operativamente esta clínica.
          </p>
        </div>
        <div className="flex gap-2">
            <a href="/super-admin/organizations" className="px-4 py-2 text-sm font-semibold text-zinc-600 bg-white dark:bg-zinc-800 dark:text-zinc-300 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors">
            Volver
            </a>
            <button 
                onClick={() => { setFormData({ email: '', password: '' }); setIsModalOpen(true); }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 shadow-sm"
            >
                <span>👤</span> Nuevo Administrador
            </button>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
              <th className="p-4 font-semibold">Correo Electrónico</th>
              <th className="p-4 font-semibold">Rol Asignado</th>
              <th className="p-4 font-semibold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
            {admins.map((adm) => (
              <tr key={adm.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors">
                <td className="p-4 font-medium text-zinc-900 dark:text-white">{adm.email}</td>
                <td className="p-4 font-mono text-xs text-zinc-500">
                    <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 px-2 py-1 rounded-md border border-blue-200 dark:border-blue-900">{adm.role}</span>
                </td>
                <td className="p-4 text-right">
                  <button 
                    onClick={() => handleDelete(adm.id)}
                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 font-medium text-xs px-3 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition-colors">
                    Eliminar Acceso
                  </button>
                </td>
              </tr>
            ))}
            {admins.length === 0 && (
              <tr>
                 <td colSpan={3} className="p-8 text-center text-zinc-500">Esta organización no tiene líderes asignados todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-md rounded-2xl shadow-xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Alta de ORG_ADMIN</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Correo Electrónico <span className="text-red-500">*</span></label>
                <input 
                  type="email" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none dark:text-white"
                  placeholder="admin@clinica.com"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Clave de Acceso Temporal</label>
                <input 
                  type="text" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none dark:text-white"
                  placeholder="(Por defecto: admin123)"
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2 rounded-xl text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  Cancelar
                </button>
                <button disabled={isPending} type="submit" className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
                  {isPending ? 'Guardando...' : 'Crear Admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
