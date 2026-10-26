import { CLAVE, validarCambioDeClave, validarClaveAsignada } from './clave';

const base = {
    actual: 'Inicial-Ab12-Cd34',
    nueva: 'MiClaveNueva2026',
    confirmacion: 'MiClaveNueva2026',
    email: 'agendadora.prueba@ejemplo.com',
};

describe('validarCambioDeClave', () => {
    it('una clave nueva válida pasa', () => {
        expect(validarCambioDeClave(base)).toBeNull();
    });

    it.each([
        [{ actual: '' }, 'Escriba su clave actual.'],
        [{ nueva: '', confirmacion: '' }, 'Escriba la clave nueva.'],
        [{ nueva: ' MiClave2026x', confirmacion: ' MiClave2026x' }, 'no puede empezar ni terminar con un espacio'],
        [{ nueva: 'Corta123', confirmacion: 'Corta123' }, `al menos ${CLAVE.MIN} caracteres`],
        [{ nueva: 'SoloLetrasLargas', confirmacion: 'SoloLetrasLargas' }, 'letras y números'],
        [{ nueva: '12345678901234', confirmacion: '12345678901234' }, 'letras y números'],
        [{ nueva: 'Inicial-Ab12-Cd34', confirmacion: 'Inicial-Ab12-Cd34' }, 'distinta de la actual'],
        [{ nueva: 'x-Agendadora.Prueba9-x', confirmacion: 'x-Agendadora.Prueba9-x' }, 'no puede contener su usuario'],
        [{ confirmacion: 'OtraCosa2026xx' }, 'La confirmación no coincide'],
    ])('%o → «%s»', (cambio, mensaje) => {
        expect(validarCambioDeClave({ ...base, ...cambio })).toContain(mensaje);
    });

    it('el tope es de 72 BYTES (lo que mira bcrypt): con tildes se llega antes', () => {
        const ascii72 = 'a1'.repeat(36); // 72 bytes
        expect(validarCambioDeClave({ ...base, nueva: ascii72, confirmacion: ascii72 })).toBeNull();
        const conTildes = 'á1'.repeat(25); // 75 bytes, 50 caracteres
        expect(validarCambioDeClave({ ...base, nueva: conTildes, confirmacion: conTildes })).toContain('demasiado larga');
    });

    it('un usuario corto (menos de 4 letras) no cuenta como «contiene su usuario»', () => {
        const d = { ...base, email: 'ana@x.co', nueva: 'Banana2026xx', confirmacion: 'Banana2026xx' };
        expect(validarCambioDeClave(d)).toBeNull();
    });
});

describe('validarClaveAsignada (la que pone un administrador)', () => {
    it('acepta una clave con letras y números de 10 o más', () => {
        expect(validarClaveAsignada('Hospital2026x', 'ana@clinica.co')).toBeNull();
    });

    it('rechaza vacía y las de fábrica que antes se ponían solas', () => {
        expect(validarClaveAsignada('', 'ana@clinica.co')).toMatch(/Escriba/);
        expect(validarClaveAsignada(undefined, 'ana@clinica.co')).toMatch(/Escriba/);
        expect(validarClaveAsignada('admin123', 'ana@clinica.co')).toMatch(/al menos/);
        expect(validarClaveAsignada('temporal123', 'ana@clinica.co')).toMatch(/fábrica/);
        expect(validarClaveAsignada('Password123', 'ana@clinica.co')).toMatch(/fábrica/);
    });

    it('exige letras y números, sin espacios en los bordes ni el usuario', () => {
        expect(validarClaveAsignada('solamenteletras', 'ana@clinica.co')).toMatch(/letras y números/);
        expect(validarClaveAsignada('12345678901', 'ana@clinica.co')).toMatch(/letras y números/);
        expect(validarClaveAsignada(' Hospital2026', 'ana@clinica.co')).toMatch(/espacio/);
        expect(validarClaveAsignada('agendadora2026', 'agendadora@clinica.co')).toMatch(/usuario/);
        expect(validarClaveAsignada('a1'.repeat(40), 'ana@clinica.co')).toMatch(/larga/);
    });
});

describe('validarCambioDeClave — claves de fábrica', () => {
    it('no deja poner una clave de fábrica como nueva', () => {
        expect(
            validarCambioDeClave({ actual: 'x', nueva: 'temporal123', confirmacion: 'temporal123', email: 'ana@c.co' }),
        ).toMatch(/fábrica/);
    });
});
