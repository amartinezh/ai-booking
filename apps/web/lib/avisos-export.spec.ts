import { buildSinCelularCsv, sinCelularFileName } from './avisos-export';

describe('buildSinCelularCsv', () => {
    it('arma el encabezado y una fila por paciente', () => {
        const csv = buildSinCelularCsv([
            {
                patientDocument: '1037456123',
                patientName: 'Luz Elena Restrepo',
                appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
            },
        ]);

        const lines = csv.split('\n');
        expect(lines[0]).toBe('documento,nombre,fecha_hora_cita');
        expect(lines[1]).toContain('1037456123');
        expect(lines[1]).toContain('Luz Elena Restrepo');
    });

    it('sin filas, solo trae el encabezado', () => {
        expect(buildSinCelularCsv([])).toBe('documento,nombre,fecha_hora_cita');
    });

    it('un nombre null se exporta como celda vacía, no "null"', () => {
        const csv = buildSinCelularCsv([
            {
                patientDocument: '111',
                patientName: null,
                appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
            },
        ]);

        // La fecha formateada trae comas propias ("jue, 24 de sept, ...") —
        // por eso viene entre comillas: sin esto el CSV tendría más columnas
        // de las que dice el encabezado.
        expect(csv.split('\n')[1]).toBe('111,,"jue, 24 de sept, 07:00 a m"');
    });

    it('un nombre con coma se envuelve en comillas (no rompe las columnas)', () => {
        const csv = buildSinCelularCsv([
            {
                patientDocument: '111',
                patientName: 'Restrepo, Luz Elena',
                appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
            },
        ]);

        expect(csv.split('\n')[1]).toContain('"Restrepo, Luz Elena"');
    });

    it('una comilla doble dentro del nombre se escapa duplicándola', () => {
        const csv = buildSinCelularCsv([
            {
                patientDocument: '111',
                patientName: 'La "Toya" Restrepo',
                appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
            },
        ]);

        expect(csv.split('\n')[1]).toContain('"La ""Toya"" Restrepo"');
    });

    it('la fecha se formatea con el helper canónico (América/Bogotá), no con la TZ del runner', () => {
        const csv = buildSinCelularCsv([
            {
                patientDocument: '111',
                patientName: 'Ana',
                // Medianoche UTC del 24 es 19:00 Bogotá del 23 — si esto usara
                // la fecha cruda de JS sin timeZone, mostraría el día equivocado.
                appointmentAtUtc: new Date('2026-09-24T00:00:00.000Z'),
            },
        ]);

        expect(csv.split('\n')[1]).toContain('23 de sept');
    });

    it('varias filas, en el mismo orden en que llegaron', () => {
        const csv = buildSinCelularCsv([
            {
                patientDocument: '111',
                patientName: 'Ana',
                appointmentAtUtc: new Date('2026-09-24T12:00:00.000Z'),
            },
            {
                patientDocument: '222',
                patientName: 'Beto',
                appointmentAtUtc: new Date('2026-09-25T12:00:00.000Z'),
            },
        ]);

        const lines = csv.split('\n');
        expect(lines).toHaveLength(3);
        expect(lines[1]).toContain('111');
        expect(lines[2]).toContain('222');
    });
});

describe('sinCelularFileName', () => {
    it('incluye el id del lote — dos descargas de avisos distintos no se confunden', () => {
        expect(sinCelularFileName('batch-abc123')).toBe('sin-celular_batch-abc123.csv');
    });
});
