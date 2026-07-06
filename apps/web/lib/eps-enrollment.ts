import { isParticularEps } from '@agenia/shared';
import { prisma } from './prisma';

// ─────────────────────────────────────────────────────────────
// PADRÓN EPS — verificación de alta para el agendamiento MANUAL del staff.
//
// Espeja la regla del chatbot (rejectIfNotEnrolledInEps): agendar POR EPS exige
// que la cédula esté dada de alta en el padrón (EpsEnrolledPatient). "Particular"
// (pago directo) o sin EPS NO pasan por el padrón.
//
// Es un READ puro: se llama ANTES de abrir la transacción de agendamiento para
// fallar rápido y no dejar escrituras a medias. Devuelve un mensaje de error
// listo para mostrar al agente, o `null` si el paciente puede agendar.
// ─────────────────────────────────────────────────────────────

// Solo necesitamos los modelos que consulta: acepta tanto el cliente global
// como un cliente de transacción sin acoplarnos al tipo completo de Prisma.
type PrismaReader = Pick<typeof prisma, 'eps' | 'epsEnrolledPatient'>;

export async function findEpsEnrollmentIssue(
    db: PrismaReader,
    params: { organizationId: string; epsId: string | null | undefined; cedula: string },
): Promise<string | null> {
    const { organizationId, epsId, cedula } = params;
    if (!epsId) return null; // Sin EPS asociada (Particular / pago directo) → no aplica.

    // Autoritativo: resolvemos la EPS por id DENTRO del tenant. "Particular"
    // vive como fila de Eps en BD, por eso se detecta por nombre.
    const eps = await db.eps.findFirst({
        where: { id: epsId, organizationId },
        select: { id: true, name: true },
    });
    // EPS inexistente en el tenant: no es asunto del padrón (otra validación falla luego).
    if (!eps || isParticularEps(eps.name)) return null;

    const normalizedCedula = cedula.replace(/\D/g, '');
    if (!normalizedCedula) return null; // La cédula vacía se rechaza por otra validación.

    const enrolled = await db.epsEnrolledPatient.findFirst({
        where: { organizationId, epsId: eps.id, cedula: normalizedCedula, isActive: true },
        select: { id: true },
    });
    if (enrolled) return null;

    return (
        `El paciente con documento ${normalizedCedula} no está dado de alta en el padrón de ${eps.name}. ` +
        `Regístrelo en "Padrón EPS (Altas)" (o revise su solicitud de alta) antes de agendar por esta EPS. ` +
        `Si la atención es de pago directo, seleccione "Particular".`
    );
}
