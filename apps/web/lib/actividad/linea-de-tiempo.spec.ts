/** @jest-environment node */
import {
    codificarCursor,
    decodificarCursor,
    mezclarPagina,
    vaAntes,
    type EventoDeActividad,
} from './linea-de-tiempo';

function ev(clave: string, at: string): EventoDeActividad {
    return {
        clave,
        at,
        categoria: 'INGRESOS',
        accion: 'USER_LOGIN',
        titulo: 'Ingresó al panel',
        detalle: null,
        aviso: false,
        organizationId: 'org-1',
        actor: { userId: 'u1', email: null, role: null },
        ip: null,
        navegador: null,
        extra: null,
    };
}

describe('vaAntes', () => {
    it('lo más nuevo va antes; a igual hora, la clave mayor', () => {
        expect(vaAntes(ev('a', '2026-10-26T10:00:00.000Z'), ev('b', '2026-10-26T09:00:00.000Z'))).toBe(true);
        expect(vaAntes(ev('a', '2026-10-26T09:00:00.000Z'), ev('b', '2026-10-26T10:00:00.000Z'))).toBe(false);
        expect(vaAntes(ev('log:b', '2026-10-26T10:00:00.000Z'), ev('log:a', '2026-10-26T10:00:00.000Z'))).toBe(true);
    });
});

describe('mezclarPagina', () => {
    const log = [ev('log:3', '2026-10-26T12:00:00.000Z'), ev('log:1', '2026-10-26T08:00:00.000Z')];
    const rastreo = [ev('rastreo:2', '2026-10-26T10:00:00.000Z'), ev('rastreo:0', '2026-10-25T23:00:00.000Z')];

    it('mezcla las fuentes de lo más nuevo a lo más viejo', () => {
        const r = mezclarPagina([log, rastreo], 10, null);
        expect(r.eventos.map((e) => e.clave)).toEqual(['log:3', 'rastreo:2', 'log:1', 'rastreo:0']);
        expect(r.siguiente).toBeNull();
    });

    it('corta la página y deja el cursor en el último mostrado', () => {
        const r = mezclarPagina([log, rastreo], 2, null);
        expect(r.eventos.map((e) => e.clave)).toEqual(['log:3', 'rastreo:2']);
        expect(r.siguiente).toEqual({ at: '2026-10-26T10:00:00.000Z', clave: 'rastreo:2' });
    });

    it('la página siguiente no repite ni salta eventos, aunque compartan el milisegundo', () => {
        const mismaHora = '2026-10-26T10:00:00.000Z';
        const fuenteA = [ev('a:2', mismaHora), ev('a:1', mismaHora)];
        const fuenteB = [ev('b:9', mismaHora)];
        const p1 = mezclarPagina([fuenteA, fuenteB], 2, null);
        expect(p1.eventos.map((e) => e.clave)).toEqual(['b:9', 'a:2']);
        // Las fuentes vuelven a traer todo lo que tenga hora <= la del cursor.
        const p2 = mezclarPagina([fuenteA, fuenteB], 2, p1.siguiente);
        expect(p2.eventos.map((e) => e.clave)).toEqual(['a:1']);
        expect(p2.siguiente).toBeNull();
    });

    it('no repite un evento que dos listas traigan', () => {
        const r = mezclarPagina([[ev('x:1', '2026-10-26T10:00:00.000Z')], [ev('x:1', '2026-10-26T10:00:00.000Z')]], 10, null);
        expect(r.eventos).toHaveLength(1);
    });
});

describe('cursor', () => {
    it('ida y vuelta', () => {
        const c = { at: '2026-10-26T10:00:00.000Z', clave: 'log:abc' };
        expect(decodificarCursor(codificarCursor(c))).toEqual(c);
    });

    it('lo que no es un cursor se ignora', () => {
        expect(decodificarCursor('basura')).toBeNull();
        expect(decodificarCursor(undefined)).toBeNull();
        expect(decodificarCursor(Buffer.from(JSON.stringify({ at: 'no-fecha', clave: 'x' })).toString('base64url'))).toBeNull();
        expect(decodificarCursor('a'.repeat(600))).toBeNull();
    });
});
