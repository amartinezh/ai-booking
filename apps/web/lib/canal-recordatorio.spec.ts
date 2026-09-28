import { canalDelRecordatorio } from './canal-recordatorio';

describe('canalDelRecordatorio (texto del botón del dashboard)', () => {
    const ambos = { whatsappId: '573001112233', telegramChatId: '777' };

    it.each(['WHATSAPP', 'MANUAL', 'MIRROR'])('cita %s con WhatsApp → «WhatsApp», como siempre', (origen) => {
        expect(canalDelRecordatorio(ambos, origen)).toBe('WhatsApp');
    });

    it('cita de Telegram → «Telegram»', () => {
        expect(canalDelRecordatorio(ambos, 'TELEGRAM')).toBe('Telegram');
    });

    it('cita de Telegram de quien bloqueó al bot → «WhatsApp» (por ahí saldrá)', () => {
        expect(canalDelRecordatorio({ ...ambos, telegramBlockedAt: new Date() }, 'TELEGRAM')).toBe('WhatsApp');
    });

    it('paciente solo de Telegram con cita del hospital → «Telegram»', () => {
        expect(canalDelRecordatorio({ telegramChatId: '777' }, 'MIRROR')).toBe('Telegram');
    });

    it('solo BSUID → «WhatsApp»', () => {
        expect(canalDelRecordatorio({ bsuid: 'CO.1' }, 'WHATSAPP')).toBe('WhatsApp');
    });

    it.each([null, undefined, {}])('sin destinatario (%p) → «WhatsApp», como antes', (p) => {
        expect(canalDelRecordatorio(p, 'TELEGRAM')).toBe('WhatsApp');
    });
});
