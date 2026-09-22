import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import {
  TEMPLATE_CONTRACTS,
  buildWhatsappRecipient,
  choqueDeNombre,
  variablesEsperadas,
} from '@agenia/shared';
import type {
  WhatsappMessageKind,
  WhatsappTemplateKind,
} from '@agenia/database';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappCredentialsService } from './whatsapp-credentials.service';
import { WhatsappMessageLogService } from './whatsapp-message-log.service';
import { metaGraphUrl } from './meta-graph';

/**
 * Para qué se manda cada plantilla, en el vocabulario del libro de mensajes.
 * `Record` sobre TODOS los tipos: agregar una plantilla nueva sin decir aquí
 * qué es no compila, en vez de registrarse en silencio con el tipo equivocado.
 */
const TIPO_DE_MENSAJE: Record<WhatsappTemplateKind, WhatsappMessageKind> = {
  APPOINTMENT_REMINDER: 'APPOINTMENT_REMINDER',
  WAITLIST_SLOT_OFFER: 'WAITLIST_OFFER',
  APPOINTMENT_CANCELLED_MASS: 'MASS_NOTICE',
  APPOINTMENT_REMINDER_MASS: 'MASS_NOTICE',
  // Aviso al personal (no a un paciente): el libro lo distingue de los envíos a pacientes.
  SYNC_EXCEPTION_ALERT: 'SYSTEM_NOTICE',
  // Confirmación al paciente de una cita que agendó el hospital (rastreo, §12 #7).
  HIS_APPOINTMENT_CONFIRMATION: 'BOOKING_CONFIRMATION',
};

/**
 * ══════════════════════════════════════════════════════════════════════════
 * ENVÍO DE PLANTILLAS DE WHATSAPP
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Meta sólo acepta TEXTO LIBRE dentro de las 24 h siguientes al último mensaje
 * del paciente ("ventana de atención"). Fuera de ella el envío se rechaza y
 * hay que usar una plantilla previamente APROBADA contra la WABA de la clínica.
 *
 * Por eso el nombre y el idioma de la plantilla son configuración POR
 * ORGANIZACIÓN (modelo `WhatsappTemplate`): la misma plantilla lógica puede
 * llamarse distinto en cada tenant, y una clínica puede tenerla aprobada
 * mientras otra todavía no.
 */
@Injectable()
export class WhatsappTemplateService {
  private readonly logger = new Logger(WhatsappTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly whatsappCredentials: WhatsappCredentialsService,
    private readonly messageLog: WhatsappMessageLogService,
  ) {}

  /**
   * Plantilla activa de un tipo para una organización, o `null` si esa clínica
   * todavía no la configuró/aprobó.
   */
  async findTemplate(organizationId: string, kind: WhatsappTemplateKind) {
    return this.prisma.whatsappTemplate.findFirst({
      where: { organizationId, kind, isActive: true },
    });
  }

  /** Plantillas de una clínica, para su pantalla de configuración. */
  async listForOrg(organizationId: string) {
    return this.prisma.whatsappTemplate.findMany({
      where: { organizationId },
      orderBy: { kind: 'asc' },
    });
  }

  /**
   * Registra (o actualiza) la plantilla de un tipo para una clínica.
   *
   * NO valida contra Meta que la plantilla exista y esté aprobada: eso sólo se
   * sabe al enviar, y el error de Meta llega literal a la auditoría. Aquí sólo
   * se guarda lo que la clínica declara haber aprobado.
   */
  async upsertForOrg(
    organizationId: string,
    input: {
      kind: WhatsappTemplateKind;
      name: string;
      language?: string;
      requestsContactInfo?: boolean;
      isActive?: boolean;
    },
  ) {
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException(
        'El nombre de la plantilla es obligatorio.',
      );
    }
    // Meta sólo acepta minúsculas, dígitos y guión bajo en el nombre.
    if (!/^[a-z0-9_]+$/.test(name)) {
      throw new BadRequestException(
        `Nombre de plantilla inválido ("${name}"). Meta sólo permite minúsculas, dígitos y guión bajo.`,
      );
    }

    // 🚨 Un mismo nombre no puede servir a dos tipos que mandan distinta
    // cantidad de variables: Meta rechaza uno de los dos envíos SIEMPRE, con
    // «number of parameters does not match», y el aviso que no salió solo se
    // descubre cuando alguien lo echa en falta. Se detectó el 2026-09-22 con
    // los cinco tipos apuntando a `recordatorio_cita`. Ver
    // packages/shared/src/whatsapp-template-contracts.ts.
    //
    // Solo entre plantillas ACTIVAS, y solo si esta va a quedar activa: una
    // apagada no envía nada, así que no puede chocar con nadie. Sin esta
    // salvedad el guardián se volvería una trampa — impediría APAGAR una
    // plantilla mal configurada, que es justo lo primero que hay que hacer
    // cuando se descubre el choque.
    const activa = input.isActive ?? true;
    if (activa) {
      const yaActivas = await this.prisma.whatsappTemplate.findMany({
        where: { organizationId, isActive: true },
        select: { kind: true, name: true },
      });
      const choque = choqueDeNombre(input.kind, name, yaActivas);
      if (choque) {
        throw new BadRequestException(
          `La plantilla "${name}" ya está asignada a «${TEMPLATE_CONTRACTS[choque.kind].label}», ` +
            `que manda ${choque.variables} variables, y «${TEMPLATE_CONTRACTS[input.kind].label}» manda ` +
            `${variablesEsperadas(input.kind)}. Una misma plantilla de Meta no puede servir a las dos: ` +
            `cree en Meta una plantilla aparte con ${variablesEsperadas(input.kind)} variables ` +
            `(${TEMPLATE_CONTRACTS[input.kind].variables.join(', ')}).`,
        );
      }
    }

