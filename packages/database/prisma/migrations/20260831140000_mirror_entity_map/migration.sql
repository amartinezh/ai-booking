-- Homologacion AgenIA <-> HIS. Ver la nota del modelo en schema.prisma.
CREATE TABLE "MirrorEntityMap" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "agenIAId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "externalLabel" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MirrorEntityMap_pkey" PRIMARY KEY ("id")
);

-- Unico en los dos sentidos: sin el segundo, dos medicos de AgenIA podrian
-- apuntar al mismo codigo del HIS y las citas de uno acabarian en la agenda
-- del otro.
CREATE UNIQUE INDEX "MirrorEntityMap_organizationId_entityType_agenIAId_key"
  ON "MirrorEntityMap"("organizationId", "entityType", "agenIAId");
CREATE UNIQUE INDEX "MirrorEntityMap_organizationId_entityType_externalKey_key"
  ON "MirrorEntityMap"("organizationId", "entityType", "externalKey");
CREATE INDEX "MirrorEntityMap_organizationId_entityType_idx"
  ON "MirrorEntityMap"("organizationId", "entityType");

ALTER TABLE "MirrorEntityMap" ADD CONSTRAINT "MirrorEntityMap_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
