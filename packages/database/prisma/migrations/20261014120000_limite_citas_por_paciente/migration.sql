-- ═══════════════════════════════════════════════════════════════════════════
-- LÍMITE DE CITAS POR PACIENTE (POR EL BOT) Y SOLICITUDES DE MÁS CITAS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- OrganizationSettings   cuántas citas vigentes puede tener un paciente el
--                        mismo día y en el mismo mes (por la fecha de la
--                        cita). Se editan en /dashboard/limites-citas.
-- AppointmentLimitRequest la revisión que pide el paciente cuando el bot lo
--                        frena por el límite; aprobada, le concede citas
--                        adicionales para ese día o ese mes.
--
-- ⚠️ A diferencia de los interruptores, este cambio SÍ cambia la conducta al
-- desplegar: las columnas nacen ENCENDIDAS con 1 cita al día y 3 al mes, que
-- es lo que pidió el hospital. Para apagarlo en una clínica: el panel, o
-- UPDATE "OrganizationSettings" SET "dailyAppointmentLimitEnabled" = false,
-- "monthlyAppointmentLimitEnabled" = false WHERE "organizationId" = '…';
-- El personal sigue agendando sin límite desde el panel.

-- CreateEnum
CREATE TYPE "AppointmentLimitKind" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AppointmentLimitRequestStatus" AS ENUM ('INVITED', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "appointmentLimitsUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "appointmentLimitsUpdatedBy" TEXT,
ADD COLUMN     "dailyAppointmentLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxAppointmentsPerDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "maxAppointmentsPerMonth" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "monthlyAppointmentLimitEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AppointmentLimitRequest" (
    "id" TEXT NOT NULL,
    "kind" "AppointmentLimitKind" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "requestedSlotAt" TIMESTAMP(3),
    "serviceName" TEXT,
    "limitAtRequest" INTEGER NOT NULL,
    "countAtRequest" INTEGER NOT NULL,
    "operation" TEXT NOT NULL DEFAULT 'BOOKING',
    "channel" "ChannelKind" NOT NULL,
    "cedula" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "reasonCategory" TEXT,
    "message" TEXT,
    "extraRequested" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentLimitRequestStatus" NOT NULL DEFAULT 'INVITED',
    "extraGranted" INTEGER,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedByEmail" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentLimitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppointmentLimitRequest_organizationId_status_createdAt_idx" ON "AppointmentLimitRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AppointmentLimitRequest_organizationId_cedula_kind_periodKe_idx" ON "AppointmentLimitRequest"("organizationId", "cedula", "kind", "periodKey");

-- AddForeignKey
ALTER TABLE "AppointmentLimitRequest" ADD CONSTRAINT "AppointmentLimitRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

