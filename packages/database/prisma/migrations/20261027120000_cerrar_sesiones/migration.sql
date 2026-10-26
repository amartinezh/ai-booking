-- Cerrar sesiones (2026-10-27): todo token emitido antes de este instante deja de
-- valer. Nace vacía (NULL = nunca se cerraron): ninguna sesión abierta cae al desplegar.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionsRevokedAt" TIMESTAMP(3);
