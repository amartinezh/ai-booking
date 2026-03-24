'use client';

import { useState } from 'react';
import { updateOrganizationBilling } from '../../../actions/billing';

export default function BillingClient({ organizations }: { organizations: any[] }) {
    const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});

    const handleUpdate = async (orgId: string, currentData: any, newValues: any) => {
        setLoadingMap(prev => ({ ...prev, [orgId]: true }));
        const res = await updateOrganizationBilling(orgId, { ...currentData, ...newValues });
        if (!res.success) alert(res.error);
        setLoadingMap(prev => ({ ...prev, [orgId]: false }));
    };

    return (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                    <thead className="text-xs uppercase bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                        <tr>
                            <th className="px-6 py-4 font-semibold">Organización / Clínica</th>
                            <th className="px-6 py-4 font-semibold">Valor Mensual</th>
                            <th className="px-6 py-4 font-semibold">Último Pago</th>
                            <th className="px-6 py-4 font-semibold text-center">Apagado Automático</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {organizations.map((org) => {
                            const isSaving = loadingMap[org.id] || false;
                            
                            // Format Date to local YYYY-MM-DD for input
                            const dateValue = org.lastPaymentDate 
                                ? new Date(org.lastPaymentDate).toISOString().split('T')[0] 
                                : '';

                            return (
                                <tr key={org.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                            {org.name}
                                            {!org.isActive && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded border border-red-200">Inactiva</span>}
                                        </div>
                                        <div className="text-xs text-zinc-500">ID: {org.id.split('-')[0]}...</div>
                                    </td>
                                    
                                    <td className="px-6 py-4">
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">$</span>
                                            <input 
                                                type="text" 
                                                defaultValue={org.monthlyFee || ''}
                                                disabled={isSaving}
                                                onBlur={(e) => {
                                                    if (e.target.value !== (org.monthlyFee || '')) {
                                                        handleUpdate(org.id, org, { monthlyFee: e.target.value });
                                                    }
                                                }}
                                                placeholder="Ej: 50.000"
                                                className="w-32 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg py-1.5 pl-7 pr-3 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                                            />
                                        </div>
                                    </td>
                                    
                                    <td className="px-6 py-4">
                                        <input 
                                            type="date"
                                            defaultValue={dateValue}
                                            disabled={isSaving}
                                            onChange={(e) => {
                                                handleUpdate(org.id, org, { lastPaymentDate: e.target.value });
                                            }}
                                            className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                                        />
                                    </td>
                                    
                                    <td className="px-6 py-4 text-center">
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input 
                                                type="checkbox" 
                                                className="sr-only peer" 
                                                checked={org.autoSuspend}
                                                disabled={isSaving}
                                                onChange={(e) => {
                                                    handleUpdate(org.id, org, { autoSuspend: e.target.checked });
                                                }}
                                            />
                                            <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-blue-600"></div>
                                        </label>
                                        {isSaving && <span className="ml-2 text-xs text-blue-500 animate-pulse">Guardando...</span>}
                                    </td>
                                </tr>
                            );
                        })}
                        {organizations.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-6 py-10 text-center text-zinc-500">
                                    No hay organizaciones registradas
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
