import { redirect } from 'next/navigation';

/**
 * 🚦 El Límite de citas por paciente ya no es una opción del menú: vive en
 * Configuración › Qué puede hacer el asistente (docs/PLAN_NAVEGACION.md, N5).
 * La dirección vieja lleva allá; `desde` hace que la sección explique que se movió.
 */
export default function LimitesCitasPage() {
    redirect('/dashboard/configuracion/asistente?desde=limites-citas#limite');
}
