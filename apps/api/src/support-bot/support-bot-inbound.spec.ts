import { leerUpdate } from './support-bot-inbound';

describe('leerUpdate (asistente de soporte)', () => {
  const privado = { id: 777, type: 'private' };
  const ana = { id: 777, first_name: '  Ana  ' };

  it('un mensaje de texto en un chat privado', () => {
    expect(
      leerUpdate({
        update_id: 10,
        message: { message_id: 1, from: ana, chat: privado, text: 'hola' },
      }),
    ).toEqual({
      accion: 'mensaje',
      updateId: '10',
      telegramUserId: '777',
      chatId: '777',
      nombre: 'Ana',
      texto: 'hola',
    });
  });

  it('una foto o un audio llega sin texto', () => {
    const r = leerUpdate({
      update_id: 11,
      message: { from: { id: 777 }, chat: privado },
    });
    expect(r).toMatchObject({ accion: 'mensaje', texto: null, nombre: null });
  });

  it('un nombre larguísimo se corta', () => {
    const r = leerUpdate({
      update_id: 12,
      message: {
        from: { id: 777, first_name: 'x'.repeat(200) },
        chat: privado,
        text: 'a',
      },
    });
    expect(r.accion === 'mensaje' && r.nombre?.length).toBe(64);
  });

  it('el toque de un botón', () => {
    expect(
      leerUpdate({
        update_id: 13,
        callback_query: {
          id: 'cb1',
          from: ana,
          data: 's1:CASO_SI',
          message: { chat: privado },
        },
      }),
    ).toEqual({
      accion: 'boton',
      updateId: '13',
      telegramUserId: '777',
      chatId: '777',
      nombre: 'Ana',
      callbackId: 'cb1',
      datos: 's1:CASO_SI',
    });
  });

  it('un botón sin datos llega con datos vacíos', () => {
    const r = leerUpdate({
      update_id: 14,
      callback_query: { id: 'cb', from: ana, message: { chat: privado } },
    });
    expect(r).toMatchObject({ accion: 'boton', datos: '' });
  });

  it.each([
    ['nada', null],
    ['sin update_id', { message: { from: ana, chat: privado, text: 'x' } }],
    [
      'un grupo',
      {
        update_id: 1,
        message: { from: ana, chat: { id: -5, type: 'group' }, text: 'x' },
      },
    ],
    [
      'un canal',
      {
        update_id: 1,
        message: { from: ana, chat: { id: -5, type: 'channel' }, text: 'x' },
      },
    ],
    ['un mensaje editado', { update_id: 1, edited_message: { text: 'x' } }],
    [
      'un mensaje sin remitente',
      { update_id: 1, message: { chat: privado, text: 'x' } },
    ],
    [
      'un mensaje sin chat id',
      {
        update_id: 1,
        message: { from: ana, chat: { type: 'private' }, text: 'x' },
      },
    ],
    [
      'otro bot',
      {
        update_id: 1,
        message: { from: { id: 9, is_bot: true }, chat: privado, text: 'x' },
      },
    ],
    [
      'un botón sin id',
      {
        update_id: 1,
        callback_query: { from: ana, message: { chat: privado } },
      },
    ],
    [
      'un botón sin chat',
      { update_id: 1, callback_query: { id: 'c', from: ana } },
    ],
    [
      'un botón en un grupo',
      {
        update_id: 1,
        callback_query: {
          id: 'c',
          from: ana,
          message: { chat: { id: -5, type: 'group' } },
        },
      },
    ],
  ])('ignora %s', (_, update) => {
    expect(leerUpdate(update as never).accion).toBe('ignorar');
  });
});
