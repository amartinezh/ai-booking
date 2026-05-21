-- AlterTable
ALTER TABLE "WaitlistEntry" ADD COLUMN "preferredDoctorId" TEXT;

-- CreateIndex
CREATE INDEX "WaitlistEntry_preferredDoctorId_idx" ON "WaitlistEntry"("preferredDoctorId");

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_preferredDoctorId_fkey" FOREIGN KEY ("preferredDoctorId") REFERENCES "DoctorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
