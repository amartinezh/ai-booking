/**
 * 🏥 Reserva de agenda para la atención presencial (Configuración › Asistente
 * Virtual, 2026-11-13): el asistente toma como mucho un porcentaje de la agenda
 * de cada médico cada día; el resto queda para agendar en el hospital.
 *
 * Lo que la API necesita de la base: el porcentaje de la clínica, su zona
 * horaria y cuántos cupos y citas del chat tiene cada médico cada día. La regla
 * misma es pura y vive en `@agenia/shared` (reserva-presencial.ts).
 *
 * Funciones y no un servicio de Nest, como `plazo-agendar.ts`: las usan la
 * búsqueda y la reserva de citas, el cambio de fecha del chatbot (dentro de su
 * transacción) y la lista de espera, cada uno con su cliente o su transacción.
 *
 * SIN PORCENTAJE (lo de fábrica) NINGUNA de estas funciones consulta nada más
 * que el ajuste: la búsqueda y la reserva quedan idénticas a las de siempre.
 */
import { Prisma, type PrismaClient } from '@agenia/database';
import {
  DEFAULT_TIMEZONE,
  chatEnElTope,
  diaLocal,
  horaLocalAUtc,
  medicoDiasEnElTope,
  normalizarParteDelChat,
  partesDeFecha,
  sumarDiasAFecha,
  type MedicoDia,
} from '@agenia/shared';

type Db =
  | Pick<
      PrismaClient,
      'organizationSettings' | 'organization' | 'waitlistEntry' | '$queryRaw'
    >
  | Pick<
      Prisma.TransactionClient,
      'organizationSettings' | 'organization' | 'waitlistEntry' | '$queryRaw'
    >;

type Tx = Pick<
  Prisma.TransactionClient,
  'organizationSettings' | 'organization' | '$queryRaw' | '$executeRaw'
>;

/** La parte de la agenda del asistente (%) y la zona de la clínica; null sin reserva. */
export async function parteDelChatDeLaClinica(
  db: Pick<Db, 'organizationSettings' | 'organization'>,
  organizationId: string,
): Promise<{ porcentaje: number; timeZone: string } | null> {
  // Los dobles de prueba que no traen la tabla: sin ella, sin reserva (en
  // producción siempre existe).
  const tabla = (db as { organizationSettings?: { findUnique?: unknown } })
    .organizationSettings;
  if (typeof tabla?.findUnique !== 'function') return null;

  const settings = await db.organizationSettings.findUnique({
    where: { organizationId },
    select: { botAgendaSharePercent: true },
  });
  const porcentaje = normalizarParteDelChat(settings?.botAgendaSharePercent);
  if (porcentaje === null) return null;

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return { porcentaje, timeZone: org?.timezone || DEFAULT_TIMEZONE };
}

/** La medianoche (UTC) con que empieza ese día ('YYYY-MM-DD') en la clínica. */
function inicioDelDia(dia: string, timeZone: string): Date {
  const [y, m, d] = partesDeFecha(dia)!;
  return horaLocalAUtc(y, m, d, 0, timeZone);
}

/**
 * Capacidad y citas del chat de cada médico cada día, para los días (enteros,
 * en la zona de la clínica) que tocan [desde, hasta]. La capacidad es de todo
 * el día y de todos los servicios del médico.
 *
 * `apartados`: cupos libres que otro paciente tiene apartados (cuentan como del
 * chat al buscar). `excluirCitaId`: la cita que se está moviendo (su cupo sigue
 * contando en la capacidad, pero no como cita del chat: dentro del mismo médico
 * y día un cambio de fecha no cuenta doble).
 */
export async function contarMedicoDias(
  db: Pick<Db, '$queryRaw'>,
  p: {
    organizationId: string;
    desde: Date;
    hasta: Date;
    timeZone: string;
    doctorId?: string;
    apartados?: readonly string[];
    excluirCitaId?: string;
  },
): Promise<MedicoDia[]> {
  const inicio = inicioDelDia(diaLocal(p.desde, p.timeZone), p.timeZone);
  const fin = inicioDelDia(
    sumarDiasAFecha(diaLocal(p.hasta, p.timeZone), 1),
    p.timeZone,
  );
  const apartados = [...new Set(p.apartados ?? [])];
  const filas = await db.$queryRaw<
    {
      doctorId: string;
      dia: string;
      capacidad: number;
      chat: number;
      apartados: number;
    }[]
  >(Prisma.sql`
    SELECT s."doctorId" AS "doctorId",
           to_char((s."startTime" AT TIME ZONE 'UTC') AT TIME ZONE ${p.timeZone}, 'YYYY-MM-DD') AS "dia",
           (count(*) FILTER (WHERE v.id IS NOT NULL OR s."isAvailable"))::int AS "capacidad",
           (count(*) FILTER (
              WHERE v.origin::text IN ('WHATSAPP', 'TELEGRAM')
                AND v.id IS DISTINCT FROM ${p.excluirCitaId ?? null}::text
           ))::int AS "chat",
           (count(*) FILTER (
              WHERE v.id IS NULL AND s."isAvailable"
                AND s.id = ANY(${apartados}::text[])
           ))::int AS "apartados"
      FROM "ScheduleSlot" s
      LEFT JOIN LATERAL (
        SELECT a.id, a.origin
          FROM "Appointment" a
         WHERE a."scheduleSlotId" = s.id AND a.status <> 'CANCELLED'
         LIMIT 1
      ) v ON true
     WHERE s."organizationId" = ${p.organizationId}
       AND s."startTime" >= ${inicio}
       AND s."startTime" < ${fin}
       AND (${p.doctorId ?? null}::text IS NULL OR s."doctorId" = ${p.doctorId ?? null}::text)
     GROUP BY 1, 2
  `);
  return filas.map((f) => ({
    doctorId: f.doctorId,
    dia: f.dia,
    capacidad: Number(f.capacidad) || 0,
    chat: Number(f.chat) || 0,
    apartados: Number(f.apartados) || 0,
  }));
}

