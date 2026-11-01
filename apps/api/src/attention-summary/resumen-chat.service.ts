import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@agenia/database';
import {
  DEFAULT_TIMEZONE,
  LIMITES_ENVIO_RESUMEN,
  chatIdFromTelegramSender,
  entregaDelPayload,
  formatDateOnly,
  formatTimeOnly,
  intencionDeResumenes,
  isTelegramSender,
  parseFechaNacimiento,
  pideSusDocumentos,
  variantesDeTelefono,
} from '@agenia/shared';
import type { ResumenAtencionHis } from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { RedisService } from '../redis/redis.service';
import { ResumenDocumentosService } from './resumen-documentos.service';
import { ResumenEnlacesService } from './resumen-enlaces.service';
import { ResumenWhatsappService } from './resumen-whatsapp.service';
import { TelegramChannelService } from '../telegram/telegram-channel.service';
import { hashDelDestino } from './resumen-envio.service';
import { TEXTOS_RESUMEN } from './resumen-textos';

const MS_DIA = 86_400_000;
/** Mientras se espera la fecha de nacimiento, el asistente sabe a qué envío pertenece. */
const llavePendiente = (organizationId: string, remitente: string) =>
  `resumen_fecha:${organizationId}:${remitente}`;

const SELECT_ENTREGA = {
  id: true,
  failedAttempts: true,
  lockedUntil: true,
  destinationHash: true,
  attentionSummary: {
    select: {
      id: true,
      organizationId: true,
      patientProfileId: true,
      content: true,
      contentExpiresAt: true,
      organization: { select: { timezone: true } },
    },
  },
} as const;

type Entrega = {
  id: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  destinationHash: string;
  attentionSummary: {
    id: string;
    organizationId: string;
    patientProfileId: string | null;
    content: string | null;
    contentExpiresAt: Date;
    organization: { timezone: string | null };
  };
};

/**
 * 💬 El resumen de la atención dentro del chat de WhatsApp (plan §3.3, D23).
 *
 * El asistente le pasa aquí, antes de su flujo de siempre:
 *  · el toque del botón «Recibir mis documentos» (plantilla o mensaje con botón);
 *  · el texto, por si es la fecha de nacimiento que se pidió o «mis documentos».
 * Si devuelve `true`, el mensaje ya se atendió y el asistente no sigue.
 *
 * Al tocar el botón:
 *  · si el número ya está verificado (el paciente escribió al asistente desde
 *    ese número y es el de su ficha), salen los documentos;
 *  · si no, se pide la fecha de nacimiento: 5 equivocadas bloquean una hora (D4).
 * Los documentos salen como PDF y una imagen por hoja, con el enlace a la
 * página para volver a descargarlos. Nada clínico sale sin el toque.
 *
 * Por Telegram (D26) el botón es de teclado: al tocarlo manda «Recibir mis
 * documentos» como un mensaje, que entra por aquí como texto. El chat unido a
 * la ficha cuenta como verificado (D23).
 *
 * También la baja escrita: «no quiero resúmenes» (y «activar resúmenes»).
 */
@Injectable()
export class ResumenChatService {
  private readonly logger = new Logger(ResumenChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly documentos: ResumenDocumentosService,
    private readonly enlaces: ResumenEnlacesService,
    private readonly whatsapp: ResumenWhatsappService,
    // Opcional: sin él (tests), los remitentes de Telegram siguen al asistente.
    @Optional() private readonly telegram?: TelegramChannelService,
  ) {}

  /** Un texto al remitente, por su canal. En Telegram puede quitar el botón de teclado. */
  private async texto(
    organizationId: string,
    remitente: string,
    cuerpo: string,
    opciones: { quitarTeclado?: boolean } = {},
  ): Promise<boolean> {
    if (isTelegramSender(remitente)) {
      if (!this.telegram) return false;
      const r = await this.telegram.sendTextConTeclado(
        organizationId,
        remitente,
        cuerpo,
        { quitar: opciones.quitarTeclado },
        { kind: 'ATTENTION_SUMMARY' },
      );
      return r.ok;
    }
    return (await this.whatsapp.texto(organizationId, remitente, cuerpo)).ok;
  }

  /** El toque de un botón. `true` si era de un resumen (y ya se atendió). */
  async manejarBoton(
    organizationId: string,
    remitente: string,
    payload: unknown,
  ): Promise<boolean> {
    const id = entregaDelPayload(payload);
    if (!id || isTelegramSender(remitente)) return false;
    const entrega = await this.prisma.attentionSummaryDelivery.findFirst({
      where: { id, channel: 'WHATSAPP', attentionSummary: { organizationId } },
      select: SELECT_ENTREGA,
    });
    if (!entrega || entrega.destinationHash !== hashDelDestino(remitente)) {
      // Un botón reenviado a otro número no abre nada.
      await this.texto(organizationId, remitente, TEXTOS_RESUMEN.otroNumero);
      return true;
    }
    await this.iniciar(organizationId, remitente, entrega);
    return true;
  }

