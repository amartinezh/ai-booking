import { stripWhatsappFormat, whatsappToTelegramHtml } from './telegram-format';

describe('whatsappToTelegramHtml', () => {
  it.each([
    ['*negrita*', '<b>negrita</b>'],
    ['_cursiva_', '<i>cursiva</i>'],
    ['~tachado~', '<s>tachado</s>'],
    ['```A-123```', '<code>A-123</code>'],
    ['Su cita es el *lunes 5*.', 'Su cita es el <b>lunes 5</b>.'],
    ['(*A*) Medicina General', '(<b>A</b>) Medicina General'],
    ['¡*Listo*!', '¡<b>Listo</b>!'],
  ])('%p → %p', (entrada, salida) => {
    expect(whatsappToTelegramHtml(entrada)).toBe(salida);
  });

  it('escapa & < > ANTES de poner etiquetas (nada del texto puede inyectar HTML)', () => {
    expect(whatsappToTelegramHtml('Dr. <b>Ruiz</b> & Cía')).toBe(
      'Dr. &lt;b&gt;Ruiz&lt;/b&gt; &amp; Cía',
    );
    expect(whatsappToTelegramHtml('*<script>*')).toBe('<b>&lt;script&gt;</b>');
  });

  it('no toca los guiones bajos de una URL ni de un snake_case', () => {
    const url = 'https://agendamiento-ia.com/encuesta/ab_cd_ef';
    expect(whatsappToTelegramHtml(url)).toBe(url);
    expect(whatsappToTelegramHtml('campo mi_valor_x aquí')).toBe(
      'campo mi_valor_x aquí',
    );
  });

  it('un asterisco sin pareja queda como texto (no rompe el envío)', () => {
    expect(whatsappToTelegramHtml('5 * 3 = 15')).toBe('5 * 3 = 15');
    expect(whatsappToTelegramHtml('*sin cerrar')).toBe('*sin cerrar');
  });

  it('las marcas no cruzan saltos de línea', () => {
    expect(whatsappToTelegramHtml('*uno\ndos*')).toBe('*uno\ndos*');
  });

  it('varias marcas en el mismo mensaje, en varias líneas', () => {
    const msg =
      'Le confirmamos su cita de *Medicina General* con *Dr. Ruiz*.\n\n_Llegue 15 minutos antes._';
    expect(whatsappToTelegramHtml(msg)).toBe(
      'Le confirmamos su cita de <b>Medicina General</b> con <b>Dr. Ruiz</b>.\n\n<i>Llegue 15 minutos antes.</i>',
    );
  });

  it('un texto sin marcas queda igual', () => {
    expect(whatsappToTelegramHtml('Hola, ¿en qué le ayudo?')).toBe(
      'Hola, ¿en qué le ayudo?',
    );
  });
});

describe('stripWhatsappFormat', () => {
  it('quita las marcas y deja el texto', () => {
    expect(
      stripWhatsappFormat('Su cita de *Medicina* es el _lunes_ ~no~ ```A1```'),
    ).toBe('Su cita de Medicina es el lunes no A1');
  });

  it('no toca lo que no es marca', () => {
    expect(stripWhatsappFormat('5 * 3 y ab_cd')).toBe('5 * 3 y ab_cd');
  });
});
