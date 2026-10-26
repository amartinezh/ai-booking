-- Actividad de usuarios (2026-10-26): la pantalla del super administrador lee la
-- bitácora del sistema por clínica y por persona, de lo más nuevo a lo más viejo.
-- Solo índices: no cambia ningún dato.

-- CreateIndex
CREATE INDEX "SystemLog_organizationId_createdAt_idx" ON "SystemLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_userId_createdAt_idx" ON "SystemLog"("userId", "createdAt");
