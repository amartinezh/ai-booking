"use client";

import { useState, useTransition } from "react";
import { createOrganization, updateOrganization, toggleOrganizationStatus } from "../../../actions/organizations";

export default function OrganizationsClient({ initialOrganizations }: { initialOrganizations: any[] }) {
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<any>(null);

  const [formData, setFormData] = useState({
    name: "",
    whatsappPhoneId: "",
    logoUrl: ""
  });

  const handleToggle = async (id: string, currentStatus: boolean) => {
    // Optimistic UI update
    setOrganizations(orgs => orgs.map(o => o.id === id ? { ...o, isActive: !currentStatus } : o));
    
    startTransition(async () => {
      await toggleOrganizationStatus(id, !currentStatus);
    });
  };

  const handleOpenModal = (org?: any) => {
    if (org) {
      setEditingOrg(org);
      setFormData({
        name: org.name,
        whatsappPhoneId: org.whatsappPhoneId || "",
        logoUrl: org.logoUrl || ""
      });
    } else {
      setEditingOrg(null);
      setFormData({ name: "", whatsappPhoneId: "", logoUrl: "" });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    startTransition(async () => {
      let res;
      if (editingOrg) {
        res = await updateOrganization(editingOrg.id, formData);
        if (res.success) {
          setOrganizations(orgs => orgs.map(o => o.id === editingOrg.id ? { ...o, ...formData } : o));
          setIsModalOpen(false);
        } else {
          alert('Error actualizando: ' + res.error);
        }
      } else {
        res = await createOrganization(formData);
        if (res.success) {
          // reloaded by server via revalidatePath, but we can optimistically close
          setIsModalOpen(false);
          // Normally we'd rely on server component refresh, 
          // but if we want to force full reload: window.location.reload()
          window.location.reload();
        } else {
          alert('Error creando organización: ' + res.error);
        }
      }
    });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Gestión de Organizaciones (Tenants)</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Administra el aislamiento global y configura interfaces de WhatsApp por Clínica.</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 shadow-sm"
        >
          <span>+</span> Crear Organización
        </button>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                <th className="p-4 font-semibold">Tenant</th>
                <th className="p-4 font-semibold">ID Whatsapp Oficial</th>
                <th className="p-4 font-semibold">Estado (Kill Switch)</th>
                <th className="p-4 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
              {organizations.map((org) => (
                <tr key={org.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      {org.logoUrl ? (
                         <img src={org.logoUrl} alt="Logo" className="w-10 h-10 rounded-full object-cover border border-zinc-200 shadow-sm" />
                      ) : (
                         <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 flex items-center justify-center font-bold text-lg shadow-sm">
                           {org.name.charAt(0)}
                         </div>
                      )}
                      <div>
                        <div className="font-semibold text-zinc-900 dark:text-white">{org.name}</div>
                        <div className="text-xs text-zinc-500 font-mono mt-0.5">{org.id.split('-')[0]}***</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-zinc-600 dark:text-zinc-400 font-mono text-xs">
                    {org.whatsappPhoneId ? (
                       <span className="bg-green-100 text-green-800 px-2 py-1 rounded-md border border-green-200">{org.whatsappPhoneId}</span>
                    ) : (
                       <span className="text-zinc-400 italic">No configurado</span>
                    )}
                  </td>
                  <td className="p-4">
                    <button 
                      onClick={() => handleToggle(org.id, org.isActive)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 shadow-inner ${org.isActive ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                    >
                      <span className={`${org.isActive ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow`} />
                    </button>
                    <span className="ml-3 text-xs font-medium text-zinc-500">
                      {org.isActive ? 'Activo' : 'Supendido'}
                    </span>
                  </td>
                  <td className="p-4 text-right flex gap-2 justify-end">
                    <button 
                      onClick={() => handleOpenModal(org)}
                      className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium text-xs px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40 rounded-lg transition-colors">
                      Configurar Entidad
                    </button>
                    <a
                      href={`/super-admin/organizations/${org.id}/admins`}
                      className="text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 font-medium text-xs px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40 rounded-lg transition-colors inline-flex items-center"
                    >
                      👤 Admins
                    </a>
                  </td>
                </tr>
              ))}
              {organizations.length === 0 && (
                <tr>
                   <td colSpan={4} className="p-8 text-center text-zinc-500">No hay organizaciones creadas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-slide-up border border-zinc-200 dark:border-zinc-800">
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
                {editingOrg ? 'Configurar Organización' : 'Nueva Organización'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 transition-colors text-2xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Nombre de la Clínica/Hospital <span className="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                  placeholder="Ej: Clínica del Sol"
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  WhatsApp Phone ID Oficial
                </label>
                <input 
                  type="text" 
                  value={formData.whatsappPhoneId}
                  onChange={e => setFormData({ ...formData, whatsappPhoneId: e.target.value })}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white font-mono"
                  placeholder="Ej: 1082348572019"
                />
                <p className="text-xs text-zinc-500 mt-1">Este ID es entregado por Meta WABA. Separa automáticamente al Chatbot Omnicanal.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  URL del Logo Visual
                </label>
                <input 
                  type="url" 
                  value={formData.logoUrl}
                  onChange={e => setFormData({ ...formData, logoUrl: e.target.value })}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                  placeholder="https://proveedor.com/logo.png"
                />
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2 rounded-xl text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors">
                  Cancelar
                </button>
                <button disabled={isPending} type="submit" className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 shadow-md transition-colors disabled:opacity-50 flex items-center justify-center min-w-[120px]">
                  {isPending ? 'Guardando...' : 'Guardar Datos'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
