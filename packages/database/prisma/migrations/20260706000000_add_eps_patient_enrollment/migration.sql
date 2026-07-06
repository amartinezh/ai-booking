-- CreateEnum
CREATE TYPE "EnrollmentRequestStatus" AS ENUM ('PENDING', 'REVIEWED');

-- CreateTable
CREATE TABLE "EpsEnrolledPatient" (
    "id" TEXT NOT NULL,
    "cedula" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "epsId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EpsEnrolledPatient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpsEnrollmentRequest" (
    "id" TEXT NOT NULL,
    "cedula" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "epsName" TEXT,
    "message" TEXT NOT NULL,
    "status" "EnrollmentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EpsEnrollmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EpsEnrolledPatient_organizationId_cedula_key" ON "EpsEnrolledPatient"("organizationId", "cedula");

-- CreateIndex
CREATE INDEX "EpsEnrolledPatient_organizationId_epsId_idx" ON "EpsEnrolledPatient"("organizationId", "epsId");

-- CreateIndex
CREATE INDEX "EpsEnrollmentRequest_organizationId_status_createdAt_idx" ON "EpsEnrollmentRequest"("organizationId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "EpsEnrolledPatient" ADD CONSTRAINT "EpsEnrolledPatient_epsId_fkey" FOREIGN KEY ("epsId") REFERENCES "Eps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpsEnrolledPatient" ADD CONSTRAINT "EpsEnrolledPatient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpsEnrollmentRequest" ADD CONSTRAINT "EpsEnrollmentRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
