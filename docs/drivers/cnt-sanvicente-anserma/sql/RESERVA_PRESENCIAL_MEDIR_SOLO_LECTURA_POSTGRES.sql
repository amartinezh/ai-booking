/* =============================================================================
   RESERVA PARA ATENCIÓN PRESENCIAL — ¿cuánto de la agenda toma hoy el chat?
   Postgres de AgenIA, SOLO LECTURA (docs/PLAN_RESERVA_PRESENCIAL.md §2.3)
   =============================================================================

   Antes de decidir el porcentaje (80 %, 70 %…), esto mide, por médico y por día,
   cuántos cupos tiene la agenda, cuántos tomó el chat, cuántos el hospital y
   cuántos quedaron libres; y cuántas veces un tope del 90/80/70/60 % habría
   frenado al chat. Solo médicos con «WhatsApp ON» (los únicos que el chat agenda).

   Capacidad de un médico en un día = cupos libres + cupos con una cita vigente
   (de cualquier origen y servicio). Los cupos cerrados sin cita (horas que el
   hospital no tiene en sus huecos, o tapados por una cita fuera de la rejilla)
   no cuentan: no se pueden agendar.

   Todo va dentro de BEGIN READ ONLY … ROLLBACK: no cambia nada.

   CÓMO (desde la raíz del repo):
     ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 \
       'docker exec -i agenia_db psql -U agenia -d antigravity -X' \
       < docs/drivers/cnt-sanvicente-anserma/sql/RESERVA_PRESENCIAL_MEDIR_SOLO_LECTURA_POSTGRES.sql

   OJO: la base corre con zona America/Bogota y AgenIA guarda en UTC; por eso
   «ahora» es `now() AT TIME ZONE 'UTC'` y los días se sacan convertidos.
   ============================================================================= */

BEGIN READ ONLY;
\pset pager off

\echo '== 0. Hora del servidor (Bogotá) y configuración del asistente =='
SELECT (now() AT TIME ZONE 'America/Bogota')::timestamp(0) ahora_bogota;
SELECT s."bookingEnabled" agendar, s."bookingMaxDaysAhead" plazo_dias,
       s."slotsOfferedCount" cupos_ofrecidos
  FROM "OrganizationSettings" s
  JOIN "HospitalMirrorConfig" h ON h."organizationId" = s."organizationId";

