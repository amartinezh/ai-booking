-- EL PADRÓN VIVE EN AGENIA — llave por EPS, régimen, y trazabilidad del corte.
--
-- Tres cambios, decididos y medidos en
-- docs/drivers/cnt-sanvicente-anserma/ESTADO.md (2026-09-10):
--
-- 1) LA LLAVE ERA (organizationId, cedula): una persona no podía estar en el
--    padrón de dos EPS a la vez. Durante un traslado real sí aparece en los
--    cortes de las dos EPS del mismo mes, y con la llave vieja la EPS de esa
--    persona cambiaba según cuál de los dos archivos se hubiera cargado de
--    último — sin relación con la fecha real del traslado. Ahora es
--    (organizationId, epsId, cedula): dos filas, cada una gobernada por el
--    corte de su propia EPS.
--
-- 2) `fullName` DEJA DE SER OBLIGATORIO. El formato mínimo del padrón solo
--    exige la cédula: el nombre real vive en el HIS, vía el agente espejo,
--    no en una copia del padrón de la EPS (que en el hospital piloto traía
--    "YULEY" sin apellidos en el 100% de una muestra de 143 filas). Se añade
--    `regime` (SUBSIDIADO/CONTRIBUTIVO, enruta el convenio de facturación) e
--    `importId` (de qué corte viene la fila).
--
-- 3) `PadronImport`/`PadronImportRow`: un corte del padrón es ahora una
--    entidad, no un efecto colateral silencioso. El hospital confirmó que el
--    archivo que envía cada EPS es siempre completo pero puede llegar
--    parcial por error, y que debe poderse recargar cuantas veces haga falta
--    — de ahí el reemplazo idempotente por EPS (el código de aplicación
--    desactiva, tras cada carga, a quien tenía isActive=true en esa EPS con
--    un importId distinto del nuevo) y el hash del archivo para detectar
--    recargas. `PadronImportRow` NUNCA guarda la fila cruda de una fila
--    aceptada — el padrón original traía columnas con datos sensibles
--    (oncología, salud mental, IVE, violencia, ~14% de sus filas) que se
--    decidió no custodiar; solo guarda la cédula y el resultado, y de una
--    fila rechazada, el valor de la columna que falló.
-- DropIndex
DROP INDEX "EpsEnrolledPatient_organizationId_cedula_key";

-- AlterTable
ALTER TABLE "EpsEnrolledPatient" ADD COLUMN     "importId" TEXT,
ADD COLUMN     "regime" TEXT,
ALTER COLUMN "fullName" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PadronImport" (
    "id" TEXT NOT NULL,
    "epsId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "totalDataRows" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "errorRows" INTEGER NOT NULL,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "reactivated" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER NOT NULL DEFAULT 0,
    "deactivationWasConfirmed" BOOLEAN,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PadronImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PadronImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "cedulaCruda" TEXT NOT NULL,
    "cedulaNormalizada" TEXT,
    "resultado" TEXT NOT NULL,
    "errorColumn" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "PadronImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PadronImport_organizationId_epsId_createdAt_idx" ON "PadronImport"("organizationId", "epsId", "createdAt");

-- CreateIndex
CREATE INDEX "PadronImportRow_importId_resultado_idx" ON "PadronImportRow"("importId", "resultado");

-- CreateIndex
CREATE INDEX "PadronImportRow_importId_cedulaNormalizada_idx" ON "PadronImportRow"("importId", "cedulaNormalizada");

-- CreateIndex
CREATE INDEX "EpsEnrolledPatient_organizationId_cedula_idx" ON "EpsEnrolledPatient"("organizationId", "cedula");

-- CreateIndex
CREATE INDEX "EpsEnrolledPatient_importId_idx" ON "EpsEnrolledPatient"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "EpsEnrolledPatient_organizationId_epsId_cedula_key" ON "EpsEnrolledPatient"("organizationId", "epsId", "cedula");

-- AddForeignKey
ALTER TABLE "EpsEnrolledPatient" ADD CONSTRAINT "EpsEnrolledPatient_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PadronImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PadronImport" ADD CONSTRAINT "PadronImport_epsId_fkey" FOREIGN KEY ("epsId") REFERENCES "Eps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PadronImport" ADD CONSTRAINT "PadronImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PadronImport" ADD CONSTRAINT "PadronImport_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PadronImportRow" ADD CONSTRAINT "PadronImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PadronImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

