'use client';

import { useState } from 'react';
import { saveEnvVars } from '../../../actions/settings';

export default function SettingsClient({ initialVars }: { initialVars: { key: string, value: string }[] }) {
    const [vars, setVars] = useState(initialVars);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const handleUpdateField = (index: number, field: 'key' | 'value', val: string) => {
        const newVars = [...vars];
        newVars[index][field] = val;
        setVars(newVars);
    };

    const handleAddRow = () => {
        setVars([...vars, { key: '', value: '' }]);
    };

    const handleRemoveRow = (index: number) => {
        const newVars = [...vars];
        newVars.splice(index, 1);
        setVars(newVars);
    };

    const handleSave = async () => {
        setMessage(null);
        setSaving(true);
        // Filter out completely empty rows
        const cleanedVars = vars.filter(v => v.key.trim() !== '');
        
        const res = await saveEnvVars(cleanedVars);
        setSaving(false);

        if (res.success) {
            setVars(cleanedVars);
            setMessage({ type: 'success', text: 'Sincronización de Entorno guardada. Por favor reinicia el servicio API.' });
            setTimeout(() => setMessage(null), 5000);
        } else {
            setMessage({ type: 'error', text: res.error || 'Ocurrió un error escribiendo el archivo.' });
        }
    };

    return (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-800/50">
                <h3 className="font-bold text-zinc-900 dark:text-white text-lg">Variables de Entorno Globales</h3>
                <button 
                    onClick={handleAddRow}
                    className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors px-3 py-1.5 rounded-lg text-sm font-semibold text-zinc-700 dark:text-zinc-300"
                >
                    + Agregar Variable
                </button>
            </div>

            <div className="p-6 space-y-4">
                {vars.map((v, idx) => (
                    <div key={idx} className="flex gap-3 group items-center">
                        <div className="w-1/3">
                            <input 
                                type="text"
                                placeholder="KEY"
                                value={v.key}
                                onChange={(e) => handleUpdateField(idx, 'key', e.target.value)}
                                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <span className="text-zinc-400">=</span>
                        <div className="flex-1">
                            <input 
                                type="text"
                                placeholder="Valor o Token (Secretos se ofuscan al renderizar opcionalmente)"
                                value={v.value}
                                onChange={(e) => handleUpdateField(idx, 'value', e.target.value)}
                                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <button 
                            onClick={() => handleRemoveRow(idx)}
                            className="p-2 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                            title="Eliminar Variable"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                ))}

                {vars.length === 0 && (
                    <div className="text-center text-zinc-500 py-10">
                        No se encontraron variables de entorno o el archivo está vacío.
                    </div>
                )}
            </div>

            <div className="p-6 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 flex justify-between items-center">
                <div className="text-sm font-medium">
                    {message && (
                        <span className={message.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                            {message.type === 'success' ? '✓ ' : '✖ '}
                            {message.text}
                        </span>
                    )}
                </div>
                <button 
                    disabled={saving}
                    onClick={handleSave}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                    {saving ? 'Escribiendo Disco...' : 'Sobrescribir Archivo .env Global'}
                </button>
            </div>
        </div>
    );
}
