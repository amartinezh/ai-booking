-- 🩺 Médicos nuevos del hospital: homologación automática (Configuración).
-- Solo agrega dos columnas que nacen APAGADAS: ninguna clínica cambia de
-- conducta al desplegar, y ninguna otra tabla se toca.

-- AlterTable
ALTER TABLE "HospitalMirrorConfig" ADD COLUMN     "autoHomologateDoctors" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoHomologateWhatsappOn" BOOLEAN NOT NULL DEFAULT false;
