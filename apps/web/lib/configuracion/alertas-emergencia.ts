import type { PrismaClient } from '@agenia/database';
import {
  MAX_DESTINATARIOS_EMERGENCIA,
  celularLegible,
  validarCelularEmergencia,
  validarNombreEmergencia,
} from '@agenia/shared';
import { estadoEnvio } from '@/lib/bandeja/avisos';
import type { EstadoEnvioDestinatario } from '@/lib/bandeja/tipos';

// ─────────────────────────────────────────────────────────────
// 🚑 Quién recibe la alerta de posible emergencia (Configuración › Datos de la
// clínica, docs/GUARDRAIL_EMERGENCIAS.md, 2026-11-22). El envío lo hace la API
// (`AlertaEmergenciaService`); aquí se lee y se guarda la lista, siempre dentro de la
// clínica de la sesión.
// ─────────────────────────────────────────────────────────────

type Db = Pick<PrismaClient, 'emergencyAlertRecipient' | 'whatsappTemplate' | 'whatsappMessageLog' | '$transaction'>;

export interface PersonaAlertaEmergencia {
  id: string;
  label: string;
  /** Solo dígitos, con el 57. */
  phone: string;
  /** «+57 314 679 3010». */
  telefono: string;
  isActive: boolean;
  estado: EstadoEnvioDestinatario;
}

export interface EstadoAlertasEmergencia {
  personas: PersonaAlertaEmergencia[];
  /** La plantilla EMERGENCY_ALERT registrada en Configuración › Canales, o null. */
  plantilla: { name: string; language: string; isActive: boolean } | null;
}

export async function cargarAlertasEmergencia(
  db: Db,
  organizationId: string,
  timeZone?: string,
): Promise<EstadoAlertasEmergencia> {
  const [filas, plantilla] = await Promise.all([
    db.emergencyAlertRecipient.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        label: true,
        phone: true,
        isActive: true,
        lastSentAt: true,
        lastWamid: true,
        lastError: true,
        lastErrorAt: true,
      },
    }),
    db.whatsappTemplate.findFirst({
      where: { organizationId, kind: 'EMERGENCY_ALERT' },
      select: { name: true, language: true, isActive: true },
    }),
  ]);
  const wamids = filas.map((f) => f.lastWamid).filter((w): w is string => !!w);
  const mensajes = wamids.length
    ? await db.whatsappMessageLog.findMany({
        where: { organizationId, wamid: { in: wamids } },
        select: { wamid: true, status: true, statusAt: true, errorDetail: true },
      })
    : [];
  const porWamid = new Map(mensajes.map((m) => [m.wamid, m]));
  return {
    plantilla,
    personas: filas.map((f) => ({
      id: f.id,
      label: f.label,
      phone: f.phone,
      telefono: celularLegible(f.phone),
      isActive: f.isActive,
      estado: estadoEnvio(f, f.lastWamid ? (porWamid.get(f.lastWamid) ?? null) : null, timeZone),
    })),
  };
}

/** Lo que manda la pantalla: la lista completa, como queda. */
export interface EntradaPersonaEmergencia {
  /** La fila que ya existía; vacío si es nueva. */
  id?: string | null;
  label: string;
  telefono: string;
  isActive: boolean;
}

export type ListaValidada =
  | { ok: true; filas: { id: string | null; label: string; phone: string; isActive: boolean }[] }
  | { ok: false; error: string };

