/* =============================================================================
   MEDICINA GENERAL (S39141) AL 100 % — Postgres de AgenIA (producción)
   =============================================================================

   PARA QUÉ (2026-10-15)
   AgenIA trabaja con una cita solo si su médico tiene «WhatsApp ON» y el
   servicio de su cupo está activo (hoy solo S39141). Tras crear los 10 médicos
   de medicina general y desplegar el filtro por servicio, la reconciliación
   trajo 74 citas de S39141 y dejó dos huecos:

     1. 13 médicos con citas de S39141 seguían en WhatsApp OFF (MD08, R001, los
        10 nuevos y la agenda 76 «Programa de Hipertensión», que tiene citas de
        medicina general).
     2. Las agendas 77 (MEDICO ATENCION GESTANTE HTA) y 077 (MEDICO ATENCION HTA 2)
        tienen citas de S39141 y no existían en AgenIA (radar: 77=17, 077=2).
        Comparten la cédula de relleno del HIS (77123456789), por eso homologar.ts
        no las crea solas: se les pone esa cédula + su código.

   Con el filtro por servicio, de las agendas de programa (76, 77, 077) solo
   entran sus citas de S39141; sus cupos quedan con su propio servicio (inactivo)
   y el asistente no los vende como medicina general.

   EFECTO INMEDIATO: con «Recordatorios» encendido, la siguiente vuelta del cron
   (cada 15 min) les escribe a los pacientes de estas citas que caigan en la
   ventana del recordatorio (~42 al prepararlo).

   SEGURO: todo en UNA transacción, con comprobaciones que abortan si algo no
   cuadra (si ya se corrió, falla en la primera y no cambia nada). No escribe en
   el HIS (origen MIRROR: nada entra a la cola hacia el hospital).

   CÓMO (desde el portátil, en la raíz del repo):
     ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 \
       'docker exec -i agenia_db psql -U agenia -d antigravity -X' \
       < docs/drivers/cnt-sanvicente-anserma/sql/S39141_AL_100_POSTGRES.sql

   DESPUÉS: reiniciar el agente (sudo systemctl restart agenia-mirror-agent) para
   que la reconciliación —2 minutos después de arrancar— traiga las 19 citas de
   S39141 de 77 y 077; si no, llegan en la reconciliación diaria siguiente.
   ============================================================================= */

BEGIN;
\set ON_ERROR_STOP 1
\pset pager off
SET LOCAL agenia.sync_origin = 'MIRROR';
CREATE TEMP TABLE agendas ON COMMIT DROP AS
WITH org AS (SELECT '97f18182-d0d9-4a3b-9eb6-4fbc031b917c'::text id),
base AS (SELECT COALESCE(MAX(substring(email FROM '^medico([0-9]+)@hsvpanserma\.com$')::int), 0) n
           FROM "User" WHERE email ~ '^medico[0-9]+@hsvpanserma\.com$'),
cand(k, nombre, orden) AS (VALUES ('077', 'Programa de Hipertensión', 1), ('77', 'Programa de Gestantes', 2))
SELECT cand.k, cand.nombre, c.label, (c.extra->>'cedula') || '-' || cand.k ced,
       (SELECT m."agenIAId" FROM "MirrorEntityMap" m WHERE m."organizationId"=org.id AND m."entityType"='SERVICE'
         AND m."externalKey" = c.extra->>'servicioDominante') servicio,
       org.id org, gen_random_uuid()::text uid, gen_random_uuid()::text did,
       'medico' || (base.n + cand.orden) || '@hsvpanserma.com' email
  FROM cand JOIN "MirrorCatalogEntry" c ON c."externalKey" = cand.k AND c."entityType"='DOCTOR'
  JOIN org ON c."organizationId" = org.id, base
 WHERE NOT EXISTS (SELECT 1 FROM "MirrorEntityMap" m WHERE m."organizationId"=org.id AND m."entityType"='DOCTOR' AND m."externalKey"=cand.k);
DO $$ BEGIN
  IF (SELECT count(*) FROM agendas) <> 2 THEN RAISE EXCEPTION 'esperaba 2 agendas (77, 077)'; END IF;
  IF EXISTS (SELECT 1 FROM agendas WHERE servicio IS NULL OR ced IS NULL) THEN RAISE EXCEPTION 'agenda sin servicio o cedula'; END IF;
  IF EXISTS (SELECT 1 FROM agendas a JOIN "DoctorProfile" d ON d."organizationId"=a.org AND d.cedula=a.ced) THEN RAISE EXCEPTION 'cedula ocupada'; END IF;
  IF EXISTS (SELECT 1 FROM agendas a JOIN "User" u ON u.email=a.email) THEN RAISE EXCEPTION 'correo ocupado'; END IF;
END $$;
INSERT INTO "User"(id, email, password, role, "organizationId", "createdAt", "updatedAt")
SELECT uid, email, md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text),
       'DOCTOR', org, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC' FROM agendas;
INSERT INTO "DoctorProfile"(id, cedula, "fullName", "isActive", "whatsappBookingEnabled", "isFunctionalAgenda",
                            "serviceId", "userId", "organizationId", "createdAt", "updatedAt")
