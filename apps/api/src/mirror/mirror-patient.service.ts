import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@agenia/database';
import {
  decidirAlta,
  documentoSinCerosIniciales,
  normalizeDocumento,
  normalizePhoneToE164Co,
  notaDeAlta,
  variantesDeTelefono,
  type CanonicalChangeEvent,
  type DecisionAlta,
  type MotivoSinAlta,
  type PerfilCandidato,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { getErrorMessage } from '../common/error-message.util';

/**
 * 🏥 El paciente de una cita nacida en el HOSPITAL: se reutiliza el que ya existe o se
 * da de alta en caliente (docs/PLAN_ALTA_EN_CALIENTE.md).
 *
 * Aquí solo se LEE y se ESCRIBE la base: **qué** hacer lo decide la regla pura
 * `decidirAlta` de `@agenia/shared`, para que sea la misma que explica el rastreo y se
 * pueda probar sin base de datos. Este servicio aporta lo que la regla no puede saber:
 * qué perfiles existen, si hay una baja registrada y de quién es ese teléfono.
 *
 * ═══ Lo que NO hace ═══
 *  · No importa pacientes en bloque: solo el de la cita que acaba de llegar
 *    (`PLAN_ESPEJO_HOSPITAL.md` §5.3, recolección mínima).
 *  · No toca el HIS: es la dirección de entrada.
 *  · No fusiona perfiles. Si el documento es ambiguo, no elige (D3).
 *  · No sobrescribe un WhatsApp que el paciente ya tenía en AgenIA: el del HIS solo
 *    se usa para rellenar un hueco.
 */

export type ResultadoAlta =
  | { pacienteId: string; creado: boolean; nota: string }
  | {
      pacienteId: null;
      motivo: MotivoSinAlta;
      /** Perfiles que podrían ser la persona, cuando el documento es ambiguo (D3). */
      candidatos: string[];
      nota: string;
    };

/** Perfiles que se traen para decidir; más de esto ya es un problema de datos, no un caso. */
const MAX_CANDIDATOS = 10;

@Injectable()
export class MirrorPatientService {
  private readonly logger = new Logger(MirrorPatientService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolverOCrear(
    organizationId: string,
    payload: CanonicalChangeEvent['payload'],
  ): Promise<ResultadoAlta> {
    const documento = normalizeDocumento(payload.patientDocument);
    const sinCeros = documentoSinCerosIniciales(documento);

    const [perfiles, baja, duenosDelTelefono] = await Promise.all([
      this.perfilesPorDocumento(organizationId, sinCeros),
      this.prisma.mirrorPatientOptOut.findUnique({
        where: {
          organizationId_document: { organizationId, document: sinCeros },
        },
        select: { id: true },
      }),
      this.duenosDelTelefono(organizationId, payload.patientPhone),
    ]);

    const decision = decidirAlta({
      documento,
      nombre: payload.patientFullName,
      telefono: payload.patientPhone,
      perfiles,
      bajaSolicitada: baja !== null,
      duenosDelTelefono,
      normalizarTelefono: normalizePhoneToE164Co,
    });
    const nota = notaDeAlta(decision);

    if (decision.accion === 'NO_CREAR') {
      return {
        pacienteId: null,
        motivo: decision.motivo,
        candidatos: decision.candidatos,
        nota,
      };
    }

    if (decision.accion === 'REUTILIZAR') {
      await this.completarTelefono(decision, perfiles);
      return { pacienteId: decision.pacienteId, creado: false, nota };
    }

    try {
      const pacienteId = await this.crear(organizationId, decision, payload);
      return { pacienteId, creado: true, nota };
    } catch (error: unknown) {
      // 🏁 Otra réplica (o el propio bot, si el paciente escribió en ese instante) lo
      // creó primero: la cédula es única por clínica. Se relee y se usa ese.
      if ((error as { code?: string })?.code === 'P2002') {
        const ahora = await this.perfilesPorDocumento(organizationId, sinCeros);
        const unico = ahora.length === 1 ? ahora[0] : null;
        if (unico) {
          return {
            pacienteId: unico.id,
            creado: false,
            nota: 'paciente ya conocido (lo creó otro proceso a la vez)',
          };
        }
      }
      throw error;
    }
  }

  /**
   * Registra la baja de un documento: no se vuelve a dar de alta solo (D10). Idempotente.
   */
  async registrarBaja(
    organizationId: string,
    documento: string,
    datos: { reason?: string | null; createdByUserId?: string | null } = {},
  ): Promise<void> {
    const document = documentoSinCerosIniciales(normalizeDocumento(documento));
    if (!document || document === '0') return;
    await this.prisma.mirrorPatientOptOut.upsert({
      where: { organizationId_document: { organizationId, document } },
      create: {
        organizationId,
        document,
        reason: datos.reason?.slice(0, 300) ?? null,
        createdByUserId: datos.createdByUserId ?? null,
      },
      update: {},
    });
  }

  /**
   * Los perfiles cuyo documento es «el mismo número» que el del HIS: se compara sin
   * ceros a la izquierda, en SQL, porque es lo que hace que `0012345` y `12345` sean
   * candidatos de la misma persona (y lo que obliga a no elegir cuando hay dos).
   */
  private async perfilesPorDocumento(
    organizationId: string,
    sinCeros: string,
  ): Promise<PerfilCandidato[]> {
    return this.prisma.$queryRaw<PerfilCandidato[]>(Prisma.sql`
      SELECT id, cedula, "whatsappId", bsuid
        FROM "PatientProfile"
       WHERE "organizationId" = ${organizationId}
         AND regexp_replace("cedula", '^0+', '') = ${sinCeros}
       LIMIT ${MAX_CANDIDATOS}`);
  }

  /** ¿De quién es ya ese teléfono en esta clínica? (D4) */
  private async duenosDelTelefono(
    organizationId: string,
    telefono: string | null | undefined,
  ): Promise<{ id: string; cedula: string }[]> {
    const e164 = normalizePhoneToE164Co((telefono ?? '').trim());
    if (!e164) return [];
    // Las dos formas con que un teléfono puede estar guardado (con y sin el 57).
    const variantes = variantesDeTelefono(e164.replace(/\D/g, ''));
    if (variantes.length === 0) return [];
    return this.prisma.patientProfile.findMany({
      where: { organizationId, whatsappId: { in: variantes } },
      select: { id: true, cedula: true },
      take: MAX_CANDIDATOS,
    });
  }

  /**
   * Un paciente que ya existía pero sin WhatsApp, y el HIS tiene uno: se rellena el
   * hueco. NUNCA se pisa el que ya tenía — ese lo puso él mismo al escribirle al bot,
   * y es más confiable que el del HIS.
   */
  private async completarTelefono(
    decision: Extract<DecisionAlta, { accion: 'REUTILIZAR' }>,
    perfiles: PerfilCandidato[],
  ): Promise<void> {
    const numero = decision.telefono.numero;
    if (!numero) return;
    const perfil = perfiles.find((p) => p.id === decision.pacienteId);
    if (!perfil || perfil.whatsappId || perfil.bsuid) return;
    try {
      await this.prisma.patientProfile.update({
        where: { id: decision.pacienteId },
        data: { whatsappId: numero },
      });
    } catch (error: unknown) {
      // No es crítico: la cita se crea igual, solo se queda sin recordatorio.
      this.logger.warn(
        `No se pudo guardar el teléfono del HIS en el paciente ${decision.pacienteId}: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Crea el paciente con lo MÍNIMO (D9): documento, nombre, teléfono y, si el evento
   * los trae, nacimiento, sexo y régimen. Nada de dirección, correo ni diagnóstico.
   *
   * La EPS se hereda del padrón cuando el documento está dado de alta en una sola EPS
   * (D6): sin ella, un agendador acotado a una EPS no vería la cita en su bandeja.
   *
   * El `User` es el mismo patrón temporal del bot: el paciente no tiene contraseña ni
   * entra al panel, pero `PatientProfile.userId` es obligatorio.
   */
  private async crear(
    organizationId: string,
    decision: Extract<DecisionAlta, { accion: 'CREAR' }>,
    payload: CanonicalChangeEvent['payload'],
  ): Promise<string> {
    const epsId = await this.epsDelPadron(organizationId, decision.documento);
    const nacimiento = this.fechaValida(payload.patientBirthDateIso);
    return this.prisma.$transaction(async (tx) => {
      const usuario = await tx.user.create({
        data: {
          email: `his_${Date.now()}_${decision.documento}@paciente.local`,
          password: 'none',
          role: 'PATIENT',
          organizationId,
        },
      });
      const paciente = await tx.patientProfile.create({
        data: {
          cedula: decision.documento,
          fullName: decision.nombre,
          whatsappId: decision.telefono.numero,
          userId: usuario.id,
          organizationId,
          epsId,
          ...(nacimiento ? { dateOfBirth: nacimiento } : {}),
          ...(payload.patientGender ? { gender: payload.patientGender } : {}),
          ...(payload.patientRegime ? { regime: payload.patientRegime } : {}),
        },
        select: { id: true },
      });
      return paciente.id;
    });
  }

  /** La EPS del padrón, solo si el documento está dado de alta en UNA sola. */
  private async epsDelPadron(
    organizationId: string,
    documento: string,
  ): Promise<string | null> {
    const candidatos = [
      ...new Set([documento, documentoSinCerosIniciales(documento)]),
    ];
    const filas = await this.prisma.epsEnrolledPatient.findMany({
      where: { organizationId, cedula: { in: candidatos }, isActive: true },
      select: { epsId: true },
      distinct: ['epsId'],
      take: 2,
    });
    return filas.length === 1 ? filas[0].epsId : null;
  }

  /** Una fecha del HIS utilizable; hay filas legadas con valores imposibles. */
  private fechaValida(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return null;
    const anio = fecha.getUTCFullYear();
    return anio >= 1900 && anio <= new Date().getUTCFullYear() ? fecha : null;
  }
}
