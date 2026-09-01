-- El agente puede latir puntual y no poder escribir una sola cita en el HIS.
-- Esa diferencia solo existía en el log del servidor: ahora se guarda, para
-- que el panel del hospital pueda mostrarla sin que nadie tenga que grepear.
ALTER TABLE "HospitalMirrorConfig"
  ADD COLUMN "lastHisReachable" BOOLEAN,
  ADD COLUMN "lastHisDetail" TEXT;
