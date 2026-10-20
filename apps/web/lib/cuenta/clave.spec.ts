import { CLAVE, validarCambioDeClave } from './clave';

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
