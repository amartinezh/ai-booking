import { diaSiguiente, filtrosATexto, leerFiltros } from './filtros';

const ORG = '3f1c2b9a-1111-4a2b-9c3d-123456789abc';
const USR = '8e7d6c5b-2222-4b3c-8d4e-abcdefabcdef';

describe('leerFiltros', () => {
    it('sin nada: todas las clínicas, sin fechas', () => {
        const f = leerFiltros({});
        expect(f.clinica).toEqual({ tipo: 'TODAS' });
        expect(f).toMatchObject({ usuarioId: null, categoria: null, desdeUtc: null, hastaUtc: null });
    });

    it('clínica, plataforma y basura', () => {
        expect(leerFiltros({ org: ORG }).clinica).toEqual({ tipo: 'CLINICA', id: ORG });
        expect(leerFiltros({ org: 'plataforma' }).clinica).toEqual({ tipo: 'PLATAFORMA' });
        expect(leerFiltros({ org: "' OR 1=1 --" }).clinica).toEqual({ tipo: 'TODAS' });
        expect(leerFiltros({ usuario: 'x' }).usuarioId).toBeNull();
        expect(leerFiltros({ usuario: USR }).usuarioId).toBe(USR);
        expect(leerFiltros({ cat: 'NO_EXISTE' }).categoria).toBeNull();
        expect(leerFiltros({ cat: 'INGRESOS' }).categoria).toBe('INGRESOS');
    });

    it('las fechas son días de Bogotá y «hasta» incluye todo el día', () => {
        const f = leerFiltros({ desde: '2026-10-20', hasta: '2026-10-26' });
        expect(f.desdeUtc?.toISOString()).toBe('2026-10-20T05:00:00.000Z');
        expect(f.hastaUtc?.toISOString()).toBe('2026-10-27T05:00:00.000Z');
        expect(f.desde).toBe('2026-10-20');
        expect(f.hasta).toBe('2026-10-26');
    });

    it('un rango al revés ignora el «hasta»; una fecha inválida se ignora', () => {
        const f = leerFiltros({ desde: '2026-10-26', hasta: '2026-10-20' });
        expect(f.hastaUtc).toBeNull();
        expect(f.hasta).toBeNull();
        expect(leerFiltros({ desde: '2026-02-31' }).desdeUtc).toBeNull();
        expect(leerFiltros({ hasta: 'ayer' }).hastaUtc).toBeNull();
    });

    it('vuelta a la dirección sin los vacíos', () => {
        expect(filtrosATexto(leerFiltros({ org: ORG, usuario: USR, cat: 'CUENTAS', desde: '2026-10-01' }))).toEqual({
            org: ORG,
            usuario: USR,
            cat: 'CUENTAS',
            desde: '2026-10-01',
        });
        expect(filtrosATexto(leerFiltros({ org: 'plataforma' }))).toEqual({ org: 'plataforma' });
    });

    it('diaSiguiente cruza meses y años', () => {
        expect(diaSiguiente('2026-10-31')).toBe('2026-11-01');
        expect(diaSiguiente('2026-12-31')).toBe('2027-01-01');
    });
});
