'use client';

import { Lock, FileWarning, X } from 'lucide-react';
import { useEffect } from 'react';

export default function ConfirmSignatureModal({
    isOpen,
    onClose,
    onConfirm,
    isLoading
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    isLoading: boolean;
}) {
    // Evitar que el fondo (body) haga scroll cuando el modal está abierto
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop con Blur y transición de Tailwind */}
            <div 
                className="absolute inset-0 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={!isLoading ? onClose : undefined}
            />
            
            {/* Modal Dialog */}
            <div className="relative bg-white dark:bg-zinc-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header Decoration */}
                <div className="bg-slate-800 p-5 flex items-start gap-4">
                    <div className="bg-slate-700/50 p-2.5 rounded-full shrink-0">
                        <Lock className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">Sellar y Firmar Historia Clínica</h3>
                        <p className="text-slate-300 text-xs mt-1 font-mono">Firma Electrónica Avanzada SHA-256</p>
                    </div>
                    <button 
                        onClick={onClose} 
                        disabled={isLoading}
                        className="ml-auto text-slate-400 hover:text-white transition disabled:opacity-50"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                {/* Body Content */}
                <div className="p-6">
                    <div className="flex gap-3 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 p-4 rounded-xl border border-rose-200 dark:border-rose-900 mb-6">
                        <FileWarning className="w-5 h-5 shrink-0 mt-0.5" />
                        <p className="text-sm font-medium leading-relaxed">
                            Está a punto de firmar digitalmente este documento. Por normatividad legal de Minsalud, <strong>una vez firmado, no podrá modificar su contenido original.</strong><br/><br/>
                            Cualquier aclaración o cambio futuro requerirá obligatoriamente la creación temporal de una <em>Adenda Legal</em> adjunta.
                        </p>
                    </div>
                    
                    {/* Actions Footer */}
                    <div className="flex justify-end gap-3 pt-2">
                        <button 
                            onClick={onClose}
                            disabled={isLoading}
                            className="px-5 py-2.5 rounded-xl font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={onConfirm}
                            disabled={isLoading}
                            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-white bg-slate-800 hover:bg-slate-900 dark:bg-blue-600 dark:hover:bg-blue-700 transition-colors shadow-lg disabled:opacity-50 min-w-[160px]"
                        >
                            {isLoading ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                'Sí, Firmar y Cerrar'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
