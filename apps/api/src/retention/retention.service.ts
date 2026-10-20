import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { RETENCION_DATOS, diasDeRetencion } from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SystemLogService } from '../system-log/system-log.service';
import { getErrorMessage } from '../common/error-message.util';
import { TechAlertService } from '../tech-alerts/tech-alert.service';

/**
 * 🧹 La purga nocturna de registros con datos personales que no tenían plazo
 * (docs/PLAN_RASTREO_PACIENTE.md §12 #4, Ley 1581 de 2012). Los plazos y su porqué
 * viven en `@agenia/shared` (`RETENCION_DATOS`):
 *
 *   · `InteractionLog`   — el texto de las conversaciones del bot: 180 días.
 *   · `PatientLookupLog` — quién consultó a qué paciente en el rastreo: 365 días.
 *   · `ChannelActivityLog` — cuándo escribió alguien (remitente seudonimizado): 400 días.
 *
 * Pasado el plazo las filas se BORRAN. Ninguna otra tabla depende de ellas (no
 * tienen FK entrantes) y nada lee tan atrás.
 *
 * ═══ Cómo se cuida la base ═══
 *  · Por lotes de `LOTE` filas: un DELETE de millones de filas en la primera noche
 *    bloquearía la tabla en la que el bot escribe cada mensaje.
 *  · Como mucho `MAX_LOTES` por tabla y noche: si queda más, sigue la noche siguiente.
 *  · De madrugada en Colombia (3:30), cuando el bot casi no conversa.
 *
 * ═══ Cómo se cuidan los datos ═══
 *  · El plazo se puede cambiar por entorno, pero nunca por debajo de
 *    `RETENCION_DATOS.minimoDias`: un error de tipeo no borra lo de ayer.
 *  · Dos réplicas de la API pueden correrlo a la vez: borrar lo ya borrado no hace nada.
 *  · Deja constancia en SystemLog de cuánto borró y con qué plazo (sin datos personales).
 */

/** Filas por DELETE. */
const LOTE = 5_000;
/** Lotes por tabla y noche: 1 millón de filas. */
const MAX_LOTES = 200;
const MS_DIA = 86_400_000;

