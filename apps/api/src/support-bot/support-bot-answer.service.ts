import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  banderasDelEspejo,
  baseDelPanel,
  diaLocal,
  getMenusForRole,
  leerRespuestaIA,
  promptDelAsistente,
  respuestaConIA,
  respuestaSinIA,
  textoBorradorParaLaIA,
  textoCasosParaLaIA,
  textoFichaDeLaClinica,
  textoIncidentesParaLaIA,
  turnosParaLaIA,
  LIMITES_SOPORTE,
  type BorradorCaso,
  type CasoDeLaPersona,
  type FichaClinica,
  type RespuestaAlEmpleado,
  type RespuestaIA,
  type UserRole,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { getErrorMessage } from '../common/error-message.util';
import { LlmFactoryService } from '../llm/llm-factory.service';
import type {
  LLMProvider,
  RespuestaConversacion,
} from '../llm/interfaces/llm-provider.interface';
import { SupportBotCasesService } from './support-bot-cases.service';
import { SupportBotKnowledgeService } from './support-bot-knowledge.service';
import type { Interlocutor } from './support-bot-session.service';
import { SupportBotWatchService } from './support-bot-watch.service';
import type { SupportBotRuntime } from './support-bot.types';

const NOMBRE_PROVEEDOR: Record<string, string | null> = {
  GEMINI: 'Gemini',
  CHATGPT: 'ChatGPT (OpenAI)',
  CLAUDE: 'Claude (Anthropic)',
  NONE: null,
};
const PROVEEDORES = ['GEMINI', 'CHATGPT', 'CLAUDE'] as const;
/** Lo que se lee de la conversación para armar el contexto. */
const MENSAJES_DE_CONTEXTO = 60;

/** Por qué una respuesta salió sin IA (para el log y las cifras). */
export type MotivoSinIA =
  | 'SIN_IA_CONFIGURADA'
  | 'TOPE_DIARIO'
  | 'FALLO'
  | 'NO_SE_PUDO_LEER'
  | 'SIN_MANUAL';

export interface RespuestaArmada {
  texto: string;
  botones: RespuestaAlEmpleado['botones'];
  registro: {
    source: 'IA' | 'SIN_IA';
    aiKind: string | null;
    uncovered: boolean;
    topics: string[];
    aiProvider: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
  };
  motivoSinIA: MotivoSinIA | null;
  /** Lo que devolvió la IA (null sin IA): el turno decide con esto el borrador y las notas. */
  ia: RespuestaIA | null;
  /** Lo que la persona escribió y se está respondiendo, tal cual (sin enmascarar). */
  pendientes: string[];
  /**
   * Lo que escribió en el turno anterior (ya respondido). Sin IA, «Abrir un caso»
   * arma el borrador con esto: es lo que ya contó antes de tocar el botón.
   */
  turnoAnterior: string[];
}

/** Lo que escribió la persona, como lo usa cada camino de la respuesta. */
type Escrito = Pick<RespuestaArmada, 'pendientes' | 'turnoAnterior'> & {
  consulta: string;
};

export interface OpcionesDeRespuesta {
  /** La persona pidió abrir un caso: este turno tiene que armarlo. */
  pedirCaso?: boolean;
  /** El borrador de caso en curso, para que la IA lo complete. */
  borrador?: BorradorCaso | null;
  /** Sus casos (si quien llama ya los tiene); si no, se buscan. */
  casos?: CasoDeLaPersona[];
}

/**
 * La respuesta del asistente a lo que el empleado escribió (docs/PLAN_BOT_SOPORTE.md
 * §3.2 y §3.3).
 *
 *   · Responde TODOS los mensajes que esperan respuesta (los seguidos se juntan).
 *   · El contexto: el manual armado para su rol y su menú, la ficha de su clínica
 *     (solo configuración), sus casos, lo que el equipo técnico ya sabe que falla,
 *     el borrador en curso y los últimos turnos, con los datos de pacientes
 *     enmascarados (S8).
 *   · La IA es la de la clínica (S5), con su respaldo entre proveedores si
 *     `LLM_FAILOVER_ENABLED=true`, y un tope diario por clínica (S15).
 *   · Si no hay IA, falla, tarda o devuelve algo ilegible: el buscador del Centro
 *     de ayuda. El empleado SIEMPRE recibe respuesta.
 *   · El código decide lo que importa (leerRespuestaIA, respuestaConIA): temas
 *     validados, «no cubierta» y los botones. El borrador y las notas los decide
 *     el turno (SupportBotService) con `ia`.
 */
