import { redirect } from 'next/navigation';

/** Encuestas se mudó a `/dashboard/encuestas` (docs/PLAN_NAVEGACION.md, Fase 3): la dirección vieja lleva allá. */
export default function EncuestasDireccionVieja() {
    redirect('/dashboard/encuestas');
}
