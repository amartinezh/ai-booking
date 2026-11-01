import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { Prisma } from '@agenia/database';
import {
  DEFAULT_TIMEZONE,
  LIMITES_ENVIO_RESUMEN,
  candidatosDeDestino,
  celularParaWhatsapp,
  dentroDelHorario,
  enmascararDestino,
  formatDateOnly,
  leerConfigResumenAtencion,
  leerExclusiones,
  motivoDeExclusion,
  payloadDeEntrega,
  puedeEnviarPorCanal,
  variantesDeTelefono,
  documentoSinCerosIniciales,
  normalizeDocumento,
} from '@agenia/shared';
import type {
  CandidatoDestino,
  ConfigResumenAtencion,
  ExclusionesResumen,
  ResumenAtencionHis,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { RedisService } from '../redis/redis.service';
import { SystemLogService } from '../system-log/system-log.service';
import { WhatsappTemplateService } from '../whatsapp-config/whatsapp-template.service';
import { ResumenWhatsappService } from './resumen-whatsapp.service';
import { BOTON_RECIBIR, TEXTOS_RESUMEN, primerNombre } from './resumen-textos';

const MS_HORA = 3_600_000;
/** Resúmenes por clínica en cada vuelta: el resto sigue en la siguiente. */
const POR_VUELTA = 40;

export const hashDelDestino = (destino: string) =>
  createHash('sha256').update(destino.trim()).digest('hex');

/** Misma llave que el asistente (`ChatbotService.serviceWindowKey`): la ventana de 24 h. */
const llaveVentana = (organizationId: string, destino: string) =>
  `wa_window:${organizationId}:${destino}`;

export interface ResultadoProgramador {
  avisados: number;
  excluidos: number;
  sinContacto: number;
  fallos: number;
}

/**
 * 📨 El envío del resumen de la atención por WhatsApp (plan §3.3, §3.6, §3.7,
 * §3.8 y §3.11; Fase 4).
 *
 * Cada 2 minutos, para cada clínica con «Enviar» encendido y dentro del
 * horario, revisa las atenciones de las últimas 24 horas que todavía no se
 * avisaron:
 *  1. lo sensible no sale (D7): queda EXCLUIDO con el código que lo excluyó;
 *  2. la baja del paciente: EXCLUIDO;
 *  3. sin un celular utilizable (D5, D6): SIN_CONTACTO;
 *  4. los interruptores (canal, servicio, modo prueba) se leen en cada vuelta:
 *     si no dejan, se espera (puede encenderse dentro de las 24 horas);
 *  5. si dejan, sale el aviso con el botón «Recibir mis documentos»: plantilla
 *     fuera de la ventana de 24 h, mensaje con botón dentro de ella.
 * El documento no sale aquí: sale cuando el paciente toca el botón
 * (`ResumenChatService`). Un aviso que falla no se reintenta solo.
 *
 * Mientras no se apruebe el piloto, «Enviar» solo enciende con el modo prueba
 * (`aplicarCambioDeEnvio`): solo los números del equipo reciben.
 */
@Injectable()
export class ResumenEnvioService {
  private readonly logger = new Logger(ResumenEnvioService.name);
  private enCurso = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly plantillas: WhatsappTemplateService,
    private readonly whatsapp: ResumenWhatsappService,
    @Optional() private readonly bitacora?: SystemLogService,
  ) {}

  @Cron('20 */2 * * * *')
  async programarCron(): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      const r = await this.programar();
      if (r.avisados + r.excluidos + r.sinContacto + r.fallos > 0) {
        this.logger.log(
          `Resumen de la atención: ${r.avisados} aviso(s), ${r.excluidos} excluido(s), ${r.sinContacto} sin contacto, ${r.fallos} fallo(s).`,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        `El envío de resúmenes falló: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.enCurso = false;
    }
  }

  async programar(ahora: Date = new Date()): Promise<ResultadoProgramador> {
    const total: ResultadoProgramador = {
      avisados: 0,
      excluidos: 0,
      sinContacto: 0,
      fallos: 0,
    };
    const clinicas = await this.prisma.hospitalMirrorConfig.findMany({
      where: { enabled: true, resumenAtencion: { not: Prisma.DbNull } },
      select: {
        organizationId: true,
        resumenAtencion: true,
        organization: { select: { timezone: true, isActive: true } },
      },
    });
    for (const c of clinicas) {
      const config = leerConfigResumenAtencion(c.resumenAtencion);
      if (!config?.enviar || !c.organization.isActive) continue;
      const timeZone = c.organization.timezone || DEFAULT_TIMEZONE;
      if (!dentroDelHorario(ahora, config.horario, timeZone)) continue;
      const r = await this.programarClinica(
        c.organizationId,
        config,
        leerExclusiones(c.resumenAtencion),
        timeZone,
        ahora,
      );
      total.avisados += r.avisados;
      total.excluidos += r.excluidos;
      total.sinContacto += r.sinContacto;
      total.fallos += r.fallos;
    }
    return total;
  }

  private async programarClinica(
    organizationId: string,
    config: ConfigResumenAtencion,
    exclusiones: ExclusionesResumen,
    timeZone: string,
    ahora: Date,
  ): Promise<ResultadoProgramador> {
    const r: ResultadoProgramador = {
      avisados: 0,
      excluidos: 0,
      sinContacto: 0,
      fallos: 0,
    };
    const pendientes = await this.prisma.attentionSummary.findMany({
      where: {
        organizationId,
        status: 'RECIBIDO',
        purgedAt: null,
        content: { not: null },
        attendedAt: {
          gte: new Date(
            ahora.getTime() - LIMITES_ENVIO_RESUMEN.horasParaAvisar * MS_HORA,
          ),
        },
        deliveries: { none: { channel: 'WHATSAPP', purpose: 'PACIENTE' } },
      },
      orderBy: { attendedAt: 'asc' },
      take: POR_VUELTA,
      select: {
        id: true,
        content: true,
        serviceCode: true,
        patientProfileId: true,
      },
    });

    for (const s of pendientes) {
      try {
        const resumen = JSON.parse(
          this.crypto.decrypt(s.content!),
        ) as ResumenAtencionHis;
        const excluida = motivoDeExclusion(resumen, exclusiones);
        if (excluida) {
          await this.marcar(s.id, 'EXCLUIDO', excluida);
          r.excluidos++;
          continue;
        }
        const perfil = s.patientProfileId
          ? await this.prisma.patientProfile.findUnique({
              where: { id: s.patientProfileId },
              select: {
                id: true,
                whatsappId: true,
                bsuid: true,
                summariesOptOut: true,
              },
            })
          : null;
        if (perfil?.summariesOptOut) {
          await this.marcar(
            s.id,
            'EXCLUIDO',
            'El paciente se dio de baja de los resúmenes',
          );
          r.excluidos++;
          continue;
        }
        const destino = await this.elegirDestino(
          organizationId,
          perfil,
          resumen,
        );
        if ('motivo' in destino) {
          await this.marcar(s.id, 'SIN_CONTACTO', destino.motivo);
          r.sinContacto++;
          continue;
        }
        // Los interruptores (canal, servicio, modo prueba): si no dejan, se espera.
        const permiso = puedeEnviarPorCanal(config, {
          canal: 'WHATSAPP',
          servicio: s.serviceCode,
          destino: destino.destino,
        });
        if (!permiso.ok) continue;

        const aviso = await this.enviarAviso(
          organizationId,
          s.id,
          resumen,
          destino,
          'PACIENTE',
          null,
          timeZone,
        );
        if (aviso.ok) r.avisados++;
        else r.fallos++;
      } catch (error: unknown) {
        r.fallos++;
        // El motivo, nunca el contenido.
        this.logger.error(
          `Resumen ${s.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return r;
  }

  private marcar(
    id: string,
    status: 'EXCLUIDO' | 'SIN_CONTACTO' | 'ENVIADO' | 'RECIBIDO',
    statusReason: string | null,
  ) {
    return this.prisma.attentionSummary.update({
      where: { id },
      data: { status, statusReason },
    });
  }

  /**
   * El primer número utilizable (D5, D6). Uno que vino del HIS y que AgenIA
   * tiene a nombre de OTRO documento no se usa; con el caso «el teléfono es de
   * otra persona» abierto en la Bandeja, tampoco el de la ficha.
   */
  private async elegirDestino(
    organizationId: string,
    perfil: {
      id: string;
      whatsappId: string | null;
      bsuid: string | null;
    } | null,
    resumen: ResumenAtencionHis,
  ): Promise<CandidatoDestino | { motivo: string }> {
    let candidatos = candidatosDeDestino(perfil, resumen);
    if (perfil) {
      const equivocado = await this.prisma.syncException.findFirst({
        where: {
          organizationId,
          kind: 'TELEFONO_EQUIVOCADO',
          patientId: perfil.id,
          status: { in: ['ABIERTA', 'EN_REVISION'] },
        },
        select: { id: true },
      });
      if (equivocado)
        candidatos = candidatos.filter((c) => c.origen !== 'PERFIL');
    }
    const documento = documentoSinCerosIniciales(
      normalizeDocumento(resumen.paciente.documento),
    );
    for (const c of candidatos) {
      if (c.origen === 'PERFIL') return c;
      const duenos = await this.prisma.patientProfile.findMany({
        where: {
          organizationId,
          whatsappId: { in: variantesDeTelefono(c.destino) },
        },
        select: { cedula: true },
        take: 5,
      });
      const deOtro = duenos.some(
        (d) =>
          documentoSinCerosIniciales(normalizeDocumento(d.cedula)) !==
          documento,
      );
      if (!deOtro) return c;
    }
    return {
      motivo: candidatos.length
        ? 'El celular del HIS es de otro paciente en AgenIA'
        : 'Sin un celular utilizable',
    };
  }

  /**
   * El aviso con el botón «Recibir mis documentos». Primero se anota el envío
   * (el botón lleva su id); fuera de la ventana de 24 h va la plantilla
   * aprobada y, dentro, un mensaje con el mismo botón.
   */
  async enviarAviso(
    organizationId: string,
    attentionSummaryId: string,
    resumen: ResumenAtencionHis,
    destino: { destino: string; origen: string },
    purpose: 'PACIENTE' | 'PRUEBA',
    createdByUserId: string | null,
    timeZone: string,
  ): Promise<{ ok: boolean; motivo?: string }> {
    const entrega = await this.prisma.attentionSummaryDelivery.create({
      data: {
        attentionSummaryId,
        channel: 'WHATSAPP',
        purpose,
        destinationHash: hashDelDestino(destino.destino),
        destinationMasked: enmascararDestino(destino.destino),
        destinationOrigin: destino.origen,
        status: 'FALLO',
        statusReason: 'En curso',
        createdByUserId,
      },
    });
    const nombre = primerNombre(resumen.paciente.nombre);
    const fecha = formatDateOnly(resumen.historia.guardadaIso, { timeZone });
    const payload = payloadDeEntrega(entrega.id);

    let enVentana = false;
    try {
      enVentana =
        (await this.redis.get(
          llaveVentana(organizationId, destino.destino),
        )) !== null;
    } catch {
      // Sin Redis se asume fuera: la plantilla sirve dentro y fuera de la ventana.
    }

    let ok: boolean;
    let motivo: string | undefined;
    let templateName: string | null = null;
    if (enVentana) {
      const r = await this.whatsapp.botones(
        organizationId,
        destino.destino,
        TEXTOS_RESUMEN.avisoEnVentana(nombre, fecha),
        [{ id: payload, titulo: BOTON_RECIBIR }],
      );
      ok = r.ok;
      motivo = r.error;
    } else {
      const r = await this.plantillas.sendTemplate({
        organizationId,
        recipientId: destino.destino,
        kind: 'ATTENTION_SUMMARY_READY',
        bodyParams: [nombre, fecha],
        buttonPayloads: [payload],
      });
      ok = r.success;
      motivo =
        r.error === 'template-not-configured'
          ? 'La plantilla «Documentos de la consulta» no está configurada'
          : r.error;
      templateName = r.templateName ?? null;
    }

    await this.prisma.attentionSummaryDelivery.update({
      where: { id: entrega.id },
      data: ok
        ? {
            status: 'AVISO_ENVIADO',
            statusReason: null,
            noticeSentAt: new Date(),
            templateName,
          }
        : {
            status: 'FALLO',
            statusReason: (motivo ?? 'No salió').slice(0, 500),
            templateName,
          },
    });
    if (purpose === 'PACIENTE') {
      await this.marcar(
        attentionSummaryId,
        ok ? 'ENVIADO' : 'RECIBIDO',
        ok ? null : `El aviso no salió: ${(motivo ?? '').slice(0, 200)}`,
      );
    }
    return ok ? { ok } : { ok, motivo };
  }

  /**
   * «Enviar de prueba» del panel: el aviso de un resumen a un número del equipo
   * (de la lista del modo prueba). Sirve para probar el botón, la fecha de
   * nacimiento y los documentos con datos reales sin escribirle al paciente.
   */
  async enviarDePrueba(
    organizationId: string,
    attentionSummaryId: string,
    destinoCrudo: unknown,
    quien: { userId: string; email: string },
  ): Promise<{ ok: boolean; motivo?: string }> {
    const espejo = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: {
        resumenAtencion: true,
        organization: { select: { timezone: true } },
      },
    });
    const config = leerConfigResumenAtencion(espejo?.resumenAtencion);
    const destino =
      typeof destinoCrudo === 'string'
        ? (celularParaWhatsapp(destinoCrudo) ?? destinoCrudo.replace(/\D/g, ''))
        : '';
    if (!config || !destino || !config.modoPrueba.destinos.includes(destino)) {
      throw new BadRequestException(
        'Solo se envía de prueba a un número de la lista del modo prueba.',
      );
    }
    const fila = await this.prisma.attentionSummary.findFirst({
      where: { id: attentionSummaryId, organizationId, purgedAt: null },
      select: { id: true, hisKey: true, content: true },
    });
    if (!fila?.content)
      throw new NotFoundException(
        'El resumen no existe o su contenido ya se borró.',
      );
    const resumen = JSON.parse(
      this.crypto.decrypt(fila.content),
    ) as ResumenAtencionHis;
    const r = await this.enviarAviso(
      organizationId,
      fila.id,
      resumen,
      { destino, origen: 'PRUEBA' },
      'PRUEBA',
      quien.userId,
      espejo?.organization.timezone || DEFAULT_TIMEZONE,
    );
    await this.bitacora?.event({
      action: 'ATTENTION_SUMMARY_TEST_SEND',
      message: `${quien.email} envió de prueba el aviso del resumen de la historia ${fila.hisKey} a ${enmascararDestino(destino)}${r.ok ? '' : ' (no salió)'}.`,
      userId: quien.userId,
      organizationId,
      metadata: {
        summaryId: fila.id,
        hisKey: fila.hisKey,
        destino: enmascararDestino(destino),
        ok: r.ok,
      },
    });
    return r;
  }
}
