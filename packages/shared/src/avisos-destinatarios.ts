/**
 * ══════════════════════════════════════════════════════════════════════════
 * A QUIÉN LE LLEGAN LOS AVISOS DE LA BANDEJA (docs/PLAN_AVISOS_AGENDADORES.md)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Hasta el 2026-11-02 el aviso por WhatsApp iba a UN número (y los recordatorios,
 * además, a un respaldo). Ahora va a una LISTA (`SyncAlertRecipient`): usuarios de la
 * clínica o números sueltos con nombre, cada uno con lo que recibe.
 *
 * Reglas puras: las usan la API (quién recibe cada lote) y el panel (la cobertura
 * que se muestra y la validación al guardar), y así dicen lo mismo.
 *
 *  · Modo (N5): `AVISOS` recibe el aviso y sus recordatorios; `SOLO_RECORDATORIOS`
 *    se entera solo si nadie tomó el caso (es el respaldo de antes).
 *  · Qué avisos (N6): citas que no llegan al hospital y pedidos de pacientes.
 *  · Alcance (N3): un agendador acotado a una EPS o a un médico recibe solo lo que ve
 *    al abrir la bandeja, con la misma regla (`citaFueraDeAlcance`).
 *  · Lo que por alcance no le cabe a nadie va a TODOS los del lote (N4): el mensaje no
 *    lleva datos del paciente y peor es un caso del que nadie se entera.
 */
import { citaFueraDeAlcance, type AlcanceAgente } from './alcance-agente';

/** N7: destinatarios ACTIVOS por clínica. */
export const MAX_DESTINATARIOS_AVISO = 15;

/** N9: «Probar» manda como mucho un mensaje por persona en este tiempo. */
export const PRUEBA_AVISO_CADA_MIN = 5;

export const MODOS_DESTINATARIO = ['AVISOS', 'SOLO_RECORDATORIOS'] as const;
export type ModoDestinatario = (typeof MODOS_DESTINATARIO)[number];

/** Los dos avisos: cada uno con su plantilla. */
export type GrupoAviso = 'SINCRONIZACION' | 'PEDIDOS_PACIENTES';
export const GRUPOS_AVISO: readonly GrupoAviso[] = [
  'SINCRONIZACION',
  'PEDIDOS_PACIENTES',
];
export const NOMBRE_GRUPO_AVISO: Record<GrupoAviso, string> = {
  SINCRONIZACION: 'Citas que no llegan al hospital',
  PEDIDOS_PACIENTES: 'Pedidos de pacientes',
};

/** El primer aviso, o un recordatorio porque nadie tomó el caso. */
export type ClaseAviso = 'AVISO' | 'RECORDATORIO';

/** Lo que estas reglas necesitan de un destinatario. */
export interface DestinatarioAviso {
  id: string;
  nombre: string;
  phone: string;
  mode: ModoDestinatario;
  syncAlerts: boolean;
  patientRequestAlerts: boolean;
  isActive: boolean;
  /** `null` = sin acotar (administrador, número suelto o agendador sin EPS ni médico). */
  alcance: AlcanceAgente | null;
}

type Recibe = Pick<
  DestinatarioAviso,
  'mode' | 'syncAlerts' | 'patientRequestAlerts' | 'isActive'
>;

export function recibeGrupo(
  d: Pick<DestinatarioAviso, 'syncAlerts' | 'patientRequestAlerts'>,
  grupo: GrupoAviso,
): boolean {
  return grupo === 'SINCRONIZACION' ? d.syncAlerts : d.patientRequestAlerts;
}

/** El primer aviso solo a `AVISOS`; los recordatorios, a los dos modos. */
export function recibeClase(
  d: Pick<DestinatarioAviso, 'mode'>,
  clase: ClaseAviso,
): boolean {
  return clase === 'RECORDATORIO' || d.mode === 'AVISOS';
}

/**
 * Quiénes reciben este lote: activos, de este aviso y de esta clase. Un mismo número
 * no aparece dos veces (la base ya lo impide; esto es la red).
 */
