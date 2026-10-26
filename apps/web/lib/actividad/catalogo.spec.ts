import {
    ACCIONES_DE_LA_BITACORA,
    ACCIONES_SIN_USUARIO,
    CATEGORIAS,
    ETIQUETA_CATEGORIA,
    accionesDeCategorias,
    describirCita,
    describirNavegador,
    enmascarar,
    esCategoria,
    etiquetaRol,
    leerAccionDeLaBitacora,
    listarCambios,
    recortar,
} from './catalogo';

describe('catálogo de actividad', () => {
    it('cada categoría tiene etiqueta e ícono', () => {
        for (const c of CATEGORIAS) expect(ETIQUETA_CATEGORIA[c].etiqueta).toBeTruthy();
    });

    it('las acciones sin usuario están en el catálogo (si no, saldrían como «Otras acciones»)', () => {
        for (const a of ACCIONES_SIN_USUARIO) expect(ACCIONES_DE_LA_BITACORA[a]).toBeDefined();
    });

    it('lee una acción conocida y una desconocida', () => {
        expect(leerAccionDeLaBitacora('USER_LOGIN', 'Ingreso de usuario (ORG_ADMIN)')).toEqual({
            categoria: 'INGRESOS',
            titulo: 'Ingresó al panel',
            aviso: false,
            detalle: null,
        });
        expect(leerAccionDeLaBitacora('LOGIN_FAILED', 'x').aviso).toBe(true);
        // El mensaje descriptivo sale como detalle solo donde se marcó.
        expect(leerAccionDeLaBitacora('MASS_NOTICE_SENT', 'Lote 1: 3 enviados').detalle).toBe('Lote 1: 3 enviados');
        expect(leerAccionDeLaBitacora('ALGO_NUEVO', 'Hizo algo')).toEqual({
            categoria: 'OTROS',
            titulo: 'Hizo algo',
            aviso: false,
            detalle: null,
        });
    });

    it('acciones de una categoría', () => {
        const ingresos = accionesDeCategorias(new Set(['INGRESOS'] as const));
        expect(ingresos.sort()).toEqual(['USER_LOGIN', 'USER_LOGOUT']);
        expect(accionesDeCategorias(new Set(['SEGURIDAD'] as const))).toContain('LOGIN_FAILED');
    });

    it('esCategoria', () => {
        expect(esCategoria('INGRESOS')).toBe(true);
        expect(esCategoria('ingresos')).toBe(false);
        expect(esCategoria(undefined)).toBe(false);
    });

    it('enmascara documentos y teléfonos', () => {
        expect(enmascarar('1053812345')).toBe('••••2345');
        expect(enmascarar('123')).toBe('••••');
        expect(enmascarar(null)).toBe('');
    });

    it('recorta textos largos', () => {
        expect(recortar('  hola   mundo ')).toBe('hola mundo');
        expect(recortar('x'.repeat(300), 10)).toHaveLength(10);
    });

    it('describe el navegador', () => {
        expect(
            describirNavegador(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            ),
        ).toBe('Chrome en Windows');
        expect(
            describirNavegador(
                'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            ),
        ).toBe('Safari en iPhone');
        expect(describirNavegador('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130')).toBe(
            'Edge en Windows',
        );
        expect(describirNavegador('curl/8.4.0')).toBe('Programa (no es un navegador)');
        expect(describirNavegador(null)).toBe('');
    });

    it('etiqueta de rol', () => {
        expect(etiquetaRol('BOOKING_AGENT')).toBe('Agente de reservas');
        expect(etiquetaRol('RARO')).toBe('RARO');
        expect(etiquetaRol(null)).toBe('');
    });
});

describe('textos de las huellas (2026-10-27)', () => {
    it('describe una cita en hora de Bogotá y sin datos del paciente', () => {
        expect(
            describirCita({ inicio: new Date('2026-10-28T13:20:00Z'), servicio: 'Medicina general', medico: 'Dra. Pérez' }),
        ).toMatch(/^Medicina general · Dra\. Pérez · 28\/10\/2026 08:20/);
        expect(describirCita({ inicio: null, servicio: null, medico: 'Dra. Pérez' })).toBe('Dra. Pérez');
    });

    it('lista lo que cambió; los campos sensibles solo dicen que cambiaron', () => {
        const etiquetas = { nombre: 'nombre', telefono: 'teléfono', activo: 'activo', nacimiento: 'nacimiento' };
        expect(
            listarCambios(
                { nombre: 'Ana', telefono: '300', activo: true, nacimiento: new Date('1990-01-01') },
                { nombre: 'Ana María', telefono: '310', activo: false, nacimiento: new Date('1990-01-01') },
                etiquetas,
                ['telefono'],
            ),
        ).toEqual(['nombre: Ana → Ana María', 'teléfono cambió', 'activo: sí → no']);
    });

    it('vacío y null cuentan igual; un campo que no viene no cuenta', () => {
        expect(listarCambios({ a: null, b: 'x' }, { a: '' }, { a: 'A', b: 'B' })).toEqual([]);
        expect(listarCambios({ a: null }, { a: 'nuevo' }, { a: 'A' })).toEqual(['A: — → nuevo']);
    });

    it('las categorías nuevas existen y cada acción nueva tiene la suya', () => {
        expect(esCategoria('CATALOGOS')).toBe(true);
        for (const a of ['DOCTOR_UPDATED', 'SERVICE_DEACTIVATED', 'EPS_DELETED']) {
            expect(ACCIONES_DE_LA_BITACORA[a].categoria).toBe('CATALOGOS');
        }
        expect(ACCIONES_DE_LA_BITACORA.PATIENT_UPDATED.categoria).toBe('PACIENTES');
        expect(ACCIONES_DE_LA_BITACORA.SLOTS_GENERATED.categoria).toBe('CITAS');
        // El recordatorio de la API ya no sale sin usuario: lo reemplaza el que dice quién lo pidió.
        expect(ACCIONES_SIN_USUARIO as readonly string[]).not.toContain('REMINDER_MANUAL_SENT');
    });
});
