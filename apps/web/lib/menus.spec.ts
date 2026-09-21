import { getMenusForRole } from './menus';

describe('getMenusForRole', () => {
    it('devuelve el menú de paciente para PATIENT', () => {
        const menus = getMenusForRole('PATIENT');
        expect(menus.map((m) => m.href)).toEqual(['/dashboard', '/dashboard/soporte']);
    });

    it('devuelve el menú de médico para DOCTOR', () => {
        const menus = getMenusForRole('DOCTOR');
        expect(menus.map((m) => m.href)).toEqual(['/dashboard', '/dashboard/rastreo', '/dashboard/soporte']);
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

    it('con conEspejo=true, ORG_ADMIN incluye Espejo, seguido de la Bandeja de sincronización, antes de Soporte', () => {
        const menus = getMenusForRole('ORG_ADMIN', { conEspejo: true });
        const espejoIdx = menus.findIndex((m) => m.href === '/dashboard/espejo');
        const soporteIdx = menus.findIndex((m) => m.href === '/dashboard/soporte');
        expect(espejoIdx).toBeGreaterThan(-1);
        expect(menus[espejoIdx + 1].href).toBe('/dashboard/bandeja');
        expect(espejoIdx).toBe(soporteIdx - 2);
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
        // Espejo, Bandeja de sincronización y Avisos.
        expect(menus).toHaveLength(antes.length + 3);
    });

    it('no duplica Avisos si getMenusForRole se llama varias veces con conAvisos=true', () => {
        getMenusForRole('BOOKING_AGENT', { conAvisos: true });
        getMenusForRole('BOOKING_AGENT', { conAvisos: true });
        const menus = getMenusForRole('BOOKING_AGENT', { conAvisos: true });
        expect(menus.filter((m) => m.href === '/dashboard/espejo/avisos')).toHaveLength(1);
    });

    // ── Rastreo de paciente (docs/PLAN_RASTREO_PACIENTE.md §5) ────────────

    it.each(['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR'] as const)('%s tiene el rastreo de paciente', (rol) => {
        expect(getMenusForRole(rol).some((m) => m.href === '/dashboard/rastreo')).toBe(true);
    });

    it.each(['PATIENT', 'GENERAL_OBSERVER'] as const)('%s NO tiene el rastreo de paciente', (rol) => {
        expect(getMenusForRole(rol).some((m) => m.href === '/dashboard/rastreo')).toBe(false);
    });

    it('el rastreo aparece con o sin espejo: sirve para investigar aunque no haya HIS', () => {
        expect(getMenusForRole('ORG_ADMIN', { conEspejo: false }).some((m) => m.href === '/dashboard/rastreo')).toBe(true);
        expect(getMenusForRole('ORG_ADMIN', { conEspejo: true }).some((m) => m.href === '/dashboard/rastreo')).toBe(true);
    });

    it('el rastreo no se duplica ni se muta el menú compartido entre llamadas', () => {
        getMenusForRole('BOOKING_AGENT', { conAvisos: true });
        getMenusForRole('BOOKING_AGENT', { conAvisos: true });
        const menus = getMenusForRole('BOOKING_AGENT', { conAvisos: true });
        expect(menus.filter((m) => m.href === '/dashboard/rastreo')).toHaveLength(1);
    });
});

describe('Bandeja de sincronización (Fase 3 del rastreo)', () => {
    const HREF = '/dashboard/bandeja';
    const tiene = (menus: { href: string }[]) => menus.some((m) => m.href === HREF);

    it('sin espejo no aparece para nadie: sin HIS no hay nada que sincronizar', () => {
        for (const rol of ['ORG_ADMIN', 'BOOKING_AGENT', 'DOCTOR', 'PATIENT', 'GENERAL_OBSERVER', 'SUPER_ADMIN'] as const) {
            expect(tiene(getMenusForRole(rol))).toBe(false);
            expect(tiene(getMenusForRole(rol, { conEspejo: false, pendientesBandeja: 4 }))).toBe(false);
        }
    });

    it('con espejo la ven ORG_ADMIN y BOOKING_AGENT — quienes la trabajan —, y nadie más', () => {
        expect(tiene(getMenusForRole('ORG_ADMIN', { conEspejo: true }))).toBe(true);
        expect(tiene(getMenusForRole('BOOKING_AGENT', { conEspejo: true }))).toBe(true);
        for (const rol of ['DOCTOR', 'PATIENT', 'GENERAL_OBSERVER', 'SUPER_ADMIN'] as const) {
            expect(tiene(getMenusForRole(rol, { conEspejo: true }))).toBe(false);
        }
    });

    it('queda justo antes de Soporte, después del Espejo, y no desplaza a los demás', () => {
        const menus = getMenusForRole('ORG_ADMIN', { conEspejo: true, conAvisos: true });
        const hrefs = menus.map((m) => m.href);
        expect(hrefs.indexOf(HREF)).toBe(hrefs.indexOf('/dashboard/espejo') + 1);
        expect(hrefs.indexOf('/dashboard/soporte')).toBe(hrefs.length - 1);
        expect(hrefs).toContain('/dashboard/espejo/avisos');
        expect(new Set(hrefs).size).toBe(hrefs.length);
    });

    it('la cifra de pendientes solo se pone si hay pendientes', () => {
        const con = getMenusForRole('BOOKING_AGENT', { conEspejo: true, pendientesBandeja: 3 }).find((m) => m.href === HREF);
        expect(con?.badge).toBe(3);
        for (const n of [0, undefined]) {
            const sin = getMenusForRole('BOOKING_AGENT', { conEspejo: true, pendientesBandeja: n }).find((m) => m.href === HREF);
            expect(sin?.badge).toBeUndefined();
        }
    });

    it('la cifra de un usuario NO se le pega al menú de otro (el ítem base es compartido)', () => {
        getMenusForRole('ORG_ADMIN', { conEspejo: true, pendientesBandeja: 9 });
        const otro = getMenusForRole('ORG_ADMIN', { conEspejo: true }).find((m) => m.href === HREF);
        expect(otro?.badge).toBeUndefined();
    });

    it('no se duplica al llamar varias veces', () => {
        getMenusForRole('ORG_ADMIN', { conEspejo: true });
        getMenusForRole('ORG_ADMIN', { conEspejo: true });
        const menus = getMenusForRole('ORG_ADMIN', { conEspejo: true });
        expect(menus.filter((m) => m.href === HREF)).toHaveLength(1);
    });
});
