import { cookies } from 'next/headers';
import DateFilterForm from './DateFilterForm';
import ChartsWrapper from './ChartsWrapper';

export default async function AnalyticsDashboard({ startDate, endDate }: { startDate?: string; endDate?: string }) {
    
    let statsData = null;
    let errorMsg = null;

    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value || '';

        const queryParams = new URLSearchParams();
        if (startDate) queryParams.set('startDate', startDate);
        if (endDate) queryParams.set('endDate', endDate);

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        
        const response = await fetch(`${apiUrl}/analytics?${queryParams.toString()}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Cookie': `auth_token=${token}`
            },
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`API returned status ${response.status}`);
        }

        statsData = await response.json();
    } catch (error: any) {
        console.error('Error fetching analytics:', error);
        errorMsg = 'No pudimos cargar la información de analíticas. Asegúrate de que el backend esté en ejecución y tengas permisos suficientes.';
    }

    return (
        <div className="space-y-6">
            <DateFilterForm />
            
            {errorMsg ? (
                <div className="bg-red-50 text-red-600 p-6 rounded-2xl font-medium shadow-sm border border-red-100">
                    ⚠️ {errorMsg}
                </div>
            ) : !statsData ? (
                <div className="animate-pulse space-y-6">
                    <div className="h-32 bg-zinc-200 dark:bg-zinc-800 rounded-2xl w-full"></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="h-64 bg-zinc-200 dark:bg-zinc-800 rounded-2xl"></div>
                        <div className="h-64 bg-zinc-200 dark:bg-zinc-800 rounded-2xl"></div>
                    </div>
                </div>
            ) : (
                <ChartsWrapper data={statsData} />
            )}
        </div>
    );
}
