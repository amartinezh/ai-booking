import { getMenusForRole } from './menus';

describe('getMenusForRole', () => {
    it('devuelve el menú de paciente para PATIENT', () => {
        const menus = getMenusForRole('PATIENT');
        expect(menus.map((m) => m.href)).toEqual(['/dashboard', '/dashboard/soporte']);
    });

    it('devuelve el menú de médico para DOCTOR', () => {
        const menus = getMenusForRole('DOCTOR');
        expect(menus.map((m) => m.href)).toEqual(['/dashboard', '/dashboard/soporte']);
        expect(menus[0].label).toBe('Mi Agenda');
    });

    it('devuelve arreglo vacío para un rol sin dashboard clínico (SUPER_ADMIN)', () => {
        expect(getMenusForRole('SUPER_ADMIN')).toEqual([]);
    });

    it('el menú de ORG_ADMIN incluye Visión General y termina en Soporte', () => {
        const menus = getMenusForRole('ORG_ADMIN');
        expect(menus[0].href).toBe('/dashboard');
        expect(menus[menus.length - 1].href).toBe('/dashboard/soporte');
    });

    it('sin conEspejo, ORG_ADMIN no incluye la opción de Espejo con el HIS', () => {
        const menus = getMenusForRole('ORG_ADMIN');
        expect(menus.some((m) => m.href === '/dashboard/espejo')).toBe(false);
    });

    it('con conEspejo=true, ORG_ADMIN incluye Espejo justo antes de Soporte', () => {
        const menus = getMenusForRole('ORG_ADMIN', { conEspejo: true });
        const espejoIdx = menus.findIndex((m) => m.href === '/dashboard/espejo');
        const soporteIdx = menus.findIndex((m) => m.href === '/dashboard/soporte');
        expect(espejoIdx).toBeGreaterThan(-1);
        expect(espejoIdx).toBe(soporteIdx - 1);
    });

    it('conEspejo=true no afecta a roles distintos de ORG_ADMIN', () => {
        const menus = getMenusForRole('BOOKING_AGENT', { conEspejo: true });
        expect(menus.some((m) => m.href === '/dashboard/espejo')).toBe(false);
    });

    it('no duplica Espejo si getMenusForRole se llama varias veces con conEspejo=true', () => {
        // MENUS_BY_ROLE es un módulo compartido — un bug de mutación in-place
        // (push en vez de spread) haría crecer el arreglo en cada llamada.
        getMenusForRole('ORG_ADMIN', { conEspejo: true });
        getMenusForRole('ORG_ADMIN', { conEspejo: true });
        const menus = getMenusForRole('ORG_ADMIN', { conEspejo: true });
        expect(menus.filter((m) => m.href === '/dashboard/espejo')).toHaveLength(1);
    });

    // ── Avisos masivos (PLAN_AVISOS_MASIVOS.md §1.3) ──────────────────────
    // A diferencia de Espejo, esta opción es de DOS roles, no solo ORG_ADMIN.

    it('sin conAvisos, ni ORG_ADMIN ni BOOKING_AGENT incluyen la opción de avisos', () => {
        expect(getMenusForRole('ORG_ADMIN').some((m) => m.href === '/dashboard/espejo/avisos')).toBe(false);
        expect(getMenusForRole('BOOKING_AGENT').some((m) => m.href === '/dashboard/espejo/avisos')).toBe(
            false,
        );
    });

    it('con conAvisos=true, ORG_ADMIN incluye Avisos justo antes de Soporte', () => {
        const menus = getMenusForRole('ORG_ADMIN', { conAvisos: true });
        const avisosIdx = menus.findIndex((m) => m.href === '/dashboard/espejo/avisos');
        const soporteIdx = menus.findIndex((m) => m.href === '/dashboard/soporte');
        expect(avisosIdx).toBeGreaterThan(-1);
        expect(avisosIdx).toBe(soporteIdx - 1);
    });

    it('con conAvisos=true, BOOKING_AGENT TAMBIÉN incluye Avisos — a diferencia de Espejo', () => {
        const menus = getMenusForRole('BOOKING_AGENT', { conAvisos: true });
        expect(menus.some((m) => m.href === '/dashboard/espejo/avisos')).toBe(true);
    });

    it('conAvisos=true no afecta a roles sin acceso (PATIENT, DOCTOR)', () => {
        expect(getMenusForRole('PATIENT', { conAvisos: true }).some((m) => m.href === '/dashboard/espejo/avisos')).toBe(false);
        expect(getMenusForRole('DOCTOR', { conAvisos: true }).some((m) => m.href === '/dashboard/espejo/avisos')).toBe(false);
    });

    it('conEspejo y conAvisos juntos no duplican ni pisan ninguna opción existente', () => {
        const antes = getMenusForRole('ORG_ADMIN').map((m) => m.href);
        const menus = getMenusForRole('ORG_ADMIN', { conEspejo: true, conAvisos: true });

        expect(menus.some((m) => m.href === '/dashboard/espejo')).toBe(true);
        expect(menus.some((m) => m.href === '/dashboard/espejo/avisos')).toBe(true);
        // Ninguna opción original desapareció ni cambió de identidad.
        for (const href of antes) {
            expect(menus.some((m) => m.href === href)).toBe(true);
        }
        expect(menus).toHaveLength(antes.length + 2);
    });

    it('no duplica Avisos si getMenusForRole se llama varias veces con conAvisos=true', () => {
        getMenusForRole('BOOKING_AGENT', { conAvisos: true });
        getMenusForRole('BOOKING_AGENT', { conAvisos: true });
        const menus = getMenusForRole('BOOKING_AGENT', { conAvisos: true });
        expect(menus.filter((m) => m.href === '/dashboard/espejo/avisos')).toHaveLength(1);
    });
});
