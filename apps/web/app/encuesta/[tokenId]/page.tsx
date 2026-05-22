import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import SurveyForm from './SurveyForm';

// El enlace llega desde WhatsApp y NO debe cachearse: la validez depende del
// estado actual del token (isUsed/expiresAt) en la base de datos.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Encuesta de satisfacción',
  robots: { index: false, follow: false },
};

export default async function EncuestaPage(props: {
  params: Promise<{ tokenId: string }>;
}) {
  const { tokenId } = await props.params;

  // 🔐 PROTECCIÓN SERVER-SIDE — cero accesos manuales.
  // Validamos el token consultando Prisma directamente (mismo patrón que el
  // resto del dashboard). Si no existe, ya se usó o expiró → al Home.
  const survey = tokenId
    ? await prisma.chatSurvey.findUnique({
        where: { id: tokenId },
        select: {
          id: true,
          isUsed: true,
          expiresAt: true,
          organization: { select: { name: true } },
        },
      })
    : null;

  const isValid =
    !!survey && !survey.isUsed && survey.expiresAt.getTime() > Date.now();

  if (!isValid) {
    redirect('/');
  }

  return (
    <SurveyForm
      tokenId={survey!.id}
      clinicName={survey!.organization?.name ?? 'nuestra clínica'}
    />
  );
}
