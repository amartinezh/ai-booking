-- Avisos de la Bandeja a varias personas (docs/PLAN_AVISOS_AGENDADORES.md, fase 1).
--
--   · SyncAlertRecipient: quién recibe los avisos por WhatsApp. Un usuario de la clínica
--     o un número suelto con nombre, con su modo (aviso y recordatorios, o solo
--     recordatorios) y qué avisos recibe.
--   · Se copian los dos números de hoy para que nadie deje de recibir el día del
--     despliegue: el agendador como «Configurado antes» (aviso y recordatorios) y el
--     respaldo como «Respaldo (configurado antes)» (solo recordatorios). Si el número
--     es el celular de UN solo agendador de esa clínica, la fila queda unida a él.
--   · HospitalMirrorConfig.agendadorWhatsapp y agendadorRespaldoWhatsapp quedan sin uso
--     (N12): no se borran aquí.

-- CreateEnum
CREATE TYPE "SyncAlertRecipientMode" AS ENUM ('AVISOS', 'SOLO_RECORDATORIOS');

-- CreateTable
CREATE TABLE "SyncAlertRecipient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "label" TEXT,
    "phone" TEXT NOT NULL,
    "mode" "SyncAlertRecipientMode" NOT NULL DEFAULT 'AVISOS',
    "syncAlerts" BOOLEAN NOT NULL DEFAULT true,
    "patientRequestAlerts" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "lastWamid" TEXT,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastTestAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncAlertRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncAlertRecipient_organizationId_isActive_idx" ON "SyncAlertRecipient"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SyncAlertRecipient_organizationId_phone_key" ON "SyncAlertRecipient"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "SyncAlertRecipient_organizationId_userId_key" ON "SyncAlertRecipient"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "SyncAlertRecipient" ADD CONSTRAINT "SyncAlertRecipient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAlertRecipient" ADD CONSTRAINT "SyncAlertRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copia: el agendador de hoy recibe el aviso y los recordatorios de los dos grupos.
INSERT INTO "SyncAlertRecipient" ("id", "organizationId", "label", "phone", "mode", "updatedAt")
SELECT gen_random_uuid()::text, c."organizationId", 'Configurado antes', btrim(c."agendadorWhatsapp"), 'AVISOS', CURRENT_TIMESTAMP
FROM "HospitalMirrorConfig" c
WHERE c."agendadorWhatsapp" IS NOT NULL AND btrim(c."agendadorWhatsapp") <> ''
ON CONFLICT DO NOTHING;

-- Copia: el respaldo, solo los recordatorios (si es otro número; sin agendador nunca recibió nada).
INSERT INTO "SyncAlertRecipient" ("id", "organizationId", "label", "phone", "mode", "updatedAt")
SELECT gen_random_uuid()::text, c."organizationId", 'Respaldo (configurado antes)', btrim(c."agendadorRespaldoWhatsapp"), 'SOLO_RECORDATORIOS', CURRENT_TIMESTAMP
FROM "HospitalMirrorConfig" c
WHERE c."agendadorRespaldoWhatsapp" IS NOT NULL AND btrim(c."agendadorRespaldoWhatsapp") <> ''
  AND c."agendadorWhatsapp" IS NOT NULL AND btrim(c."agendadorWhatsapp") <> ''
  AND btrim(c."agendadorRespaldoWhatsapp") <> btrim(c."agendadorWhatsapp")
ON CONFLICT DO NOTHING;

-- Unir cada número copiado al agendador cuyo celular es (los últimos 10 dígitos), solo
-- si es UNO en esa clínica y todavía no tiene fila.
WITH coincidencias AS (
    SELECT r."id" AS "recipientId", a."userId", count(*) OVER (PARTITION BY r."id") AS "cuantos",
           count(*) OVER (PARTITION BY a."userId") AS "filasDelUsuario"
    FROM "SyncAlertRecipient" r
    JOIN "AgentProfile" a
      ON a."organizationId" = r."organizationId"
     AND a."phone" IS NOT NULL
     AND right(regexp_replace(a."phone", '\D', '', 'g'), 10) = right(r."phone", 10)
)
UPDATE "SyncAlertRecipient" r
SET "userId" = c."userId", "label" = NULL
FROM coincidencias c
WHERE r."id" = c."recipientId" AND c."cuantos" = 1 AND c."filasDelUsuario" = 1;
