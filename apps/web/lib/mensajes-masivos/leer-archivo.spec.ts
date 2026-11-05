import { TextDecoder as NodeTextDecoder } from 'util';
import { decodificarTexto } from './leer-archivo';

// jsdom no trae TextDecoder con Windows-1252: se usa el de Node.
(global as unknown as { TextDecoder: typeof NodeTextDecoder }).TextDecoder = NodeTextDecoder;

describe('decodificarTexto', () => {
    it('lee UTF-8 tal cual', () => {
        const bytes = new TextEncoder().encode('nombre;teléfono\nJosé Núñez;3001234567');
        expect(decodificarTexto(bytes.buffer as ArrayBuffer)).toBe('nombre;teléfono\nJosé Núñez;3001234567');
    });

    it('un CSV guardado por Excel en Windows (Windows-1252) no deja caracteres rotos', () => {
        // «José Núñez» en Windows-1252: é = 0xE9, ú = 0xFA, ñ = 0xF1.
        const bytes = new Uint8Array([0x4a, 0x6f, 0x73, 0xe9, 0x20, 0x4e, 0xfa, 0xf1, 0x65, 0x7a]);
        expect(decodificarTexto(bytes.buffer)).toBe('José Núñez');
    });
});