  /**
   * Un texto: la fecha de nacimiento que se pidió, o «mis documentos». Si no es
   * ninguna de las dos, `false` y el asistente sigue como siempre.
   */
  async manejarTexto(
    organizationId: string,
    remitente: string,
    texto: string | undefined,
  ): Promise<boolean> {
    if (!texto) return false;
    if (isTelegramSender(remitente) && !this.telegram) return false;

    // La baja (o el alta) va primero: es una decisión sobre sus datos.
    const intencion = intencionDeResumenes(texto);
    if (intencion) {
      await this.cambiarBaja(organizationId, remitente, intencion === 'BAJA');
      return true;
    }

    let pendiente: string | null = null;
    try {
      pendiente = await this.redis.get(
        llavePendiente(organizationId, remitente),
      );
    } catch {
      pendiente = null;
    }
    if (pendiente)
      return this.recibirFecha(organizationId, remitente, pendiente, texto);

    if (!pideSusDocumentos(texto)) return false;
    const entrega = await this.prisma.attentionSummaryDelivery.findFirst({
      where: {
        // La huella ya distingue el canal: un chat de Telegram es «tg:<chat>».
        destinationHash: hashDelDestino(remitente),
        createdAt: { gte: new Date(Date.now() - 30 * MS_DIA) },
        attentionSummary: { organizationId },
      },
      orderBy: { createdAt: 'desc' },
      select: SELECT_ENTREGA,
    });
    if (!entrega) {
      await this.texto(organizationId, remitente, TEXTOS_RESUMEN.sinDocumentos);
      return true;
    }
    await this.iniciar(organizationId, remitente, entrega);
    return true;
  }

  private resumenDe(e: Entrega): ResumenAtencionHis | null {
    return e.attentionSummary.content
      ? (JSON.parse(
          this.crypto.decrypt(e.attentionSummary.content),
        ) as ResumenAtencionHis)
      : null;
  }

  private timeZone(e: Entrega): string {
    return e.attentionSummary.organization.timezone || DEFAULT_TIMEZONE;
  }

  private async iniciar(
    organizationId: string,
    remitente: string,
    e: Entrega,
  ): Promise<void> {
    const resumen = this.resumenDe(e);
    if (!resumen) {
      await this.texto(organizationId, remitente, TEXTOS_RESUMEN.noDisponible);
      return;
    }
    if (e.lockedUntil && e.lockedUntil.getTime() > Date.now()) {
      await this.texto(
        organizationId,
        remitente,
        TEXTOS_RESUMEN.bloqueado(
          formatTimeOnly(e.lockedUntil, { timeZone: this.timeZone(e) }),
        ),
      );
      return;
    }
    if (
      await this.numeroVerificado(
        organizationId,
        remitente,
        e.attentionSummary.patientProfileId,
      )
    ) {
      await this.entregar(organizationId, remitente, e, resumen, 'NUMERO');
      return;
    }
    if (!fechaDelHis(resumen)) {
      await this.texto(organizationId, remitente, TEXTOS_RESUMEN.sinFecha);
      return;
    }
    await this.redis.set(
      llavePendiente(organizationId, remitente),
      e.id,
      'EX',
      LIMITES_ENVIO_RESUMEN.esperaFechaMinutos * 60,
    );
    await this.texto(organizationId, remitente, TEXTOS_RESUMEN.pedirFecha);
  }

  /**
   * Verificado = es el número de la ficha del paciente y ya le escribió al
   * asistente desde ahí (D23). Un número que solo vino del HIS no cuenta.
   */
  private async numeroVerificado(
    organizationId: string,
    remitente: string,
    patientProfileId: string | null,
  ): Promise<boolean> {
    if (!patientProfileId) return false;
    const perfil = await this.prisma.patientProfile.findUnique({
      where: { id: patientProfileId },
      select: { whatsappId: true, bsuid: true, telegramChatId: true },
    });
    // Telegram: el chat quedó unido a la ficha cuando el paciente se identificó.
    if (isTelegramSender(remitente)) {
      const chat = chatIdFromTelegramSender(remitente);
      return !!perfil && !!chat && perfil.telegramChatId === chat;
    }
    if (
      !perfil ||
      (perfil.whatsappId !== remitente && perfil.bsuid !== remitente)
    )
      return false;
    const escribio = await this.prisma.interactionLog.findFirst({
      where: {
        organizationId,
        whatsappId: remitente,
        status: { not: 'OUTBOUND' },
      },
      select: { id: true },
    });
    return escribio !== null;
  }

