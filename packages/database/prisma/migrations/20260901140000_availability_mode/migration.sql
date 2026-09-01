-- Fase 2: importación de la agenda del hospital, con modo sombra.
--
-- Va aparte de `enabled` a propósito: escribir citas en el HIS y adueñarse de
-- la disponibilidad son decisiones distintas, y el hospital las toma en
-- momentos distintos. OFF por defecto: nada cambia para quien ya esté corriendo.
CREATE TYPE "MirrorAvailabilityMode" AS ENUM ('OFF', 'SHADOW', 'ON');

ALTER TABLE "HospitalMirrorConfig"
  ADD COLUMN "availabilityMode" "MirrorAvailabilityMode" NOT NULL DEFAULT 'OFF';