@Injectable()
export class SupportBotAnswerService {
  private readonly logger = new Logger(SupportBotAnswerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly llm: LlmFactoryService,
    private readonly conocimiento: SupportBotKnowledgeService,
    private readonly casos: SupportBotCasesService,
    @Optional() private readonly vigilancia?: SupportBotWatchService,
  ) {}

  /** La respuesta a lo pendiente, o null si no hay nada que responder. */
  async responder(
    yo: Interlocutor,
    rt: SupportBotRuntime,
    ahora: Date = new Date(),
    opciones: OpcionesDeRespuesta = {},
  ): Promise<RespuestaArmada | null> {
    const mensajes = (
      await this.prisma.supportBotMessage.findMany({
        where: { conversationId: yo.conversationId },
        orderBy: { createdAt: 'desc' },
        take: MENSAJES_DE_CONTEXTO,
        select: { direction: true, text: true },
      })
    ).reverse();
    const ultimaSalida = mensajes.map((m) => m.direction).lastIndexOf('SALIDA');
    const pendientes = mensajes
      .slice(ultimaSalida + 1)
      .filter((m) => m.direction === 'ENTRADA')
      .map((m) => m.text);
    if (pendientes.length === 0) return null;
    const previos = mensajes.slice(0, Math.max(0, ultimaSalida));
    const turnoAnterior = previos
      .slice(previos.map((m) => m.direction).lastIndexOf('SALIDA') + 1)
      .filter((m) => m.direction === 'ENTRADA')
      .map((m) => m.text);
    const escrito: Escrito = {
      // Para el buscador, sin los comandos («/nuevo»).
      consulta: pendientes.filter((t) => !t.startsWith('/')).join('\n'),
      pendientes,
      turnoAnterior,
    };

    const clinica = await this.clinica(yo.organizationId);
    // El super admin en modo prueba pregunta como el administrador de esa clínica.
    const rol: UserRole = yo.isTest ? 'ORG_ADMIN' : yo.role;
    const manual = this.conocimiento.manualPara(
      rol,
      getMenusForRole(rol, clinica?.banderas ?? {}),
    );
    if (!manual) return this.sinIA(escrito, 'SIN_MANUAL', []);

    if (!(await this.dentroDelTope(yo, rt, ahora))) {
      return this.sinIA(escrito, 'TOPE_DIARIO', manual.temasDeOtroRol);
    }

    const principal = await this.proveedor(yo.organizationId);
    if (!principal)
      return this.sinIA(escrito, 'SIN_IA_CONFIGURADA', manual.temasDeOtroRol);

    const [casos, incidentes] = await Promise.all([
      opciones.casos ?? this.casos.casosDe(yo, ahora),
      this.casos.incidentesPara(yo.organizationId, clinica?.ficha.ia ?? null),
    ]);
    const prompt = promptDelAsistente({
      manual,
      ficha: clinica ? textoFichaDeLaClinica(clinica.ficha, ahora) : '',
      ahora,
      casos: textoCasosParaLaIA(casos),
      incidentes: textoIncidentesParaLaIA(incidentes, ahora),
      borrador: textoBorradorParaLaIA(opciones.borrador ?? null),
      pedirCaso: opciones.pedirCaso,
    });
    const turnos = turnosParaLaIA(mensajes);
    const inicio = Date.now();
    const r = await this.conRespaldo(yo.organizationId, principal, (p) =>
      p.conversar({
        sistema: prompt,
        turnos,
        json: true,
        maxTokens: 1200,
        timeoutMs: LIMITES_SOPORTE.esperaIaSegundos * 1000,
      }),
    );
    const clinicaDeYo = { id: yo.organizationId, nombre: yo.organizationName };
    if (!r) {
      void this.vigilancia?.iaFallo(clinicaDeYo, 'la IA falló o tardó');
      return this.sinIA(escrito, 'FALLO', manual.temasDeOtroRol);
    }

    const leida = leerRespuestaIA(r.respuesta.texto, manual.temasValidos);
    if (!leida) {
      this.logger.warn(
        `La IA (${r.proveedor}) devolvió algo que no se pudo leer como respuesta del asistente.`,
      );
      void this.vigilancia?.iaFallo(
        clinicaDeYo,
        'la IA respondió algo ilegible',
      );
      return this.sinIA(escrito, 'NO_SE_PUDO_LEER', manual.temasDeOtroRol);
    }
    void this.vigilancia?.iaRespondio(yo.organizationId);

    const armada = respuestaConIA({
      ia: leida.respuesta,
      noCubierta: leida.noCubierta,
      // El enlace al Centro de ayuda, solo para quien lo ve (el administrador).
      baseAyuda:
        rol === 'ORG_ADMIN' && !yo.isTest
          ? baseDelPanel(process.env.PUBLIC_WEB_URL, process.env.PUBLIC_API_URL)
          : null,
    });
    return {
      texto: armada.texto,
      botones: armada.botones,
      registro: {
        source: 'IA',
        aiKind: leida.respuesta.tipo,
        uncovered: leida.noCubierta,
        topics: leida.respuesta.temas,
        aiProvider: r.proveedor,
        inputTokens: r.respuesta.tokensEntrada,
        outputTokens: r.respuesta.tokensSalida,
        latencyMs: Date.now() - inicio,
      },
      motivoSinIA: null,
      ia: leida.respuesta,
      pendientes,
      turnoAnterior,
    };
  }

