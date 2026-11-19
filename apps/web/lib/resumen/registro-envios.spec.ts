import { filasDelRegistro, nombreDelRegistro, porQueNoLlego } from './registro-envios';
import type { AtencionConEnvios, EnvioDeLaAtencion } from '@/app/actions/resumen-envios';

const vacia = { enviados: 0, entregados: 0, leidos: 0, fallidos: 0 };
const envio = (c: Partial<EnvioDeLaAtencion>): EnvioDeLaAtencion => ({
    canal: 'WHATSAPP',
    proposito: 'PACIENTE',
    destino: '•••4567',
    estado: 'DOCUMENTOS_ENVIADOS',
    motivo: null,
    avisoIso: null,
    documentosIso: null,
    verificadoPor: 'FECHA_NACIMIENTO',
    traza: {
        aviso: {
            tipo: 'PLANTILLA',
            enviadoIso: '2026-11-10T15:00:00.000Z',
            entregadoIso: '2026-11-10T15:00:04.000Z',
            leidoIso: '2026-11-10T15:20:00.000Z',
            estado: 'READ',
            error: null,
        },
        pidioIso: '2026-11-10T15:21:00.000Z',
        verificadoIso: '2026-11-10T15:22:00.000Z',
        documentosIso: '2026-11-10T15:22:30.000Z',
        archivos: { enviados: 6, entregados: 6, leidos: 4, fallidos: 0 },
    },
    ...c,
});
const atencion = (c: Partial<AtencionConEnvios>): AtencionConEnvios => ({
    id: 'a',
    historia: '2441058',
    atendidaIso: '2026-11-10T13:00:00.000Z',
    servicio: 'S39141',
    paciente: { nombre: 'Ana P•••', documento: '•••0001' },
    estado: 'ENVIADO',
    motivo: null,
    contenidoDisponible: true,
    envios: [],
    pagina: { veces: 0, ultimaIso: null, descargas: 0 },
    noLlego: null,
    ...c,
});

describe('el registro de envíos (Excel)', () => {
    it('una fila por envío con cada hora; la atención sin envíos, en una fila con el porqué', () => {
        const filas = filasDelRegistro([
            atencion({ envios: [envio({})], pagina: { veces: 2, ultimaIso: '2026-11-11T13:00:00.000Z', descargas: 1 } }),
            atencion({ id: 'b', historia: '2441059', estado: 'EXCLUIDO', motivo: 'F', paciente: null }),
        ]);
        const [cabecera, primera, segunda] = filas;
        expect(filas).toHaveLength(3);
        expect(filas.every((f) => f.length === cabecera.length)).toBe(true);
        const col = (nombre: string) => cabecera.indexOf(nombre);
        expect(primera[col('Historia')]).toBe('2441058');
        expect(primera[col('Canal')]).toBe('WhatsApp');
        expect(primera[col('Cómo salió el aviso')]).toBe('Plantilla de WhatsApp');
        expect(primera[col('Aviso leído')]).toContain('10:20');
        expect(primera[col('Cómo se verificó')]).toBe('Fecha de nacimiento');
        expect(primera[col('Archivos vistos')]).toBe(4);
        expect(primera[col('Veces que abrió la página')]).toBe(2);
        expect(segunda[col('Estado de la atención')]).toBe('No se envía');
        expect(segunda[col('Motivo')]).toBe('F');
        expect(segunda[col('Canal')]).toBe('');
    });

    it('el correo y Telegram no tienen entregado ni leído; el error de un aviso que no salió va en su columna', () => {
        const [cabecera, correo, tg, fallo] = filasDelRegistro([
            atencion({
                envios: [
                    envio({
                        canal: 'EMAIL',
                        verificadoPor: null,
                        traza: {
                            aviso: { tipo: 'CORREO', enviadoIso: '2026-11-10T15:00:00.000Z', entregadoIso: null, leidoIso: null, estado: null, error: null },
                            pidioIso: null,
                            verificadoIso: null,
                            documentosIso: '2026-11-10T15:00:00.000Z',
                            archivos: vacia,
                        },
                    }),
                    envio({
                        canal: 'TELEGRAM',
                        verificadoPor: 'NUMERO',
                        traza: { ...envio({}).traza, aviso: { tipo: 'TELEGRAM', enviadoIso: '2026-11-10T15:00:00.000Z', entregadoIso: null, leidoIso: null, estado: 'ACCEPTED', error: null } },
                    }),
                    envio({
                        estado: 'FALLO',
                        motivo: 'La plantilla «Documentos de la consulta» no está configurada',
                        traza: { aviso: { tipo: null, enviadoIso: null, entregadoIso: null, leidoIso: null, estado: null, error: null }, pidioIso: null, verificadoIso: null, documentosIso: null, archivos: vacia },
                    }),
                ],
            }),
        ]);
        const col = (nombre: string) => cabecera.indexOf(nombre);
        expect(correo[col('Aviso entregado')]).toBe('');
        expect(correo[col('Pidió los documentos')]).toBe('');
        expect(tg[col('Archivos entregados')]).toBe('');
        expect(tg[col('Cómo se verificó')]).toBe('Su número');
        expect(fallo[col('Error del aviso')]).toBe('La plantilla «Documentos de la consulta» no está configurada');
    });

    it('nombre del archivo con las fechas', () => {
        expect(nombreDelRegistro('2026-11-01', '2026-11-10')).toBe('Envios_documentos_2026-11-01_a_2026-11-10.xlsx');
        expect(nombreDelRegistro('2026-11-01', '2026-11-10', true)).toBe('Envios_documentos_no_llegaron_2026-11-01_a_2026-11-10.xlsx');
    });

    it('la columna «Por qué no le llegó» va en cada fila, también en la de la atención sin envíos', () => {
        const ahora = new Date('2026-11-12T15:00:00.000Z');
        const [cabecera, sinContacto] = filasDelRegistro(
            [atencion({ estado: 'SIN_CONTACTO', motivo: 'Sin un celular utilizable', envios: [] })],
            ahora,
        );
        expect(cabecera[cabecera.length - 1]).toBe('Por qué no le llegó');
        expect(sinContacto).toHaveLength(cabecera.length);
        expect(sinContacto[cabecera.indexOf('Veces que abrió la página')]).toBe(0);
        expect(sinContacto[cabecera.length - 1]).toContain('Sin un celular utilizable');
    });
});