\echo '== 1. Por día: capacidad, quién la tomó y qué quedó libre (todos los médicos WhatsApp ON) =='
\echo '   Los días pasados muestran cómo quedaron; los futuros, cómo van hoy.'
-- Un renglón por médico (WhatsApp ON) y día, desde hace 14 días hasta 7 adelante
-- (se repite en 1, 2 y 3: una transacción de solo lectura no admite tablas temporales).
WITH cupo AS (
  SELECT s.id, s."doctorId", s."isAvailable",
         ((s."startTime" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date dia,
         (SELECT a.origin FROM "Appointment" a
           WHERE a."scheduleSlotId" = s.id AND a.status <> 'CANCELLED' LIMIT 1) origen_viva
    FROM "ScheduleSlot" s
    JOIN "DoctorProfile" d ON d.id = s."doctorId"
    JOIN "HospitalMirrorConfig" h ON h."organizationId" = s."organizationId"
   WHERE d."whatsappBookingEnabled"
     AND s."startTime" >= (now() AT TIME ZONE 'UTC') - interval '15 days'
     AND s."startTime" <  (now() AT TIME ZONE 'UTC') + interval '8 days'
), medico_dia AS (
  SELECT "doctorId", dia,
         count(*) FILTER (WHERE origen_viva IS NOT NULL OR "isAvailable")       capacidad,
         count(*) FILTER (WHERE origen_viva IN ('WHATSAPP', 'TELEGRAM'))          chat,
         count(*) FILTER (WHERE origen_viva = 'MIRROR')                           hospital,
         count(*) FILTER (WHERE origen_viva = 'MANUAL')                           panel,
         count(*) FILTER (WHERE origen_viva IS NULL AND "isAvailable")            libres,
         count(*) FILTER (WHERE origen_viva IS NULL AND NOT "isAvailable")        cerrados_sin_cita
    FROM cupo
   WHERE dia BETWEEN (now() AT TIME ZONE 'America/Bogota')::date - 14
                 AND (now() AT TIME ZONE 'America/Bogota')::date + 7
   GROUP BY 1, 2
)
SELECT dia, to_char(dia, 'Dy') dsem, count(*) medicos,
       sum(capacidad) capacidad, sum(chat) chat, sum(hospital) hospital, sum(panel) panel,
       sum(libres) libres, sum(cerrados_sin_cita) cerrados_sin_cita,
       round(100.0 * sum(chat) / nullif(sum(capacidad), 0), 1) pct_chat,
       round(100.0 * sum(libres) / nullif(sum(capacidad), 0), 1) pct_libre
  FROM medico_dia
 WHERE capacidad > 0
 GROUP BY 1 ORDER BY 1;

\echo '== 2. ¿Cuántas veces habría frenado un tope? (médico-días con capacidad, últimos 14 días y próximos 7) =='
\echo '   tope = piso(capacidad × %); frenados = médico-días donde el chat llegó al tope;'
\echo '   citas_de_mas = citas del chat por encima del tope (las que no habría podido dar).'
-- Un renglón por médico (WhatsApp ON) y día, desde hace 14 días hasta 7 adelante
-- (se repite en 1, 2 y 3: una transacción de solo lectura no admite tablas temporales).
WITH cupo AS (
  SELECT s.id, s."doctorId", s."isAvailable",
         ((s."startTime" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date dia,
         (SELECT a.origin FROM "Appointment" a
           WHERE a."scheduleSlotId" = s.id AND a.status <> 'CANCELLED' LIMIT 1) origen_viva
    FROM "ScheduleSlot" s
    JOIN "DoctorProfile" d ON d.id = s."doctorId"
    JOIN "HospitalMirrorConfig" h ON h."organizationId" = s."organizationId"
   WHERE d."whatsappBookingEnabled"
     AND s."startTime" >= (now() AT TIME ZONE 'UTC') - interval '15 days'
     AND s."startTime" <  (now() AT TIME ZONE 'UTC') + interval '8 days'
), medico_dia AS (
  SELECT "doctorId", dia,
         count(*) FILTER (WHERE origen_viva IS NOT NULL OR "isAvailable")       capacidad,
         count(*) FILTER (WHERE origen_viva IN ('WHATSAPP', 'TELEGRAM'))          chat,
         count(*) FILTER (WHERE origen_viva = 'MIRROR')                           hospital,
         count(*) FILTER (WHERE origen_viva = 'MANUAL')                           panel,
         count(*) FILTER (WHERE origen_viva IS NULL AND "isAvailable")            libres,
         count(*) FILTER (WHERE origen_viva IS NULL AND NOT "isAvailable")        cerrados_sin_cita
    FROM cupo
   WHERE dia BETWEEN (now() AT TIME ZONE 'America/Bogota')::date - 14
                 AND (now() AT TIME ZONE 'America/Bogota')::date + 7
   GROUP BY 1, 2
)
SELECT pct || ' %' tope,
       count(*) FILTER (WHERE chat >= floor(capacidad * pct / 100.0)) medico_dias_frenados,
       count(*) medico_dias,
       sum(greatest(0, chat - floor(capacidad * pct / 100.0)))::int citas_de_mas,
       sum(chat) citas_chat
  FROM medico_dia, (VALUES (90), (80), (70), (60), (50)) t(pct)
 WHERE capacidad > 0
 GROUP BY pct ORDER BY pct DESC;

\echo '== 3. Médico-días donde el chat ya pasa del 60 % (los más cargados primero) =='
-- Un renglón por médico (WhatsApp ON) y día, desde hace 14 días hasta 7 adelante
-- (se repite en 1, 2 y 3: una transacción de solo lectura no admite tablas temporales).
WITH cupo AS (
  SELECT s.id, s."doctorId", s."isAvailable",
         ((s."startTime" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date dia,
         (SELECT a.origin FROM "Appointment" a
           WHERE a."scheduleSlotId" = s.id AND a.status <> 'CANCELLED' LIMIT 1) origen_viva
    FROM "ScheduleSlot" s
    JOIN "DoctorProfile" d ON d.id = s."doctorId"
    JOIN "HospitalMirrorConfig" h ON h."organizationId" = s."organizationId"
   WHERE d."whatsappBookingEnabled"
     AND s."startTime" >= (now() AT TIME ZONE 'UTC') - interval '15 days'
     AND s."startTime" <  (now() AT TIME ZONE 'UTC') + interval '8 days'
), medico_dia AS (
  SELECT "doctorId", dia,
         count(*) FILTER (WHERE origen_viva IS NOT NULL OR "isAvailable")       capacidad,
         count(*) FILTER (WHERE origen_viva IN ('WHATSAPP', 'TELEGRAM'))          chat,
         count(*) FILTER (WHERE origen_viva = 'MIRROR')                           hospital,
         count(*) FILTER (WHERE origen_viva = 'MANUAL')                           panel,
         count(*) FILTER (WHERE origen_viva IS NULL AND "isAvailable")            libres,
         count(*) FILTER (WHERE origen_viva IS NULL AND NOT "isAvailable")        cerrados_sin_cita
    FROM cupo
   WHERE dia BETWEEN (now() AT TIME ZONE 'America/Bogota')::date - 14
                 AND (now() AT TIME ZONE 'America/Bogota')::date + 7
   GROUP BY 1, 2
)
SELECT md.dia, left(d."fullName", 28) medico, md.capacidad, md.chat, md.hospital, md.libres,
       round(100.0 * md.chat / md.capacidad, 0) pct_chat,
       floor(md.capacidad * 0.8)::int tope_80
  FROM medico_dia md JOIN "DoctorProfile" d ON d.id = md."doctorId"
 WHERE md.capacidad > 0 AND md.chat > 0.6 * md.capacidad
 ORDER BY pct_chat DESC, md.dia
 LIMIT 40;

\echo '== 4. Con cuánta anticipación se agenda (días entre la creación y la cita), por origen, últimos 14 días =='
\echo '   Si el hospital agenda casi todo para el mismo día, la reserva importa más en «hoy».'
SELECT a.origin,
       count(*) citas,
       count(*) FILTER (WHERE dc = 0) mismo_dia,
       count(*) FILTER (WHERE dc = 1) dia_siguiente,
       count(*) FILTER (WHERE dc BETWEEN 2 AND 3) a_2_3_dias,
       count(*) FILTER (WHERE dc BETWEEN 4 AND 7) a_4_7_dias,
       count(*) FILTER (WHERE dc > 7) mas_de_7
  FROM (
    SELECT a.origin,
           ((s."startTime" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date
         - ((a."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date dc
      FROM "Appointment" a
      JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
      JOIN "DoctorProfile" d ON d.id = s."doctorId"
      JOIN "HospitalMirrorConfig" h ON h."organizationId" = a."organizationId"
     WHERE d."whatsappBookingEnabled"
       AND a.status <> 'CANCELLED'
       AND a."createdAt" >= (now() AT TIME ZONE 'UTC') - interval '14 days'
  ) a
 GROUP BY 1 ORDER BY 2 DESC;

\echo '== 5. Cuántos se quedaron sin cupo por el chat, por día (últimos 14 días) =='
\echo '   ofrecio_lista = el asistente dijo que no había cupos y ofreció la lista de espera.'
SELECT ((l."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date dia,
       count(DISTINCT l."whatsappId") FILTER (WHERE l.metadata->>'step' = 'WAITLIST_OPTIN_OFFERED') ofrecio_lista,
       count(DISTINCT l."whatsappId") FILTER (WHERE l.metadata->>'step' = 'SLOTS_OFFERED') vieron_cupos,
       count(DISTINCT l."whatsappId") FILTER (WHERE l.status = 'BOOKING_CONFIRMED') agendaron
  FROM "InteractionLog" l
  JOIN "HospitalMirrorConfig" h ON h."organizationId" = l."organizationId"
 WHERE l."createdAt" >= (now() AT TIME ZONE 'UTC') - interval '14 days'
 GROUP BY 1 ORDER BY 1;

\echo '== 6. Citas del hospital fuera del turno (las «temporales» con que hoy guarda cupos a mano) =='
SELECT ((s."startTime" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date dia, count(*) citas
  FROM "Appointment" a
  JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
  JOIN "HospitalMirrorConfig" h ON h."organizationId" = a."organizationId"
 WHERE a.status <> 'CANCELLED' AND (a."metaLog"->>'fueraDeTurno')::boolean IS TRUE
   AND s."startTime" >= (now() AT TIME ZONE 'UTC') - interval '14 days'
 GROUP BY 1 ORDER BY 1;

ROLLBACK;
