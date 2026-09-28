import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Identificadores de CANAL de la ficha del paciente: por clínica, pero NUNCA
 * únicos (migraciones 20260928110000 y 20260928120000).
 *
 * El BSUID de WhatsApp y el chat de Telegram son la CUENTA desde la que se
 * escribe, no la persona (esa es la cédula, que sí es única por clínica). Una
 * familia comparte la cuenta: una madre agenda para ella y para su hijo. Con
 * llave única, la ficha del hijo no se creaba (su cita no se reservaba) y a
 * una ficha existente se le perdía el régimen junto con el BSUID, porque van
 * en el mismo update — reproducido contra Postgres el 2026-09-28.
 *
 * Si este test falla, alguien volvió a poner la unicidad: léase lo de arriba
 * antes de «arreglarlo» cambiando el test.
 */
describe('schema: identificadores de canal del paciente', () => {
  const schema = readFileSync(
    join(__dirname, '../../../packages/database/prisma/schema.prisma'),
    'utf8',
  );
  const patientProfile =
    /model PatientProfile \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? '';

  it('encuentra el modelo', () => {
    expect(patientProfile).toContain('cedula');
  });

  it.each(['bsuid', 'telegramChatId', 'whatsappId'])(
    '%s NO es único (ni solo, ni junto a la clínica)',
    (campo) => {
      expect(patientProfile).not.toMatch(
        new RegExp(`@@unique\\(\\[organizationId, ${campo}\\]\\)`),
      );
      expect(patientProfile).not.toMatch(
        new RegExp(`\\n\\s*${campo}\\s+String\\?[^\\n]*@unique`),
      );
    },
  );

  it.each(['bsuid', 'telegramChatId', 'whatsappId'])(
    '%s sigue indexado POR CLÍNICA (el aislamiento entre tenants no cambia)',
    (campo) => {
      expect(patientProfile).toMatch(
        new RegExp(`@@index\\(\\[organizationId, ${campo}\\]\\)`),
      );
    },
  );

  it('la cédula SÍ es única por clínica: es la persona', () => {
    expect(patientProfile).toMatch(/@@unique\(\[organizationId, cedula\]\)/);
  });
});