describe('a quién no le llegó el aviso (plan de celulares del hospital)', () => {
    const ahora = new Date('2026-11-12T15:00:00.000Z');
    const aviso = (c: Partial<EnvioDeLaAtencion['traza']['aviso']>) => ({
        tipo: 'PLANTILLA' as const,
        enviadoIso: '2026-11-10T15:00:00.000Z',
        entregadoIso: null,
        leidoIso: null,
        estado: 'SENT' as const,
        error: null,
        ...c,
    });
    const sinNada = { pidioIso: null, verificadoIso: null, documentosIso: null, archivos: vacia };
    const con = (av: Parameters<typeof aviso>[0], e: Partial<EnvioDeLaAtencion> = {}) =>
        atencion({ envios: [envio({ estado: 'AVISO_ENVIADO', traza: { aviso: aviso(av), ...sinNada }, ...e })] });

    it('le llegó: Meta lo entregó, lo leyó, pidió o recibió los documentos, o lo aceptó Telegram', () => {
        expect(porQueNoLlego(atencion({ envios: [envio({})] }), ahora)).toBeNull();
        expect(porQueNoLlego(con({ estado: 'DELIVERED' }), ahora)).toBeNull();
        expect(porQueNoLlego(con({ entregadoIso: '2026-11-10T15:00:05.000Z' }), ahora)).toBeNull();
        expect(porQueNoLlego(con({ tipo: 'TELEGRAM', estado: 'ACCEPTED' }, { canal: 'TELEGRAM' }), ahora)).toBeNull();
    });

    it('no cuenta lo que no se envía a propósito, lo que todavía no se intenta ni lo que salió hace menos de 24 h', () => {
        expect(porQueNoLlego(atencion({ estado: 'EXCLUIDO', motivo: 'F32' }), ahora)).toBeNull();
        expect(porQueNoLlego(atencion({ estado: 'RECIBIDO' }), ahora)).toBeNull();
        expect(porQueNoLlego(con({ enviadoIso: '2026-11-12T10:00:00.000Z' }), ahora)).toBeNull();
        expect(porQueNoLlego(con({}, { proposito: 'PRUEBA' }), ahora)).toBeNull();
    });

    it('no le llegó: sin celular, Meta no lo entregó (con su error) o sin confirmar en 24 h', () => {
        expect(porQueNoLlego(atencion({ estado: 'SIN_CONTACTO', motivo: 'El celular del HIS es de otro paciente en AgenIA' }), ahora)).toBe(
            'Sin un celular utilizable: El celular del HIS es de otro paciente en AgenIA',
        );
        expect(porQueNoLlego(con({ estado: 'FAILED', error: '131026 Message undeliverable' }), ahora)).toBe(
            'WhatsApp no lo entregó: 131026 Message undeliverable',
        );
        expect(
            porQueNoLlego(con({ tipo: null, enviadoIso: null, estado: null }, { estado: 'FALLO', motivo: 'Meta rechazó el número' }), ahora),
        ).toBe('WhatsApp no lo entregó: Meta rechazó el número');
        expect(porQueNoLlego(con({}), ahora)).toContain('no confirmó la entrega en 24 horas');
    });
});