export interface ResultadoPurga {
  conversaciones: { dias: number; borradas: number; completa: boolean };
  consultasRastreo: { dias: number; borradas: number; completa: boolean };
  actividadCanales: { dias: number; borradas: number; completa: boolean };
  /** Conversaciones del asistente de soporte (con sus mensajes), mismo plazo que las del bot. */
  asistenteSoporte: { dias: number; borradas: number; completa: boolean };
  /** Códigos del panel para el asistente, un día después de vencer. */
  codigosAsistente: number;
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private enCurso = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly systemLog: SystemLogService,
    // 🚨 Alertas técnicas. Opcional: sin él (tests), purga igual, solo no avisa.
    @Optional() private readonly alertas?: TechAlertService,
  ) {}

  @Cron('0 30 3 * * *', { timeZone: 'America/Bogota' })
  async purgarCron(): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      await this.purgar();
      await this.alertas?.cronBien('retencion');
    } catch (error: unknown) {
      this.logger.error(
        `La purga de retención falló: ${getErrorMessage(error)}`,
      );
      await this.alertas?.cronFallo(
        'retencion',
        'Retención de datos personales',
        error,
      );
    } finally {
      this.enCurso = false;
    }
  }

  /** Público para que una prueba (o un botón de administración futuro) la dispare. */
  async purgar(ahora: Date = new Date()): Promise<ResultadoPurga> {
    const conversaciones = this.plazo(
      'RETENCION_CONVERSACIONES_DIAS',
      RETENCION_DATOS.conversacionesDias,
    );
    const consultas = this.plazo(
      'RETENCION_BITACORA_RASTREO_DIAS',
      RETENCION_DATOS.bitacoraRastreoDias,
    );
    const actividad = this.plazo(
      'RETENCION_ACTIVIDAD_CANALES_DIAS',
      RETENCION_DATOS.actividadCanalesDias,
    );

    const r1 = await this.borrarEnLotes(
      new Date(ahora.getTime() - conversaciones * MS_DIA),
      (antesDe) =>
        this.prisma.interactionLog.findMany({
          where: { createdAt: { lt: antesDe } },
          select: { id: true },
          take: LOTE,
        }),
      (ids) =>
        this.prisma.interactionLog.deleteMany({ where: { id: { in: ids } } }),
    );
    const r2 = await this.borrarEnLotes(
      new Date(ahora.getTime() - consultas * MS_DIA),
      (antesDe) =>
        this.prisma.patientLookupLog.findMany({
          where: { createdAt: { lt: antesDe } },
          select: { id: true },
          take: LOTE,
        }),
      (ids) =>
        this.prisma.patientLookupLog.deleteMany({ where: { id: { in: ids } } }),
    );

    const r3 = await this.borrarEnLotes(
      new Date(ahora.getTime() - actividad * MS_DIA),
      (antesDe) =>
        this.prisma.channelActivityLog.findMany({
          where: { createdAt: { lt: antesDe } },
          select: { id: true },
          take: LOTE,
        }),
      (ids) =>
        this.prisma.channelActivityLog.deleteMany({
          where: { id: { in: ids } },
        }),
    );

    // Asistente de soporte (docs/PLAN_BOT_SOPORTE.md): sus conversaciones con el
    // personal tienen el mismo plazo que las del bot de los pacientes (los mensajes
    // se van con ellas, en cascada), y los códigos del panel, un día después de vencer.
    const r4 = await this.borrarEnLotes(
      new Date(ahora.getTime() - conversaciones * MS_DIA),
      (antesDe) =>
        this.prisma.supportBotConversation.findMany({
          where: { lastMessageAt: { lt: antesDe } },
          select: { id: true },
          take: LOTE,
        }),
      (ids) =>
        this.prisma.supportBotConversation.deleteMany({
          where: { id: { in: ids } },
        }),
    );
    const codigos = await this.prisma.supportBotCode.deleteMany({
      where: { expiresAt: { lt: new Date(ahora.getTime() - MS_DIA) } },
    });

    const resultado: ResultadoPurga = {
      conversaciones: { dias: conversaciones, ...r1 },
      consultasRastreo: { dias: consultas, ...r2 },
      actividadCanales: { dias: actividad, ...r3 },
      asistenteSoporte: { dias: conversaciones, ...r4 },
      codigosAsistente: codigos.count,
    };

    const pendiente =
      !r1.completa || !r2.completa || !r3.completa || !r4.completa;
    if (
      r1.borradas + r2.borradas + r3.borradas + r4.borradas > 0 ||
      pendiente
    ) {
      this.logger.log(
        `Retención: ${r1.borradas} conversación(es) de más de ${conversaciones} días, ` +
          `${r2.borradas} consulta(s) del rastreo de más de ${consultas} días, ` +
          `${r3.borradas} registro(s) de actividad de canales de más de ${actividad} días y ` +
          `${r4.borradas} conversación(es) del asistente de soporte de más de ${conversaciones} días borrados` +
          (pendiente ? '; quedan más, siguen la próxima noche.' : '.'),
      );
      await this.systemLog.event({
        action: 'DATA_RETENTION_PURGE',
        message: `Purga de retención: ${r1.borradas} conversaciones, ${r2.borradas} consultas del rastreo, ${r3.borradas} registros de actividad de canales y ${r4.borradas} conversaciones del asistente de soporte.`,
        metadata: resultado as unknown as Record<string, unknown>,
      });
    }
    return resultado;
  }

  /** El plazo del entorno, validado; si no vale, el de por defecto y una advertencia. */
  private plazo(variable: string, porDefecto: number): number {
    const { dias, aviso } = diasDeRetencion(
      this.config.get<string>(variable),
      porDefecto,
    );
    if (aviso) this.logger.warn(`${variable}: ${aviso}`);
    return dias;
  }

  private async borrarEnLotes(
    antesDe: Date,
    buscar: (antesDe: Date) => Promise<{ id: string }[]>,
    borrar: (ids: string[]) => Promise<{ count: number }>,
  ): Promise<{ borradas: number; completa: boolean }> {
    let borradas = 0;
    for (let i = 0; i < MAX_LOTES; i++) {
      const filas = await buscar(antesDe);
      if (filas.length === 0) return { borradas, completa: true };
      const { count } = await borrar(filas.map((f) => f.id));
      borradas += count;
      if (filas.length < LOTE) return { borradas, completa: true };
    }
    return { borradas, completa: false };
  }
}
