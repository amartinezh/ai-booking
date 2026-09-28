/**
 * Alta en caliente del paciente de una cita nacida en el HOSPITAL
 * (docs/PLAN_ALTA_EN_CALIENTE.md). Lógica PURA: decide QUÉ hacer con un documento y
 * un teléfono que llegan del HIS, sin tocar la base.
 *
 * Vive en `@agenia/shared` porque la decisión tiene que ser la misma que ve el rastreo
 * cuando explica un caso raro, y porque así se prueba sin base de datos.
 *
 * ═══ Las reglas, y de dónde salen ═══
 *  · **D3 — documento ambiguo.** Se reutiliza un perfil solo si hay EXACTAMENTE uno
 *    que corresponda al documento (el mismo número, o el mismo sin ceros a la
 *    izquierda). Si hay varios, no se crea ni se elige: alguien tiene que corregir el
 *    documento en el sistema donde esté mal escrito. Fusionar automáticamente podría
 *    unir a dos personas distintas, y eso no se deshace.
 *  · **D4 — teléfono compartido.** Un teléfono que ya es de OTRO documento no se
 *    asigna: el bot identifica a quien escribe por su número, y asignarlo haría que
 *    una persona pudiera ver —o cancelar— la cita de otra. Se pierde un recordatorio;
 *    no se filtra una cita.
 *  · **D10 — no recrear.** Un documento dado de baja no vuelve a crearse solo.
 *  · Sin nombre no se crea el perfil: un paciente sin nombre no se puede identificar
 *    en ventanilla ni saludar en un recordatorio. La cita del hospital sigue ocupando
 *    el cupo, como hasta hoy.
 */
import { documentoSinCerosIniciales, normalizeDocumento } from './documento';

/** Lo que hace falta saber de un perfil que ya existe en AgenIA. */
export interface PerfilCandidato {
  id: string;
  cedula: string;
  whatsappId: string | null;
  bsuid: string | null;
}

/** Un perfil que ya usa el teléfono que trae el HIS. */
export interface DuenoDeTelefono {
  id: string;
  cedula: string;
}

export type MotivoSinAlta =
  /** Varios perfiles podrían ser esta persona: lo resuelve alguien, no el sistema. */
  | 'DOCUMENTO_AMBIGUO'
  /** Alguien pidió que no se le vuelva a crear el perfil (D10). */
  | 'BAJA_SOLICITADA'
  /** El documento que manda el hospital no es utilizable. */
  | 'DOCUMENTO_INVALIDO'
  /** No hay nombre: no se crea un paciente anónimo. */
  | 'SIN_NOMBRE';

export interface TelefonoDecidido {
  /** El número a guardar, o `null` si no se le asigna ninguno. */
  numero: string | null;
  /** Por qué no se asignó, para la auditoría. */
  motivo: 'ASIGNADO' | 'SIN_TELEFONO' | 'ILEGIBLE' | 'ES_DE_OTRO_PACIENTE';
}

export type DecisionAlta =
  | { accion: 'REUTILIZAR'; pacienteId: string; telefono: TelefonoDecidido }
  | {
      accion: 'CREAR';
      /** El documento tal como se va a guardar: el que manda el hospital, normalizado. */
      documento: string;
      nombre: string;
      telefono: TelefonoDecidido;
    }
  | { accion: 'NO_CREAR'; motivo: MotivoSinAlta; candidatos: string[] };

export interface EntradaAlta {
  /** `NU_HIST_PAC_CIT` del HIS, tal cual. */
  documento: string | null | undefined;
  nombre?: string | null;
  telefono?: string | null;
  /** Perfiles de ESTA clínica cuyo documento coincide (exacto o sin ceros). */
  perfiles: PerfilCandidato[];
  /** ¿Hay una baja registrada para este documento? (D10) */
  bajaSolicitada?: boolean;
  /** Perfiles de ESTA clínica que ya tienen ese teléfono. */
  duenosDelTelefono?: DuenoDeTelefono[];
  /** Cómo se normaliza un celular colombiano (se inyecta para no duplicar la regla). */
  normalizarTelefono: (crudo: string) => string | null;
}

