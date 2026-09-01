-- Régimen de afiliación del paciente ('SUBSIDIADO' | 'CONTRIBUTIVO').
-- Sin él no se puede resolver el convenio de facturación: la misma EPS tiene
-- convenios distintos por régimen. Nullable porque los pacientes anteriores no
-- lo tienen y una clínica sin espejo nunca lo necesita.
ALTER TABLE "PatientProfile" ADD COLUMN "regime" TEXT;
