import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  CATALOGO_ALERTAS,
  MAX_DESTINATARIOS_EMERGENCIA,
  PRUEBA_EMERGENCIA_CADA_MIN,
  claveAlerta,
  enmascararIdentificadorWhatsapp,
  explicarFalloDeEnvio,
  parametrosAlertaEmergencia,
  parametrosPruebaAlertaEmergencia,
  textoLibreAlertaEmergencia,
  type ResultadoAlertaEmergencia,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappTemplateService } from '../whatsapp-config/whatsapp-template.service';
import { TechAlertService } from '../tech-alerts/tech-alert.service';
import { getErrorMessage } from '../common/error-message.util';

/** Cómo salió un envío (plantilla o texto libre). */
interface EnvioResultado {
  success: boolean;
  error?: string;
  wamid?: string | null;
}

/** El texto libre lo manda el chatbot (`sendOutboundForOrg`): así queda en su libro. */
export type EnviarTextoLibre = (
  phone: string,
  texto: string,
) => Promise<EnvioResultado>;

const MAX_ERROR = 300;

/**
 * 🚑 La alerta de posible emergencia al PERSONAL (docs/GUARDRAIL_EMERGENCIAS.md,
 * 2026-11-22). El asistente ya le dijo al paciente que llame al 123 o vaya a Urgencias;
 * esto es para que alguien del hospital lo llame.
 *
 * ═══ A quién ═══
 * A la lista de Configuración › Datos de la clínica › Alertas de posible emergencia
 * (`EmergencyAlertRecipient`), a cualquier hora. Si la clínica aún no eligió a nadie,
 * al teléfono de soporte, solo si es un celular (como antes del 2026-11-22): un fijo no
 * tiene WhatsApp.
 *
 * ═══ Con qué ═══
 * Con la plantilla `EMERGENCY_ALERT`, que sale aunque esa persona nunca le haya escrito
 * al asistente. Si la clínica no la ha registrado, con texto libre, que WhatsApp solo
 * entrega a quien escribió en las últimas 24 horas.
 *
 * ═══ Si no le sale a nadie ═══
 * Alerta técnica (`ALERTA_EMERGENCIA_NO_SALE`, sin datos del paciente) para que el
 * equipo técnico le avise al hospital. El caso queda siempre en la Caja Negra.
 *
 * Nunca lanza: una falla aquí no puede tumbar la respuesta al paciente.
 */
@Injectable()
export class AlertaEmergenciaService {
  private readonly logger = new Logger(AlertaEmergenciaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plantillas: WhatsappTemplateService,
    @Optional() private readonly alertasTecnicas?: TechAlertService,
  ) {}

  async avisar(p: {
    organizationId: string;
    organizationName?: string | null;
    supportPhone?: string | null;
    timeZone?: string | null;
    senderId: string;
    mensaje: string | null | undefined;
    enviarTexto: EnviarTextoLibre;
    ahora?: Date;
  }): Promise<ResultadoAlertaEmergencia> {
    const ahora = p.ahora ?? new Date();
    try {
      const lista = await this.prisma.emergencyAlertRecipient.findMany({
        where: { organizationId: p.organizationId, isActive: true },
        orderBy: { createdAt: 'asc' },
        take: MAX_DESTINATARIOS_EMERGENCIA,
        select: { id: true, phone: true },
      });
      const destinos: { id: string | null; phone: string }[] = lista.length
        ? lista
        : this.soporteSiEsCelular(p.supportPhone);

      if (destinos.length === 0) {
        const motivo =
          'la clínica no eligió quién recibe las alertas y el teléfono de soporte no es un celular';
        await this.avisarAlEquipoTecnico(p, motivo);
        return this.resultado('NINGUNO', 0, [], motivo);
      }

      const params = parametrosAlertaEmergencia({
        senderId: p.senderId,
        mensaje: p.mensaje,
        cuando: ahora,
        timeZone: p.timeZone ?? undefined,
      });

      let canal: ResultadoAlertaEmergencia['canal'] = 'PLANTILLA';
      const resultados: EnvioResultado[] = [];
      for (const d of destinos) {
        let r: EnvioResultado = await this.plantillas.sendTemplate({
          organizationId: p.organizationId,
          recipientId: d.phone,
          kind: 'EMERGENCY_ALERT',
          bodyParams: [...params],
        });
        if (!r.success && r.error === 'template-not-configured') {
          canal = 'TEXTO';
          r = await p
            .enviarTexto(d.phone, textoLibreAlertaEmergencia(params))
            .catch((e: unknown) => ({
              success: false,
              error: getErrorMessage(e),
            }));
        }
        resultados.push(r);
        if (d.id) await this.anotarSalud(d.id, r, ahora);
      }

      const wamids = resultados
        .map((r) => (r.success ? r.wamid : null))
        .filter((w): w is string => !!w);
      const aceptados = resultados.filter((r) => r.success).length;
      if (aceptados === 0) {
        const motivo = `Meta no la aceptó para ninguno de los ${destinos.length} número(s): ${explicarFalloDeEnvio(resultados[0]?.error)}`;
        await this.avisarAlEquipoTecnico(p, motivo);
        return {
          ...this.resultado(canal, destinos.length, [], motivo),
          aceptados: 0,
        };
      }
      this.logger.log(
        `Alerta de posible emergencia (org ${p.organizationId}) por ${canal === 'PLANTILLA' ? 'plantilla' : 'texto libre'}: ${aceptados} de ${destinos.length}.`,
      );
      return {
        staffAlerted: true,
        canal,
        destinatarios: destinos.length,
        aceptados,
        wamids,
        motivo: null,
      };
    } catch (e: unknown) {
      const motivo = `falló el envío: ${getErrorMessage(e)}`.slice(
        0,
        MAX_ERROR,
      );
      this.logger.error(
        `Alerta de posible emergencia (org ${p.organizationId}): ${motivo}`,
      );
      await this.avisarAlEquipoTecnico(p, motivo);
      return this.resultado('NINGUNO', 0, [], motivo);
    }
  }