/** ¿Dos documentos son «el mismo número» a ojos de esta regla? */
const mismoNumero = (a: string, b: string): boolean =>
  documentoSinCerosIniciales(normalizeDocumento(a)) ===
  documentoSinCerosIniciales(normalizeDocumento(b));

/** Un documento utilizable: 4 a 15 dígitos y al menos uno distinto de cero. */
const documentoUtilizable = (digitos: string): boolean =>
  /^\d{4,15}$/.test(digitos) && /[1-9]/.test(digitos);

export function decidirTelefono(
  entrada: Pick<
    EntradaAlta,
    'telefono' | 'documento' | 'duenosDelTelefono' | 'normalizarTelefono'
  >,
): TelefonoDecidido {
  const crudo = (entrada.telefono ?? '').trim();
  if (!crudo) return { numero: null, motivo: 'SIN_TELEFONO' };
  const e164 = entrada.normalizarTelefono(crudo);
  if (!e164) return { numero: null, motivo: 'ILEGIBLE' };
  // Como lo espera el envío de WhatsApp: solo dígitos, con el 57.
  const numero = e164.replace(/\D/g, '');
  const documento = normalizeDocumento(entrada.documento);
  const deOtro = (entrada.duenosDelTelefono ?? []).some(
    (d) => !mismoNumero(d.cedula, documento),
  );
  return deOtro
    ? { numero: null, motivo: 'ES_DE_OTRO_PACIENTE' }
    : { numero, motivo: 'ASIGNADO' };
}

export function decidirAlta(entrada: EntradaAlta): DecisionAlta {
  const documento = normalizeDocumento(entrada.documento);
  if (!documentoUtilizable(documento)) {
    return { accion: 'NO_CREAR', motivo: 'DOCUMENTO_INVALIDO', candidatos: [] };
  }

  const candidatos = entrada.perfiles.filter((p) =>
    mismoNumero(p.cedula, documento),
  );
  if (candidatos.length > 1) {
    // Puede ser la misma persona escrita de dos formas, o dos personas distintas.
    // Desde aquí no se sabe, y equivocarse mezcla dos historias clínicas.
    return {
      accion: 'NO_CREAR',
      motivo: 'DOCUMENTO_AMBIGUO',
      candidatos: candidatos.map((c) => c.id),
    };
  }

  const telefono = decidirTelefono(entrada);

  if (candidatos.length === 1) {
    return { accion: 'REUTILIZAR', pacienteId: candidatos[0].id, telefono };
  }

  // Crear: la baja solo bloquea lo NUEVO. Si el perfil ya existe, la cita del
  // hospital se le anota igual (la baja es de recordatorios, no de existir).
  if (entrada.bajaSolicitada) {
    return { accion: 'NO_CREAR', motivo: 'BAJA_SOLICITADA', candidatos: [] };
  }
  const nombre = (entrada.nombre ?? '').trim().replace(/\s+/g, ' ');
  if (!nombre) {
    return { accion: 'NO_CREAR', motivo: 'SIN_NOMBRE', candidatos: [] };
  }
  return { accion: 'CREAR', documento, nombre, telefono };
}

/** La nota de auditoría de una decisión, sin datos personales. */
export function notaDeAlta(d: DecisionAlta): string {
  const porTelefono = (t: TelefonoDecidido) =>
    t.motivo === 'ASIGNADO'
      ? 'con WhatsApp'
      : t.motivo === 'ES_DE_OTRO_PACIENTE'
        ? 'sin WhatsApp (el teléfono del HIS ya es de otro paciente)'
        : t.motivo === 'ILEGIBLE'
          ? 'sin WhatsApp (el teléfono del HIS no es un celular legible)'
          : 'sin WhatsApp (el HIS no tiene teléfono)';
  switch (d.accion) {
    case 'REUTILIZAR':
      return `paciente ya conocido, ${porTelefono(d.telefono)}`;
    case 'CREAR':
      return `paciente creado desde el HIS, ${porTelefono(d.telefono)}`;
    default:
      return {
        DOCUMENTO_AMBIGUO:
          'no se creó el paciente: hay más de un perfil que podría ser esta persona',
        BAJA_SOLICITADA:
          'no se creó el paciente: hay una baja registrada para ese documento',
        DOCUMENTO_INVALIDO:
          'no se creó el paciente: el documento del HIS no es utilizable',
        SIN_NOMBRE:
          'no se creó el paciente: el HIS no dio el nombre',
      }[d.motivo];
  }
}

