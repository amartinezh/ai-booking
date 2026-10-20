import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  VIGILANCIA_SOPORTE,
  claveAlerta,
  claveCifrasDelDia,
  diaLocal,
  ventanaDe,
  type ContadorSoporte,
} from '@agenia/shared';
import { RedisService } from '../redis/redis.service';
import { TechAlertService } from '../tech-alerts/tech-alert.service';
import { getErrorMessage } from '../common/error-message.util';

const DIA_SEG = 86_400;
const FUENTE = 'asistente de soporte';

/**
 * La vigilancia del asistente de soporte (docs/PLAN_BOT_SOPORTE.md §3.7, Fase 5):
 *
 *  · Cuenta por día, en Redis, lo que pasa antes de la conversación y no queda en
 *    la base (los códigos se borran un día después de vencer): códigos pedidos,
 *    equivocados, cuentas bloqueadas y mensajes sin código. Lo lee el panel.
 *  · Abre las alertas técnicas del propio asistente: sin la IA de una clínica
 *    (3 fallos en 15 min; se resuelve con la primera respuesta con IA), una clínica
 *    que llegó a su tope diario de IA (una vez al día) y muchos códigos
 *    equivocados seguidos desde cualquier cuenta (20 en 10 min).
 *
 * Nada de esto usa IA ni datos de pacientes. Sin Redis no se cuenta ni se alerta,
 * y nunca lanza: el asistente sigue atendiendo.
 */
@Injectable()
export class SupportBotWatchService {
  private readonly logger = new Logger(SupportBotWatchService.name);

  constructor(
    private readonly redis: RedisService,
    @Optional() private readonly alertas?: TechAlertService,
  ) {}

  /** Suma uno al contador del día. */
  async contar(
    campo: ContadorSoporte,
    ahora: Date = new Date(),
  ): Promise<void> {
    try {
      const clave = claveCifrasDelDia(diaLocal(ahora));
      const n = await this.redis.hincrby(clave, campo, 1);
      if (n === 1) {
        await this.redis.expire(
          clave,
          VIGILANCIA_SOPORTE.contadoresDias * DIA_SEG,
        );
      }
    } catch (e: unknown) {
      this.logger.warn(
        `No se pudo contar «${campo}» (Redis): ${getErrorMessage(e)}`,
      );
    }
  }

  /** Un código equivocado o vencido: se cuenta y, si son muchos seguidos, alerta. */
  async codigoFallido(ahora: Date = new Date()): Promise<void> {
    await this.contar('fallidos', ahora);
    const { ventanaCodigosMin, codigosFallidosParaAlerta } = VIGILANCIA_SOPORTE;
    try {
      const ventana = ventanaDe(ahora, ventanaCodigosMin);
      const clave = `soporte:codigos-fallidos:${ventana}`;
      const n = await this.redis.incr(clave);
      if (n === 1) await this.redis.expire(clave, ventanaCodigosMin * 60 * 2);
      if (n !== codigosFallidosParaAlerta) return;
      await this.alertas?.avisar({
        kind: 'SOPORTE_CODIGOS_FALLIDOS',
        dedupeKey: claveAlerta.soporteCodigosFallidos(ventana),
        title: 'Códigos del asistente de soporte',
        detail: `${n} códigos equivocados en menos de ${ventanaCodigosMin} minutos, desde cualquier cuenta de Telegram. Puede ser alguien probando códigos al azar: cada cuenta se bloquea una hora después de 5 y los códigos vencen a los 10 minutos.`,
        fuente: FUENTE,
      });
    } catch (e: unknown) {
      this.logger.warn(
        `Sin vigilancia de códigos (Redis): ${getErrorMessage(e)}`,
      );
    }
  }

  /**
   * La IA de la clínica falló o respondió algo ilegible (no cuenta la clínica sin
   * IA configurada ni el tope diario: esos son decisiones, no fallas).
   */
  async iaFallo(
    clinica: { id: string; nombre: string },
    motivo: string,
  ): Promise<void> {
    const { ventanaFallosIaMin, fallosIaParaAlerta } = VIGILANCIA_SOPORTE;
    try {
      const clave = `soporte:fallos-ia:${clinica.id}`;
      const n = await this.redis.incr(clave);
      if (n === 1) await this.redis.expire(clave, ventanaFallosIaMin * 60);
      if (n < fallosIaParaAlerta) return;
      // Una sola vez mientras siga sin IA (la marca se borra al volver).
      const nueva = await this.redis.set(
        claveSinIaAbierta(clinica.id),
        '1',
        'EX',
        7 * DIA_SEG,
        'NX',
      );
      if (nueva !== 'OK') return;
      await this.alertas?.avisar({
        kind: 'SOPORTE_SIN_IA',
        dedupeKey: claveAlerta.soporteSinIa(clinica.id),
        title: 'Asistente de soporte sin IA',
        detail: `${n} respuestas seguidas sin la IA de la clínica en ${ventanaFallosIaMin} minutos (${motivo}). El personal recibe lo más parecido del manual. Revise la IA en Configuración › Integración de IA de la clínica.`,
        organizationId: clinica.id,
        organizationName: clinica.nombre,
        fuente: FUENTE,
      });
    } catch (e: unknown) {
      this.logger.warn(
        `Sin vigilancia de la IA del asistente (Redis): ${getErrorMessage(e)}`,
      );
    }
  }

  /** La IA de la clínica respondió: si había alerta, se resuelve. */
  async iaRespondio(organizationId: string): Promise<void> {
    try {
      const [abierta] = await Promise.all([
        this.redis.del(claveSinIaAbierta(organizationId)),
        this.redis.del(`soporte:fallos-ia:${organizationId}`),
      ]);
      if (abierta > 0) {
        await this.alertas?.resolver(claveAlerta.soporteSinIa(organizationId));
      }
    } catch (e: unknown) {
      this.logger.warn(
        `Sin vigilancia de la IA del asistente (Redis): ${getErrorMessage(e)}`,
      );
    }
  }

  /** La clínica llegó a su tope diario de respuestas con IA (se llama una vez al día). */
  async topeAlcanzado(
    clinica: { id: string; nombre: string },
    tope: number,
    ahora: Date = new Date(),
  ): Promise<void> {
    await this.alertas?.avisar({
      kind: 'SOPORTE_TOPE_IA',
      dedupeKey: claveAlerta.soporteTopeIa(clinica.id, diaLocal(ahora)),
      title: 'Tope de IA del asistente de soporte',
      detail: `La clínica llegó a ${tope} respuestas con IA hoy: hasta mañana, el asistente le responde al personal con el buscador del manual. El tope se cambia en «Asistente de soporte».`,
      organizationId: clinica.id,
      organizationName: clinica.nombre,
      fuente: FUENTE,
    });
  }
}

const claveSinIaAbierta = (organizationId: string) =>
  `soporte:sin-ia-abierta:${organizationId}`;
