import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DEFAULT_TIMEZONE,
  LIMITES_ENVIO,
  clasificarTelefono,
  estimarDuracion,
  explicarErrorDeEnvio,
  formatoPorFirma,
  nombreParaSaludo,
  problemaDuroDeImagen,
  proximaVentanaDeComunicados,
  puedeEnviarComunicadoAhora,
  revisarTexto,
  textoParaEnviar,
  type EstadoEnvioMasivo,
  type ProblemaTexto,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappTemplateService } from '../whatsapp-config/whatsapp-template.service';
import { SystemLogService } from '../system-log/system-log.service';
import { getErrorMessage } from '../common/error-message.util';
import {
  MassMessageMetaService,
  type TipoPlantillaComunicado,
  type VerificacionPlantilla,
} from './mass-message-meta.service';

const ACTIVOS: EstadoEnvioMasivo[] = ['EN_COLA', 'ENVIANDO'];
/** El id de una imagen en Meta vale unos 30 días: se vuelve a subir pasados 25. */
const VIGENCIA_MEDIA_MS = 25 * 24 * 60 * 60 * 1000;
/** Lo que dura el turno de una vuelta sobre un envío (si la API se cae, otra lo retoma). */
const TURNO_MS = 90_000;
/** El código de Meta de quien bloqueó los mensajes de marketing de la clínica. */
const BAJA_EN_META = '131050';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PreviaEnvio {
  estado: EstadoEnvioMasivo;
  contactos: number;
  bajas: number;
  bajasEnMeta: number;
  /** Lo que hay que escribir para confirmar. */
  aEnviar: number;
  tipoPlantilla: TipoPlantillaComunicado;
  plantilla: VerificacionPlantilla;
  problemasTexto: ProblemaTexto[];
  textoFinal: string;
  ritmoPorMinuto: number;
  horarioAbierto: boolean;
  saleDesde: string;
  minutosEstimados: number;
  terminaria: string;
  /** Lo que impide confirmar. Vacío = se puede enviar. */
  bloqueos: string[];
}

type Envio = {
  id: string;
  organizationId: string;
  listId: string;
  status: string;
  messageText: string;
  imageMime: string | null;
  imageBytes: number | null;
  imageMediaId: string | null;
  imageMediaUploadedAt: Date | null;
  templateKind: string | null;
  ratePerMinute: number;
};

const SELECT_ENVIO = {
  id: true,
  organizationId: true,
  listId: true,
  status: true,
  messageText: true,
  imageMime: true,
  imageBytes: true,
  imageMediaId: true,
  imageMediaUploadedAt: true,
  templateKind: true,
  ratePerMinute: true,
} as const;

const ritmoValido = (r: number) =>
  Math.min(
    LIMITES_ENVIO.ritmoMaximo,
    Math.max(
      LIMITES_ENVIO.ritmoMinimo,
      Math.round(r || LIMITES_ENVIO.ritmoPorDefecto),
    ),
  );

/**
 * 📢 El envío de Mensajes masivos (docs/PLAN_MENSAJES_MASIVOS.md §8).
 *
 *  1. `previa`: lo que se va a enviar y lo que lo impide (texto con errores,
 *     plantilla sin aprobar o con otra forma, imagen que Meta no acepta, nadie a
 *     quien enviar). La pantalla lo muestra antes de confirmar.
 *  2. `iniciar`: con la cantidad escrita por la persona (tiene que ser la de la
 *     previa), toma la FOTO de destinatarios —la lista menos quienes pidieron no
 *     recibir más y quienes bloquearon a la clínica en WhatsApp— y deja el envío
 *     EN_COLA. Volver a confirmar no duplica a nadie (`@@unique`).
 *  3. `vuelta` (cada 20 s, solo en el horario de la Ley 2300): cada envío activo
 *     manda su tanda al ritmo configurado, con un turno en la base para que dos
 *     vueltas no trabajen el mismo envío. Un error de la persona (no tiene
 *     WhatsApp) la marca FALLIDO y sigue; un error de la clínica (plantilla
 *     rechazada, token vencido) PAUSA el envío con el motivo, sin gastar la lista.
 */