export function destinatariosDelLote<D extends Recibe & { phone: string }>(
  destinatarios: readonly D[],
  grupo: GrupoAviso,
  clase: ClaseAviso,
): D[] {
  const vistos = new Set<string>();
  return destinatarios.filter((d) => {
    if (!d.isActive || !recibeGrupo(d, grupo) || !recibeClase(d, clase)) {
      return false;
    }
    if (vistos.has(d.phone)) return false;
    vistos.add(d.phone);
    return true;
  });
}

/** ¿Hay quién reciba el PRIMER aviso de este grupo? Sin eso no sale nada (ni recordatorios). */
export function hayQuienRecibaElAviso(
  destinatarios: readonly Recibe[],
  grupo: GrupoAviso,
): boolean {
  return destinatarios.some(
    (d) =>
      d.isActive && recibeGrupo(d, grupo) && recibeClase(d, 'AVISO'),
  );
}

/**
 * A cada destinatario, las excepciones del lote que caben en su alcance (N3). Las que
 * no le caben a nadie van a todos (N4). Devuelve solo a quien le toca algo, en el
 * orden de `destinatarios` y con las excepciones en el orden del lote.
 */
export function repartirLote<
  D extends { alcance: AlcanceAgente | null },
  T extends { epsId: string | null; doctorId: string | null },
>(
  destinatarios: readonly D[],
  items: readonly T[],
): { destinatario: D; items: T[] }[] {
  const porDestinatario = destinatarios.map((destinatario) => ({
    destinatario,
    items: [] as T[],
  }));
  for (const item of items) {
    const caben = porDestinatario.filter(
      (p) => !citaFueraDeAlcance(p.destinatario.alcance, item),
    );
    for (const p of caben.length ? caben : porDestinatario) p.items.push(item);
  }
  return porDestinatario.filter((p) => p.items.length > 0);
}

/**
 * Los nombres para el historial de un caso: «Karen Muñoz», «Karen Muñoz y Ana
 * García», «Karen Muñoz, Ana García y 2 más». Nunca números de teléfono.
 */
export function nombresParaHistorial(nombres: readonly string[], max = 3): string {
  if (nombres.length === 0) return '';
  if (nombres.length === 1) return nombres[0];
  if (nombres.length <= max) {
    return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
  }
  return `${nombres.slice(0, max).join(', ')} y ${nombres.length - max} más`;
}

/** Cuántas personas reciben cada aviso, para la pantalla. */
export interface CoberturaAvisos {
  /** Personas activas que reciben algo. */
  personas: number;
  porGrupo: Record<
    GrupoAviso,
    {
      /** Reciben el primer aviso. */
      avisos: number;
      /** Reciben los recordatorios (incluye a quienes reciben el aviso). */
      recordatorios: number;
      /**
       * Todos los que reciben el aviso están acotados a una EPS o a un médico: lo que
       * no le cabe a ninguno (otra EPS, un caso sin EPS) les llega a todos (N4).
       */
      todosAcotados: boolean;
    }
  >;
}

export function coberturaAvisos(
  destinatarios: readonly (Recibe & { alcance: AlcanceAgente | null })[],
): CoberturaAvisos {
  const activos = destinatarios.filter(
    (d) => d.isActive && (d.syncAlerts || d.patientRequestAlerts),
  );
  const grupo = (g: GrupoAviso) => {
    const delGrupo = activos.filter((d) => recibeGrupo(d, g));
    const conAviso = delGrupo.filter((d) => recibeClase(d, 'AVISO'));
    return {
      avisos: conAviso.length,
      recordatorios: delGrupo.length,
      todosAcotados:
        conAviso.length > 0 && conAviso.every((d) => d.alcance !== null),
    };
  };
  return {
    personas: activos.length,
    porGrupo: {
      SINCRONIZACION: grupo('SINCRONIZACION'),
      PEDIDOS_PACIENTES: grupo('PEDIDOS_PACIENTES'),
    },
  };
}

/**
 * Lo que impide guardar una lista: alguien en «solo recordatorios» de un aviso que
 * nadie recibe primero. Sin primer aviso no hay recordatorio, así que esa persona no
 * recibiría nada sin saberlo (antes: «un respaldo sin agendador»). `null` si está bien.
 */
