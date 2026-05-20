"use client";

import { useState } from "react";
import { purgeOrganization } from "../../../actions/organizations";

interface PurgeOrganizationModalProps {
  org: { id: string; name: string };
  onClose: () => void;
  /** Se invoca tras una purga exitosa para que el padre quite la fila. */
  onPurged: (id: string) => void;
}

export default function PurgeOrganizationModal({ org, onClose, onPurged }: PurgeOrganizationModalProps) {
  const [purgePassword, setPurgePassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ name: string; total: number } | null>(null);

  // Doble fricción: además de la clave de purga, exigimos teclear el nombre exacto.
  const nameMatches = confirmName.trim() === org.name.trim();
  const canSubmit = nameMatches && purgePassword.length > 0 && !loading;

  const handlePurge = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    const res = await purgeOrganization(org.id, purgePassword);
    setLoading(false);

    if (res.success) {
      const total = Object.values(res.purged).reduce((a, b) => a + b, 0);
      setSuccess({ name: res.organizationName || org.name, total });
      // Damos un par de segundos para que el operador lea el resumen.
      setTimeout(() => {
        onPurged(org.id);
        onClose();
      }, 2200);
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-slide-up border-2 border-red-500/60 flex flex-col max-h-[92vh]">
        {/* Banda roja de advertencia */}
        <div className="bg-gradient-to-br from-red-600 to-red-700 px-6 py-5 text-white shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-3xl">⚠️</span>
            <div>
              <h2 className="text-xl font-extrabold tracking-tight">PURGA IRREVERSIBLE</h2>
              <p className="text-red-100 text-sm">{org.name}</p>
            </div>
          </div>
        </div>

        {success ? (
          /* Estado de éxito */
          <div className="p-8 text-center space-y-3">
            <div className="text-5xl">✅</div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Clínica purgada</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Se eliminaron <strong className="text-zinc-700 dark:text-zinc-200">{success.total.toLocaleString()}</strong> registros
              de <strong className="text-zinc-700 dark:text-zinc-200">{success.name}</strong>. La acción quedó
              registrada en la bitácora de auditoría global.
            </p>
          </div>
        ) : (
          <div className="p-6 space-y-5 overflow-y-auto">
            {/* Advertencia gigante */}
            <div className="rounded-xl border-2 border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-4">
              <p className="text-red-700 dark:text-red-300 font-bold text-base leading-snug">
                ESTA ACCIÓN ES IRREVERSIBLE Y BORRARÁ DATOS MÉDICOS LEGALES.
              </p>
              <p className="text-red-600/90 dark:text-red-400/90 text-sm mt-2 leading-relaxed">
                Se eliminarán de forma permanente (hard delete): pacientes, médicos, citas,
                historias clínicas, agendas, logs y la organización completa. No hay papelera
                de reciclaje. Por favor ingrese la Clave de Purga de SuperAdmin para confirmar.
              </p>
            </div>

            {/* Confirmación por nombre */}
            <div>
              <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Escriba el nombre exacto de la clínica
              </label>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={org.name}
                autoComplete="off"
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all dark:text-white"
              />
              {confirmName.length > 0 && !nameMatches && (
                <p className="text-xs text-red-500 mt-1">El nombre no coincide.</p>
              )}
            </div>

            {/* Clave de purga */}
            <div>
              <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Clave de Purga de SuperAdmin <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={purgePassword}
                onChange={(e) => setPurgePassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="new-password"
                onKeyDown={(e) => e.key === "Enter" && handlePurge()}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-sm font-mono focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all dark:text-white"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300 break-words">
                ❌ {error}
              </div>
            )}

            {/* Acciones */}
            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-5 py-2 rounded-xl text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handlePurge}
                disabled={!canSubmit}
                className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 shadow-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 min-w-52 justify-center"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Purgando...
                  </>
                ) : (
                  <>🗑️ Confirmar Purga Hard Delete</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
