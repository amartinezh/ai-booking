-- El catálogo del HIS tal como el agente lo reporta: los médicos y servicios
-- que el hospital tiene, ANTES de que nadie decida a quién corresponden en
-- AgenIA.
--
-- Va en su propia tabla y no en "MirrorEntityMap" a propósito: un médico del
-- hospital sin emparejar no es una homologación a medias, es una fila de
-- catálogo esperando que alguien la mire. Con el agenIAId vacío rompería las
-- dos restricciones únicas de esa tabla y confundiría "no lo hemos mirado" con
-- "no tiene equivalente".
CREATE TABLE "MirrorCatalogEntry" (
    "id"             TEXT NOT NULL,
    "entityType"     TEXT NOT NULL,
    "externalKey"    TEXT NOT NULL,
    "label"          TEXT NOT NULL,
    "extra"          JSONB,
    "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MirrorCatalogEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MirrorCatalogEntry_organizationId_entityType_externalKey_key"
    ON "MirrorCatalogEntry"("organizationId", "entityType", "externalKey");

CREATE INDEX "MirrorCatalogEntry_organizationId_entityType_idx"
    ON "MirrorCatalogEntry"("organizationId", "entityType");

ALTER TABLE "MirrorCatalogEntry"
    ADD CONSTRAINT "MirrorCatalogEntry_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
