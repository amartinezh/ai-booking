import { citaFueraDeAlcance } from './alcance-agente';

// El alcance de un BOOKING_AGENT: la EPS y el médico que tiene asignados. Es la
// misma regla con que el panel le LISTA las citas (`app/dashboard/page.tsx`) y el
// rastreo se las acota (`alcanceDeCitas`): lo que no ve, tampoco lo puede tocar.
describe('citaFueraDeAlcance', () => {
    const cita = (epsId: string | null = 'eps-1', doctorId: string | null = 'doc-1') => ({ epsId, doctorId });

    describe('sin alcance acotado (global): nada queda fuera', () => {
        it.each([
            ['sin perfil de agente', null],
            ['perfil sin EPS ni médico', { epsId: null, doctorId: null }],
            ['campos vacíos (el panel los trata como sin asignar)', { epsId: '', doctorId: '' }],
        ])('%s', (_n, alcance) => {
            expect(citaFueraDeAlcance(alcance, cita())).toBe(false);
            expect(citaFueraDeAlcance(alcance, cita(null, null))).toBe(false);
        });

        it('sin perfil se trata igual que un perfil vacío (undefined no acota)', () => {
            expect(citaFueraDeAlcance(undefined, cita())).toBe(false);
        });
    });

    describe('con EPS asignada', () => {
        const alcance = { epsId: 'eps-1', doctorId: null };

        it('una cita de esa EPS está dentro', () => {
            expect(citaFueraDeAlcance(alcance, cita('eps-1', 'cualquiera'))).toBe(false);
        });

        it('una cita de OTRA EPS está fuera', () => {
            expect(citaFueraDeAlcance(alcance, cita('eps-2'))).toBe(true);
        });

        it('una cita SIN EPS está fuera: el panel no se la lista (filtra por epsId igual)', () => {
            expect(citaFueraDeAlcance(alcance, cita(null))).toBe(true);
        });
    });

    describe('con médico asignado', () => {
        const alcance = { epsId: null, doctorId: 'doc-1' };

        it('una cita de ese médico está dentro, sea cual sea su EPS', () => {
            expect(citaFueraDeAlcance(alcance, cita('cualquiera', 'doc-1'))).toBe(false);
            expect(citaFueraDeAlcance(alcance, cita(null, 'doc-1'))).toBe(false);
        });

        it('una cita de OTRO médico está fuera', () => {
            expect(citaFueraDeAlcance(alcance, cita('eps-1', 'doc-2'))).toBe(true);
        });
    });

    describe('con EPS y médico asignados: hay que cumplir LAS DOS', () => {
        const alcance = { epsId: 'eps-1', doctorId: 'doc-1' };

        it('cumple las dos: dentro', () => {
            expect(citaFueraDeAlcance(alcance, cita('eps-1', 'doc-1'))).toBe(false);
        });

        it.each([
            ['solo la EPS', cita('eps-1', 'doc-2')],
            ['solo el médico', cita('eps-2', 'doc-1')],
            ['ninguna', cita('eps-2', 'doc-2')],
        ])('cumple %s: fuera', (_n, c) => {
            expect(citaFueraDeAlcance(alcance, c)).toBe(true);
        });
    });

    it('🔒 falla CERRADO: si de la cita no se sabe el médico o la EPS, con alcance acotado se rechaza', () => {
        // Una lectura que olvidó traer el campo no puede abrirle la puerta a nadie.
        expect(citaFueraDeAlcance({ epsId: 'eps-1', doctorId: null }, { epsId: undefined as never, doctorId: 'x' })).toBe(true);
        expect(citaFueraDeAlcance({ epsId: null, doctorId: 'doc-1' }, { epsId: 'x', doctorId: undefined as never })).toBe(true);
    });
});
