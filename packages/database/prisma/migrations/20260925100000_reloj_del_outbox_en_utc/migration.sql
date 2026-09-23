-- ═══════════════════════════════════════════════════════════════════════════
-- EL RELOJ DEL OUTBOX, EN UTC COMO TODOS LOS DEMÁS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- EL DEFECTO, medido en producción el 2026-09-22
--
-- Una cita agendada por WhatsApp a las 14:25:46 de Bogotá y entregada al
-- hospital DOS SEGUNDOS después se veía así:
--
--     seq   | createdAt           | deliveredAt
--     13064 | 2026-09-22 14:25:46 | 2026-09-22 19:25:48     ← «5 horas»
--
-- No fue lentitud: son dos relojes distintos en la misma fila.
--
--   · `createdAt` lo pone la BASE DE DATOS. La columna no se nombra en el
--     INSERT del disparador, así que entra su DEFAULT `CURRENT_TIMESTAMP`, que
--     Postgres evalúa en SU zona — y el contenedor corre en `America/Bogota`
--     (docker-compose.deploy.yml pasa `TZ` a todos los servicios).
--   · `deliveredAt` de un evento LOCAL lo pone la APLICACIÓN, vía Prisma, que
--     escribe siempre en UTC.
--   · `deliveredAt` de un evento MIRROR lo pone otra vez el disparador
--     (`now()`, anti-eco: nace entregado), así que esos van en local los dos.
--
-- La columna es `timestamp without time zone`: no guarda de qué zona viene, y
-- Prisma lee todo como si fuera UTC. Resultado: cada evento del outbox se lee
-- CINCO HORAS ANTES de cuando ocurrió.
--
-- A QUIÉN LE DOLÍA
-- El Rastreo de paciente lee justo ese par (apps/web/lib/rastreo/servicio.ts)
-- para enseñar cuándo se sincronizó una cita y cuánto tardó. Es la pantalla
-- con la que el hospital va a diagnosticar el espejo, y mostraba una entrega
-- de 2 segundos como uno de 5 horas.
--
-- QUÉ NO ESTABA ROTO (comprobado antes de tocar nada)
--   · El backoff: `nextAttemptAt` lo escribe y lo compara la aplicación, las
--     dos veces en UTC (mirror-dispatch.service.ts).
--   · El orden del despachador: va por `seq`, no por tiempo.
--   · La ventana del vigilante: 14 días; 5 horas no le escondían nada.
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El DEFAULT de la columna ────────────────────────────────────────────
-- `now() AT TIME ZONE 'utc'` devuelve el instante actual como timestamp naive
-- EN UTC, que es exactamente lo que Prisma escribe en todas las demás fechas.
ALTER TABLE "SyncOutbox"
  ALTER COLUMN "createdAt" SET DEFAULT (now() AT TIME ZONE 'utc');

-- ── 2. El disparador, para el `deliveredAt` del anti-eco ───────────────────
-- Se reemplaza la función entera (es la forma de CREATE OR REPLACE); lo único
-- que cambia respecto de 20260924100000 es el `now()` de la última línea.
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

  -- En un UPDATE se adjunta la fila ANTERIOR bajo `__old`: sin eso un
  -- reagendamiento es irrecuperable (ver 20260924100000).
  IF TG_OP = 'UPDATE' THEN
    v_payload := to_jsonb(NEW) || jsonb_build_object('__old', to_jsonb(OLD));
  ELSE
    v_payload := to_jsonb(COALESCE(NEW, OLD));
  END IF;

  -- 🚨 `current_setting(..., true)` vuelve a CADENA VACÍA —no a NULL— cuando la
  -- transacción que hizo `SET LOCAL` termina, y el pool reutiliza conexiones:
  -- de ahí el NULLIF (ver 20260924100000).
  INSERT INTO "SyncOutbox"("organizationId", "entityType", "entityId", "op", "payload", "origin", "deliveredAt")
  VALUES (
    v_org_id,
    TG_ARGV[0],
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    v_payload,
    COALESCE(NULLIF(v_origin, ''), 'LOCAL'),
    -- ⏱️ EN UTC, igual que la aplicación. Con `now()` a secas este sello salía
    -- en la zona del contenedor y no se podía comparar con el `deliveredAt`
    -- que escribe Prisma.
    CASE WHEN COALESCE(NULLIF(v_origin, ''), 'LOCAL') = 'MIRROR'
         THEN (now() AT TIME ZONE 'utc') ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ── 3. Las filas ya escritas ───────────────────────────────────────────────
-- Se corrigen convirtiendo DESDE la zona del servidor, no restando 5 horas a
-- ciegas: así vale para cualquier despliegue (y para la máquina de cualquier
-- desarrollador) sin suponer que la clínica está en Colombia.
--
-- Si el servidor ya estaba en UTC, las fechas YA eran correctas y no se toca
-- nada — por eso el IF. Este es el caso de una base recién creada.
--
-- ⚠️ Solo se corrige lo que escribió el disparador: `createdAt` (siempre) y el
-- `deliveredAt` de los MIRROR (que nacen entregados). El `deliveredAt` de un
-- evento LOCAL lo puso la aplicación y YA está en UTC: tocarlo lo rompería.
DO $$
DECLARE
  v_tz TEXT := current_setting('TimeZone');
  v_filas BIGINT;
BEGIN
  IF v_tz IS NULL OR upper(v_tz) IN ('UTC', 'ETC/UTC') THEN
    RAISE NOTICE 'SyncOutbox: el servidor ya está en UTC, no hay nada que corregir.';
    RETURN;
  END IF;

  UPDATE "SyncOutbox"
  SET "createdAt"   = ("createdAt" AT TIME ZONE v_tz) AT TIME ZONE 'UTC',
      "deliveredAt" = CASE
                        WHEN "origin" = 'MIRROR' AND "deliveredAt" IS NOT NULL
                        THEN ("deliveredAt" AT TIME ZONE v_tz) AT TIME ZONE 'UTC'
                        ELSE "deliveredAt"
                      END;

  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RAISE NOTICE 'SyncOutbox: % filas pasadas de % a UTC.', v_filas, v_tz;
END $$;
