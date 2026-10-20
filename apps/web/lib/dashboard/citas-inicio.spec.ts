import { SELECT_CITA_INICIO, TOPE_CITAS_INICIO, ventanaDeCitas } from './citas-inicio';

// Jueves 22 de octubre de 2026, 06:30 en Bogotá (UTC-5).
const AHORA = new Date('2026-10-22T11:30:00.000Z');
const iso = (d?: Date) => d?.toISOString();

describe('ventanaDeCitas — qué días trae la Visión General', () => {
    it('sin fechas: desde hoy a las 00:00 de Bogotá, sin final', () => {
        const v = ventanaDeCitas({}, AHORA);
        expect(v.desdeHoy).toBe(true);
        expect(iso(v.gte)).toBe('2026-10-22T05:00:00.000Z');
        expect(v.lte).toBeUndefined();
    });

    it('a las 22:00 de Bogotá, «hoy» sigue siendo el día de Bogotá aunque en UTC ya sea mañana', () => {
        const v = ventanaDeCitas({}, new Date('2026-10-22T03:00:00.000Z')); // 21-oct 22:00 en Bogotá
        expect(iso(v.gte)).toBe('2026-10-21T05:00:00.000Z');
    });

    it('con fecha inicial (para mirar atrás): desde ese día, y ya no «desde hoy»', () => {
        const v = ventanaDeCitas({ startDate: '2026-10-01' }, AHORA);
        expect(v.desdeHoy).toBe(false);
        expect(iso(v.gte)).toBe('2026-10-01T05:00:00.000Z');
        expect(v.lte).toBeUndefined();
    });

    it('con las dos fechas: los dos días completos incluidos', () => {
        const v = ventanaDeCitas({ startDate: '2026-10-01', endDate: '2026-10-05' }, AHORA);
        expect(iso(v.gte)).toBe('2026-10-01T05:00:00.000Z');
        expect(iso(v.lte)).toBe('2026-10-06T04:59:59.999Z');
    });

    it('solo fecha final por venir («hasta el sábado»): de hoy a ese día', () => {
        const v = ventanaDeCitas({ endDate: '2026-10-24' }, AHORA);
        expect(v.desdeHoy).toBe(true);
        expect(iso(v.gte)).toBe('2026-10-22T05:00:00.000Z');
        expect(iso(v.lte)).toBe('2026-10-25T04:59:59.999Z');
    });

    it('solo fecha final de hoy: el día de hoy', () => {
        const v = ventanaDeCitas({ endDate: '2026-10-22' }, AHORA);
        expect(iso(v.gte)).toBe('2026-10-22T05:00:00.000Z');
        expect(iso(v.lte)).toBe('2026-10-23T04:59:59.999Z');
    });

    it('solo fecha final ya pasada: todo lo anterior a ese día (si no, saldría vacía)', () => {
        const v = ventanaDeCitas({ endDate: '2026-10-01' }, AHORA);
        expect(v.desdeHoy).toBe(false);
        expect(v.gte).toBeUndefined();
        expect(iso(v.lte)).toBe('2026-10-02T04:59:59.999Z');
    });

    it.each(['abc', '2026-02-30', '2026-13-01', '22/10/2026', ''])(
        'una fecha que no se entiende («%s») se ignora en vez de romper la página',
        (malo) => {
            const v = ventanaDeCitas({ startDate: malo, endDate: malo }, AHORA);
            expect(v.desdeHoy).toBe(true);
            expect(iso(v.gte)).toBe('2026-10-22T05:00:00.000Z');
            expect(v.lte).toBeUndefined();
        },
    );

    it('fin de mes y de año: el día siguiente se calcula bien', () => {
        expect(iso(ventanaDeCitas({ startDate: '2026-12-01', endDate: '2026-12-31' }, AHORA).lte)).toBe(
            '2027-01-01T04:59:59.999Z',
        );
    });

    it('otra zona horaria (multi-clínica): medianoche de esa zona', () => {
        const v = ventanaDeCitas({}, AHORA, 'America/Mexico_City'); // UTC-6
        expect(iso(v.gte)).toBe('2026-10-22T06:00:00.000Z');
    });
});

describe('SELECT_CITA_INICIO — solo lo que usa la pantalla', () => {
    it('no trae el usuario del paciente (correo, clave) ni relaciones completas', () => {
        expect(SELECT_CITA_INICIO.patient.select).not.toHaveProperty('user');
        expect(Object.keys(SELECT_CITA_INICIO.patient.select).sort()).toEqual(
            ['bsuid', 'cedula', 'fullName', 'id', 'telegramBlockedAt', 'telegramChatId', 'whatsappId'].sort(),
        );
        expect(SELECT_CITA_INICIO.scheduleSlot.select.doctor).toEqual({
            select: { id: true, userId: true, fullName: true },
        });
        expect(SELECT_CITA_INICIO.eps).toEqual({ select: { name: true } });
    });

    it('el tope cubre un día lleno (unas 250 citas) con holgura', () => {
        expect(TOPE_CITAS_INICIO).toBeGreaterThanOrEqual(300);
        expect(TOPE_CITAS_INICIO).toBeLessThanOrEqual(1000);
    });
});
