'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Calendar, Filter, X } from 'lucide-react';

export default function DateFilterForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    
    const currentStart = searchParams.get('startDate') || '';
    const currentEnd = searchParams.get('endDate') || '';

    const [startDate, setStartDate] = useState(currentStart);
    const [endDate, setEndDate] = useState(currentEnd);

    const handleApply = (e: React.FormEvent) => {
        e.preventDefault();
        const params = new URLSearchParams(searchParams.toString());
        if (startDate) params.set('startDate', startDate);
        else params.delete('startDate');
        
        if (endDate) params.set('endDate', endDate);
        else params.delete('endDate');

        router.push(`/dashboard/analytics?${params.toString()}`);
    };

    const handleClear = () => {
        setStartDate('');
        setEndDate('');
        router.push('/dashboard/analytics');
    };

    return (
        <form onSubmit={handleApply} className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col md:flex-row gap-4 items-end mb-8 shadow-sm">
            <div className="flex-1 w-full">
                <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wider">Fecha Inicio</label>
                <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 w-4 h-4" />
                    <input 
                        type="date" 
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            </div>
            
            <div className="flex-1 w-full">
                <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wider">Fecha Fin</label>
                <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 w-4 h-4" />
                    <input 
                        type="date" 
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-zinc-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            </div>

            <div className="flex gap-2 w-full md:w-auto">
                <button 
                    type="submit"
                    className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-medium transition-colors"
                >
                    <Filter className="w-4 h-4" /> Filtrar
                </button>
                {(startDate || endDate) && (
                    <button 
                        type="button"
                        onClick={handleClear}
                        className="flex items-center justify-center gap-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-4 py-2 rounded-xl font-medium transition-colors"
                        title="Limpiar filtros"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>
        </form>
    );
}
