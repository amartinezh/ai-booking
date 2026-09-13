import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// jsdom no expone TextEncoder/TextDecoder globalmente (los necesita `jose`
// para firmar/verificar JWT en lib/session.ts y lib/jwt-secret.ts).
if (typeof globalThis.TextEncoder === 'undefined') {
    Object.assign(globalThis, { TextEncoder, TextDecoder });
}

// El jsdom de este entorno implementa `File`/`Blob` pero no `Blob#arrayBuffer`
// (lo necesita `sniffBinarySignature` en lib/spreadsheet-upload.ts, vía
// `file.slice(0, 8).arrayBuffer()`). Sí funciona en cualquier navegador real
// y en el runtime de Next.js — es un hueco del entorno de test, no del
// código. Se rellena con `FileReader`, que jsdom sí implementa.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function (this: Blob) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el Blob.'));
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.readAsArrayBuffer(this);
        });
    };
}
