'use server';

import { prisma } from '../../lib/prisma';
import { getSession } from '../../lib/session';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@agenia/database';
import { getErrorMessage } from '../../lib/error';

export async function updateOrganizationBilling(
    orgId: string, 
    data: { monthlyFee?: string, lastPaymentDate?: string, autoSuspend?: boolean }
) {
    try {
        const session = await getSession();
        if (!session || session.role !== 'SUPER_ADMIN') {
            return { success: false, error: 'Unauthorized' };
        }

        const updateData: Prisma.OrganizationUpdateInput = {};
        if (data.monthlyFee !== undefined) updateData.monthlyFee = data.monthlyFee;
        if (data.autoSuspend !== undefined) updateData.autoSuspend = data.autoSuspend;
        
        if (data.lastPaymentDate !== undefined) {
            updateData.lastPaymentDate = data.lastPaymentDate ? new Date(data.lastPaymentDate) : null;
        }

        await prisma.organization.update({
            where: { id: orgId },
            data: updateData
        });

        revalidatePath('/super-admin/billing');
        return { success: true };
    } catch (e) {
        return { success: false, error: getErrorMessage(e) };
    }
}
