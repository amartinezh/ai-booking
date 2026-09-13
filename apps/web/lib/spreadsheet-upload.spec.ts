import { sniffBinarySignature, xlsxToCsv } from './spreadsheet-upload';

// Nota: `PadronUploader.tsx` no tenía spec antes de esta extracción — este
// archivo es la primera cobertura real de esta lógica, no una migración de
// tests existentes.

describe('sniffBinarySignature', () => {
    it('reconoce la firma ZIP/xlsx (PK\\x03\\x04)', async () => {
        const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])], 'a.xlsx');
        const result = await sniffBinarySignature(file);
        expect(result).toMatchObject({ kind: 'zip' });
    });

    it('reconoce un .xls antiguo (firma OLE)', async () => {
        const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])], 'a.xls');
        const result = await sniffBinarySignature(file);
        expect(result).toMatchObject({ kind: 'ole' });
    });

    it('reconoce un PDF', async () => {
        const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0])], 'a.pdf');
        const result = await sniffBinarySignature(file);
        expect(result).toMatchObject({ kind: 'pdf' });
    });

    it('devuelve null para texto plano (CSV real)', async () => {
        const file = new File(['documento,telefono\n123,3001234567'], 'a.csv', {
            type: 'text/csv',
        });
        const result = await sniffBinarySignature(file);
        expect(result).toBeNull();
    });
});

describe('xlsxToCsv', () => {
    it('convierte la primera hoja con datos a CSV', async () => {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.aoa_to_sheet([
            ['documento', 'telefono'],
            ['12345678', '3001234567'],
        ]);
        const wb = XLSX.utils.book_new();
        // Una hoja vacía antes de la que sí tiene datos — debe saltarla.
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Vacía');
        XLSX.utils.book_append_sheet(wb, ws, 'Datos');
        const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

        const csv = await xlsxToCsv(buffer);

        expect(csv).toBe('documento,telefono\n12345678,3001234567');
    });

    it('devuelve null cuando ninguna hoja tiene datos', async () => {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Vacía');
        const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

        const csv = await xlsxToCsv(buffer);

        expect(csv).toBeNull();
    });
});
