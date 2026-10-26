-- 📊 Estadísticas para compartir (Configuración › Estadísticas): la clave de la
-- página pública de estadísticas, con bcrypt, y quién la cambió por última vez.
-- Solo agrega tres columnas que nacen vacías (NULL = página cerrada): ninguna
-- clínica cambia de conducta al desplegar, y ninguna otra tabla se toca.

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "publicStatsKeyHash" TEXT,
ADD COLUMN     "publicStatsKeyUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "publicStatsKeyUpdatedBy" TEXT;
