import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUTORIZACION_DATOS,
  isTelegramSender,
  normalizarVersionPolitica,
  type RespuestaAutorizacion,
} from '@agenia/shared';
import { Prisma } from '@agenia/database';
import { PrismaService } from '../prisma/prisma.service';
import type { SenderIdentity } from './sender-identity';
import { getErrorMessage } from '../common/error-message.util';

/** La autorización encendida de una clínica: qué versión y qué enlace se muestran. */
export interface ConfigAutorizacion {
  version: string;
  urlPolitica: string | null;
}

/**
 * 🔒 Autorización de tratamiento de datos por chat (Ley 1581 de 2012,
 * docs/PLAN_AUTORIZACION_DATOS.md). Guarda cada pregunta y cada respuesta en
 * `DataConsent` —la prueba que pide el Decreto 1377 de 2013— y responde si
 * alguien ya autorizó la versión vigente de la política.
 *
 * Va por remitente (número, BSUID o chat de Telegram): se pregunta antes de
 * saber de quién es la cita. Nunca lanza hacia el chat en las lecturas: si la
 * base falla, la autorización cuenta como apagada y el chat sigue como antes
 * (con el aviso legal en el resumen de la cita, que no se quita sin un SÍ
 * guardado).
 */
@Injectable()
export class AutorizacionDatosService {
  private readonly logger = new Logger(AutorizacionDatosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** El enlace general del servidor, para la clínica que no puso el suyo. */
  private urlDelServidor(): string | null {
    return this.config.get<string>('PRIVACY_POLICY_URL')?.trim() || null;
  }

  /** La configuración de la clínica si está ENCENDIDA; null si no (o si la lectura falla). */
  async configuracion(
    organizationId: string,
  ): Promise<ConfigAutorizacion | null> {
    try {
      const s = await this.prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: {
          dataConsentEnabled: true,
          dataPolicyUrl: true,
          dataPolicyVersion: true,
        },
      });
      if (!s?.dataConsentEnabled) return null;
      return {
        version: normalizarVersionPolitica(s.dataPolicyVersion),
        urlPolitica: s.dataPolicyUrl?.trim() || this.urlDelServidor(),
      };
    } catch (e) {
      this.logger.error(
        `No se pudo leer la autorización de datos (org ${organizationId}): ${getErrorMessage(e)}`,
      );
      return null;
    }
  }

  /**
   * El enlace que va en el aviso del resumen de la cita: el de la clínica si lo
   * puso, si no el del servidor (lo de siempre). Con la autorización apagada
   * también: es la misma política.
   */
  async urlPolitica(organizationId: string): Promise<string | undefined> {
    try {
      const s = await this.prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: { dataPolicyUrl: true },
      });
      return s?.dataPolicyUrl?.trim() || this.urlDelServidor() || undefined;
    } catch {
      return this.urlDelServidor() ?? undefined;
    }
  }

  /** Las filas de quien escribe: por su clave, su teléfono o su BSUID. */
  private delRemitente(
    organizationId: string,
    identity: SenderIdentity,
  ): Prisma.DataConsentWhereInput {
    const OR: Prisma.DataConsentWhereInput[] = [
      { senderKey: identity.senderId },
    ];
    if (identity.phone) OR.push({ phone: identity.phone });
    if (identity.bsuid) OR.push({ bsuid: identity.bsuid });
    return { organizationId, OR };
  }

  /** ¿Dijo SÍ a esta versión de la política y no la retiró después? */
  async vigente(
    organizationId: string,
    identity: SenderIdentity,
    version: string,
  ): Promise<boolean> {
    const donde = this.delRemitente(organizationId, identity);
    const [si, retiro] = await Promise.all([
      this.prisma.dataConsent.findFirst({
        where: { ...donde, status: 'ACCEPTED', policyVersion: version },
        orderBy: { answeredAt: 'desc' },
        select: { answeredAt: true },
      }),
      this.prisma.dataConsent.findFirst({
        where: { ...donde, status: 'REVOKED' },
        orderBy: { answeredAt: 'desc' },
        select: { answeredAt: true },
      }),
    ]);
    if (!si?.answeredAt) return false;
    return !retiro?.answeredAt || retiro.answeredAt < si.answeredAt;
  }

  /**
   * ¿Hay que pedirle la autorización antes de agendar? Devuelve la
   * configuración si está encendida y aún no autorizó; null si está apagada, si
   * ya autorizó o si la base falla (el chat sigue como siempre).
   */
  async necesitaPreguntar(
    organizationId: string,
    identity: SenderIdentity,
  ): Promise<ConfigAutorizacion | null> {
    const cfg = await this.configuracion(organizationId);
    if (!cfg) return null;
    try {
      return (await this.vigente(organizationId, identity, cfg.version))
        ? null
        : cfg;
    } catch (e) {
      this.logger.error(
        `No se pudo revisar la autorización de ${identity.senderId} (org ${organizationId}): ${getErrorMessage(e)}`,
      );
      return null;
    }
  }

  /**
   * ¿Ya autorizó (con la autorización encendida)? Así el resumen de la cita no
   * le repite el párrafo legal. Ante la duda, false: el párrafo se queda.
   */
  async autorizoYa(
    organizationId: string,
    identity: SenderIdentity,
  ): Promise<boolean> {
    const cfg = await this.configuracion(organizationId);
    if (!cfg) return false;
    try {
      return await this.vigente(organizationId, identity, cfg.version);
    } catch {
      return false;
    }
  }

  private canal(identity: SenderIdentity): 'WHATSAPP' | 'TELEGRAM' {
    return isTelegramSender(identity.senderId) ? 'TELEGRAM' : 'WHATSAPP';
  }

  private recortar(texto: string | null | undefined): string | null {
    const t = (texto ?? '').trim();
    return t ? t.slice(0, AUTORIZACION_DATOS.MAX_RESPUESTA_GUARDADA) : null;
  }

  /**
   * Guarda que se le preguntó. Con `filaId` (la pregunta abierta de esta
   * conversación, si sigue sin respuesta) solo suma una vez; si no, crea la fila
   * con el texto completo del aviso. Devuelve su id.
   */
  async registrarPregunta(
    organizationId: string,
    identity: SenderIdentity,
    p: {
      filaId: string | null;
      version: string;
      urlPolitica: string | null;
      aviso: string;
    },
  ): Promise<string> {
    if (p.filaId) {
      const { count } = await this.prisma.dataConsent.updateMany({
        where: { id: p.filaId, organizationId, status: 'PENDING' },
        data: { timesAsked: { increment: 1 } },
      });
      if (count > 0) return p.filaId;
    }
    const fila = await this.prisma.dataConsent.create({
      data: {
        organizationId,
        channel: this.canal(identity),
        senderKey: identity.senderId,
        phone: identity.phone,
        bsuid: identity.bsuid,
        policyVersion: p.version,
        policyUrl: p.urlPolitica,
        noticeText: p.aviso,
      },
      select: { id: true },
    });
    return fila.id;
  }

  /**
   * Guarda el SÍ o el NO en la pregunta abierta (la de `filaId`, o la última sin
   * respuesta de esta versión). Si no la encuentra, crea una fila completa: la
   * respuesta nunca se pierde. Una respuesta dada no se vuelve a escribir.
   */
  async registrarRespuesta(
    organizationId: string,
    identity: SenderIdentity,
    p: {
      filaId: string | null;
      version: string;
      urlPolitica: string | null;
      aviso: string;
      respuesta: RespuestaAutorizacion;
      texto: string | null | undefined;
      via: 'TEXT' | 'VOICE';
    },
  ): Promise<void> {
    const data = {
      status:
        p.respuesta === 'SI' ? ('ACCEPTED' as const) : ('REJECTED' as const),
      answerText: this.recortar(p.texto),
      answerVia: p.via,
      answeredAt: new Date(),
    };
    const abierta = p.filaId
      ? { id: p.filaId }
      : await this.prisma.dataConsent.findFirst({
          where: {
            ...this.delRemitente(organizationId, identity),
            status: 'PENDING',
            policyVersion: p.version,
          },
          orderBy: { askedAt: 'desc' },
          select: { id: true },
        });
    if (abierta) {
      const { count } = await this.prisma.dataConsent.updateMany({
        where: { id: abierta.id, organizationId, status: 'PENDING' },
        data,
      });
      if (count > 0) return;
    }
    await this.prisma.dataConsent.create({
      data: {
        organizationId,
        channel: this.canal(identity),
        senderKey: identity.senderId,
        phone: identity.phone,
        bsuid: identity.bsuid,
        policyVersion: p.version,
        policyUrl: p.urlPolitica,
        noticeText: p.aviso,
        ...data,
      },
    });
  }

  /** «Retiro mi autorización»: una fila REVOKED con lo que escribió y lo que se le respondió. */
  async retirar(
    organizationId: string,
    identity: SenderIdentity,
    p: {
      version: string;
      urlPolitica: string | null;
      texto: string | null | undefined;
      respuesta: string;
    },
  ): Promise<void> {
    const ahora = new Date();
    await this.prisma.dataConsent.create({
      data: {
        organizationId,
        channel: this.canal(identity),
        senderKey: identity.senderId,
        phone: identity.phone,
        bsuid: identity.bsuid,
        status: 'REVOKED',
        policyVersion: p.version,
        policyUrl: p.urlPolitica,
        noticeText: p.respuesta,
        answerText: this.recortar(p.texto),
        answerVia: 'TEXT',
        askedAt: ahora,
        answeredAt: ahora,
      },
    });
  }

  /**
   * El paciente que se acaba de registrar desde este chat queda enlazado a la
   * autorización vigente (su prueba). Sin autorización vigente no hace nada, y
   * si falla solo lo anota: nunca frena una cita.
   */
  async enlazarPaciente(
    organizationId: string,
    identity: SenderIdentity,
    patientId: string,
  ): Promise<void> {
    try {
      const cfg = await this.configuracion(organizationId);
      if (!cfg) return;
      if (!(await this.vigente(organizationId, identity, cfg.version))) return;
      const fila = await this.prisma.dataConsent.findFirst({
        where: {
          ...this.delRemitente(organizationId, identity),
          status: 'ACCEPTED',
          policyVersion: cfg.version,
        },
        orderBy: { answeredAt: 'desc' },
        select: { id: true, patientIds: true },
      });
      if (!fila || fila.patientIds.includes(patientId)) return;
      await this.prisma.dataConsent.update({
        where: { id: fila.id },
        data: { patientIds: { push: patientId } },
      });
    } catch (e) {
      this.logger.error(
        `No se pudo enlazar el paciente ${patientId} a su autorización (org ${organizationId}): ${getErrorMessage(e)}`,
      );
    }
  }
}
