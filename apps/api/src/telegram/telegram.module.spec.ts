import { telegramEnabled } from './telegram.module';

/**
 * Interruptor global del canal (T9). Apagado debe ser el resultado de todo lo
 * que no sea exactamente `true`: con él apagado no existe ninguna ruta de
 * Telegram y el bot se comporta como hoy.
 */
describe('telegramEnabled', () => {
  it('solo `true` lo enciende', () => {
    expect(telegramEnabled({ TELEGRAM_ENABLED: 'true' })).toBe(true);
    expect(telegramEnabled({ TELEGRAM_ENABLED: ' true ' })).toBe(true);
  });

  it.each([undefined, '', 'false', '1', 'yes', 'TRUE', 'ture', 'on'])(
    '%p lo deja apagado',
    (value) => {
      expect(telegramEnabled({ TELEGRAM_ENABLED: value })).toBe(false);
    },
  );

  it('sin variable, apagado', () => {
    expect(telegramEnabled({})).toBe(false);
  });
});
