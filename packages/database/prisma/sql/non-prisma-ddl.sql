-- =============================================================================
-- DDL que Prisma NO gestiona: triggers, funciones e indices parciales.
--
-- POR QUE EXISTE ESTE ARCHIVO
-- Este repo construye sus bases con `prisma db push` (ver scripts/up.sh y
-- deploy/install-vps.sh), que aplica el schema.prisma y NUNCA ejecuta el SQL
-- de prisma/migrations/. Peor: `db_bootstrap` en el instalador sella todas las
-- migraciones como `--applied` sin correrlas, asi que ningun `migrate deploy`
-- posterior las ejecutara jamas.
--
-- Resultado medido el 2026-08-31: en la base de desarrollo NO existia
-- `fn_sync_outbox()` ni ninguno de sus tres triggers. El espejo con el HIS
-- estaba silenciosamente muerto: SyncOutbox vacio, sin un solo error visible.
-- En una VPS recien instalada habria pasado exactamente lo mismo.
--
-- TODO lo de este archivo es IDEMPOTENTE: correrlo diez veces seguidas es
-- inofensivo. Se ejecuta SIEMPRE despues de `db push` y despues de
-- `migrate deploy`, en los cuatro caminos que construyen una base.
--
--   pnpm --filter @agenia/database db:apply-sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Indice parcial de eventos pendientes
-- -----------------------------------------------------------------------------
-- La consulta mas caliente del modulo mirror es "dame los eventos pendientes
-- de esta organizacion, en orden". El predicado debe coincidir EXACTAMENTE con
-- el del dispatcher (deliveredAt IS NULL AND deadLettered = false) o Postgres
-- no puede usar el indice y cae a un scan de la tabla completa.
DROP INDEX IF EXISTS "idx_outbox_pending";
CREATE INDEX "idx_outbox_pending"
  ON "SyncOutbox" ("organizationId", "seq")
  WHERE "deliveredAt" IS NULL AND "deadLettered" = false;

