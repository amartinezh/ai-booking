/* =============================================================================
   ¿MEDICINA GENERAL (S39141) AL 100 %? — Postgres de AgenIA, SOLO LECTURA
   =============================================================================

   AgenIA trabaja con una cita solo si su médico tiene «WhatsApp ON» y el servicio
   de su cupo está activo en Servicios (hoy solo S39141). Esto muestra si alguna
   cita de un servicio activo queda fuera, y si algo de otro servicio entra.

   Todo va dentro de BEGIN READ ONLY … ROLLBACK: no cambia nada.

   CÓMO (desde la raíz del repo):
     ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 \
       'docker exec -i agenia_db psql -U agenia -d antigravity -X' \
       < docs/drivers/cnt-sanvicente-anserma/sql/DIAGNOSTICO_S39141_SOLO_LECTURA_POSTGRES.sql

   OJO: la base corre con zona America/Bogota y AgenIA guarda en UTC; por eso
   «ahora» es `now() AT TIME ZONE 'UTC'` y las horas se muestran convertidas.
   ============================================================================= */

BEGIN READ ONLY;
\pset pager off

\echo '== 1. Interruptores =='
SELECT s."bookingEnabled" agendar, s."cancelEnabled" cancelar, s."rescheduleEnabled" cambiar,
       s."remindersEnabled" recordatorios
  FROM "OrganizationSettings" s JOIN "HospitalMirrorConfig" h ON h."organizationId" = s."organizationId";

\echo '== 2. Servicios activos (con los que trabaja AgenIA) =='
SELECT ms.name, m."externalKey" codigo_his
  FROM "MedicalService" ms
  JOIN "HospitalMirrorConfig" h ON h."organizationId" = ms."organizationId"
  LEFT JOIN "MirrorEntityMap" m ON m."agenIAId" = ms.id AND m."entityType" = 'SERVICE'
 WHERE ms."isActive";

\echo '== 3. Citas futuras vigentes: en alcance y fuera (debe ser 0 en s_activo_fuera) =='
SELECT count(*) FILTER (WHERE ms."isActive" AND d."whatsappBookingEnabled") en_alcance,
       count(*) FILTER (WHERE ms."isActive" AND NOT d."whatsappBookingEnabled") s_activo_fuera,
       count(*) FILTER (WHERE NOT ms."isActive" AND d."whatsappBookingEnabled") otros_servicios_excluidos
  FROM "Appointment" a
  JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
  JOIN "DoctorProfile" d ON d.id = s."doctorId"
  JOIN "MedicalService" ms ON ms.id = s."serviceId"
  JOIN "HospitalMirrorConfig" h ON h."organizationId" = a."organizationId"
 WHERE s."startTime" > now() AT TIME ZONE 'UTC' AND a.status <> 'CANCELLED';

\echo '== 4. Citas futuras de servicios activos por médico =='
SELECT m."externalKey" cod, left(d."fullName", 30) medico,
       CASE WHEN d."whatsappBookingEnabled" THEN 'ON' ELSE 'OFF' END wa, count(*) citas
  FROM "Appointment" a
  JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
  JOIN "DoctorProfile" d ON d.id = s."doctorId"
  JOIN "MedicalService" ms ON ms.id = s."serviceId"
  JOIN "HospitalMirrorConfig" h ON h."organizationId" = a."organizationId"
  LEFT JOIN "MirrorEntityMap" m ON m."agenIAId" = d.id AND m."entityType" = 'DOCTOR'
 WHERE s."startTime" > now() AT TIME ZONE 'UTC' AND a.status <> 'CANCELLED' AND ms."isActive"
 GROUP BY 1, 2, 3 ORDER BY 3, 4 DESC;

\echo '== 5. Última reconciliación: servicios corregidos, citas traídas y radar =='
\echo '   activeServiceUnmapped = médicos SIN crear con citas de servicios activos'
\echo '   activeServiceWhatsappOff = médicos creados en WhatsApp OFF con citas de servicios activos'
-- El detalle se recorta a 4000 caracteres (no siempre es JSON válido): se
-- leen los campos cortos, que van al principio, con expresiones regulares.
SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota', 'MM-DD HH24:MI') hora,
       substring(detail FROM '"serviceFixed":([0-9]+)') servicios_corregidos,
       substring(detail FROM '"toImport":([0-9]+)') citas_pedidas,
       substring(detail FROM '"activeServiceUnmapped":(\{[^}]*\})') sin_crear,
       substring(detail FROM '"activeServiceWhatsappOff":(\{[^}]*\})') en_off
  FROM "SyncAudit"
 WHERE direction = 'RECONCILE' AND op = 'COMPARE'
 ORDER BY "createdAt" DESC LIMIT 3;

\echo '== 6. Citas traídas por la reconciliación (cnt:IMPORT), por día =='
SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota', 'MM-DD') dia, outcome, count(*)
  FROM "SyncAudit" WHERE "eventId" LIKE 'cnt:IMPORT:%'
 GROUP BY 1, 2 ORDER BY 1 DESC LIMIT 10;

\echo '== 7. Recordatorios de las últimas 24 h, por servicio (todo debe ser de un servicio activo) =='
SELECT ms.name servicio, ms."isActive" activo, count(*),
       to_char(min((a."reminderSentAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota'), 'MM-DD HH24:MI') primero,
       to_char(max((a."reminderSentAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota'), 'MM-DD HH24:MI') ultimo
  FROM "Appointment" a
  JOIN "ScheduleSlot" s ON s.id = a."scheduleSlotId"
  JOIN "MedicalService" ms ON ms.id = s."serviceId"
  JOIN "HospitalMirrorConfig" h ON h."organizationId" = a."organizationId"
 WHERE a."reminderSentAt" > (now() AT TIME ZONE 'UTC') - interval '24 hours'
 GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '== 8. Escrituras en el HIS de las últimas 24 h y cola pendiente =='
SELECT op, outcome, count(*) FROM "SyncAudit"
 WHERE direction = 'AGENIA_TO_HIS' AND "createdAt" > (now() AT TIME ZONE 'UTC') - interval '24 hours'
 GROUP BY 1, 2;
SELECT count(*) FILTER (WHERE "deliveredAt" IS NULL AND NOT "deadLettered") pendientes,
       count(*) FILTER (WHERE "deadLettered") muertos
  FROM "SyncOutbox";

ROLLBACK;