@Injectable()
export class MassMessageSenderService {
  private readonly logger = new Logger(MassMessageSenderService.name);
  private ocupado = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly plantillas: WhatsappTemplateService,
    private readonly meta: MassMessageMetaService,
    private readonly systemLog: SystemLogService,
  ) {}

  private async envioDe(
    organizationId: string,
    campaignId: string,
  ): Promise<Envio> {
    const envio = await this.prisma.massCampaign.findFirst({
      where: { id: campaignId, organizationId },
      select: SELECT_ENVIO,
    });
    if (!envio) throw new NotFoundException('Envío no encontrado.');
    return envio;
  }

  private async zonaDe(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    return org?.timezone || DEFAULT_TIMEZONE;
  }

  /** Quiénes de estos celulares no deben recibir: los que pidieron la baja y los que bloquearon a la clínica en Meta. */
  private async excluidos(
    organizationId: string,
    celulares: string[],
  ): Promise<{ bajas: Set<string>; bajasEnMeta: Set<string> }> {
    const bajas = new Set<string>();
    const bajasEnMeta = new Set<string>();
    for (let i = 0; i < celulares.length; i += 1000) {
      const tanda = celulares.slice(i, i + 1000);
      const [optOuts, bloqueos] = await Promise.all([
        this.prisma.massMessageOptOut.findMany({
          where: { organizationId, destination: { in: tanda } },
          select: { destination: true },
        }),
        this.prisma.whatsappMessageLog.findMany({
          where: {
            organizationId,
            recipientId: { in: tanda.map((c) => c.replace(/^\+/, '')) },
            errorCode: BAJA_EN_META,
          },
          select: { recipientId: true },
          distinct: ['recipientId'],
        }),
      ]);
      optOuts.forEach((o) => bajas.add(o.destination));
      bloqueos.forEach(
        (b) =>
          !bajas.has(`+${b.recipientId}`) &&
          bajasEnMeta.add(`+${b.recipientId}`),
      );
    }
    return { bajas, bajasEnMeta };
  }

  // ─── Antes de confirmar ───────────────────────────────────────────────────

  async previa(
    organizationId: string,
    campaignId: string,
    ahora = new Date(),
  ): Promise<PreviaEnvio> {
    const envio = await this.envioDe(organizationId, campaignId);
    const zona = await this.zonaDe(organizationId);
    const contactos = await this.prisma.massContact.findMany({
      where: { listId: envio.listId },
      select: { phoneE164: true },
    });
    const celulares = [...new Set(contactos.map((c) => c.phoneE164))];
    const { bajas, bajasEnMeta } = await this.excluidos(
      organizationId,
      celulares,
    );
    const aEnviar = celulares.length - bajas.size - bajasEnMeta.size;

    const tipoPlantilla: TipoPlantillaComunicado = envio.imageMime
      ? 'MASS_MESSAGE_IMAGE'
      : 'MASS_MESSAGE_TEXT';
    const plantilla = await this.meta.verificarPlantilla(
      organizationId,
      tipoPlantilla,
    );
    const revision = revisarTexto(envio.messageText, { plantillaSaluda: true });
    const ritmo = ritmoValido(envio.ratePerMinute);
    const saleDesde = proximaVentanaDeComunicados(ahora, zona);
    const duracion = estimarDuracion(aEnviar, ritmo, ahora, zona);

    const bloqueos: string[] = [];
    if (envio.status !== 'BORRADOR')
      bloqueos.push('Este envío ya se confirmó.');
    if (!celulares.length) bloqueos.push('La lista no tiene contactos.');
    else if (aEnviar <= 0)
      bloqueos.push(
        'Todos los contactos de la lista pidieron no recibir comunicados.',
      );
    if (aEnviar > LIMITES_ENVIO.maxDestinatarios) {
      bloqueos.push(
        `Son ${aEnviar} personas; el máximo por envío es ${LIMITES_ENVIO.maxDestinatarios}. Divida la lista.`,
      );
    }
    if (!revision.puedeEnviarse) {
      bloqueos.push(
        `El texto tiene errores que impiden enviarlo: ${revision.problemas
          .filter((p) => p.nivel === 'ERROR')
          .map((p) => p.mensaje)
          .join(' ')}`,
      );
    }
    bloqueos.push(...plantilla.problemas);
    if (envio.imageMime) {
      const datos = await this.prisma.massCampaign.findUnique({
        where: { id: envio.id },
        select: { imageData: true },
      });
      const problema = datos?.imageData
        ? problemaDuroDeImagen(
            formatoPorFirma(new Uint8Array(datos.imageData.subarray(0, 32))),
            datos.imageData.length,
          )
        : 'La imagen no se guardó: vuelva a subirla.';
      if (problema) bloqueos.push(problema);
    }

    return {
      estado: envio.status as EstadoEnvioMasivo,
      contactos: celulares.length,
      bajas: bajas.size,
      bajasEnMeta: bajasEnMeta.size,
      aEnviar: Math.max(0, aEnviar),
      tipoPlantilla,
      plantilla,
      problemasTexto: revision.problemas,
      textoFinal: textoParaEnviar(envio.messageText),
      ritmoPorMinuto: ritmo,
      horarioAbierto: puedeEnviarComunicadoAhora(ahora, zona),
      saleDesde: saleDesde.toISOString(),
      minutosEstimados: duracion.minutos,
      terminaria: duracion.terminaria.toISOString(),
      bloqueos,
    };
  }

  async iniciar(
    organizationId: string,
    campaignId: string,
    actor: { userId: string; email?: string | null },
    confirmacion: number,
  ): Promise<{
    estado: EstadoEnvioMasivo;
    aEnviar: number;
    saleDesde: string;
  }> {
    const previa = await this.previa(organizationId, campaignId);
    if (previa.bloqueos.length)
      throw new BadRequestException(previa.bloqueos.join(' '));
    if (Number(confirmacion) !== previa.aEnviar) {
      throw new BadRequestException(
        `Para confirmar escriba ${previa.aEnviar}, la cantidad de personas a las que se les va a enviar (puede haber cambiado si alguien pidió la baja).`,
      );
    }

    const envio = await this.envioDe(organizationId, campaignId);
    const contactos = await this.prisma.massContact.findMany({
      where: { listId: envio.listId },
      select: { id: true, fullName: true, firstName: true, phoneE164: true },
      orderBy: { createdAt: 'asc' },
    });
    const { bajas, bajasEnMeta } = await this.excluidos(
      organizationId,
      contactos.map((c) => c.phoneE164),
    );
    const filas = contactos.map((c) => {
      const motivo = bajas.has(c.phoneE164)
        ? 'BAJA'
        : bajasEnMeta.has(c.phoneE164)
          ? 'BAJA_EN_META'
          : null;
      return {
        campaignId,
        organizationId,
        contactId: c.id,
        name: c.firstName ?? c.fullName,
        phoneE164: c.phoneE164,
        outcome: motivo ? 'OMITIDO' : 'PENDIENTE',
        skipReason: motivo,
      };
    });
    const plantilla = await this.plantillas.findTemplate(
      organizationId,
      previa.tipoPlantilla,
    );
    const ahora = new Date();

    // El cambio de estado va primero y condicionado: si dos confirmaciones llegan a la
    // vez, solo una pasa de BORRADOR.
    const tomado = await this.prisma.massCampaign.updateMany({
      where: { id: campaignId, organizationId, status: 'BORRADOR' },
      data: { status: 'EN_COLA' },
    });
    if (!tomado.count)
      throw new BadRequestException('Este envío ya se confirmó.');
    await this.prisma.$transaction([
      this.prisma.massCampaignRecipient.deleteMany({ where: { campaignId } }),
      this.prisma.massCampaignRecipient.createMany({
        data: filas,
        skipDuplicates: true,
      }),
      this.prisma.massCampaign.update({
        where: { id: campaignId },
        data: {
          messageText: previa.textoFinal,
          templateKind: previa.tipoPlantilla,
          templateName: plantilla?.name ?? previa.plantilla.nombre,
          total: filas.length,
          skipped: filas.filter((f) => f.outcome === 'OMITIDO').length,
          sent: 0,
          failed: 0,
          confirmedByUserId: actor.userId,
          confirmedByEmail: actor.email ?? null,
          confirmedAt: ahora,
          lastError: null,
          textReview: {
            reglas: previa.problemasTexto.map((p) => ({
              id: p.id,
              nivel: p.nivel,
              mensaje: p.mensaje,
            })),
            plantilla: {
              nombre: previa.plantilla.nombre,
              estadoMeta: previa.plantilla.estadoMeta,
              cuerpo: previa.plantilla.cuerpo,
            },
            confirmadoEn: ahora.toISOString(),
          } as object,
        },
      }),
    ]);

    await this.systemLog.event({
      action: 'MASS_MESSAGE_CONFIRMED',
      message: `Mensajes masivos: ${actor.email ?? actor.userId} confirmó el envío ${campaignId} a ${previa.aEnviar} personas.`,
      organizationId,
      userId: actor.userId,
      metadata: {
        campaignId,
        aEnviar: previa.aEnviar,
        bajas: previa.bajas,
        bajasEnMeta: previa.bajasEnMeta,
        plantilla: previa.tipoPlantilla,
      },
    });
    return {
      estado: 'EN_COLA',
      aEnviar: previa.aEnviar,
      saleDesde: previa.saleDesde,
    };
  }

  // ─── La vuelta ────────────────────────────────────────────────────────────

  @Cron('*/20 * * * * *', { name: 'mensajes-masivos' })
  async vuelta(ahora = new Date()): Promise<void> {
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      const activos = await this.prisma.massCampaign.findMany({
        where: {
          status: { in: ACTIVOS },
          OR: [{ lockedUntil: null }, { lockedUntil: { lt: ahora } }],
        },
        select: { id: true, organizationId: true },
        orderBy: { confirmedAt: 'asc' },
        take: 10,
      });
      for (const a of activos) {
        if (
          !puedeEnviarComunicadoAhora(
            ahora,
            await this.zonaDe(a.organizationId),
          )
        )
          continue;
        await this.trabajar(a.id, ahora).catch((e: unknown) =>
          this.logger.error(
            `Mensajes masivos, envío ${a.id}: ${getErrorMessage(e)}`,
          ),
        );
      }
    } finally {
      this.ocupado = false;
    }
  }

  /** Una tanda de un envío: a lo sumo un tercio de su ritmo por minuto (la vuelta es cada 20 s). */
  async trabajar(campaignId: string, ahora = new Date()): Promise<void> {
    const turno = await this.prisma.massCampaign.updateMany({
      where: {
        id: campaignId,
        status: { in: ACTIVOS },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: ahora } }],
      },
      data: { lockedUntil: new Date(ahora.getTime() + TURNO_MS) },
    });
    if (!turno.count) return;
    try {
      const envio = await this.prisma.massCampaign.findUnique({
        where: { id: campaignId },
        select: { ...SELECT_ENVIO, startedAt: true },
      });
      if (!envio) return;
      if (envio.status === 'EN_COLA') {
        await this.prisma.massCampaign.update({
          where: { id: campaignId },
          data: { status: 'ENVIANDO', startedAt: envio.startedAt ?? ahora },
        });
      }
      const tipo = (envio.templateKind ??
        'MASS_MESSAGE_TEXT') as TipoPlantillaComunicado;
      let mediaId: string | undefined;
      if (tipo === 'MASS_MESSAGE_IMAGE') {
        const subida = await this.asegurarImagen(envio);
        if ('error' in subida) {
          await this.detener(
            envio,
            `No se pudo subir la imagen a WhatsApp: ${subida.error}`,
          );
          return;
        }
        mediaId = subida.id;
      }

      const ritmo = ritmoValido(envio.ratePerMinute);
      const pendientes = await this.prisma.massCampaignRecipient.findMany({
        where: { campaignId, outcome: 'PENDIENTE' },
        select: { id: true, name: true, phoneE164: true },
        orderBy: { id: 'asc' },
        take: Math.max(1, Math.ceil(ritmo / 3)),
      });
      const texto = textoParaEnviar(envio.messageText);
      for (let i = 0; i < pendientes.length; i++) {
        // Antes de cada mensaje: «Pausar» y «Cancelar» se respetan al instante.
        const estado = await this.prisma.massCampaign.findUnique({
          where: { id: campaignId },
          select: { status: true },
        });
        if (!estado || !ACTIVOS.includes(estado.status as EstadoEnvioMasivo))
          break;
        const r = await this.enviarUno(
          envio,
          tipo,
          pendientes[i],
          texto,
          mediaId,
        );
        if (r.detener) {
          await this.detener(envio, r.detener);
          break;
        }
        if (i < pendientes.length - 1) await sleep(Math.round(60_000 / ritmo));
      }
      await this.recontar(campaignId);
    } finally {
      await this.prisma.massCampaign.updateMany({
        where: { id: campaignId },
        data: { lockedUntil: null },
      });
    }
  }

  /** Un mensaje. Devuelve `detener` con el motivo si el problema es de la clínica. */
  private async enviarUno(
    envio: Envio,
    tipo: TipoPlantillaComunicado,
    d: { id: string; name: string | null; phoneE164: string },
    texto: string,
    mediaId?: string,
  ): Promise<{ detener?: string }> {
    const baja = await this.prisma.massMessageOptOut.findUnique({
      where: {
        organizationId_destination: {
          organizationId: envio.organizationId,
          destination: d.phoneE164,
        },
      },
      select: { id: true },
    });
    if (baja) {
      await this.prisma.massCampaignRecipient.update({
        where: { id: d.id },
        data: { outcome: 'OMITIDO', skipReason: 'BAJA' },
      });
      return {};
    }
    if (clasificarTelefono(d.phoneE164).clase !== 'CELULAR') {
      await this.prisma.massCampaignRecipient.update({
        where: { id: d.id },
        data: { outcome: 'OMITIDO', skipReason: 'CELULAR_INVALIDO' },
      });
      return {};
    }
    const r = await this.plantillas.sendTemplate({
      organizationId: envio.organizationId,
      recipientId: d.phoneE164.replace(/^\+/, ''),
      kind: tipo,
      bodyParams: [nombreParaSaludo(d.name), texto],
      headerImageId: mediaId,
    });
    if (r.success) {
      await this.prisma.massCampaignRecipient.update({
        where: { id: d.id },
        data: {
          outcome: 'ENVIADO',
          wamid: r.wamid ?? null,
          sentAt: new Date(),
          error: null,
          errorCode: null,
          attempts: { increment: 1 },
        },
      });
      return {};
    }
    const explicado = explicarErrorDeEnvio(r.error);
    // Si el problema es de la clínica, la persona sigue PENDIENTE: no fue su culpa y
    // le llegará al reanudar, cuando se arregle.
    await this.prisma.massCampaignRecipient.update({
      where: { id: d.id },
      data: {
        outcome: explicado.detieneElEnvio ? 'PENDIENTE' : 'FALLIDO',
        error: (r.error ?? '').slice(0, 1000),
        errorCode: explicado.codigo,
        attempts: { increment: 1 },
      },
    });
    return explicado.detieneElEnvio ? { detener: explicado.motivo } : {};
  }

  private async asegurarImagen(
    envio: Envio,
  ): Promise<{ id: string } | { error: string }> {
    if (
      envio.imageMediaId &&
      envio.imageMediaUploadedAt &&
      Date.now() - envio.imageMediaUploadedAt.getTime() < VIGENCIA_MEDIA_MS
    ) {
      return { id: envio.imageMediaId };
    }
    const datos = await this.prisma.massCampaign.findUnique({
      where: { id: envio.id },
      select: { imageData: true, imageMime: true },
    });
    if (!datos?.imageData || !datos.imageMime)
      return { error: 'el envío no tiene la imagen guardada' };
    const buffer = Buffer.from(datos.imageData);
    const problema = problemaDuroDeImagen(
      formatoPorFirma(new Uint8Array(buffer.subarray(0, 32))),
      buffer.length,
    );
    if (problema) return { error: problema };
    const subida = await this.meta.subirImagen(
      envio.organizationId,
      buffer,
      datos.imageMime,
    );
    if ('id' in subida) {
      await this.prisma.massCampaign.update({
        where: { id: envio.id },
        data: { imageMediaId: subida.id, imageMediaUploadedAt: new Date() },
      });
      envio.imageMediaId = subida.id;
      envio.imageMediaUploadedAt = new Date();
    }
    return subida;
  }

  private async detener(envio: Envio, motivo: string): Promise<void> {
    await this.prisma.massCampaign.updateMany({
      where: { id: envio.id, status: { in: ACTIVOS } },
      data: { status: 'PAUSADO', lastError: motivo.slice(0, 1000) },
    });
    await this.systemLog.warning({
      action: 'MASS_MESSAGE_PAUSED',
      message: `Mensajes masivos: el envío ${envio.id} se detuvo solo. ${motivo}`,
      organizationId: envio.organizationId,
      metadata: { campaignId: envio.id, motivo },
    });
  }

  /** Las cifras del envío desde la tabla (nunca desde la memoria), y si ya terminó. */
  async recontar(campaignId: string): Promise<void> {
    const grupos = await this.prisma.massCampaignRecipient.groupBy({
      by: ['outcome'],
      where: { campaignId },
      _count: { _all: true },
    });
    const n = (o: string) =>
      grupos.find((g) => g.outcome === o)?._count._all ?? 0;
    const pendientes = n('PENDIENTE');
    const envio = await this.prisma.massCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true, organizationId: true },
    });
    const termina = pendientes === 0 && envio?.status === 'ENVIANDO';
    await this.prisma.massCampaign.update({
      where: { id: campaignId },
      data: {
        sent: n('ENVIADO'),
        failed: n('FALLIDO'),
        skipped: n('OMITIDO'),
        ...(termina ? { status: 'TERMINADO', finishedAt: new Date() } : {}),
      },
    });
    if (termina && envio) {
      await this.systemLog.event({
        action: 'MASS_MESSAGE_FINISHED',
        message: `Mensajes masivos: terminó el envío ${campaignId} (${n('ENVIADO')} enviados, ${n('FALLIDO')} fallidos, ${n('OMITIDO')} omitidos).`,
        organizationId: envio.organizationId,
        metadata: {
          campaignId,
          enviados: n('ENVIADO'),
          fallidos: n('FALLIDO'),
          omitidos: n('OMITIDO'),
        },
      });
    }
  }

  // ─── Prueba ───────────────────────────────────────────────────────────────

  async enviarPrueba(
    organizationId: string,
    campaignId: string,
    telefono: string,
    nombre?: string | null,
  ): Promise<
    { ok: true; wamid: string | null } | { ok: false; motivo: string }
  > {
    const tel = clasificarTelefono(telefono);
    if (tel.clase !== 'CELULAR' || !tel.e164)
      throw new BadRequestException(
        'Escriba un celular válido para la prueba.',
      );
    const envio = await this.envioDe(organizationId, campaignId);
    const revision = revisarTexto(envio.messageText, { plantillaSaluda: true });
    if (!revision.puedeEnviarse) {
      throw new BadRequestException(
        `Corrija el texto antes de probar: ${revision.problemas
          .filter((p) => p.nivel === 'ERROR')
          .map((p) => p.mensaje)
          .join(' ')}`,
      );
    }
    const tipo: TipoPlantillaComunicado = envio.imageMime
      ? 'MASS_MESSAGE_IMAGE'
      : 'MASS_MESSAGE_TEXT';
    let mediaId: string | undefined;
    if (tipo === 'MASS_MESSAGE_IMAGE') {
      const subida = await this.asegurarImagen(envio);
      if ('error' in subida)
        return {
          ok: false,
          motivo: `No se pudo subir la imagen a WhatsApp: ${subida.error}`,
        };
      mediaId = subida.id;
    }
    const r = await this.plantillas.sendTemplate({
      organizationId,
      recipientId: tel.e164.replace(/^\+/, ''),
      kind: tipo,
      bodyParams: [
        nombreParaSaludo(nombre),
        textoParaEnviar(envio.messageText),
      ],
      headerImageId: mediaId,
    });
    if (r.success) return { ok: true, wamid: r.wamid ?? null };
    return { ok: false, motivo: explicarErrorDeEnvio(r.error).motivo };
  }

  // ─── Control ──────────────────────────────────────────────────────────────

  private async cambiarEstado(
    organizationId: string,
    campaignId: string,
    desde: EstadoEnvioMasivo[],
    hacia: EstadoEnvioMasivo,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const r = await this.prisma.massCampaign.updateMany({
      where: { id: campaignId, organizationId, status: { in: desde } },
      data: { status: hacia, ...extra },
    });
    if (!r.count) {
      await this.envioDe(organizationId, campaignId);
      throw new BadRequestException(
        'El envío ya no está en un estado que permita ese cambio. Recargue la página.',
      );
    }
  }

  async pausar(organizationId: string, campaignId: string): Promise<void> {
    await this.cambiarEstado(
      organizationId,
      campaignId,
      ['EN_COLA', 'ENVIANDO'],
      'PAUSADO',
    );
  }

  async reanudar(organizationId: string, campaignId: string): Promise<void> {
    await this.cambiarEstado(
      organizationId,
      campaignId,
      ['PAUSADO'],
      'EN_COLA',
      { lastError: null },
    );
  }

  async cancelar(organizationId: string, campaignId: string): Promise<void> {
    await this.cambiarEstado(
      organizationId,
      campaignId,
      ['EN_COLA', 'ENVIANDO', 'PAUSADO'],
      'CANCELADO',
      { finishedAt: new Date() },
    );
    await this.prisma.massCampaignRecipient.updateMany({
      where: { campaignId, outcome: 'PENDIENTE' },
      data: { outcome: 'OMITIDO', skipReason: 'CANCELADO' },
    });
    await this.recontar(campaignId);
  }

  /** Vuelve a la cola a quienes fallaron por algo pasajero (límites de Meta, fallas de red). */
  async reintentarFallidos(
    organizationId: string,
    campaignId: string,
  ): Promise<{ reintentos: number }> {
    const envio = await this.envioDe(organizationId, campaignId);
    if (
      !['TERMINADO', 'PAUSADO', 'ENVIANDO', 'EN_COLA'].includes(envio.status)
    ) {
      throw new BadRequestException('Este envío no se puede reintentar.');
    }
    const fallidos = await this.prisma.massCampaignRecipient.findMany({
      where: { campaignId, outcome: 'FALLIDO' },
      select: { id: true, error: true },
    });
    const ids = fallidos
      .filter((f) => explicarErrorDeEnvio(f.error).reintentable)
      .map((f) => f.id);
    if (!ids.length) return { reintentos: 0 };
    await this.prisma.massCampaignRecipient.updateMany({
      where: { id: { in: ids } },
      data: { outcome: 'PENDIENTE' },
    });
    if (envio.status === 'TERMINADO') {
      await this.prisma.massCampaign.update({
        where: { id: campaignId },
        data: { status: 'EN_COLA', finishedAt: null },
      });
    }
    await this.recontar(campaignId);
    return { reintentos: ids.length };
  }
}
