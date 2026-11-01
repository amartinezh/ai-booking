-- Resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md), Fase 2: documentos y página.
--
--   · AttentionSummaryLink: el enlace a la página del resumen (/resumen/<token>).
--     Del token solo se guarda su SHA-256; vence a los 30 días y se bloquea una
--     hora tras 5 fechas de nacimiento equivocadas (D4). En esta fase solo hay
--     enlaces de PRUEBA, que genera el administrador.
--   · AttentionSummaryAccess: cada apertura, verificación y descarga de la
--     página, con la IP y el navegador. Sin contenido clínico.
--
-- Las dos se borran con su resumen (al año). Solo agrega tablas: ninguna fila
-- existente cambia.

-- CreateTable
CREATE TABLE "AttentionSummaryLink" (
    "id" TEXT NOT NULL,
    "attentionSummaryId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AttentionSummaryLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttentionSummaryAccess" (
    "id" TEXT NOT NULL,
    "attentionSummaryId" TEXT NOT NULL,
    "linkId" TEXT,
    "kind" TEXT NOT NULL,
    "documentId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttentionSummaryAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttentionSummaryLink_tokenHash_key" ON "AttentionSummaryLink"("tokenHash");

-- CreateIndex
CREATE INDEX "AttentionSummaryLink_attentionSummaryId_idx" ON "AttentionSummaryLink"("attentionSummaryId");

-- CreateIndex
CREATE INDEX "AttentionSummaryAccess_attentionSummaryId_createdAt_idx" ON "AttentionSummaryAccess"("attentionSummaryId", "createdAt");

-- CreateIndex
CREATE INDEX "AttentionSummaryAccess_linkId_idx" ON "AttentionSummaryAccess"("linkId");

-- AddForeignKey
ALTER TABLE "AttentionSummaryLink" ADD CONSTRAINT "AttentionSummaryLink_attentionSummaryId_fkey" FOREIGN KEY ("attentionSummaryId") REFERENCES "AttentionSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttentionSummaryAccess" ADD CONSTRAINT "AttentionSummaryAccess_attentionSummaryId_fkey" FOREIGN KEY ("attentionSummaryId") REFERENCES "AttentionSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttentionSummaryAccess" ADD CONSTRAINT "AttentionSummaryAccess_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "AttentionSummaryLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