// ─────────────────────────────────────────────────────────────
// Lo que se hereda del padrón de la EPS
// ─────────────────────────────────────────────────────────────

export type Regimen = "SUBSIDIADO" | "CONTRIBUTIVO";

/** Una fila activa del padrón (`EpsEnrolledPatient`) para el documento. */
export interface FilaPadron {
  epsId: string;
  regime: string | null;
}

export interface AfiliacionPadron {
  epsId: string | null;
  regime: Regimen | null;
}

const REGIMENES: readonly Regimen[] = ["SUBSIDIADO", "CONTRIBUTIVO"];

/**
 * La EPS y el régimen que el padrón le da a un documento, solo si no hay duda.
 *
 * El HIS nunca manda el régimen, y sin él el espejo no puede elegir el convenio de la
 * EPS (hay uno por régimen): el paciente creado por el alta en caliente quedaba sin
 * él, y su siguiente cita por WhatsApp no llegaba al hospital (caso real del
 * 2026-09-26). El padrón de la EPS sí lo trae — lo tenían los 121 pacientes nacidos
 * en el HIS que estaban sin régimen.
 *
 *  · **EPS (D6):** solo si el documento está activo en UNA sola EPS. En dos, elegir
 *    sería adivinar.
 *  · **Régimen:** el de ESA EPS, y solo si sus filas coinciden. El documento puede
 *    estar dos veces en la misma EPS (con y sin ceros a la izquierda); si esas filas
 *    dicen regímenes distintos, no se elige: el bot se lo pregunta al paciente.
 *    Un régimen que no sea SUBSIDIADO o CONTRIBUTIVO no cuenta.
 */
export function afiliacionDelPadron(filas: FilaPadron[]): AfiliacionPadron {
  const epsIds = [...new Set(filas.map((f) => f.epsId))];
  if (epsIds.length !== 1) return { epsId: null, regime: null };

  const regimenes = [
    ...new Set(
      filas
        .map((f) => (f.regime ?? "").trim().toUpperCase())
        .filter((r): r is Regimen =>
          (REGIMENES as readonly string[]).includes(r),
        ),
    ),
  ];
  return {
    epsId: epsIds[0],
    regime: regimenes.length === 1 ? regimenes[0] : null,
  };
}

/**
 * Qué huecos de un paciente que YA existe rellena el padrón. Nunca pisa: un dato que
 * ya estaba lo puso el paciente (al bot) o el personal, y vale más que el padrón.
 *
 * El régimen es de una EPS concreta: solo se copia si el paciente no tiene EPS o
 * tiene justo la del padrón. Con otra EPS, el régimen del padrón sería el de otra
 * afiliación.
 */
export function huecosQueRellenaElPadron(
  perfil: { epsId: string | null; regime: string | null },
  padron: AfiliacionPadron,
): { epsId?: string; regime?: Regimen } {
  const cambios: { epsId?: string; regime?: Regimen } = {};
  if (!padron.epsId) return cambios;
  if (!perfil.epsId) cambios.epsId = padron.epsId;
  const mismaEps = !perfil.epsId || perfil.epsId === padron.epsId;
  if (!perfil.regime?.trim() && padron.regime && mismaEps) {
    cambios.regime = padron.regime;
  }
  return cambios;
}

/**
 * El régimen del padrón para agendar con `epsId`, SOLO si no hay ninguna duda; si no,
 * null y el bot se lo pregunta al paciente (preguntar nunca es un error; adivinar sí).
 *
 * Más estricta que `afiliacionDelPadron` a propósito: además de una sola EPS y un
 * solo régimen, esa EPS tiene que ser LA MISMA con la que el paciente está agendando.
 * El régimen es de una afiliación concreta; el de otra EPS elegiría otro convenio.
 */
export function regimenSeguroDelPadron(
  filas: FilaPadron[],
  epsId: string | null | undefined,
): Regimen | null {
  if (!epsId) return null;
  const afiliacion = afiliacionDelPadron(filas);
  return afiliacion.epsId === epsId ? afiliacion.regime : null;
}
