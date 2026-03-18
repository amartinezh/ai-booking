/*
  Warnings:

  - You are about to drop the column `bookedViaAi` on the `Appointment` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "AppointmentOrigin" AS ENUM ('MANUAL', 'WHATSAPP');

-- AlterTable
ALTER TABLE "Appointment" DROP COLUMN "bookedViaAi",
ADD COLUMN     "origin" "AppointmentOrigin" NOT NULL DEFAULT 'WHATSAPP';
