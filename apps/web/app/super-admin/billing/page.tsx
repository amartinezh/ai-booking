import { prisma } from '../../../lib/prisma';
import { getSession } from '../../../lib/session';
import { redirect } from 'next/navigation';
import BillingClient from './components/BillingClient';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
    const session = await getSession();

    if (!session || session.role !== 'SUPER_ADMIN') {
        redirect('/dashboard');
    }

    const organizations = await prisma.organization.findMany({
        orderBy: { name: 'asc' },
        select: {
            id: true,
            name: true,
            isActive: true,
            monthlyFee: true,
            lastPaymentDate: true,
            autoSuspend: true
        }
    });

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Facturación Global</h1>
                    <p className="text-zinc-500 dark:text-zinc-400 mt-2">
                        Controla el apagado automático y los datos de pago de las clínicas afiliadas.
                    </p>
                </div>
            </div>

            <BillingClient organizations={organizations} />
        </div>
    );
}
