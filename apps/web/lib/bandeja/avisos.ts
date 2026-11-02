/**
 * 📣 A quién le llegan por WhatsApp los avisos de la Bandeja
 * (docs/PLAN_AVISOS_AGENDADORES.md, 2026-11-02).
 *
 * Antes eran dos números (agendador y respaldo). Ahora es una lista
 * (`SyncAlertRecipient`): los agendadores y administradores de la clínica aparecen
 * solos y el administrador elige quién recibe, con qué modo y qué avisos; además,
 * números sueltos con nombre para quien no tiene cuenta.
 *
 * Las mismas reglas que `lib/bandeja/servicio.ts`: el tenant sale del token y va en
 * TODA consulta, solo el ORG_ADMIN configura (`permisos.configurarAvisos`), y el
 * cambio y su constancia en la bitácora del espejo van en UNA transacción. Quién
 * recibe qué lo deciden las reglas de `@agenia/shared` (`avisos-destinatarios.ts`),
 * las mismas que usa la API al enviar.
 */
import type { PrismaClient } from '@agenia/database';
import {
  MAX_DESTINATARIOS_AVISO,
  MODOS_DESTINATARIO,
  SYNC_AUDIT_DIRECTION,
  alcanceDeDestinatario,
  coberturaAvisos,
  enmascararIdentificadorWhatsapp,
  hayQuienRecibaElAviso,
  nombreDeDestinatario,
  normalizePhoneToE164Co,
  problemaDeCobertura,
  type DestinatarioAviso,
  type ModoDestinatario,
} from '@agenia/shared';
import { formatAppointmentCompact } from '../date';
import { etiquetaMedico } from '../rastreo/evidencia';
import { SIN_PERMISOS, type ActorBandeja } from './acceso';
import { MSG_NO_GUARDADA } from './servicio';
import type {
  DestinatarioVista,
  EntradaDestinatario,
  EstadoAvisos,
  EstadoEnvioDestinatario,
  Resultado,
} from './tipos';

type Db = PrismaClient;

/** N1: quién del sistema puede recibir. */
const ROLES_DESTINATARIO = ['ORG_ADMIN', 'BOOKING_AGENT'] as const;
/** Tope de filas que acepta un guardado (la pantalla manda solo a quienes reciben). */
const MAX_FILAS = 100;
const MAX_ETIQUETA = 60;

export const MSG_NUMERO_INVALIDO =
  'Escribe un celular colombiano válido: 10 dígitos, empieza por 3 (ej. 300 123 4567).';
export const MSG_SIN_ESPEJO =
  'El espejo con el hospital no está configurado para esta clínica.';
export const MSG_LISTA_INVALIDA =
  'La lista llegó incompleta. Recarga la página e intenta de nuevo.';
export const MSG_PERSONA_AJENA =
  'Una de las personas ya no es de esta clínica o cambió de rol. Recarga la página.';
export const MSG_SIN_NOMBRE = `Escribe el nombre de cada número sin cuenta (por ejemplo «Coordinación de citas»), de hasta ${MAX_ETIQUETA} letras.`;
export const MSG_TOPE = `Como mucho ${MAX_DESTINATARIOS_AVISO} personas pueden recibir los avisos (las que están en pausa no cuentan).`;

const ETIQUETA_MODO: Record<ModoDestinatario, string> = {
  AVISOS: 'avisos y recordatorios',
  SOLO_RECORDATORIOS: 'solo recordatorios',
};

/** Un celular del formulario → como lo espera el envío (solo dígitos, con el 57); `''` = ninguno. */
function leerCelular(valor: unknown): { ok: true; numero: string | null } | { ok: false } {
  const crudo = typeof valor === 'string' ? valor.trim() : '';
  if (!crudo) return { ok: true, numero: null };
  const e164 = normalizePhoneToE164Co(crudo);
  return e164 ? { ok: true, numero: e164.replace(/\D/g, '') } : { ok: false };
}