export function problemaDeCobertura(
  destinatarios: readonly Recibe[],
): string | null {
  for (const g of GRUPOS_AVISO) {
    const soloRecordatorios = destinatarios.some(
      (d) => d.isActive && recibeGrupo(d, g) && d.mode === 'SOLO_RECORDATORIOS',
    );
    if (soloRecordatorios && !hayQuienRecibaElAviso(destinatarios, g)) {
      return `Nadie recibe el primer aviso de «${NOMBRE_GRUPO_AVISO[g]}»: quien está en «Solo recordatorios» no recibiría nada. Pon al menos a una persona en «Avisos y recordatorios».`;
    }
  }
  return null;
}

/**
 * El alcance con el que recibe un usuario: el de su perfil si es agendador con EPS o
 * médico asignados (la misma regla de la bandeja, `resolverActorBandeja`); si no, sin
 * acotar. Un número suelto (sin usuario) tampoco está acotado.
 */
export function alcanceDeDestinatario(
  usuario: {
    role: string;
    agentProfile: { epsId: string | null; doctorId: string | null } | null;
  } | null,
): AlcanceAgente | null {
  if (!usuario || usuario.role !== 'BOOKING_AGENT') return null;
  const epsId = usuario.agentProfile?.epsId || null;
  const doctorId = usuario.agentProfile?.doctorId || null;
  return epsId || doctorId ? { epsId, doctorId } : null;
}

/** Cómo se nombra a un destinatario en la pantalla, el historial y las alertas técnicas. */
export function nombreDeDestinatario(r: {
  label: string | null;
  user: { email: string; agentProfile: { fullName: string } | null } | null;
}): string {
  return (
    r.user?.agentProfile?.fullName?.trim() ||
    r.user?.email ||
    r.label?.trim() ||
    'Sin nombre'
  );
}

/**
 * N9: las variables del mensaje de prueba, con la MISMA plantilla del aviso
 * (`SYNC_EXCEPTION_ALERT`): así se comprueban a la vez el número, que tenga WhatsApp
 * y la plantilla. Con el texto aprobado se lee «AgenIA: 0 cita(s) necesitan revisión…
 * La más próxima: ninguna (mensaje de prueba). Causa: PRUEBA…».
 */
export function parametrosPruebaAviso(): string[] {
  return [
    '0',
    'ninguna (mensaje de prueba)',
    'PRUEBA de la configuración de avisos: no hay nada que revisar',
  ];
}

/** Los fallos que el envío devuelve con un código propio, antes de llegar a Meta. */
const FALLOS_CONOCIDOS: Record<string, string> = {
  'template-not-configured': 'falta registrar la plantilla en Configuración',
  'whatsapp-inactive': 'el WhatsApp de la clínica está apagado',
  'body-params-mismatch': 'el mensaje no cuadra con la plantilla',
  'missing-params': 'falta el número',
  'not-a-whatsapp-recipient': 'no es un número de WhatsApp',
};

/**
 * Por qué no salió un mensaje, dicho para la pantalla y la alerta técnica: el motivo
 * que da Meta (su `details` o su `message`, con el código) o el de AgenIA, sin el
 * JSON entero. Acotado a 200 caracteres y en una línea.
 */
export function explicarFalloDeEnvio(error: string | null | undefined): string {
  const crudo = (error ?? '').trim();
  if (!crudo) return 'no se sabe el motivo';
  if (FALLOS_CONOCIDOS[crudo]) return FALLOS_CONOCIDOS[crudo];
  let texto = crudo;
  try {
    const j = JSON.parse(crudo) as {
      error?: {
        message?: unknown;
        code?: unknown;
        error_data?: { details?: unknown };
      };
    };
    const e = j?.error;
    const motivo = e?.error_data?.details ?? e?.message;
    if (typeof motivo === 'string' && motivo.trim()) {
      texto = e?.code != null ? `${motivo.trim()} (código ${String(e.code)})` : motivo.trim();
    }
  } catch {
    // No era JSON: va tal cual, acotado.
  }
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio.length > 200 ? `${limpio.slice(0, 199).trimEnd()}…` : limpio;
}
