import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import SurveysClient from './SurveysClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SuperAdminSurveysPage() {
  const session = await getSession();
  if (!session || session.role !== 'SUPER_ADMIN') {
    redirect('/dashboard');
  }

  // Catálogo de clínicas para el filtro (lectura directa, contexto Super Admin).
  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return <SurveysClient organizations={organizations} />;
}