/** Lo que se lee de una fila de la lista. */
const SELECT_FILA = {
  id: true,
  userId: true,
  label: true,
  phone: true,
  mode: true,
  syncAlerts: true,
  patientRequestAlerts: true,
  isActive: true,
  lastSentAt: true,
  lastWamid: true,
  lastError: true,
  lastErrorAt: true,
  user: {
    select: {
      email: true,
      role: true,
      agentProfile: { select: { fullName: true, epsId: true, doctorId: true } },
    },
  },
} as const;

type FilaLista = {
  id: string;
  userId: string | null;
  label: string | null;
  phone: string;
  mode: ModoDestinatario;
  syncAlerts: boolean;
  patientRequestAlerts: boolean;
  isActive: boolean;
  lastSentAt: Date | null;
  lastWamid: string | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  user: {
    email: string;
    role: string;
    agentProfile: { fullName: string; epsId: string | null; doctorId: string | null } | null;
  } | null;
};

const comoDestinatario = (f: FilaLista): DestinatarioAviso => ({
  id: f.id,
  nombre: nombreDeDestinatario(f),
  phone: f.phone,
  mode: f.mode,
  syncAlerts: f.syncAlerts,
  patientRequestAlerts: f.patientRequestAlerts,
  isActive: f.isActive,
  alcance: alcanceDeDestinatario(f.user),
});

// ─────────────────────────────────────────────────────────────
// Leer
// ─────────────────────────────────────────────────────────────

/**
 * ¿Están saliendo los avisos? Si no, POR QUÉ: un aviso que no sale en silencio es
 * peor que uno que no existe (el agendador cree estar cubierto). Y a quién le llegan:
 * la lista completa solo para el administrador; los demás ven lo suyo (`yo`).
 */
export async function estadoAvisos(
  db: Db,
  actor: ActorBandeja,
): Promise<Resultado<EstadoAvisos>> {
  if (!actor.permisos.ver) return { success: false, error: SIN_PERMISOS };
  const org = actor.organizationId;
  const plantillaActiva = (kind: 'SYNC_EXCEPTION_ALERT' | 'PATIENT_REQUEST_ALERT') =>
    db.whatsappTemplate.findFirst({
      where: { organizationId: org, kind, isActive: true },
      select: { id: true },
    });
  const [config, plantilla, plantillaPacientes, filas] = await Promise.all([
    db.hospitalMirrorConfig.findUnique({
      where: { organizationId: org },
      select: { enabled: true, conflictAlertsEnabled: true },
    }),
    plantillaActiva('SYNC_EXCEPTION_ALERT'),
    plantillaActiva('PATIENT_REQUEST_ALERT'),
    db.syncAlertRecipient.findMany({
      where: { organizationId: org },
      orderBy: { createdAt: 'asc' },
      select: SELECT_FILA,
    }) as Promise<FilaLista[]>,
  ]);

  const lista = filas.map(comoDestinatario);
  const alertasActivas = !!config?.conflictAlertsEnabled;

  // Lo que comparten los dos avisos: el espejo y el interruptor.
  let razonComun: string | null = null;
  if (!config?.enabled) {
    razonComun = 'El espejo con el hospital está apagado para esta clínica.';
  } else if (!alertasActivas) {
    razonComun = 'Los avisos por WhatsApp están apagados.';
  }
  const razon =
    razonComun ??
    (!hayQuienRecibaElAviso(lista, 'SINCRONIZACION')
      ? 'Nadie recibe el aviso: agrega al menos a una persona en «Configurar avisos».'
      : plantilla
        ? null
        : 'Falta la plantilla «Aviso al agendador» aprobada en Meta: sin ella el mensaje no sale.');
  const razonPacientes =
    razonComun ??
    (!hayQuienRecibaElAviso(lista, 'PEDIDOS_PACIENTES')
      ? 'Nadie en la lista recibe este aviso.'
      : plantillaPacientes
        ? null
        : 'Falta la plantilla «Aviso al agendador (pedidos de pacientes)» aprobada en Meta y registrada en Configuración.');

  const mia = filas.find((f) => f.userId === actor.userId) ?? null;
  const datos: EstadoAvisos = {
    salen: razon === null,
    razon,
    alertasActivas,
    plantilla: !!plantilla,
    plantillaPacientes: !!plantillaPacientes,
    razonPacientes,
    cobertura: coberturaAvisos(lista),
    yo: {
      recibe: !!mia,
      numero: mia ? enmascararIdentificadorWhatsapp(mia.phone) : null,
      modo: mia?.mode ?? null,
      syncAlerts: !!mia?.syncAlerts,
      patientRequestAlerts: !!mia?.patientRequestAlerts,
      enPausa: !!mia && !mia.isActive,
    },
    destinatarios: actor.permisos.configurarAvisos ? await listaParaConfigurar(db, org, filas) : null,
  };
  return { success: true, data: datos };
}