SELECT did, ced, nombre, true, true, true, servicio, uid, org, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC' FROM agendas;
INSERT INTO "MirrorEntityMap"(id, "entityType", "agenIAId", "externalKey", "externalLabel", "organizationId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'DOCTOR', did, k, label, org, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC' FROM agendas;

-- WhatsApp ON: los médicos de medicina general (S39141 como servicio principal)
-- y las agendas que tienen citas de S39141 (76, 77, 077). Con el filtro por
-- servicio, de las agendas de programa solo entran sus citas de S39141.
CREATE TEMP TABLE encender ON COMMIT DROP AS
SELECT d.id, m."externalKey" k, d."fullName"
  FROM "MirrorEntityMap" m JOIN "DoctorProfile" d ON d.id = m."agenIAId"
 WHERE m."organizationId"='97f18182-d0d9-4a3b-9eb6-4fbc031b917c' AND m."entityType"='DOCTOR'
   AND m."externalKey" IN ('MD08','R001','149','AP08','MD09','RU62','RU65','RU66','RU67','RU69','RU70','RU71','76')
   AND d."whatsappBookingEnabled" = false;
DO $$ BEGIN IF (SELECT count(*) FROM encender) <> 13 THEN RAISE EXCEPTION 'esperaba 13 por encender, hay %', (SELECT count(*) FROM encender); END IF; END $$;
UPDATE "DoctorProfile" d SET "whatsappBookingEnabled" = true, "updatedAt" = now() AT TIME ZONE 'UTC'
 WHERE d.id IN (SELECT id FROM encender);

INSERT INTO "SyncAudit"(id, "organizationId", direction, "entityType", op, outcome, detail, "createdAt")
VALUES (gen_random_uuid()::text, '97f18182-d0d9-4a3b-9eb6-4fbc031b917c', 'CONFIG', 'DoctorProfile', 'WHATSAPP_ON', 'OK',
  'Medicina general (S39141) al 100% (pedido del usuario 2026-10-15): WhatsApp ON a ' ||
  (SELECT string_agg(k, ', ' ORDER BY k) FROM encender) ||
  '; agendas 077 (Programa de Hipertensión) y 77 (Programa de Gestantes) creadas, homologadas y en WhatsApp ON. ' ||
  'Solo entran sus citas de servicios activos (hoy S39141).', now() AT TIME ZONE 'UTC');

\echo '== Médicos con WhatsApp ON despues =='
SELECT m."externalKey" cod, d."fullName" medico, ms.name servicio_del_medico, ms."isActive" activo
  FROM "MirrorEntityMap" m JOIN "DoctorProfile" d ON d.id=m."agenIAId" LEFT JOIN "MedicalService" ms ON ms.id=d."serviceId"
 WHERE m."entityType"='DOCTOR' AND d."whatsappBookingEnabled" ORDER BY 1;
\echo '== Citas futuras en alcance (WA ON + servicio activo) vs fuera =='
SELECT count(*) FILTER (WHERE d."whatsappBookingEnabled" AND ms."isActive") en_alcance,
       count(*) FILTER (WHERE ms."isActive" AND NOT d."whatsappBookingEnabled") s39141_fuera,
       count(*) FILTER (WHERE NOT ms."isActive" AND d."whatsappBookingEnabled") otros_servicios_de_medicos_on
  FROM "Appointment" a JOIN "ScheduleSlot" s ON s.id=a."scheduleSlotId" JOIN "DoctorProfile" d ON d.id=s."doctorId"
  JOIN "MedicalService" ms ON ms.id=s."serviceId"
 WHERE a."organizationId"='97f18182-d0d9-4a3b-9eb6-4fbc031b917c' AND s."startTime" > now() AT TIME ZONE 'UTC' AND a.status <> 'CANCELLED';
\echo '== Recordatorios que saldrian en la proxima vuelta (24 h, con telefono o Telegram, sin baja) =='
SELECT d."fullName" medico, count(*)
  FROM "Appointment" a JOIN "ScheduleSlot" s ON s.id=a."scheduleSlotId" JOIN "DoctorProfile" d ON d.id=s."doctorId"
  JOIN "MedicalService" ms ON ms.id=s."serviceId" JOIN "PatientProfile" p ON p.id=a."patientId"
 WHERE a."organizationId"='97f18182-d0d9-4a3b-9eb6-4fbc031b917c' AND a.status='SCHEDULED' AND a."reminderSentAt" IS NULL
   AND s."startTime" > now() AT TIME ZONE 'UTC' AND s."startTime" <= (now() AT TIME ZONE 'UTC') + interval '24 hours'
   AND d."whatsappBookingEnabled" AND ms."isActive" AND NOT p."remindersOptOut"
   AND (p."whatsappId" IS NOT NULL OR p."telegramChatId" IS NOT NULL OR p.bsuid IS NOT NULL)
 GROUP BY 1 ORDER BY 2 DESC;
SELECT count(*) eventos_doctor_pendientes FROM "SyncOutbox" WHERE "entityType"='DOCTOR' AND "deliveredAt" IS NULL;
COMMIT;
