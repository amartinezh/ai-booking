-- Nombres y apellidos por separado, como los da el paciente.
--
-- El HIS del hospital guarda el nombre en cuatro columnas y partir un
-- `fullName` después es imposible sin adivinar: "JUAN CARLOS PEREZ" puede ser
-- un nombre y dos apellidos, o dos nombres y un apellido. Ahora el chatbot lo
-- pregunta en dos pasos y la frontera la pone el paciente.
--
-- Nulos para los pacientes anteriores: para ellos se sigue usando la
-- heurística de partirNombre() sobre `fullName`.
ALTER TABLE "PatientProfile"
  ADD COLUMN "nombres" TEXT,
  ADD COLUMN "apellidos" TEXT;
