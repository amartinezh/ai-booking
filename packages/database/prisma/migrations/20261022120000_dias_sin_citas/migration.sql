-- 📅 Días y horas sin citas por el asistente (Configuración › Días sin citas).
-- Solo agrega una tabla: ninguna existente cambia, y sin filas el asistente
-- ofrece las citas como siempre.

-- CreateTable
CREATE TABLE "BookingBlock" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "repeatWeekly" BOOLEAN NOT NULL DEFAULT false,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "note" VARCHAR(120),
    "createdById" TEXT,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingBlock_organizationId_idx" ON "BookingBlock"("organizationId");

-- AddForeignKey
ALTER TABLE "BookingBlock" ADD CONSTRAINT "BookingBlock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
