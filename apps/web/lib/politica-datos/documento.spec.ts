import { documentoPolitica, TITULO_POLITICA, type Bloque, type DocumentoPolitica } from './documento';
import type { DatosPolitica } from './datos';

const DATOS: DatosPolitica = {
    razonSocial: 'E.S.E. Hospital San Vicente de Paúl de Anserma',
    nit: '900.000.000-0',
    municipio: 'Anserma, Caldas',
    direccion: 'Carrera 5 Calle 1 Bis',
    telefono: '(606) 853 8860',
    correo: 'siau@hsvpanserma.gov.co',
    area: 'Oficina de Atención al Usuario (SIAU)',
    horario: 'Martes a viernes de 7:00 a. m. a 4:00 p. m.',
    vigenteDesde: '2026-12-01',
};

const textoDe = (b: Bloque): string => {
    switch (b.tipo) {
        case 'parrafo':
        case 'nota':
            return b.texto;
        case 'lista':
        case 'numerada':
            return b.items.join('\n');
        case 'definiciones':
            return b.items.map((i) => `${i.termino}: ${i.texto}`).join('\n');
        case 'tabla':
            return [b.columnas.join(' | '), ...b.filas.map((f) => f.join(' | '))].join('\n');
    }
};
const todo = (doc: DocumentoPolitica) =>
    [doc.titulo, ...doc.resumen, ...doc.secciones.flatMap((s) => [s.titulo, ...s.bloques.map(textoDe)])].join('\n');

describe('política de datos — el texto', () => {
    const doc = documentoPolitica({ datos: DATOS, version: '2', asistente: 'Vicente' });
    const texto = todo(doc);
    const seccion = (id: string) => {
        const s = doc.secciones.find((x) => x.id === id);
        if (!s) throw new Error(`falta la sección ${id}`);
        return s.bloques.map(textoDe).join('\n');
    };

    it('encabezado: título, responsable, versión y vigencia en letras', () => {
        expect(doc).toMatchObject({
            titulo: TITULO_POLITICA,
            responsable: DATOS.razonSocial,
            version: '2',
            vigenteDesde: '1 de diciembre de 2026',
        });
    });

    it('cada sección tiene un id único y contenido', () => {
        const ids = doc.secciones.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const s of doc.secciones) expect(s.bloques.length).toBeGreaterThan(0);
    });

    it('Decreto 1377, art. 13, n.º 1: identifica al responsable con domicilio, dirección, correo y teléfono', () => {
        const r = seccion('responsable');
        for (const v of [DATOS.razonSocial, DATOS.nit!, DATOS.municipio, DATOS.direccion, DATOS.correo, DATOS.telefono]) {
            expect(r).toContain(v);
        }
        expect(r).toMatch(/encargada del tratamiento/);
    });

    it('sin NIT ni horario, no aparecen esas filas', () => {
        const sin = todo(documentoPolitica({ datos: { ...DATOS, nit: null, horario: null }, version: '1', asistente: 'X' }));
        expect(sin).not.toMatch(/^NIT:/m);
        expect(sin).not.toMatch(/Horario de atención:/);
        expect(sin).toContain(`${DATOS.direccion}, ${DATOS.municipio}`);
    });

    it('n.º 2 y 3: tratamiento, finalidades y derechos del art. 8', () => {
        expect(seccion('finalidades')).toMatch(/Agendar, confirmar, cambiar, cancelar/);
        expect(seccion('finalidades')).toMatch(/no vende/);
        const d = seccion('derechos');
        for (const derecho of [/Conocer, actualizar y corregir/, /prueba de la autorización/, /Ser informado/, /Superintendencia/, /Retirar su autorización/, /gratis/]) {
            expect(d).toMatch(derecho);
        }
    });

    it('n.º 4 y 5: el área que atiende y el procedimiento con los plazos de ley', () => {
        expect(seccion('ejercer')).toContain(DATOS.area);
        expect(seccion('ejercer')).toContain(DATOS.horario!);
        const p = seccion('procedimiento');
        for (const plazo of [/diez \(10\) días hábiles/, /cinco \(5\) días hábiles más/, /dos \(2\) meses/, /quince \(15\) días hábiles/, /ocho \(8\) días hábiles más/, /reclamo en trámite/]) {
            expect(p).toMatch(plazo);
        }
        expect(p).toMatch(/art\. 16/);
    });

    it('n.º 6: vigencia de la política y de las bases de datos', () => {
        expect(seccion('vigencia')).toMatch(/versión 2, rige desde el 1 de diciembre de 2026/);
        expect(seccion('vigencia')).toMatch(/bases de datos estarán vigentes/);
        expect(seccion('conservacion')).toMatch(/180 días/);
        expect(seccion('conservacion')).toMatch(/15 años/);
    });

    it('datos sensibles: facultativo y sin condicionar la atención (Decreto 1377, art. 6)', () => {
        const s = seccion('sensibles');
        expect(s).toMatch(/no está obligado\(a\) a autorizar/);
        expect(s).toMatch(/ninguna atención depende/);
    });

    it('menores, autorización, IA, proveedores y supresión', () => {
        expect(seccion('menores')).toMatch(/interés superior/);
        expect(seccion('autorizacion')).toMatch(/Retiro mi autorización/);
        expect(seccion('autorizacion')).toMatch(/urgencia médica/);
        expect(seccion('inteligencia-artificial')).toMatch(/No hace diagnósticos/);
        expect(seccion('compartir')).toMatch(/fuera de Colombia/);
        expect(seccion('supresion')).toMatch(/deber legal o contractual/);
    });

    it('seguridad: toma la base de Mi Colombia Digital sin eximirse de responsabilidad', () => {
        const s = seccion('seguridad');
        expect(s).toMatch(/Copias de seguridad/);
        expect(s).toMatch(/Superintendencia de Industria y Comercio/);
        expect(texto).not.toMatch(/no nos hacemos responsables/i);
    });

    it('nombra al asistente y resume en «En pocas palabras»', () => {
        expect(texto).toMatch(/asistente virtual Vicente/);
        expect(doc.resumen).toHaveLength(5);
        expect(doc.resumen.join(' ')).toContain(DATOS.correo);
    });
});
