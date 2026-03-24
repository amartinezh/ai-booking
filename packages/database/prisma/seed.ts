import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando Seed Multi-Tenant...');

  // 1. Crear Organización por defecto
  const hospitalName = 'Hospital San Vicente';
  let defaultOrg = await prisma.organization.findUnique({
    where: { name: hospitalName },
  });

  if (!defaultOrg) {
    defaultOrg = await prisma.organization.create({
      data: {
        name: hospitalName,
        isActive: true,
      },
    });
    console.log(`✅ Organización "${hospitalName}" creada con ID: ${defaultOrg.id}`);
  } else {
    console.log(`ℹ️ Organización "${hospitalName}" ya existe.`);
  }

  const orgId = defaultOrg.id;

  // 2. Migrar Usuarios huérfanos
  const usersUpdated = await prisma.user.updateMany({
    where: { organizationId: null },
    data: { organizationId: orgId },
  });
  console.log(`✅ Usuarios migrados: ${usersUpdated.count}`);

  // 3. Migrar EPS huérfanas
  const epsUpdated = await prisma.eps.updateMany({
    where: { organizationId: null },
    data: { organizationId: orgId },
  });
  console.log(`✅ EPS migradas: ${epsUpdated.count}`);

  // 4. Migrar Servicios Médicos huérfanos
  const servicesUpdated = await prisma.medicalService.updateMany({
    where: { organizationId: null },
    data: { organizationId: orgId },
  });
  console.log(`✅ Servicios Médicos migrados: ${servicesUpdated.count}`);

  // 5. Migrar Slots de Agenda huérfanos
  const slotsUpdated = await prisma.scheduleSlot.updateMany({
    where: { organizationId: null },
    data: { organizationId: orgId },
  });
  console.log(`✅ Slots de Agenda migrados: ${slotsUpdated.count}`);

  // 6. Migrar Citas huérfanas
  const appointmentsUpdated = await prisma.appointment.updateMany({
    where: { organizationId: null },
    data: { organizationId: orgId },
  });
  console.log(`✅ Citas migradas: ${appointmentsUpdated.count}`);

  // 7. Migrar Historias Clínicas huérfanas
  const ehrUpdated = await prisma.clinicalRecord.updateMany({
    where: { organizationId: null },
    data: { organizationId: orgId },
  });
  console.log(`✅ Historias Clínicas migradas: ${ehrUpdated.count}`);

  const doctorsUpdated = await prisma.doctorProfile.updateMany({
    where: { organizationId: null },
    data: { organizationId: orgId },
  });
  console.log(`✅ Doctores migrados: ${doctorsUpdated.count}`);

  const patientsUpdated = await prisma.patientProfile.updateMany({
    where: { organizationId: null },
    data: { organizationId: orgId },
  });
  console.log(`✅ Pacientes migrados: ${patientsUpdated.count}`);

  // NOTA: Para el rol ADMIN -> ORG_ADMIN, esto se debe manejar a nivel SQL en la migración
  // o si Prisma lo elimina por error, habría que repopularlo manualmente. 
  // Sin embargo, este seed asegura que toda la data relacional ahora pertenezca al Tenant 1.

  console.log('✅ Seed finalizado con éxito.');
}

main()
  .catch((e) => {
    console.error('❌ Error durante el Seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
