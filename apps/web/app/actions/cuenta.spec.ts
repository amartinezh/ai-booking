jest.mock('../../lib/prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), update: jest.fn() },
        systemLog: { create: jest.fn(), count: jest.fn() },
    },
}));
jest.mock('../../lib/session', () => ({ getSession: jest.fn() }));
// El token nuevo de quien cambia su clave (jose es ESM puro: aquí, un doble).
jest.mock('../../lib/sesion-token', () => ({ abrirSesion: jest.fn() }));

import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { getSession } from '../../lib/session';
import { cambiarMiClave } from './cuenta';
import { INTENTOS_CLAVE } from '../../lib/cuenta/clave';
import { abrirSesion } from '../../lib/sesion-token';

const mockSession = getSession as jest.Mock;
const findUnique = prisma.user.findUnique as jest.Mock;
const update = prisma.user.update as jest.Mock;
const logCreate = prisma.systemLog.create as jest.Mock;
const logCount = prisma.systemLog.count as jest.Mock;

const ACTUAL = 'Inicial-Ab12-Cd34';
const NUEVA = 'MiClaveNueva2026';

describe('cambiarMiClave', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSession.mockResolvedValue({
            userId: 'u-agendadora',
            email: 'agendadora.prueba@ejemplo.com',
            role: 'BOOKING_AGENT',
            organizationId: 'org-1',
        });
        findUnique.mockResolvedValue({
            id: 'u-agendadora',
            password: bcrypt.hashSync(ACTUAL, 4),
            role: 'BOOKING_AGENT',
            organizationId: 'org-1',
        });
        update.mockResolvedValue({});
        logCreate.mockResolvedValue({});
        logCount.mockResolvedValue(0);
    });

    it('con la clave actual correcta, guarda la nueva cifrada (y solo de quien tiene la sesión)', async () => {
        const r = await cambiarMiClave({ actual: ACTUAL, nueva: NUEVA, confirmacion: NUEVA });

        expect(r).toEqual({ success: true });
        expect(findUnique.mock.calls[0][0].where).toEqual({ id: 'u-agendadora' });
        const { where, data } = update.mock.calls[0][0];
        expect(where).toEqual({ id: 'u-agendadora' });
        expect(data.password).not.toBe(NUEVA);
        expect(bcrypt.compareSync(NUEVA, data.password)).toBe(true);
        expect(bcrypt.compareSync(ACTUAL, data.password)).toBe(false);
    });

    it('deja constancia en la bitácora sin ningún dato de la clave', async () => {
        await cambiarMiClave({ actual: ACTUAL, nueva: NUEVA, confirmacion: NUEVA });

        const { data } = logCreate.mock.calls[0][0];
        expect(data).toMatchObject({ action: 'PASSWORD_CHANGED', userId: 'u-agendadora', organizationId: 'org-1' });
        expect(JSON.stringify(data)).not.toContain(NUEVA);
        expect(JSON.stringify(data)).not.toContain(ACTUAL);
    });

    it('con la clave actual equivocada no cambia nada', async () => {
        const r = await cambiarMiClave({ actual: 'NoEsLaMia2026', nueva: NUEVA, confirmacion: NUEVA });

        expect(r).toEqual({ success: false, error: 'La clave actual no es correcta.' });
        expect(update).not.toHaveBeenCalled();
        // El intento fallido queda registrado (cuenta para el tope), sin la clave.
        expect(logCreate).toHaveBeenCalledTimes(1);
        const { data } = logCreate.mock.calls[0][0];
        expect(data).toMatchObject({ level: 'WARNING', action: 'PASSWORD_CHANGE_FAILED', userId: 'u-agendadora' });
        expect(JSON.stringify(data)).not.toContain('NoEsLaMia2026');
        expect(JSON.stringify(data)).not.toContain(NUEVA);
    });

    it(`tras ${INTENTOS_CLAVE.MAX} intentos fallidos en ${INTENTOS_CLAVE.VENTANA_MIN} minutos, frena aunque la clave sea la correcta`, async () => {
        logCount.mockResolvedValue(INTENTOS_CLAVE.MAX);
        const r = await cambiarMiClave({ actual: ACTUAL, nueva: NUEVA, confirmacion: NUEVA });

        expect(r.success).toBe(false);
        expect(r).toMatchObject({ error: expect.stringContaining('Demasiados intentos') });
        expect(findUnique).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        // Cuenta solo los fallos de ESTE usuario y solo los recientes.
        const { where } = logCount.mock.calls[0][0];
        expect(where).toMatchObject({ action: 'PASSWORD_CHANGE_FAILED', userId: 'u-agendadora' });
        const hace = Date.now() - where.createdAt.gte.getTime();
        expect(hace).toBeGreaterThanOrEqual(INTENTOS_CLAVE.VENTANA_MIN * 60_000 - 1000);
        expect(hace).toBeLessThanOrEqual(INTENTOS_CLAVE.VENTANA_MIN * 60_000 + 1000);
    });

    it('con menos fallos que el tope, la clave correcta sí pasa', async () => {
        logCount.mockResolvedValue(INTENTOS_CLAVE.MAX - 1);
        const r = await cambiarMiClave({ actual: ACTUAL, nueva: NUEVA, confirmacion: NUEVA });
        expect(r).toEqual({ success: true });
    });

    it('si no se puede registrar el fallo, igual responde que la clave actual no es correcta', async () => {
        logCreate.mockRejectedValue(new Error('bitácora caída'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const r = await cambiarMiClave({ actual: 'NoEsLaMia2026', nueva: NUEVA, confirmacion: NUEVA });
        expect(r).toEqual({ success: false, error: 'La clave actual no es correcta.' });
        expect(update).not.toHaveBeenCalled();
    });

    it('una clave nueva que no cumple la regla ni siquiera consulta la base', async () => {
        const r = await cambiarMiClave({ actual: ACTUAL, nueva: 'corta1', confirmacion: 'corta1' });

        expect(r.success).toBe(false);
        expect(findUnique).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it('sin sesión, nada', async () => {
        mockSession.mockResolvedValue(null);
        const r = await cambiarMiClave({ actual: ACTUAL, nueva: NUEVA, confirmacion: NUEVA });

        expect(r).toEqual({ success: false, error: 'Su sesión terminó. Vuelva a ingresar.' });
        expect(findUnique).not.toHaveBeenCalled();
    });

    it('si la bitácora falla, la clave igual queda cambiada', async () => {
        logCreate.mockRejectedValue(new Error('bitácora caída'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const r = await cambiarMiClave({ actual: ACTUAL, nueva: NUEVA, confirmacion: NUEVA });

        expect(r).toEqual({ success: true });
        expect(update).toHaveBeenCalled();
    });
});

describe('cambiarMiClave — cierra las otras sesiones (2026-10-27)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSession.mockResolvedValue({ userId: 'u-1', email: 'agendadora.prueba@ejemplo.com', role: 'BOOKING_AGENT', organizationId: 'org-1' });
        findUnique.mockResolvedValue({ id: 'u-1', password: bcrypt.hashSync(ACTUAL, 4), role: 'BOOKING_AGENT', organizationId: 'org-1' });
        update.mockResolvedValue({ id: 'u-1', email: 'agendadora.prueba@ejemplo.com', role: 'BOOKING_AGENT', organizationId: 'org-1' });
        logCreate.mockResolvedValue({});
        logCount.mockResolvedValue(0);
    });

    it('marca el cierre de sesiones y le da a quien la cambió un token nuevo', async () => {
        const antes = Date.now();
        expect(await cambiarMiClave({ actual: ACTUAL, nueva: NUEVA, confirmacion: NUEVA })).toEqual({ success: true });
        const { data } = update.mock.calls[0][0];
        expect(data.sessionsRevokedAt).toBeInstanceOf(Date);
        expect(data.sessionsRevokedAt.getTime()).toBeGreaterThanOrEqual(antes);
        expect(abrirSesion).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-1', role: 'BOOKING_AGENT' }));
    });

    it('con la clave actual equivocada no cierra nada', async () => {
        await cambiarMiClave({ actual: 'otra-clave-123', nueva: NUEVA, confirmacion: NUEVA });
        expect(update).not.toHaveBeenCalled();
        expect(abrirSesion).not.toHaveBeenCalled();
    });
});
