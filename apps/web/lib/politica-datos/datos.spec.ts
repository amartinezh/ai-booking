import {
    CAMPOS_POLITICA,
    camposCambiados,
    datosParaEditar,
    datosPublicables,
    etiquetaCampo,
    fechaEnLetras,
    rutaPoliticaDatos,
    validarDatosPolitica,
} from './datos';

const HOY = '2026-11-20';
const COMPLETOS = {
    razonSocial: 'E.S.E. Hospital San Vicente de Paúl de Anserma',
    nit: '900.000.000-0',
    municipio: 'Anserma, Caldas',
    direccion: 'Carrera 5 Calle 1 Bis',
    telefono: '(606) 853 8860 · 314 679 3010',
    correo: 'siau@hsvpanserma.gov.co',
    area: 'Oficina de Atención al Usuario (SIAU)',
    horario: 'Martes a viernes de 7:00 a. m. a 4:00 p. m.',
    vigenteDesde: '2026-12-01',
};

describe('política de datos — los datos del responsable', () => {
    it('acepta los datos completos y limpia los espacios', () => {
        const r = validarDatosPolitica({ ...COMPLETOS, razonSocial: `  ${COMPLETOS.razonSocial}   ` }, HOY);
        expect(r).toEqual({ ok: true, datos: COMPLETOS });
    });

    it('el NIT y el horario son opcionales: vacíos quedan en null', () => {
        const r = validarDatosPolitica({ ...COMPLETOS, nit: ' ', horario: undefined }, HOY);
        expect(r).toMatchObject({ ok: true, datos: { nit: null, horario: null } });
    });

    it.each(['razonSocial', 'municipio', 'direccion', 'telefono', 'correo', 'area', 'vigenteDesde'] as const)(
        'sin %s no se guarda y dice qué campo falta',
        (campo) => {
            const r = validarDatosPolitica({ ...COMPLETOS, [campo]: '' }, HOY);
            expect(r).toMatchObject({ ok: false, campo });
        },
    );

    it('nada o algo que no es un objeto: falta el primero', () => {
        expect(validarDatosPolitica(null, HOY)).toMatchObject({ ok: false, campo: 'razonSocial' });
        expect(validarDatosPolitica('hola', HOY)).toMatchObject({ ok: false, campo: 'razonSocial' });
    });

    it('respeta el largo máximo de cada campo', () => {
        const r = validarDatosPolitica({ ...COMPLETOS, area: 'x'.repeat(161) }, HOY);
        expect(r).toMatchObject({ ok: false, campo: 'area', error: expect.stringMatching(/160/) });
    });

    it('un NIT con letras o un correo mal escrito no pasan', () => {
        expect(validarDatosPolitica({ ...COMPLETOS, nit: '890ABC' }, HOY)).toMatchObject({ ok: false, campo: 'nit' });
        expect(validarDatosPolitica({ ...COMPLETOS, correo: 'siau@hospital' }, HOY)).toMatchObject({
            ok: false,
            campo: 'correo',
        });
    });

    it.each(['2026-02-30', '2026-13-01', '2026-00-10', '01/12/2026', '2011-01-01', '2027-11-21'])(
        'la fecha de vigencia %s no es válida',
        (vigenteDesde) => {
            expect(validarDatosPolitica({ ...COMPLETOS, vigenteDesde }, HOY)).toMatchObject({
                ok: false,
                campo: 'vigenteDesde',
            });
        },
    );

    it('la vigencia puede ser hasta un año adelante y desde la Ley 1581', () => {
        expect(validarDatosPolitica({ ...COMPLETOS, vigenteDesde: '2027-11-20' }, HOY).ok).toBe(true);
        expect(validarDatosPolitica({ ...COMPLETOS, vigenteDesde: '2012-10-17' }, HOY).ok).toBe(true);
        expect(validarDatosPolitica({ ...COMPLETOS, vigenteDesde: '2028-02-29' }, '2027-03-01').ok).toBe(true);
    });

    it('lo publicado no se despublica con el tiempo, pero lo incompleto no se publica', () => {
        expect(datosPublicables({ ...COMPLETOS, vigenteDesde: '2026-12-01' })).toEqual(COMPLETOS);
        expect(datosPublicables({ ...COMPLETOS, correo: '' })).toBeNull();
        expect(datosPublicables(null)).toBeNull();
    });

    it('para el formulario: lo guardado campo por campo, o vacío', () => {
        expect(datosParaEditar(COMPLETOS)).toEqual(COMPLETOS);
        const vacio = datosParaEditar(null);
        expect(Object.keys(vacio)).toEqual(CAMPOS_POLITICA.map((d) => d.campo));
        expect(Object.values(vacio).every((v) => v === '')).toBe(true);
        expect(datosParaEditar({ nit: 123 }).nit).toBe('');
    });

    it('dice qué campos cambiaron, con su etiqueta', () => {
        const nuevo = { ...COMPLETOS, correo: 'datos@hsvpanserma.gov.co', nit: null };
        expect(camposCambiados(COMPLETOS, nuevo)).toEqual([etiquetaCampo('nit'), etiquetaCampo('correo')]);
        expect(camposCambiados(COMPLETOS, COMPLETOS)).toEqual([]);
        expect(camposCambiados(null, COMPLETOS)).toHaveLength(CAMPOS_POLITICA.length);
    });

    it('la fecha en letras, sin pasar por la zona horaria', () => {
        expect(fechaEnLetras('2026-12-01')).toBe('1 de diciembre de 2026');
        expect(fechaEnLetras('2027-01-31')).toBe('31 de enero de 2027');
        expect(fechaEnLetras('mañana')).toBe('mañana');
    });

    it('la ruta pública', () => {
        expect(rutaPoliticaDatos('97f18182-d0d9-4a3b-9eb6-4fbc031b917c')).toBe(
            '/politica-de-datos/97f18182-d0d9-4a3b-9eb6-4fbc031b917c',
        );
        expect(etiquetaCampo('nada' as never)).toBe('nada');
    });
});