  // ── Internos ───────────────────────────────────────────────────────────

  private sinIA(
    escrito: Escrito,
    motivo: MotivoSinIA,
    temasDeOtroRol: readonly string[],
  ): RespuestaArmada {
    const armada = respuestaSinIA(
      this.conocimiento.buscar(escrito.consulta),
      temasDeOtroRol,
    );
    return {
      texto: armada.texto,
      botones: armada.botones,
      registro: {
        source: 'SIN_IA',
        aiKind: null,
        uncovered: false,
        topics: [],
        aiProvider: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
      },
      motivoSinIA: motivo,
      ia: null,
      pendientes: escrito.pendientes,
      turnoAnterior: escrito.turnoAnterior,
    };
  }

  /** La IA de la clínica, o null si no tiene (o no se pudo leer su configuración). */
  private async proveedor(organizationId: string): Promise<LLMProvider | null> {
    try {
      return await this.llm.forOrgOrNull(organizationId);
    } catch (e: unknown) {
      this.logger.warn(
        `No se pudo leer la IA de la clínica: ${getErrorMessage(e)}`,
      );
      return null;
    }
  }

  /**
   * Llama al proveedor principal y, si falla y `LLM_FAILOVER_ENABLED=true`, a los
   * demás que la clínica tenga configurados (igual que el asistente de pacientes).
   * Cada intento tiene su tiempo máximo. Null si ninguno respondió.
   */
  private async conRespaldo(
    organizationId: string,
    principal: LLMProvider,
    llamar: (p: LLMProvider) => Promise<RespuestaConversacion>,
  ): Promise<{ respuesta: RespuestaConversacion; proveedor: string } | null> {
    const intentar = async (p: LLMProvider) => {
      try {
        return {
          respuesta: await conTiempo(
            llamar(p),
            LIMITES_SOPORTE.esperaIaSegundos * 1000,
          ),
          proveedor: p.name,
        };
      } catch (e: unknown) {
        this.logger.warn(
          `La IA ${p.name} del asistente de soporte falló: ${getErrorMessage(e).slice(0, 200)}`,
        );
        return null;
      }
    };
    const primera = await intentar(principal);
    if (primera) return primera;
    if ((process.env.LLM_FAILOVER_ENABLED || '').toLowerCase() !== 'true')
      return null;
    for (const nombre of PROVEEDORES.filter((n) => n !== principal.name)) {
      const otro = await this.llm
        .forOrgByProvider(organizationId, nombre)
        .catch(() => null);
      if (!otro) continue;
      const r = await intentar(otro);
      if (r) return r;
    }
    return null;
  }

