/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use client';

import { useState } from 'react';
import ServicesTable from './ServicesTable';
import ServicesModal from './ServicesModal';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';

export default function ServicesClient({ data }: { data: any[] }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const router = useRouter();
    const searchParams = useSearchParams();

    const handleSearch = useDebouncedCallback((term: string) => {
        const params = new URLSearchParams(searchParams);
        if (term) {
            params.set('q', term);
        } else {
            params.delete('q');
        }
        router.replace(`/dashboard/servicios?${params.toString()}`);
    }, 300);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                        Catálogo de Servicios Médicos
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Administre las especialidades que el hospital tiene autorizadas y operativas.
                    </p>
                </div>
                <div className="flex w-full sm:w-auto items-center gap-3">
                    <div className="relative flex-grow sm:flex-grow-0 sm:w-64">
                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                            <svg className="w-4 h-4 text-gray-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
                                <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z" />
                            </svg>
                        </div>
                        <input
                            type="text"
                            onChange={(e) => handleSearch(e.target.value)}
                            defaultValue={searchParams.get('q')?.toString()}
                            className="block w-full p-2 pl-10 text-sm text-gray-900 border border-gray-300 rounded-lg bg-gray-50 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="Buscar Servicio..."
                        />
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="flex-none bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Alta de Especialidad
                    </button>
                </div>
            </div>

            <ServicesTable data={data} />
            {isModalOpen && <ServicesModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />}
        </div>
    );
}