  /**
   * «Enviar prueba» desde Configuración: la MISMA plantilla con un texto de prueba,
   * como mucho una vez cada `PRUEBA_EMERGENCIA_CADA_MIN` por persona (compare-and-set
   * sobre `lastTestAt`: dos clics no mandan dos). Sin plantilla no hay prueba: el texto
   * libre no llegaría a quien no escribió en 24 h, y la prueba diría «salió» en falso.
   */
  async probar(
    organizationId: string,
    recipientId: string,
    quien: string,
    ahora: Date = new Date(),
  ): Promise<{ success: true } | { success: false; error: string }> {
    const fila = await this.prisma.emergencyAlertRecipient.findFirst({
      where: { id: recipientId, organizationId },
      select: { id: true, label: true, phone: true },
    });
    if (!fila) {
      return {
        success: false,
        error: 'Esa persona ya no está en la lista. Recargue la página.',
      };
    }
    const desde = new Date(
      ahora.getTime() - PRUEBA_EMERGENCIA_CADA_MIN * 60_000,
    );
    const { count } = await this.prisma.emergencyAlertRecipient.updateMany({
      where: {
        id: fila.id,
        organizationId,
        OR: [{ lastTestAt: null }, { lastTestAt: { lt: desde } }],
      },
      data: { lastTestAt: ahora },
    });
    if (count === 0) {
      return {
        success: false,
        error: `Ya se le mandó una prueba hace poco: espere ${PRUEBA_EMERGENCIA_CADA_MIN} minutos.`,
      };
    }
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const r = await this.plantillas.sendTemplate({
      organizationId,
      recipientId: fila.phone,
      kind: 'EMERGENCY_ALERT',
      bodyParams: [
        ...parametrosPruebaAlertaEmergencia(ahora, org?.timezone ?? undefined),
      ],
    });
    await this.anotarSalud(fila.id, r, ahora);
    const motivo = r.success ? null : explicarFalloDeEnvio(r.error);
    this.logger.log(
      `Prueba de la alerta de emergencia a ${fila.label} (${enmascararIdentificadorWhatsapp(fila.phone)}), pedida por ${quien}: ${r.success ? 'Meta la aceptó' : `no salió: ${motivo}`}.`,
    );
    return r.success
      ? { success: true }
      : { success: false, error: `No salió: ${motivo}.` };
  }

  /** El teléfono de soporte, solo si es un celular de Colombia con indicativo. */
  private soporteSiEsCelular(
    supportPhone: string | null | undefined,
  ): { id: null; phone: string }[] {
    const d = (supportPhone ?? '').replace(/\D/g, '');
    if (/^573\d{9}$/.test(d)) return [{ id: null, phone: d }];
    if (/^3\d{9}$/.test(d)) return [{ id: null, phone: `57${d}` }];
    return [];
  }

  private resultado(
    canal: ResultadoAlertaEmergencia['canal'],
    destinatarios: number,
    wamids: string[],
    motivo: string,
  ): ResultadoAlertaEmergencia {
    return {
      staffAlerted: false,
      canal,
      destinatarios,
      aceptados: 0,
      wamids,
      motivo,
    };
  }

  /** Sin datos del paciente: el equipo técnico le avisa al hospital, que lo ve en la Caja Negra. */
  private async avisarAlEquipoTecnico(
    p: { organizationId: string; organizationName?: string | null },
    motivo: string,
  ): Promise<void> {
    if (!this.alertasTecnicas) return;
    await this.alertasTecnicas
      .avisar({
        kind: 'ALERTA_EMERGENCIA_NO_SALE',
        dedupeKey: claveAlerta.alertaEmergencia(p.organizationId),
        title: CATALOGO_ALERTAS.ALERTA_EMERGENCIA_NO_SALE.titulo,
        detail: `Un paciente fue derivado al 123 / Urgencias y nadie del hospital recibió la alerta (${motivo}). El caso está en la Caja Negra de la clínica: hay que avisarle al hospital para que lo llamen y revisar Configuración › Datos de la clínica › Alertas de posible emergencia.`,
        organizationId: p.organizationId,
        organizationName: p.organizationName ?? null,
        fuente: 'guardrail de emergencias del asistente',
      })
      .catch((e: unknown) =>
        this.logger.warn(
          `No se pudo abrir la alerta técnica de la emergencia: ${getErrorMessage(e)}`,
        ),
      );
  }

  /** La salud de cada persona en su fila. Nunca lanza. */
  private async anotarSalud(
    id: string,
    r: EnvioResultado,
    ahora: Date,
  ): Promise<void> {
    await this.prisma.emergencyAlertRecipient
      .updateMany({
        where: { id },
        data: r.success
          ? { lastSentAt: ahora, lastWamid: r.wamid ?? null }
          : {
              lastError: explicarFalloDeEnvio(r.error).slice(0, MAX_ERROR),
              lastErrorAt: ahora,
            },
      })
      .catch((e: unknown) =>
        this.logger.warn(
          `No se pudo anotar el envío a ${id}: ${getErrorMessage(e)}`,
        ),
      );
  }
}
