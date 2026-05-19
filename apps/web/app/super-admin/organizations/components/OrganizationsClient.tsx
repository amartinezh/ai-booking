"use client";

import { useState, useTransition } from "react";
import { createOrganization, updateOrganization, toggleOrganizationStatus } from "../../../actions/organizations";
import { getKnowledgeBaseForOrg, updateKnowledgeBaseForOrg } from "../../../actions/knowledge-base";
import { getOrgSettingsForOrg, updateOrgSettingsForOrg } from "../../../actions/settings";

export default function OrganizationsClient({ initialOrganizations }: { initialOrganizations: any[] }) {
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'kb' | 'settings'>('general');
  const [kbContent, setKbContent] = useState('');
  const [kbLoading, setKbLoading] = useState(false);
  const [kbSaved, setKbSaved] = useState(false);
  const [settingsBotName, setSettingsBotName] = useState('Vicente');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    logoUrl: ""
  });

  const handleToggle = async (id: string, currentStatus: boolean) => {
    setOrganizations(orgs => orgs.map(o => o.id === id ? { ...o, isActive: !currentStatus } : o));
    startTransition(async () => {
      await toggleOrganizationStatus(id, !currentStatus);
    });
  };

  const handleOpenModal = async (org?: any) => {
    if (org) {
      setEditingOrg(org);
      setFormData({
        name: org.name,
        logoUrl: org.logoUrl || ""
      });
      setActiveTab('general');
      setKbContent('');
    } else {
      setEditingOrg(null);
      setFormData({ name: "", logoUrl: "" });
      setActiveTab('general');
      setKbContent('');
    }
    setIsModalOpen(true);
  };

  const handleTabChange = async (tab: 'general' | 'kb' | 'settings') => {
    setActiveTab(tab);
    if (tab === 'kb' && editingOrg && kbContent === '') {
      setKbLoading(true);
      try {
        const content = await getKnowledgeBaseForOrg(editingOrg.id);
        setKbContent(content ?? '');
      } catch {
        setKbContent('');
      } finally {
        setKbLoading(false);
      }
    }
    if (tab === 'settings' && editingOrg) {
      setSettingsLoading(true);
      try {
        const s = await getOrgSettingsForOrg(editingOrg.id);
        setSettingsBotName(s.botName);
      } catch {
        setSettingsBotName('Vicente');
      } finally {
        setSettingsLoading(false);
      }
    }
  };

  const handleSaveSettings = () => {
    if (!editingOrg) return;
    setSettingsSaved(false);
    startTransition(async () => {
      const res = await updateOrgSettingsForOrg(editingOrg.id, { botName: settingsBotName });
      if (res.success) {
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 3000);
      } else {
        alert('Error al guardar: ' + res.error);
      }
    });
  };

  const handleSaveKb = () => {
    if (!editingOrg) return;
    setKbSaved(false);
    startTransition(async () => {
      const res = await updateKnowledgeBaseForOrg(editingOrg.id, kbContent);
      if (res.success) {
        setKbSaved(true);
        setTimeout(() => setKbSaved(false), 3000);
      } else {
        alert('Error al guardar KB: ' + res.error);
      }
    });
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
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
          setIsModalOpen(false);
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
                    {org.whatsappConfig?.phoneNumberId ? (
                       <span
                         className={`px-2 py-1 rounded-md border ${
                           org.whatsappConfig.isActive
                             ? 'bg-green-100 text-green-800 border-green-200'
                             : 'bg-amber-100 text-amber-800 border-amber-200'
                         }`}
                         title={org.whatsappConfig.isActive ? 'Canal activo' : 'Canal inactivo'}
                       >
                         {org.whatsappConfig.phoneNumberId}
                       </span>
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
          <div className="bg-white dark:bg-zinc-900 w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden animate-slide-up border border-zinc-200 dark:border-zinc-800 flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
                {editingOrg ? 'Configurar Organización' : 'Nueva Organización'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 transition-colors text-2xl leading-none">&times;</button>
            </div>

            {/* Tabs — solo visibles al editar */}
            {editingOrg && (
              <div className="flex border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <button
                  onClick={() => handleTabChange('general')}
                  className={`px-6 py-3 text-sm font-semibold transition-colors ${activeTab === 'general' ? 'text-indigo-600 border-b-2 border-indigo-600 dark:text-indigo-400 dark:border-indigo-400' : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400'}`}
                >
                  ⚙️ Configuración General
                </button>
                <button
                  onClick={() => handleTabChange('kb')}
                  className={`px-6 py-3 text-sm font-semibold transition-colors ${activeTab === 'kb' ? 'text-indigo-600 border-b-2 border-indigo-600 dark:text-indigo-400 dark:border-indigo-400' : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400'}`}
                >
                  🧠 Base de Conocimiento
                </button>
                <button
                  onClick={() => handleTabChange('settings')}
                  className={`px-6 py-3 text-sm font-semibold transition-colors ${activeTab === 'settings' ? 'text-indigo-600 border-b-2 border-indigo-600 dark:text-indigo-400 dark:border-indigo-400' : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400'}`}
                >
                  🤖 Chatbot
                </button>
              </div>
            )}

            {/* Tab: General */}
            {activeTab === 'general' && (
              <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto">
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

                <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  <p className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">
                    📱 Credenciales de WhatsApp
                  </p>
                  Las credenciales de Meta (Phone ID, Access Token, Verify Token) ahora
                  las gestiona el administrador de cada clínica desde su panel:
                  <span className="block mt-1 text-zinc-500 italic">
                    Configuración → Integraciones → Canal de WhatsApp.
                  </span>
                  {editingOrg?.whatsappConfig?.phoneNumberId && (
                    <p className="mt-2 font-mono text-[11px]">
                      Estado actual:{' '}
                      <span
                        className={
                          editingOrg.whatsappConfig.isActive
                            ? 'text-green-700 dark:text-green-300'
                            : 'text-amber-700 dark:text-amber-300'
                        }
                      >
                        {editingOrg.whatsappConfig.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                      {' · '}
                      Phone ID {editingOrg.whatsappConfig.phoneNumberId}
                    </p>
                  )}
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
                  <button disabled={isPending} type="submit" className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 shadow-md transition-colors disabled:opacity-50 flex items-center justify-center min-w-30">
                    {isPending ? 'Guardando...' : 'Guardar Datos'}
                  </button>
                </div>
              </form>
            )}

            {/* Tab: Chatbot Settings */}
            {activeTab === 'settings' && editingOrg && (
              <div className="p-6 space-y-5 overflow-y-auto">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Personalización del asistente virtual de <strong className="text-zinc-700 dark:text-zinc-200">{editingOrg.name}</strong>.
                </p>

                {settingsLoading ? (
                  <div className="flex items-center justify-center py-12 text-zinc-400">
                    <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Cargando...
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                        Nombre del asistente virtual
                      </label>
                      <input
                        type="text"
                        maxLength={40}
                        value={settingsBotName}
                        onChange={e => setSettingsBotName(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
                        placeholder="Ej: Vicente, Sofía, MedBot..."
                      />
                      <p className="text-xs text-zinc-400 mt-1.5">
                        El paciente verá: <em>"Soy <strong>{settingsBotName || 'Vicente'}</strong>, el asistente de {editingOrg.name}."</em>
                      </p>
                    </div>
                    <div className="flex justify-between items-center pt-2">
                      <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2 rounded-xl text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors">
                        Cerrar
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveSettings}
                        disabled={isPending}
                        className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 shadow-md transition-colors disabled:opacity-50 flex items-center gap-2 min-w-35"
                      >
                        {isPending ? 'Guardando...' : settingsSaved ? '✅ Guardado' : '💾 Guardar'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Tab: Knowledge Base */}
            {activeTab === 'kb' && editingOrg && (
              <div className="p-6 space-y-4 overflow-y-auto flex flex-col flex-1">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Información que el chatbot usará para responder preguntas frecuentes de pacientes de <strong className="text-zinc-700 dark:text-zinc-200">{editingOrg.name}</strong>.
                </p>

                {kbLoading ? (
                  <div className="flex items-center justify-center py-12 text-zinc-400">
                    <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Cargando...
                  </div>
                ) : (
                  <>
                    <textarea
                      value={kbContent}
                      onChange={(e) => setKbContent(e.target.value)}
                      rows={14}
                      className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-3 text-sm font-mono text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-y leading-relaxed"
                      placeholder="Escriba la información de la clínica: horarios, tarifas, EPS, servicios, contacto..."
                    />
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-zinc-400">{kbContent.length.toLocaleString()} caracteres</span>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setIsModalOpen(false)}
                          className="px-5 py-2 rounded-xl text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
                        >
                          Cerrar
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveKb}
                          disabled={isPending}
                          className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 shadow-md transition-colors disabled:opacity-50 flex items-center gap-2 min-w-35"
                        >
                          {isPending ? 'Guardando...' : kbSaved ? '✅ Guardado' : '💾 Guardar KB'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
