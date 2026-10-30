import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import SurveysExplorer from '@/app/components/surveys/SurveysExplorer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SuperAdminSurveysPage() {
  const session = await getSession();
  if (!session) redirect('/sesion-cerrada');
  if (session.role !== 'SUPER_ADMIN') {
    redirect('/dashboard');
  }

  // Catálogo de clínicas para el filtro (lectura directa, contexto Super Admin).
  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return <SurveysExplorer scope="global" organizations={organizations} />;
}