-- -----------------------------------------------------------------------------
-- 2. Captura hacia SyncOutbox
-- -----------------------------------------------------------------------------
-- Serializa la fila completa (NEW en INSERT/UPDATE, OLD en DELETE) a
-- "SyncOutbox", solo si la organizacion tiene el espejo encendido. TG_ARGV[0]
-- es el entity_type ('SLOT'|'DOCTOR'|'APPOINTMENT'), que pasa cada CREATE
-- TRIGGER — la funcion no conoce la tabla.
--
-- Anti-eco: cuando el modulo mirror aplica un cambio que vino del HIS, ejecuta
-- `SET LOCAL agenia.sync_origin = 'MIRROR'` dentro de esa transaccion. El
-- trigger igual registra el evento (para auditoria) pero con origin='MIRROR',
-- y el dispatcher sabe no reenviarlo de vuelta al HIS que lo origino.
CREATE OR REPLACE FUNCTION fn_sync_outbox() RETURNS trigger AS $$
DECLARE
  v_origin TEXT := current_setting('agenia.sync_origin', true);
  v_org_id TEXT := COALESCE(NEW."organizationId", OLD."organizationId");
  v_payload JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "HospitalMirrorConfig" c
    WHERE c."organizationId" = v_org_id AND c."enabled" = true
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- En un UPDATE se adjunta la fila ANTERIOR bajo `__old`.
  --
  -- Sin esto un reagendamiento es irrecuperable: AgenIA lo modela moviendo
  -- `scheduleSlotId` en la MISMA fila, asi que el evento solo traia el cupo
  -- nuevo y el driver no tenia forma de saber que cita borrar en el HIS. Con
  -- `__old` se puede cancelar la vieja y crear la nueva, que es exactamente
  -- como el hospital dijo que quiere que funcione.
  --
  -- Solo en UPDATE: en INSERT no hay anterior, y en DELETE la fila completa ya
  -- viaja como payload.
  IF TG_OP = 'UPDATE' THEN
    v_payload := to_jsonb(NEW) || jsonb_build_object('__old', to_jsonb(OLD));
  ELSE
    v_payload := to_jsonb(COALESCE(NEW, OLD));
  END IF;

  -- 🚨 `current_setting(..., true)` devuelve NULL solo si el parametro NUNCA se
  -- definio en esta conexion. Tras la primera transaccion que hizo
  -- `SET LOCAL agenia.sync_origin`, al terminar esa transaccion el valor vuelve a
  -- la CADENA VACIA, no a NULL — y las conexiones se reutilizan (pool). Con un
  -- COALESCE a secas, todo lo que AgenIA escribiera despues en esa misma conexion
  -- quedaba con origin = '' en vez de 'LOCAL': ni local ni espejo.
  --
  -- ANTI-ECO: lo que nace en el HIS se registra para auditoria pero NACE ENTREGADO
  -- (`deliveredAt` = ahora), que es la forma de que el dispatcher no lo devuelva al
  -- hospital que lo origino sin dejarlo pendiente para siempre tapando la cola.
  INSERT INTO "SyncOutbox"("organizationId", "entityType", "entityId", "op", "payload", "origin", "deliveredAt")
  VALUES (
    v_org_id,
    TG_ARGV[0],
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    v_payload,
    COALESCE(NULLIF(v_origin, ''), 'LOCAL'),
    CASE WHEN COALESCE(NULLIF(v_origin, ''), 'LOCAL') = 'MIRROR' THEN now() ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Un trigger por tabla espejada. Todas disparan en AFTER para no interferir
-- con la transaccion original si algo fallara en la insercion del outbox
-- (preferimos fallar la transaccion completa a dejar un slot/cita huerfano de
-- su evento de sync — ver "Garantia de cero perdida" en el plan).
--
-- DROP + CREATE en vez de CREATE OR REPLACE: Postgres no soporta
-- `CREATE OR REPLACE TRIGGER` antes de la version 14, y el objetivo aqui es
-- que este archivo corra en cualquier version que el equipo tenga enfrente.
DROP TRIGGER IF EXISTS trg_sync_outbox_schedule_slot ON "ScheduleSlot";
CREATE TRIGGER trg_sync_outbox_schedule_slot
  AFTER INSERT OR UPDATE OR DELETE ON "ScheduleSlot"
  FOR EACH ROW EXECUTE FUNCTION fn_sync_outbox('SLOT');

DROP TRIGGER IF EXISTS trg_sync_outbox_doctor_profile ON "DoctorProfile";
CREATE TRIGGER trg_sync_outbox_doctor_profile
  AFTER INSERT OR UPDATE OR DELETE ON "DoctorProfile"
  FOR EACH ROW EXECUTE FUNCTION fn_sync_outbox('DOCTOR');

-- `UPDATE OF <columnas>`, no `UPDATE` a secas: sin esto, CUALQUIER UPDATE de
-- `Appointment` generaba un evento hacia el HIS, incluidos campos 100%
-- internos de AgenIA como `reminderSentAt` (lo toca el cron de recordatorios
-- en cada cita agendada). Esos eventos no tenían nada que ofrecerle al HIS,
-- caían siempre en el mismo cajón sin implementar del motor (ver
-- core/engine.ts, case 'UPDATE') y terminaban quemando sus diez intentos en
-- dead-letter — no por un fallo real, sino por un campo que al hospital no le
-- importa. La lista es un ALLOWLIST a propósito (falla seguro): un campo
-- interno nuevo que se agregue después no dispara el trigger por accidente,
-- hay que agregarlo aquí a mano si alguna vez sí le importa al HIS.
-- Postgres dispara `UPDATE OF` cuando la columna aparece en el SET del
-- UPDATE — que es exactamente lo que genera Prisma: solo los campos que de
-- verdad cambiaron.
DROP TRIGGER IF EXISTS trg_sync_outbox_appointment ON "Appointment";
CREATE TRIGGER trg_sync_outbox_appointment
  AFTER INSERT OR DELETE OR UPDATE OF
    status, "scheduleSlotId", "patientId", "epsId", reason, "attendanceStatus"
  ON "Appointment"
  FOR EACH ROW EXECUTE FUNCTION fn_sync_outbox('APPOINTMENT');

-- ═══════════════════════════════════════════════════════════════════════════
-- Un cupo, como mucho UNA cita vigente.
--
-- `Appointment.scheduleSlotId` llevaba un @unique global, y eso decía algo
-- distinto: "un cupo tuvo como mucho una cita EN TODA SU HISTORIA". Una cita
-- cancelada conserva su fila (es historia clínica) y seguía ocupando la llave,
-- así que un cupo liberado tras una cancelación se volvía a ofrecer por
-- WhatsApp y reventaba al confirmar con "ese espacio acaba de reservarse".
-- Mentira, y sin arreglo posible: ese cupo quedaba invendible para siempre.
--
-- Lo encontró la prueba de punta a punta contra la VM: cancelar y volver a
-- agendar la misma hora es de las cosas más normales que hace un paciente.
--
-- Prisma no sabe expresar un índice único parcial, por eso vive aquí.
-- ═══════════════════════════════════════════════════════════════════════════
DROP INDEX IF EXISTS "Appointment_scheduleSlotId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_appointment_cupo_vigente"
  ON "Appointment" ("scheduleSlotId")
  WHERE status <> 'CANCELLED';

-- ═══════════════════════════════════════════════════════════════════════════
-- Búsqueda de pacientes por NOMBRE (rastreo de paciente, Fase 0).
--
-- docs/PLAN_RASTREO_PACIENTE.md §4.2 y §8. Sin esto, buscar "maria lopez" es un
-- `ILIKE '%...%'` sin índice — un scan de todos los pacientes — y además falla
-- con las tildes: "María" no casa con "maria".
--
--   · pg_trgm  → índice GIN que acelera LIKE '%texto%' y la similitud.
--   · unaccent → quita tildes.
--   · fn_norm_texto() → minúsculas + sin tildes, la MISMA expresión que tiene
--     que usar la consulta para que Postgres pueda usar el índice.
--
-- `unaccent()` está declarada STABLE, no IMMUTABLE, y Postgres solo indexa
-- expresiones inmutables. Este envoltorio la declara inmutable: es el patrón
-- habitual y es seguro mientras el diccionario de unaccent no cambie, lo que en
-- la práctica no ocurre. Si algún día cambiara, basta reconstruir el índice.
--
-- Ambas extensiones vienen en la imagen oficial de Postgres y son "trusted"
-- desde PG 13 (las puede crear el dueño de la base, no hace falta superusuario).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION fn_norm_texto(text) RETURNS text AS $$
  SELECT lower(public.unaccent('public.unaccent', $1))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

CREATE INDEX IF NOT EXISTS "idx_patient_fullname_trgm"
  ON "PatientProfile" USING gin (fn_norm_texto("fullName") gin_trgm_ops);

-- ═══════════════════════════════════════════════════════════════════════════
-- Interruptores de la clínica conectada al hospital: «si está apagado, está
-- apagado y punto» (2026-10-15, pedido del usuario).
--
-- Con el espejo activo, agendar, cancelar y cambiar la fecha de una cita tienen
-- cada uno su interruptor (OrganizationSettings: bookingEnabled, cancelEnabled,
-- rescheduleEnabled). Encendido, la operación se hace por el asistente y desde
-- el panel, y llega al sistema del hospital. Apagado, NO se puede hacer en
-- AgenIA: esta función la rechaza ANTES de escribir, venga de donde venga (el
-- bot, el panel, un proceso o una consulta a mano). Así nunca queda en la cola
-- un cambio que el hospital no va a recibir — que es lo que pasaba cuando el
-- interruptor solo detenía el envío: lo hecho en el panel se acumulaba y se
-- escribía en el hospital días después, quizás sobre horas ya ocupadas.
--
--   · Lo que llega DEL hospital (`agenia.sync_origin = 'MIRROR'`: el espejo, el
--     rechazo del HIS, la cita que vuelve a su hora) nunca se frena.
--   · Sin espejo activo no hay hospital: la clínica opera libre en AgenIA.
--   · Solo frena altas, cancelaciones y cambios de cupo. Asistencia, EPS, motivo
--     o el recordatorio enviado no se escriben en el hospital y pasan siempre.
--   · REACTIVAR (una cita cancelada que vuelve a vigente) se frena SIEMPRE con
--     espejo: para el hospital sería una cita nueva que nadie le enviaría.
--   · Sin fila de OrganizationSettings: frena (falla cerrado).
--   · FUERA_DE_ALCANCE (2026-10-15): AgenIA solo trabaja con las citas de los
--     médicos con «WhatsApp ON» (`DoctorProfile.whatsappBookingEnabled`, en
--     Médicos) Y de un servicio ACTIVO (`MedicalService.isActive`, en Servicios;
--     en Anserma solo «Consulta ambulatoria de medicina general», S39141). El
--     servicio es el del CUPO, que el espejo pone igual al de la cita del
--     hospital: un mismo médico atiende medicina general, hipertensos y lectura
--     de exámenes. Crear, cancelar o mover cualquier otra cita (odontología,
--     hipertensos…) se frena aunque la operación esté encendida: esas citas se
--     gestionan en el sistema del hospital.
--   · CITA_PASADA (2026-10-16): cancelar o mover desde AgenIA una cita cuya hora
--     ya llegó se frena: en el hospital sería borrar una cita ya cumplida o
--     perdida (el bot ofreció cancelar a las 7:25 una cita de las 7:30 y el SÍ
--     podía llegar después). Las fechas se guardan en UTC y la base corre en hora
--     de Bogotá: se compara contra `now() AT TIME ZONE 'UTC'`.
--
-- El error lleva `AGENIA_OPERACION_APAGADA:<operación>`: la API y el panel lo
-- reconocen (`operacionFrenadaDelError` en @agenia/shared) y lo traducen a un
-- mensaje para la persona. Ver packages/shared/src/compuerta-his.ts.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_interruptores_del_hospital() RETURNS trigger AS $$
DECLARE
  v_origin TEXT := COALESCE(NULLIF(current_setting('agenia.sync_origin', true), ''), 'LOCAL');
  v_op TEXT;
  v_permitido BOOLEAN;
BEGIN
  IF v_origin = 'MIRROR' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "HospitalMirrorConfig" c
    WHERE c."organizationId" = NEW."organizationId" AND c."enabled" = true
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_op := 'AGENDAR';
  ELSIF NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED' THEN
    v_op := 'CANCELAR';
  ELSIF OLD.status = 'CANCELLED' AND NEW.status IS DISTINCT FROM 'CANCELLED' THEN
    RAISE EXCEPTION 'AGENIA_OPERACION_APAGADA:REACTIVAR'
      USING HINT = 'Con la clínica conectada al hospital, una cita cancelada no se reactiva: se agenda de nuevo.';
  ELSIF NEW."scheduleSlotId" IS DISTINCT FROM OLD."scheduleSlotId"
        AND NEW.status IS DISTINCT FROM 'CANCELLED' THEN
    v_op := 'MODIFICAR';
  ELSE
    RETURN NEW;
  END IF;

  SELECT CASE v_op
           WHEN 'AGENDAR'   THEN s."bookingEnabled"
           WHEN 'CANCELAR'  THEN s."cancelEnabled"
           WHEN 'MODIFICAR' THEN s."rescheduleEnabled"
         END
    INTO v_permitido
    FROM "OrganizationSettings" s
   WHERE s."organizationId" = NEW."organizationId";

  IF v_permitido IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'AGENIA_OPERACION_APAGADA:%', v_op
      USING HINT = 'El interruptor de esta operación está apagado en Configuración: hágala directamente en el sistema del hospital.';
  END IF;

  -- El cupo de la cita (y, al moverla, también el de antes) tiene que ser de un
  -- médico en WhatsApp ON y de un servicio activo. Un cupo, médico o servicio
  -- que no se encuentra cuenta como fuera.
  IF NOT EXISTS (
    SELECT 1 FROM "ScheduleSlot" ss
      JOIN "DoctorProfile" d ON d.id = ss."doctorId"
      JOIN "MedicalService" sv ON sv.id = ss."serviceId"
     WHERE ss.id = NEW."scheduleSlotId"
       AND d."whatsappBookingEnabled" = true AND sv."isActive" = true
  ) OR (
    TG_OP = 'UPDATE' AND NEW."scheduleSlotId" IS DISTINCT FROM OLD."scheduleSlotId"
    AND NOT EXISTS (
      SELECT 1 FROM "ScheduleSlot" ss
        JOIN "DoctorProfile" d ON d.id = ss."doctorId"
        JOIN "MedicalService" sv ON sv.id = ss."serviceId"
       WHERE ss.id = OLD."scheduleSlotId"
         AND d."whatsappBookingEnabled" = true AND sv."isActive" = true
    )
  ) THEN
    RAISE EXCEPTION 'AGENIA_OPERACION_APAGADA:FUERA_DE_ALCANCE'
      USING HINT = 'La cita es de un médico sin WhatsApp ON o de un servicio inactivo: se gestiona directamente en el sistema del hospital.';
  END IF;

  -- Una cita cuya hora ya llegó no se cancela ni se mueve desde AgenIA.
  IF TG_OP = 'UPDATE' AND v_op IN ('CANCELAR', 'MODIFICAR') AND EXISTS (
    SELECT 1 FROM "ScheduleSlot" ss
     WHERE ss.id = OLD."scheduleSlotId"
       AND ss."startTime" <= (now() AT TIME ZONE 'UTC')
  ) THEN
    RAISE EXCEPTION 'AGENIA_OPERACION_APAGADA:CITA_PASADA'
      USING HINT = 'La hora de la cita ya llegó: se gestiona directamente en el sistema del hospital.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE (no AFTER como el del outbox): rechaza la escritura antes de que exista
-- y antes de que el disparador del outbox la ponga en la cola. Solo las columnas
-- que definen alta, cancelación o cambio de cupo: el resto ni lo despierta.
DROP TRIGGER IF EXISTS trg_interruptores_del_hospital ON "Appointment";
CREATE TRIGGER trg_interruptores_del_hospital
  BEFORE INSERT OR UPDATE OF status, "scheduleSlotId"
  ON "Appointment"
  FOR EACH ROW EXECUTE FUNCTION fn_interruptores_del_hospital();

-- ═══════════════════════════════════════════════════════════════════════════
-- Alertas técnicas: como mucho UN problema ABIERTO por clave
-- (docs/PLAN_ALERTAS_TECNICAS.md §3.5).
--
-- Cada fallo se identifica por su clave (`claveAlerta` en @agenia/shared): el
-- servicio caído, el cron que revienta. Mientras el problema siga abierto, otro
-- fallo igual suma `occurrences` en la MISMA fila y no manda otro mensaje. Con dos
-- réplicas de la API detectando lo mismo a la vez, sin este índice las dos
-- abrirían su fila y el grupo recibiría el aviso dos veces; con él, la segunda
-- choca y actualiza la de la primera.
--
-- Parcial a propósito: un problema resuelto conserva su fila (es la bitácora) y
-- la misma clave puede volver a abrirse mañana.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tech_alert_abierta"
  ON "TechAlert" ("dedupeKey")
  WHERE status = 'ABIERTA';

-- ═══════════════════════════════════════════════════════════════════════════
-- Asistente de soporte: a lo sumo UNA conversación abierta por usuario y UNA por
-- cuenta de Telegram (docs/PLAN_BOT_SOPORTE.md §3.1).
--
-- El código del panel abre una conversación atada a un usuario de AgenIA y a la
-- cuenta de Telegram que lo escribió. Abrir otra cierra la anterior en la misma
-- transacción; sin estos índices, dos códigos validados a la vez (dos mensajes
-- seguidos, dos réplicas) dejarían dos conversaciones abiertas, y los avisos y el
-- estado del caso irían a la que no es.
--
-- Parciales a propósito: las conversaciones cerradas se conservan (180 días) y el
-- mismo usuario abre una nueva cada vez.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS "uq_support_bot_abierta_usuario"
  ON "SupportBotConversation" ("userId")
  WHERE "closedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_support_bot_abierta_telegram"
  ON "SupportBotConversation" ("telegramUserId")
  WHERE "closedAt" IS NULL;
