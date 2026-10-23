import { SIN_FILTROS, filtrarMedicos, hayFiltros, type FiltrosMedicos } from './buscar';

const medico = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    fullName: 'YULIETH ANDREA RIOS AGUIRRE',
    cedula: '1002900070',
    medicalLicense: null,
    phone: null,
    isActive: true,
    whatsappBookingEnabled: false,
    service: { name: 'Consulta ambulatoria de medicina general' },
    user: { email: 'yulieth@hsvp.gov.co' },
    ...over,
});

const MEDICOS = [
    medico('yulieth'),
    medico('adrian', {
        fullName: 'ADRIAN CAMILO SALAZAR SANCHEZ',
        cedula: '1193031152',
        whatsappBookingEnabled: true,
        phone: '300 123 4567',
        user: { email: 'adrian@hsvp.gov.co' },
    }),
    medico('hipertension', {
        fullName: 'Programa de Hipertensión',
        cedula: '77123456789-077',
        whatsappBookingEnabled: true,
        service: { name: 'Consulta ambularoria control hipertensos' },
        user: { email: 'hta@hsvp.gov.co' },
    }),
    medico('fabio', {
        fullName: 'FABIO MARTINEZ CASTAÑO',
        cedula: '9998757316',
        isActive: false,
        medicalLicense: 'TP-55443',
        user: { email: 'fabio@hsvp.gov.co' },
    }),
];
const CODIGOS = { yulieth: 'RU69', adrian: 'MD09' };

const buscar = (f: Partial<FiltrosMedicos>) =>
    filtrarMedicos(MEDICOS, { ...SIN_FILTROS, ...f }, CODIGOS).map((m) => m.id);

describe('filtrarMedicos — buscar por lo que sea', () => {
    it('sin filtros, todos y en el mismo orden', () => {
        expect(buscar({})).toEqual(['yulieth', 'adrian', 'hipertension', 'fabio']);
    });

    it.each([
        ['yulieth', ['yulieth']],
        ['YULIETH rios', ['yulieth']], // varias palabras: todas
        ['castano', ['fabio']], // sin tilde encuentra «CASTAÑO»
        ['hipertensión', ['hipertension']], // con tilde también
        ['1193031152', ['adrian']], // cédula
        ['77123456789077', ['hipertension']], // cédula sin guion
        ['3001234567', ['adrian']], // teléfono sin espacios
        ['ru69', ['yulieth']], // código del hospital
        ['tp-55443', ['fabio']], // licencia
        ['adrian@hsvp', ['adrian']], // correo
        ['medicina general', ['yulieth', 'adrian', 'fabio']], // servicio
        ['control', ['hipertension']],
        ['   ', ['yulieth', 'adrian', 'hipertension', 'fabio']], // solo espacios = sin texto
        ['zzz', []],
    ])('«%s» → %j', (texto, esperado) => {
        expect(buscar({ texto })).toEqual(esperado);
    });

    it('WhatsApp ON / OFF', () => {
        expect(buscar({ whatsapp: 'on' })).toEqual(['adrian', 'hipertension']);
        expect(buscar({ whatsapp: 'off' })).toEqual(['yulieth', 'fabio']);
    });

    it('activos / inactivos', () => {
        expect(buscar({ estado: 'inactivos' })).toEqual(['fabio']);
        expect(buscar({ estado: 'activos' })).toEqual(['yulieth', 'adrian', 'hipertension']);
    });

    it('todo junto: texto + WhatsApp + estado', () => {
        expect(buscar({ texto: 'medicina', whatsapp: 'off', estado: 'activos' })).toEqual(['yulieth']);
    });

    it('hayFiltros', () => {
        expect(hayFiltros(SIN_FILTROS)).toBe(false);
        expect(hayFiltros({ ...SIN_FILTROS, texto: '  ' })).toBe(false);
        expect(hayFiltros({ ...SIN_FILTROS, whatsapp: 'on' })).toBe(true);
    });
});
