import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import ClinicSurveysClient from './ClinicSurveysClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ClinicSurveysPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'ORG_ADMIN') redirect('/dashboard');

  // El scoping real lo aplica el backend (orgId del token === :orgId).
  return <ClinicSurveysClient />;
}