    const language = input.language?.trim() || 'es';
    const data = {
      name,
      language,
      requestsContactInfo: input.requestsContactInfo ?? false,
      isActive: input.isActive ?? true,
    };

    return this.prisma.whatsappTemplate.upsert({
      // Compuesta por organización: una plantilla por tipo y por clínica.
      where: {
        organizationId_kind: { organizationId, kind: input.kind },
      },
      create: { organizationId, kind: input.kind, ...data },
      update: data,
    });
  }

  /** Elimina la plantilla de un tipo, siempre dentro del tenant indicado. */
  async removeForOrg(organizationId: string, kind: WhatsappTemplateKind) {
    await this.prisma.whatsappTemplate.deleteMany({
      where: { organizationId, kind },
    });
    return { success: true };
  }

  /**
   * Envía una plantilla aprobada.
   *
   * `bodyParams` son los marcadores posicionales del cuerpo (`{{1}}`, `{{2}}`…)
   * EN ORDEN. El contrato de cada tipo lo define quien llama: si la plantilla
   * aprobada en Meta espera otro orden u otra cantidad, Meta rechaza el envío
   * — por eso el error de la API se propaga tal cual en `error`, sin
   * reinterpretarlo.
   */
  async sendTemplate(params: {
    organizationId: string;
    recipientId: string;
    kind: WhatsappTemplateKind;
    bodyParams?: string[];
    /** Cita a la que se refiere (recordatorios): queda en el libro de mensajes. */
    appointmentId?: string | null;
  }): Promise<{ success: boolean; error?: string; templateName?: string }> {
    const { organizationId, recipientId, kind, bodyParams = [] } = params;

    if (!organizationId || !recipientId) {
      return { success: false, error: 'missing-params' };
    }

    // El contrato compartido es la única fuente de verdad sobre cuántos
    // `{{n}}` manda cada tipo. Si el código que arma `bodyParams` se separa
    // de él, el rechazo de Meta llega como un código opaco y con el envío ya
    // contado contra la calidad de la WABA; aquí se ve antes de salir.
    const esperadas = variablesEsperadas(kind);
    if (bodyParams.length !== esperadas) {
      this.logger.error(
        `Plantilla ${kind} (org ${organizationId}): se iban a mandar ${bodyParams.length} ` +
          `variables y el contrato declara ${esperadas}. Envío cancelado antes de llamar a Meta.`,
      );
      return { success: false, error: 'body-params-mismatch' };
    }

    const template = await this.findTemplate(organizationId, kind);
    if (!template) {
      // No es un error de red: es configuración que falta. El llamador decide
      // si degrada a texto libre (sólo válido dentro de la ventana) o si omite.
      return { success: false, error: 'template-not-configured' };
    }

    const creds = await this.whatsappCredentials.forOrg(organizationId);
    if (!creds || !creds.isActive) {
      return { success: false, error: 'whatsapp-inactive' };
    }

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      // Teléfono → `to`; BSUID → `recipient` (ver @agenia/shared).
      ...buildWhatsappRecipient(recipientId),
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        // `components` se omite cuando la plantilla no lleva variables: Meta
        // rechaza un arreglo de parámetros que no case con la aprobación.
        ...(bodyParams.length > 0
          ? {
              components: [
                {
                  type: 'body',
                  parameters: bodyParams.map((text) => ({
                    type: 'text',
                    text,
                  })),
                },
              ],
            }
          : {}),
      },
    };

    try {
      const response = await lastValueFrom(
        this.httpService.post<unknown>(
          metaGraphUrl(`${creds.phoneNumberId}/messages`),
          body,
          {
            headers: {
              Authorization: `Bearer ${creds.accessToken}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );
      // Se registra ANTES de devolver y sin lanzar nunca: si el libro falla,
      // la plantilla ya salió y el llamador debe enterarse de que se envió.
      await this.messageLog.recordOutbound({
        organizationId,
        recipientId,
        messageType: 'TEMPLATE',
        metaResponse: response.data,
        context: {
          kind: TIPO_DE_MENSAJE[kind],
          appointmentId: params.appointmentId ?? null,
        },
      });
      return { success: true, templateName: template.name };
    } catch (error) {
      // El error de Axios llega sin tipar; se extrae el cuerpo de Meta si viene.
      const axiosError = error as {
        response?: { data?: unknown };
        message?: string;
      };
      const detail =
        axiosError?.response?.data !== undefined
          ? JSON.stringify(axiosError.response.data)
          : (axiosError?.message ?? 'error desconocido');
      this.logger.error(
        `Error enviando plantilla "${template.name}" (${kind}) a ${recipientId} ` +
          `de org ${organizationId}: ${detail}`,
      );
      return { success: false, error: detail, templateName: template.name };
    }
  }
}