  private async recibirFecha(
    organizationId: string,
    remitente: string,
    entregaId: string,
    texto: string,
  ): Promise<boolean> {
    const escrita = parseFechaNacimiento(texto);
    if (!escrita) {
      // No parece una fecha: el paciente cambió de tema; el asistente sigue.
      await this.redis.del(llavePendiente(organizationId, remitente));
      return false;
    }
    const e = await this.prisma.attentionSummaryDelivery.findFirst({
      where: { id: entregaId, attentionSummary: { organizationId } },
      select: SELECT_ENTREGA,
    });
    const resumen = e ? this.resumenDe(e) : null;
    if (!e || !resumen) {
      await this.redis.del(llavePendiente(organizationId, remitente));
      await this.texto(organizationId, remitente, TEXTOS_RESUMEN.noDisponible);
      return true;
    }
    if (e.lockedUntil && e.lockedUntil.getTime() > Date.now()) {
      await this.redis.del(llavePendiente(organizationId, remitente));
      await this.texto(
        organizationId,
        remitente,
        TEXTOS_RESUMEN.bloqueado(
          formatTimeOnly(e.lockedUntil, { timeZone: this.timeZone(e) }),
        ),
      );
      return true;
    }

    const real = fechaDelHis(resumen);
    if (real && real === escrita.iso.slice(0, 10)) {
      await this.redis.del(llavePendiente(organizationId, remitente));
      await this.prisma.attentionSummaryDelivery.update({
        where: { id: e.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      await this.entregar(
        organizationId,
        remitente,
        e,
        resumen,
        'FECHA_NACIMIENTO',
      );
      return true;
    }

    const tras = await this.prisma.attentionSummaryDelivery.update({
      where: { id: e.id },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    await this.prisma.attentionSummaryAccess.create({
      data: {
        attentionSummaryId: e.attentionSummary.id,
        kind: 'VERIFICAR_FALLO',
        documentId: isTelegramSender(remitente) ? 'telegram' : 'whatsapp',
      },
    });
    if (tras.failedAttempts >= LIMITES_ENVIO_RESUMEN.intentosFecha) {
      const hasta = new Date(
        Date.now() + LIMITES_ENVIO_RESUMEN.bloqueoMinutos * 60_000,
      );
      await this.prisma.attentionSummaryDelivery.update({
        where: { id: e.id },
        data: { failedAttempts: 0, lockedUntil: hasta },
      });
      await this.redis.del(llavePendiente(organizationId, remitente));
      await this.texto(
        organizationId,
        remitente,
        TEXTOS_RESUMEN.bloqueado(
          formatTimeOnly(hasta, { timeZone: this.timeZone(e) }),
        ),
      );
      return true;
    }
    await this.texto(
      organizationId,
      remitente,
      TEXTOS_RESUMEN.fechaIncorrecta(
        LIMITES_ENVIO_RESUMEN.intentosFecha - tras.failedAttempts,
      ),
    );
    return true;
  }

  /** Cada documento en PDF y una imagen por hoja, y el enlace para volver a descargarlos. */
  private async entregar(
    organizationId: string,
    remitente: string,
    e: Entrega,
    resumen: ResumenAtencionHis,
    verificadoPor: 'NUMERO' | 'FECHA_NACIMIENTO',
  ): Promise<void> {
    const timeZone = this.timeZone(e);
    await this.texto(
      organizationId,
      remitente,
      TEXTOS_RESUMEN.enviando(
        formatDateOnly(resumen.historia.guardadaIso, { timeZone }),
      ),
    );
    const g = await this.documentos.generador(organizationId, resumen);
    const porTelegram = isTelegramSender(remitente);
    let fallos = 0;
    if (porTelegram && this.telegram) {
      const ctx = { kind: 'ATTENTION_SUMMARY' as const };
      for (const doc of g.listar()) {
        const pdf = await g.pdf(doc.id);
        if (
          !pdf ||
          !(
            await this.telegram.sendDocument(
              organizationId,
              remitente,
              pdf.datos,
              pdf.nombreArchivo,
              pdf.tipo,
              ctx,
            )
          ).ok
        )
          fallos++;
        const fotos: { datos: Buffer; nombre: string; pie?: string }[] = [];
        for (let h = 1; h <= doc.hojas; h++) {
          const png = await g.png(doc.id, h);
          if (png)
            fotos.push({
              datos: png.datos,
              nombre: png.nombreArchivo,
              ...(h === 1 ? { pie: doc.titulo } : {}),
            });
          else fallos++;
        }
        if (
          fotos.length &&
          !(
            await this.telegram.sendFotos(organizationId, remitente, fotos, ctx)
          ).ok
        )
          fallos++;
      }
    }
    for (const doc of porTelegram ? [] : g.listar()) {
      const pdf = await g.pdf(doc.id);
      const idPdf = pdf
        ? await this.whatsapp.subir(
            organizationId,
            pdf.datos,
            pdf.tipo,
            pdf.nombreArchivo,
          )
        : null;
      if (
        !pdf ||
        !idPdf ||
        !(
          await this.whatsapp.documento(
            organizationId,
            remitente,
            idPdf,
            pdf.nombreArchivo,
          )
        ).ok
      )
        fallos++;
      for (let h = 1; h <= doc.hojas; h++) {
        const png = await g.png(doc.id, h);
        const idPng = png
          ? await this.whatsapp.subir(
              organizationId,
              png.datos,
              png.tipo,
              png.nombreArchivo,
            )
          : null;
        const pie =
          doc.hojas > 1
            ? `${doc.titulo} (hoja ${h} de ${doc.hojas})`
            : doc.titulo;
        if (
          !png ||
          !idPng ||
          !(await this.whatsapp.imagen(organizationId, remitente, idPng, pie))
            .ok
        )
          fallos++;
      }
    }

    let enlace: string | null = null;
    const base = (process.env.PUBLIC_WEB_URL ?? '').replace(/\/+$/, '');
    if (base) {
      const { token } = await this.enlaces.crearEnlace(
        e.attentionSummary.id,
        e.attentionSummary.contentExpiresAt,
        'PACIENTE',
        null,
      );
      enlace = `${base}/resumen/${token}`;
    }
    await this.texto(
      organizationId,
      remitente,
      fallos ? TEXTOS_RESUMEN.incompleto(enlace) : TEXTOS_RESUMEN.listo(enlace),
      { quitarTeclado: true },
    );

    await this.prisma.attentionSummaryDelivery.update({
      where: { id: e.id },
      data: {
        status: fallos ? 'FALLO' : 'DOCUMENTOS_ENVIADOS',
        statusReason: fallos ? `${fallos} archivo(s) no salieron` : null,
        verifiedBy: verificadoPor,
        documentsSentAt: new Date(),
      },
    });
    await this.prisma.attentionSummaryAccess.create({
      data: {
        attentionSummaryId: e.attentionSummary.id,
        kind: 'VERIFICAR_OK',
        documentId: `${porTelegram ? 'telegram' : 'whatsapp'}:${verificadoPor === 'NUMERO' ? 'numero' : 'fecha'}`,
      },
    });
    await this.prisma.attentionSummaryAccess.create({
      data: {
        attentionSummaryId: e.attentionSummary.id,
        kind: 'DOCUMENTO',
        documentId: `${porTelegram ? 'telegram' : 'whatsapp'}:todos`,
      },
    });
    if (fallos)
      this.logger.warn(
        `Resumen ${e.attentionSummary.id}: ${fallos} archivo(s) no salieron por ${porTelegram ? 'Telegram' : 'WhatsApp'}.`,
      );
  }

  /**
   * «no quiero resúmenes» / «activar resúmenes» (plan §3.6). Vale para el
   * número (o el chat) desde el que escribe, tenga ficha o no, y para todas las
   * fichas de la clínica con ese número: como la baja de recordatorios. Por
   * Telegram, solo por su chat (quitarle el prefijo a `tg:` daría un número que
   * puede ser el celular de otro paciente).
   */
  private async cambiarBaja(
    organizationId: string,
    remitente: string,
    baja: boolean,
  ): Promise<void> {
    const destinationHash = hashDelDestino(remitente);
    const porTelegram = isTelegramSender(remitente);
    if (baja) {
      await this.prisma.attentionSummaryOptOut.upsert({
        where: {
          organizationId_destinationHash: { organizationId, destinationHash },
        },
        create: {
          organizationId,
          destinationHash,
          channel: porTelegram ? 'TELEGRAM' : 'WHATSAPP',
        },
        update: {},
      });
    } else {
      await this.prisma.attentionSummaryOptOut.deleteMany({
        where: { organizationId, destinationHash },
      });
    }
    let where: Prisma.PatientProfileWhereInput;
    if (porTelegram) {
      where = {
        organizationId,
        telegramChatId: chatIdFromTelegramSender(remitente) ?? '',
      };
    } else {
      const ids = [
        ...new Set([
          remitente,
          ...variantesDeTelefono(remitente.replace(/\D/g, '')),
        ]),
      ];
      where = {
        organizationId,
        OR: [{ whatsappId: { in: ids } }, { bsuid: { in: ids } }],
      };
    }
    await this.prisma.patientProfile.updateMany({
      where,
      data: { summariesOptOut: baja },
    });
    await this.texto(
      organizationId,
      remitente,
      baja ? TEXTOS_RESUMEN.baja : TEXTOS_RESUMEN.alta,
    );
  }
}

/** La fecha de nacimiento del HIS como «AAAA-MM-DD», o `null` si no hay una válida. */
function fechaDelHis(r: ResumenAtencionHis): string | null {
  const f = (r.paciente.fechaNacimientoIso ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
}
