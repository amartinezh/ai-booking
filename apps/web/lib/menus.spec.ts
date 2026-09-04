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
});