/** Valida la lista entera antes de tocar la base. */
export function validarListaEmergencia(entrada: unknown): ListaValidada {
  if (!Array.isArray(entrada)) return { ok: false, error: 'Falta la lista.' };
  if (entrada.length > MAX_DESTINATARIOS_EMERGENCIA * 2) {
    return { ok: false, error: `Son demasiadas personas: máximo ${MAX_DESTINATARIOS_EMERGENCIA} activas.` };
  }
  const filas: { id: string | null; label: string; phone: string; isActive: boolean }[] = [];
  const vistos = new Set<string>();
  for (const [i, e] of entrada.entries()) {
    const fila = (e ?? {}) as Partial<EntradaPersonaEmergencia>;
    const n = validarNombreEmergencia(fila.label);
    if (!n.ok) return { ok: false, error: `Persona ${i + 1}: ${n.error}` };
    const c = validarCelularEmergencia(fila.telefono);
    if (!c.ok) return { ok: false, error: `${n.label}: ${c.error}` };
    if (vistos.has(c.phone)) {
      return { ok: false, error: `El celular ${celularLegible(c.phone)} está dos veces.` };
    }
    vistos.add(c.phone);
    const id = typeof fila.id === 'string' && fila.id.trim() && fila.id.length <= 64 ? fila.id.trim() : null;
    filas.push({ id, label: n.label, phone: c.phone, isActive: fila.isActive !== false });
  }
  const activas = filas.filter((f) => f.isActive).length;
  if (activas > MAX_DESTINATARIOS_EMERGENCIA) {
    return {
      ok: false,
      error: `Como mucho ${MAX_DESTINATARIOS_EMERGENCIA} personas activas: pause a alguien o quítelo de la lista.`,
    };
  }
  return { ok: true, filas };
}

/** «Ana (···3010)»: para la Actividad de usuarios, sin el celular entero. */
const quien = (label: string, phone: string) => `${label} (···${phone.slice(-4)})`;

/**
 * Guarda la lista tal como quedó en la pantalla: crea las nuevas, cambia las que
 * siguen y borra las que se quitaron. Una fila con un `id` de otra clínica no existe
 * aquí (cada escritura va con `organizationId`). Devuelve el resumen de lo que cambió.
 */
export async function guardarListaEmergencia(
  db: Db,
  organizationId: string,
  filas: { id: string | null; label: string; phone: string; isActive: boolean }[],
  userId: string | null,
): Promise<{ cambios: string[]; activas: number }> {
  return db.$transaction(async (tx) => {
    const antes = await tx.emergencyAlertRecipient.findMany({
      where: { organizationId },
      select: { id: true, label: true, phone: true, isActive: true },
    });
    const porId = new Map(antes.map((a) => [a.id, a]));
    const quedan = new Set(filas.map((f) => f.id).filter((id): id is string => !!id && porId.has(id)));
    const cambios: string[] = [];

    const quitar = antes.filter((a) => !quedan.has(a.id));
    if (quitar.length) {
      await tx.emergencyAlertRecipient.deleteMany({
        where: { organizationId, id: { in: quitar.map((a) => a.id) } },
      });
      for (const a of quitar) cambios.push(`quitó a ${quien(a.label, a.phone)}`);
    }

    for (const f of filas) {
      const previa = f.id ? porId.get(f.id) : undefined;
      if (!previa) {
        await tx.emergencyAlertRecipient.create({
          data: { organizationId, label: f.label, phone: f.phone, isActive: f.isActive, createdByUserId: userId },
        });
        cambios.push(`agregó a ${quien(f.label, f.phone)}${f.isActive ? '' : ' (en pausa)'}`);
        continue;
      }
      if (previa.label === f.label && previa.phone === f.phone && previa.isActive === f.isActive) continue;
      await tx.emergencyAlertRecipient.updateMany({
        where: { id: previa.id, organizationId },
        data: {
          label: f.label,
          phone: f.phone,
          isActive: f.isActive,
          // Otro celular: la salud del anterior ya no dice nada de este.
          ...(previa.phone !== f.phone
            ? { lastSentAt: null, lastWamid: null, lastError: null, lastErrorAt: null, lastTestAt: null }
            : {}),
        },
      });
      if (previa.isActive !== f.isActive) cambios.push(`${f.isActive ? 'reanudó' : 'pausó'} a ${quien(f.label, f.phone)}`);
      if (previa.phone !== f.phone) cambios.push(`cambió el celular de ${f.label} a ···${f.phone.slice(-4)}`);
      if (previa.label !== f.label) cambios.push(`renombró a «${previa.label}» como «${f.label}»`);
    }
    return { cambios, activas: filas.filter((f) => f.isActive).length };
  });
}