  /**
   * El tope diario de respuestas con IA de la clínica (S15), contado en Redis por
   * día de Colombia. Con tope 0 la clínica se atiende siempre sin IA. Sin Redis no
   * hay tope (mejor responder que callar).
   */
  private async dentroDelTope(
    yo: Interlocutor,
    rt: SupportBotRuntime,
    ahora: Date,
  ): Promise<boolean> {
    if (rt.maxAiTurnsPerOrgPerDay <= 0) return false;
    try {
      const clave = `soporte:ia:${yo.organizationId}:${diaLocal(ahora)}`;
      const n = await this.redis.incr(clave);
      if (n === 1) await this.redis.expire(clave, 2 * 24 * 3600);
      // La primera vez que se pasa en el día, el equipo técnico se entera.
      if (n === rt.maxAiTurnsPerOrgPerDay + 1) {
        void this.vigilancia?.topeAlcanzado(
          { id: yo.organizationId, nombre: yo.organizationName },
          rt.maxAiTurnsPerOrgPerDay,
          ahora,
        );
      }
      return n <= rt.maxAiTurnsPerOrgPerDay;
    } catch (e: unknown) {
      this.logger.warn(`Sin tope diario de IA (Redis): ${getErrorMessage(e)}`);
      return true;
    }
  }

  /** La ficha (solo configuración, nunca pacientes) y las banderas del menú. */
  private async clinica(organizationId: string): Promise<{
    ficha: FichaClinica;
    banderas: ReturnType<typeof banderasDelEspejo>;
  } | null> {
    const o = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        supportPhone: true,
        settings: {
          select: {
            botName: true,
            bookingEnabled: true,
            cancelEnabled: true,
            rescheduleEnabled: true,
            remindersEnabled: true,
            remindersOnlySelfBooked: true,
            reminderMinLeadMinutes: true,
            dailyAppointmentLimitEnabled: true,
            maxAppointmentsPerDay: true,
            monthlyAppointmentLimitEnabled: true,
            maxAppointmentsPerMonth: true,
          },
        },
        aiProviderConfig: { select: { activeProvider: true } },
        whatsappConfig: { select: { isActive: true } },
        telegramConfig: { select: { isActive: true } },
        hospitalMirrorConfig: {
          select: {
            enabled: true,
            driverKey: true,
            avisosMasivos: true,
            availabilityMode: true,
            lastHeartbeatAt: true,
            lastHisReachable: true,
          },
        },
      },
    });
    if (!o) return null;
    const s = o.settings;
    const espejo = o.hospitalMirrorConfig;
    const banderas = banderasDelEspejo(espejo);
    return {
      banderas,
      ficha: {
        nombre: o.name,
        nombreDelAsistente: s?.botName ?? 'AgenIA',
        canales: {
          whatsapp: !!o.whatsappConfig?.isActive,
          telegram: !!o.telegramConfig?.isActive,
        },
        ia:
          NOMBRE_PROVEEDOR[o.aiProviderConfig?.activeProvider ?? 'NONE'] ??
          null,
        interruptores: {
          agendar: s?.bookingEnabled ?? true,
          cancelar: s?.cancelEnabled ?? true,
          cambiarFecha: s?.rescheduleEnabled ?? true,
        },
        recordatorios: {
          encendidos: s?.remindersEnabled ?? true,
          soloAutoagendadas: s?.remindersOnlySelfBooked ?? false,
          anticipacionMinutos: s?.reminderMinLeadMinutes ?? 60,
        },
        limites: {
          porDia:
            (s?.dailyAppointmentLimitEnabled ?? true)
              ? (s?.maxAppointmentsPerDay ?? 1)
              : null,
          porMes:
            (s?.monthlyAppointmentLimitEnabled ?? true)
              ? (s?.maxAppointmentsPerMonth ?? 3)
              : null,
        },
        telefonoSoporte: o.supportPhone?.trim() || null,
        espejo: espejo
          ? {
              encendido: espejo.enabled,
              modoAgenda: espejo.availabilityMode,
              ultimoLatido: espejo.lastHeartbeatAt,
              alcanzaHis: espejo.lastHisReachable,
              avisosMasivos: banderas.conAvisos,
            }
          : null,
      },
    };
  }
}

/** Rechaza si la promesa no termina a tiempo (por si el proveedor ignora su señal). */
function conTiempo<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    promesa,
    new Promise<T>((_, rechazar) => {
      t = setTimeout(
        () => rechazar(new Error(`sin respuesta en ${ms} ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(t));
}