/**
 * La lista de «Configurar avisos»: cada agendador y administrador de la clínica (esté
 * o no en la lista) y después los números sin cuenta, con el estado de su último aviso.
 */
async function listaParaConfigurar(
  db: Db,
  org: string,
  filas: FilaLista[],
): Promise<DestinatarioVista[]> {
  const wamids = filas.map((f) => f.lastWamid).filter((w): w is string => !!w);
  const [usuarios, mensajes, organizacion] = await Promise.all([
    db.user.findMany({
      where: { organizationId: org, role: { in: [...ROLES_DESTINATARIO] } },
      select: {
        id: true,
        email: true,
        role: true,
        agentProfile: { select: { fullName: true, phone: true, epsId: true, doctorId: true } },
      },
    }),
    wamids.length
      ? db.whatsappMessageLog.findMany({
          where: { organizationId: org, wamid: { in: wamids } },
          select: { wamid: true, status: true, statusAt: true, errorDetail: true },
        })
      : Promise.resolve([]),
    db.organization.findUnique({ where: { id: org }, select: { timezone: true } }),
  ]);
  const epsIds = [...new Set(usuarios.map((u) => u.agentProfile?.epsId).filter((x): x is string => !!x))];
  const medicoIds = [...new Set(usuarios.map((u) => u.agentProfile?.doctorId).filter((x): x is string => !!x))];
  const [eps, medicos] = await Promise.all([
    epsIds.length
      ? db.eps.findMany({ where: { organizationId: org, id: { in: epsIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    medicoIds.length
      ? db.doctorProfile.findMany({
          where: { organizationId: org, id: { in: medicoIds } },
          select: { id: true, fullName: true, isFunctionalAgenda: true },
        })
      : Promise.resolve([]),
  ]);
  const nombreEps = new Map(eps.map((e) => [e.id, e.name]));
  const nombreMedico = new Map(medicos.map((m) => [m.id, etiquetaMedico(m.fullName, m.isFunctionalAgenda)]));
  const porWamid = new Map(mensajes.map((m) => [m.wamid, m]));
  const zona = organizacion?.timezone || undefined;
  const filaDe = new Map(filas.filter((f) => f.userId).map((f) => [f.userId as string, f]));

  const vista = (f: FilaLista | null): Pick<DestinatarioVista, 'id' | 'recibe' | 'syncAlerts' | 'patientRequestAlerts' | 'isActive' | 'estado'> =>
    f
      ? {
          id: f.id,
          recibe: f.mode,
          syncAlerts: f.syncAlerts,
          patientRequestAlerts: f.patientRequestAlerts,
          isActive: f.isActive,
          estado: estadoEnvio(f, f.lastWamid ? (porWamid.get(f.lastWamid) ?? null) : null, zona),
        }
      : {
          id: null,
          recibe: 'NO',
          syncAlerts: true,
          patientRequestAlerts: true,
          isActive: true,
          estado: { tono: 'nunca', texto: '' },
        };

  const personas: DestinatarioVista[] = usuarios
    .map((u) => {
      const f = filaDe.get(u.id) ?? null;
      const alcance = alcanceDeDestinatario(u);
      const textoAlcance = alcance
        ? [alcance.epsId && `EPS ${nombreEps.get(alcance.epsId) ?? 'asignada'}`, alcance.doctorId && (nombreMedico.get(alcance.doctorId) || 'Su médico')]
            .filter(Boolean)
            .join(' · ')
        : 'Todo';
      const delPerfil = leerCelular(u.agentProfile?.phone ?? '');
      return {
        ...vista(f),
        userId: u.id,
        nombre: nombreDeDestinatario({ label: null, user: u }),
        rol: u.role as 'ORG_ADMIN' | 'BOOKING_AGENT',
        alcance: textoAlcance,
        label: null,
        phone: f?.phone ?? (delPerfil.ok ? delPerfil.numero : null),
      };
    })
    // Primero los agendadores, luego los administradores; por nombre.
    .sort((a, b) => (a.rol === b.rol ? a.nombre.localeCompare(b.nombre, 'es') : a.rol === 'BOOKING_AGENT' ? -1 : 1));

  const sueltos: DestinatarioVista[] = filas
    .filter((f) => !f.userId)
    .map((f) => ({
      ...vista(f),
      userId: null,
      nombre: nombreDeDestinatario(f),
      rol: null,
      alcance: null,
      label: f.label,
      phone: f.phone,
    }));
  return [...personas, ...sueltos];
}

/** Lo que dice la columna «Estado» de una persona (§3.6). */
export function estadoEnvio(
  f: Pick<FilaLista, 'lastSentAt' | 'lastError' | 'lastErrorAt'>,
  mensaje: { status: string; statusAt: Date; errorDetail: string | null } | null,
  timeZone?: string,
): EstadoEnvioDestinatario {
  const cuando = (d: Date) => formatAppointmentCompact(d.toISOString(), timeZone ? { timeZone } : undefined);
  if (f.lastErrorAt && (!f.lastSentAt || f.lastErrorAt > f.lastSentAt)) {
    return { tono: 'error', texto: `No le salió (${cuando(f.lastErrorAt)}): ${f.lastError ?? 'sin motivo'}` };
  }
  if (!f.lastSentAt) return { tono: 'nunca', texto: 'Sin envíos todavía' };
  switch (mensaje?.status) {
    case 'READ':
      return { tono: 'ok', texto: `Leído · ${cuando(mensaje.statusAt)}` };
    case 'DELIVERED':
      return { tono: 'ok', texto: `Entregado · ${cuando(mensaje.statusAt)}` };
    case 'FAILED':
      return {
        tono: 'error',
        texto: `Meta no lo entregó (${cuando(mensaje.statusAt)})${mensaje.errorDetail ? `: ${mensaje.errorDetail}` : ''}`,
      };
    default:
      return { tono: 'pendiente', texto: `Enviado · ${cuando(f.lastSentAt)}` };
  }
}

// ─────────────────────────────────────────────────────────────
// Guardar
// ─────────────────────────────────────────────────────────────

interface FilaNueva {
  /** La fila que ya existía, o `null` si es nueva. */
  id: string | null;
  userId: string | null;
  label: string | null;
  nombre: string;
  phone: string;
  mode: ModoDestinatario;
  syncAlerts: boolean;
  patientRequestAlerts: boolean;
  isActive: boolean;
}

type Usuario = { id: string; email: string; role: string; agentProfile: { fullName: string } | null };

/** Valida lo que mandó la pantalla contra las personas y filas REALES de la clínica. */
function leerEntradas(
  crudas: unknown[],
  usuarios: Usuario[],
  existentes: { id: string; userId: string | null }[],
): { ok: true; filas: FilaNueva[] } | { ok: false; error: string } {
  const filas: FilaNueva[] = [];
  for (const cruda of crudas) {
    if (!cruda || typeof cruda !== 'object') return { ok: false, error: MSG_LISTA_INVALIDA };
    const e = cruda as Record<keyof EntradaDestinatario, unknown>;
    let id: string | null = null;
    let userId: string | null = null;
    let label: string | null = null;
    let nombre: string;
    if (typeof e.userId === 'string' && e.userId) {
      const u = usuarios.find((x) => x.id === e.userId);
      if (!u) return { ok: false, error: MSG_PERSONA_AJENA };
      userId = u.id;
      nombre = nombreDeDestinatario({ label: null, user: u });
      id = existentes.find((x) => x.userId === u.id)?.id ?? null;
    } else {
      label = typeof e.label === 'string' ? e.label.replace(/\s+/g, ' ').trim() : '';
      if (!label || label.length > MAX_ETIQUETA) return { ok: false, error: MSG_SIN_NOMBRE };
      nombre = label;
      if (e.id != null && e.id !== '') {
        const previa = existentes.find((x) => x.id === e.id && x.userId === null);
        if (!previa) return { ok: false, error: MSG_LISTA_INVALIDA };
        id = previa.id;
      }
    }
    const celular = leerCelular(e.phone);
    if (!celular.ok || !celular.numero) return { ok: false, error: `${nombre}: ${MSG_NUMERO_INVALIDO}` };
    if (!(MODOS_DESTINATARIO as readonly unknown[]).includes(e.mode)) return { ok: false, error: MSG_LISTA_INVALIDA };
    if (typeof e.syncAlerts !== 'boolean' || typeof e.patientRequestAlerts !== 'boolean' || typeof e.isActive !== 'boolean') {
      return { ok: false, error: MSG_LISTA_INVALIDA };
    }
    if (!e.syncAlerts && !e.patientRequestAlerts) {
      return { ok: false, error: `${nombre}: marca al menos un aviso, o elige «No recibe».` };
    }
    filas.push({
      id,
      userId,
      label,
      nombre,
      phone: celular.numero,
      mode: e.mode as ModoDestinatario,
      syncAlerts: e.syncAlerts,
      patientRequestAlerts: e.patientRequestAlerts,
      isActive: e.isActive,
    });
  }

  const telefonos = new Set<string>();
  const personas = new Set<string>();
  for (const f of filas) {
    if (telefonos.has(f.phone)) {
      return {
        ok: false,
        error: `El celular ${enmascararIdentificadorWhatsapp(f.phone)} está dos veces: cada número recibe una sola vez.`,
      };
    }
    telefonos.add(f.phone);
    const clave = f.userId ?? f.id;
    if (clave && personas.has(clave)) return { ok: false, error: MSG_LISTA_INVALIDA };
    if (clave) personas.add(clave);
  }
  if (filas.filter((f) => f.isActive).length > MAX_DESTINATARIOS_AVISO) return { ok: false, error: MSG_TOPE };
  const cobertura = problemaDeCobertura(filas);
  if (cobertura) return { ok: false, error: cobertura };
  return { ok: true, filas };
}

/** La línea de la bitácora: quién entró, quién cambió, quién salió. Números enmascarados. */
function describirCambios(
  activos: boolean,
  filas: FilaNueva[],
  existentes: (FilaLista & { nombre: string })[],
  quien: string,
): string {
  const resumen = (f: Pick<FilaNueva, 'phone' | 'mode' | 'syncAlerts' | 'patientRequestAlerts' | 'isActive'>) =>
    [
      enmascararIdentificadorWhatsapp(f.phone),
      ETIQUETA_MODO[f.mode],
      [f.syncAlerts && 'citas', f.patientRequestAlerts && 'pedidos'].filter(Boolean).join(' y '),
      f.isActive ? null : 'en pausa',
    ]
      .filter(Boolean)
      .join(', ');
  const cambios: string[] = [];
  for (const f of filas) {
    const antes = f.id ? existentes.find((x) => x.id === f.id) : undefined;
    if (!antes) cambios.push(`+${f.nombre} (${resumen(f)})`);
    else if (resumen(antes) !== resumen(f) || (antes.label ?? null) !== f.label) cambios.push(`${f.nombre}: ${resumen(f)}`);
  }
  const quedan = new Set(filas.map((f) => f.id).filter(Boolean));
  for (const e of existentes) {
    if (!quedan.has(e.id)) cambios.push(`−${e.nombre} (${enmascararIdentificadorWhatsapp(e.phone)})`);
  }
  const activas = filas.filter((f) => f.isActive).length;
  return `Avisos de la bandeja ${activos ? 'activos' : 'apagados'}; ${activas} ${activas === 1 ? 'persona recibe' : 'personas reciben'}. ${
    cambios.length ? `Cambios: ${cambios.join('; ')}.` : 'Sin cambios en la lista.'
  } (Desde el panel, por ${quien}.)`;
}

/**
 * Guarda la lista completa (solo ORG_ADMIN): quien llega recibe, quien no llega sale
 * de la lista. Valida contra las personas y filas REALES de la clínica: una persona
 * de otra clínica o una fila vieja se rechazan y nada cambia.
 */
export async function guardarAvisos(
  db: Db,
  actor: ActorBandeja,
  entrada: { activos: unknown; destinatarios: unknown },
): Promise<Resultado<{ activos: boolean; personas: number }>> {
  if (!actor.permisos.configurarAvisos) return { success: false, error: SIN_PERMISOS };
  if (typeof entrada?.activos !== 'boolean') {
    return { success: false, error: 'Indica si los avisos están activos.' };
  }
  const activos = entrada.activos;
  if (!Array.isArray(entrada.destinatarios) || entrada.destinatarios.length > MAX_FILAS) {
    return { success: false, error: MSG_LISTA_INVALIDA };
  }
  const org = actor.organizationId;

  try {
    const [usuarios, existentesCrudas] = await Promise.all([
      db.user.findMany({
        where: { organizationId: org, role: { in: [...ROLES_DESTINATARIO] } },
        select: { id: true, email: true, role: true, agentProfile: { select: { fullName: true } } },
      }),
      db.syncAlertRecipient.findMany({ where: { organizationId: org }, select: SELECT_FILA }) as Promise<FilaLista[]>,
    ]);
    const existentes = existentesCrudas.map((f) => ({ ...f, nombre: nombreDeDestinatario(f) }));
    const leidas = leerEntradas(entrada.destinatarios, usuarios, existentes);
    if (!leidas.ok) return { success: false, error: leidas.error };
    const filas = leidas.filas;

    return await db.$transaction(async (tx) => {
      const { count } = await tx.hospitalMirrorConfig.updateMany({
        where: { organizationId: org },
        data: { conflictAlertsEnabled: activos },
      });
      if (count !== 1) return { success: false as const, error: MSG_SIN_ESPEJO };

      // Primero salen, luego cambian, luego entran: así un número que pasa de una
      // fila a otra no choca con el único (clínica, celular).
      const quedan = new Set(filas.map((f) => f.id).filter(Boolean));
      const salen = existentes.filter((e) => !quedan.has(e.id)).map((e) => e.id);
      if (salen.length) {
        await tx.syncAlertRecipient.deleteMany({ where: { organizationId: org, id: { in: salen } } });
      }
      for (const f of filas) {
        const datos = {
          label: f.label,
          phone: f.phone,
          mode: f.mode,
          syncAlerts: f.syncAlerts,
          patientRequestAlerts: f.patientRequestAlerts,
          isActive: f.isActive,
        };
        if (!f.id) continue;
        const antes = existentes.find((e) => e.id === f.id);
        await tx.syncAlertRecipient.updateMany({
          where: { id: f.id, organizationId: org },
          // Otro número: lo que se sabía del anterior ya no es de este.
          data:
            antes && antes.phone !== f.phone
              ? { ...datos, lastSentAt: null, lastWamid: null, lastError: null, lastErrorAt: null, lastTestAt: null }
              : datos,
        });
      }
      for (const f of filas.filter((x) => !x.id)) {
        await tx.syncAlertRecipient.create({
          data: {
            organizationId: org,
            userId: f.userId,
            label: f.label,
            phone: f.phone,
            mode: f.mode,
            syncAlerts: f.syncAlerts,
            patientRequestAlerts: f.patientRequestAlerts,
            isActive: f.isActive,
            createdByUserId: actor.userId,
          },
        });
      }
      await tx.syncAudit.create({
        data: {
          organizationId: org,
          direction: SYNC_AUDIT_DIRECTION.CONFIG,
          entityType: 'SyncAlertRecipient',
          op: 'ALERT_SETTINGS_CHANGE',
          outcome: 'OK',
          detail: describirCambios(activos, filas, existentes, actor.email ?? actor.role),
        },
      });
      return {
        success: true as const,
        data: { activos, personas: filas.filter((f) => f.isActive).length },
      };
    });
  } catch (error: unknown) {
    console.error('[bandeja] no se pudo guardar la lista de avisos', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: MSG_NO_GUARDADA };
  }
}