/**
 * Los cupos ofrecidos a alguien de la lista de espera que aún no responde:
 * están apartados para el chat aunque todavía no sean una cita.
 */
export async function cuposOfrecidosALaLista(
  db: Pick<Db, 'waitlistEntry'>,
  organizationId: string,
): Promise<string[]> {
  const tabla = (db as { waitlistEntry?: { findMany?: unknown } })
    .waitlistEntry;
  if (typeof tabla?.findMany !== 'function') return [];
  const ofrecidos = await db.waitlistEntry.findMany({
    where: { organizationId, status: 'NOTIFIED' },
    select: { metadata: true },
  });
  const ids: string[] = [];
  for (const o of ofrecidos ?? []) {
    const id = (o.metadata as { pendingSlotId?: unknown } | null)
      ?.pendingSlotId;
    if (typeof id === 'string' && id) ids.push(id);
  }
  return ids;
}

/**
 * Para la BÚSQUEDA de cupos: los tramos (médico + día, en UTC) donde el
 * asistente ya llegó a su tope y no debe ofrecer más. Sin reserva, ninguno (y
 * ninguna consulta de más). Los cupos apartados por otros pacientes y los
 * ofrecidos a la lista de espera cuentan como del chat.
 */
export async function tramosReservadosParaElHospital(
  db: Db,
  organizationId: string,
  desde: Date,
  hasta: Date,
  opts: { apartados?: readonly string[] } = {},
): Promise<{ doctorId: string; gte: Date; lt: Date }[]> {
  const parte = await parteDelChatDeLaClinica(db, organizationId);
  if (!parte) return [];
  const ofrecidos = await cuposOfrecidosALaLista(db, organizationId);
  const filas = await contarMedicoDias(db, {
    organizationId,
    desde,
    hasta,
    timeZone: parte.timeZone,
    apartados: [...(opts.apartados ?? []), ...ofrecidos],
  });
  return medicoDiasEnElTope(
    filas.filter((f) => f.capacidad > 0),
    parte.porcentaje,
  ).map((f) => ({
    doctorId: f.doctorId,
    gte: inicioDelDia(f.dia, parte.timeZone),
    lt: inicioDelDia(sumarDiasAFecha(f.dia, 1), parte.timeZone),
  }));
}

/**
 * Para OFRECER un cupo a la lista de espera: ¿el asistente ya llegó al tope de
 * ese médico ese día? Cuenta lo ya ofrecido a otros de la lista (menos este
 * mismo cupo). Sin reserva, false.
 */
export async function cupoReservadoParaElHospital(
  db: Db,
  organizationId: string,
  cupo: { id?: string; doctorId: string; startTime: Date },
): Promise<boolean> {
  const parte = await parteDelChatDeLaClinica(db, organizationId);
  if (!parte) return false;
  const ofrecidos = (await cuposOfrecidosALaLista(db, organizationId)).filter(
    (id) => id !== cupo.id,
  );
  const [fila] = await contarMedicoDias(db, {
    organizationId,
    desde: cupo.startTime,
    hasta: cupo.startTime,
    timeZone: parte.timeZone,
    doctorId: cupo.doctorId,
    apartados: ofrecidos,
  });
  return fila ? chatEnElTope(fila, parte.porcentaje) : false;
}

/**
 * Para RESERVAR y para CAMBIAR LA FECHA, dentro de la transacción: ¿el
 * asistente ya tiene todas las citas que le caben con ese médico ese día? Toma
 * un candado por médico y día (`pg_advisory_xact_lock`, se suelta solo al
 * terminar la transacción) para que dos pacientes que confirman a la vez el
 * último cupo del chat no pasen los dos. Aquí solo cuentan las citas, no lo
 * apartado. Sin reserva, false y sin candado.
 */
export async function chatEnElTopeAlReservar(
  tx: Tx,
  organizationId: string,
  cupo: { doctorId: string; startTime: Date },
  opts: { excluirCitaId?: string } = {},
): Promise<boolean> {
  const parte = await parteDelChatDeLaClinica(tx, organizationId);
  if (!parte) return false;
  const dia = diaLocal(cupo.startTime, parte.timeZone);
  const llave = `reserva-presencial:${organizationId}:${cupo.doctorId}:${dia}`;
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${llave}, 0))`,
  );
  const [fila] = await contarMedicoDias(tx, {
    organizationId,
    desde: cupo.startTime,
    hasta: cupo.startTime,
    timeZone: parte.timeZone,
    doctorId: cupo.doctorId,
    excluirCitaId: opts.excluirCitaId,
  });
  if (!fila) return false;
  return chatEnElTope(
    { capacidad: fila.capacidad, chat: fila.chat },
    parte.porcentaje,
  );
}
