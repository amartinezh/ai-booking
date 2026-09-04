import { findEpsEnrollmentIssue } from './eps-enrollment';

type PrismaReader = Parameters<typeof findEpsEnrollmentIssue>[0];

function fakeDb(opts: {
    eps?: { id: string; name: string } | null;
    enrolled?: { id: string } | null;
}) {
    return {
        eps: { findFirst: jest.fn().mockResolvedValue(opts.eps ?? null) },
        epsEnrolledPatient: { findFirst: jest.fn().mockResolvedValue(opts.enrolled ?? null) },
    } as unknown as PrismaReader;
}

const BASE_PARAMS = { organizationId: 'org-1', cedula: '123456789' };

describe('findEpsEnrollmentIssue', () => {
    it('no aplica cuando no hay epsId (Particular / pago directo)', async () => {
        const db = fakeDb({});
        const issue = await findEpsEnrollmentIssue(db, { ...BASE_PARAMS, epsId: null });
        expect(issue).toBeNull();
        expect(db.eps.findFirst).not.toHaveBeenCalled();
    });

    it('no aplica cuando epsId es undefined', async () => {
        const db = fakeDb({});
        const issue = await findEpsEnrollmentIssue(db, { ...BASE_PARAMS, epsId: undefined });
        expect(issue).toBeNull();
    });

    it('no aplica cuando la EPS no existe en el tenant (otra validación se encarga)', async () => {
        const db = fakeDb({ eps: null });
        const issue = await findEpsEnrollmentIssue(db, { ...BASE_PARAMS, epsId: 'eps-x' });
        expect(issue).toBeNull();
    });

    it('no aplica cuando la EPS resuelta es "Particular"', async () => {
        const db = fakeDb({ eps: { id: 'eps-particular', name: 'Particular' } });
        const issue = await findEpsEnrollmentIssue(db, { ...BASE_PARAMS, epsId: 'eps-particular' });
        expect(issue).toBeNull();
    });

    it('detecta "Particular" sin importar mayúsculas/espacios', async () => {
        const db = fakeDb({ eps: { id: 'eps-particular', name: '  PARTICULAR  ' } });
        const issue = await findEpsEnrollmentIssue(db, { ...BASE_PARAMS, epsId: 'eps-particular' });
        expect(issue).toBeNull();
    });

    it('no aplica cuando la cédula normalizada queda vacía', async () => {
        const db = fakeDb({ eps: { id: 'eps-1', name: 'Sanitas' } });
        const issue = await findEpsEnrollmentIssue(db, { ...BASE_PARAMS, epsId: 'eps-1', cedula: '---' });
        expect(issue).toBeNull();
        expect(db.epsEnrolledPatient.findFirst).not.toHaveBeenCalled();
    });

    it('no aplica cuando el paciente SÍ está dado de alta y activo', async () => {
        const db = fakeDb({ eps: { id: 'eps-1', name: 'Sanitas' }, enrolled: { id: 'enroll-1' } });
        const issue = await findEpsEnrollmentIssue(db, { ...BASE_PARAMS, epsId: 'eps-1' });
        expect(issue).toBeNull();
    });

    it('devuelve un mensaje de error cuando el paciente NO está dado de alta', async () => {
        const db = fakeDb({ eps: { id: 'eps-1', name: 'Sanitas' }, enrolled: null });
        const issue = await findEpsEnrollmentIssue(db, { ...BASE_PARAMS, epsId: 'eps-1' });
        expect(issue).toContain('123456789');
        expect(issue).toContain('Sanitas');
    });

    it('normaliza la cédula (quita puntos/guiones) antes de buscar y de reportar', async () => {
        const db = fakeDb({ eps: { id: 'eps-1', name: 'Sanitas' }, enrolled: null });
        const issue = await findEpsEnrollmentIssue(db, { ...BASE_PARAMS, epsId: 'eps-1', cedula: '123.456.789-0' });
        expect(db.epsEnrolledPatient.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ cedula: '1234567890' }) }),
        );
        expect(issue).toContain('1234567890');
    });

    it('busca la EPS y la alta dentro del organizationId del tenant (aislamiento multi-tenant)', async () => {
        const db = fakeDb({ eps: { id: 'eps-1', name: 'Sanitas' }, enrolled: { id: 'enroll-1' } });
        await findEpsEnrollmentIssue(db, { organizationId: 'org-42', cedula: '123456789', epsId: 'eps-1' });
        expect(db.eps.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-42', id: 'eps-1' }) }),
        );
        expect(db.epsEnrolledPatient.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-42', isActive: true }) }),
        );
    });
});
