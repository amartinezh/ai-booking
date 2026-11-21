import { alertasLleganPorWhatsapp, validarTelefonoSoporte } from './telefono-soporte';

describe('validarTelefonoSoporte (docs/PLAN_NAVEGACION.md, N9)', () => {
    it.each([
        ['300 123 4567'],
        ['3001234567'],
        ['+57 300 123 4567'],
        ['57 3001234567'],
        ['(300) 123-4567'],
    ])('el celular %s se guarda con indicativo: la alerta de emergencia necesita el 57', (entrada) => {
        expect(validarTelefonoSoporte(entrada)).toEqual({ ok: true, valor: '+57 300 123 4567', alertasPorWhatsapp: true });
    });

    it.each(['(606) 859 1010', '6068591010', '8591010', '+1 415 555 0100'])(
        '%s se acepta tal cual, pero dice que la alerta por WhatsApp no llega',
        (entrada) => {
            expect(validarTelefonoSoporte(entrada)).toEqual({ ok: true, valor: entrada, alertasPorWhatsapp: false });
        },
    );

    it('junta los espacios de más', () => {
        expect(validarTelefonoSoporte('  (606)   859  1010 ')).toMatchObject({ ok: true, valor: '(606) 859 1010' });
    });

    it.each(['', '   ', null, undefined, 3001234567])('%p no se puede guardar: no se deja vacío', (entrada) => {
        expect(validarTelefonoSoporte(entrada)).toEqual({ ok: false, error: expect.stringContaining('Escriba el teléfono') });
    });

    it.each(['llamar al 300', '300-123-4567 ext 4', '+57+3001234567', '1'.repeat(31)])('%s no es un teléfono', (entrada) => {
        expect(validarTelefonoSoporte(entrada).ok).toBe(false);
    });

    it.each(['123456', '1234567890123456'])('%s tiene un número de dígitos que no sirve', (entrada) => {
        expect(validarTelefonoSoporte(entrada)).toEqual({ ok: false, error: expect.stringContaining('entre 7 y 15') });
    });
});

describe('alertasLleganPorWhatsapp', () => {
    it.each(['+57 300 123 4567', '573001234567'])('%s: sí', (v) => expect(alertasLleganPorWhatsapp(v)).toBe(true));
    it.each(['3001234567', '(606) 859 1010', '', null, undefined])('%p: no', (v) => expect(alertasLleganPorWhatsapp(v)).toBe(false));
});
