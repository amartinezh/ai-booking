import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// jsdom no expone TextEncoder/TextDecoder globalmente (los necesita `jose`
// para firmar/verificar JWT en lib/session.ts y lib/jwt-secret.ts).
if (typeof globalThis.TextEncoder === 'undefined') {
    Object.assign(globalThis, { TextEncoder, TextDecoder });
}
