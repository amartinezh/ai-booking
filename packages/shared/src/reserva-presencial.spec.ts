import {
  RESERVA_PRESENCIAL,
  chatEnElTope,
  medicoDiasEnElTope,
  normalizarParteDelChat,
  textoParteDelChat,
  topeDelChat,
  validarParteDelChat,
} from './reserva-presencial';

describe('reserva de agenda para la atención presencial', () => {
  describe('lo que viene de la base', () => {
    it('sin valor no hay reserva', () => {
      expect(normalizarParteDelChat(null)).toBeNull();
      expect(normalizarParteDelChat(undefined)).toBeNull();
      expect(normalizarParteDelChat('')).toBeNull();
    });

    it('un dato raro nunca deja al asistente sin citas: cuenta como sin reserva', () => {
      expect(normalizarParteDelChat(0)).toBeNull();
      expect(normalizarParteDelChat(-20)).toBeNull();
      expect(normalizarParteDelChat(9)).toBeNull();
      expect(normalizarParteDelChat(NaN)).toBeNull();
      expect(normalizarParteDelChat('ochenta')).toBeNull();
      expect(normalizarParteDelChat(250)).toBeNull();
    });

    it('100 % es lo mismo que sin reserva', () => {
      expect(normalizarParteDelChat(100)).toBeNull();
    });

    it('un porcentaje del rango se respeta', () => {
      expect(normalizarParteDelChat(80)).toBe(80);
      expect(normalizarParteDelChat('80')).toBe(80);
      expect(normalizarParteDelChat(RESERVA_PRESENCIAL.MIN)).toBe(10);
      expect(normalizarParteDelChat(99)).toBe(99);
    });
  });

  describe('lo que llega del panel', () => {
    it('acepta «sin reserva» y los enteros de 10 a 100', () => {
      expect(validarParteDelChat(null)).toEqual({ ok: true, porcentaje: null });
      expect(validarParteDelChat(80)).toEqual({ ok: true, porcentaje: 80 });
      expect(validarParteDelChat(10)).toEqual({ ok: true, porcentaje: 10 });
      expect(validarParteDelChat(100)).toEqual({ ok: true, porcentaje: 100 });
    });

    it('rechaza lo demás en vez de dejarlo sin reserva', () => {
      for (const malo of [9, 101, 0, -5, 80.5, '80', undefined, NaN, {}]) {
        expect(validarParteDelChat(malo).ok).toBe(false);
      }
    });
  });

  describe('el tope del chat se redondea hacia abajo', () => {
    it('20 cupos al 80 % son 16 del chat', () => {
      expect(topeDelChat(20, 80)).toBe(16);
    });

    it('7 cupos al 80 % son 5; 5 cupos son 4 (sin error de coma flotante)', () => {
      expect(topeDelChat(7, 80)).toBe(5);
      expect(topeDelChat(5, 80)).toBe(4);
      expect(topeDelChat(10, 70)).toBe(7);
    });

    it('agendas pequeñas: 4 → 3, 3 → 2, 2 → 1 y 1 → 0', () => {
      expect(topeDelChat(4, 80)).toBe(3);
      expect(topeDelChat(3, 80)).toBe(2);
      expect(topeDelChat(2, 80)).toBe(1);
      expect(topeDelChat(1, 80)).toBe(0);
    });

    it('sin reserva o con 100 %, toda la capacidad', () => {
      expect(topeDelChat(20, null)).toBe(20);
      expect(topeDelChat(20, 100)).toBe(20);
    });

    it('una capacidad rara no da un tope negativo', () => {
      expect(topeDelChat(-3, 80)).toBe(0);
      expect(topeDelChat(NaN, 80)).toBe(0);
    });
  });

  describe('¿el asistente ya llegó al tope de ese médico ese día?', () => {
    it('sin reserva, nunca', () => {
      expect(chatEnElTope({ capacidad: 20, chat: 20 }, null)).toBe(false);
      expect(chatEnElTope({ capacidad: 1, chat: 0 }, 100)).toBe(false);
    });

    it('con 15 citas del chat de 20 cupos al 80 % todavía cabe una', () => {
      expect(chatEnElTope({ capacidad: 20, chat: 15 }, 80)).toBe(false);
    });

    it('con 16 ya no', () => {
      expect(chatEnElTope({ capacidad: 20, chat: 16 }, 80)).toBe(true);
    });

    it('las citas del hospital no cuentan: solo las del chat', () => {
      // 20 cupos, 14 del hospital y 2 del chat: el chat sigue lejos de 16.
      expect(chatEnElTope({ capacidad: 20, chat: 2 }, 80)).toBe(false);
    });

    it('al buscar, lo apartado por otros pacientes cuenta como del chat', () => {
      expect(chatEnElTope({ capacidad: 20, chat: 14, apartados: 1 }, 80)).toBe(
        false,
      );
      expect(chatEnElTope({ capacidad: 20, chat: 14, apartados: 2 }, 80)).toBe(
        true,
      );
    });

    it('una agenda de un solo cupo queda para el hospital', () => {
      expect(chatEnElTope({ capacidad: 1, chat: 0 }, 80)).toBe(true);
    });
  });

  describe('los médico-días en el tope', () => {
    const filas = [
      { doctorId: 'a', dia: '2026-11-17', capacidad: 20, chat: 16 },
      { doctorId: 'b', dia: '2026-11-17', capacidad: 20, chat: 3 },
      { doctorId: 'a', dia: '2026-11-18', capacidad: 10, chat: 7, apartados: 1 },
    ];

    it('solo los que llegaron', () => {
      expect(medicoDiasEnElTope(filas, 80).map((f) => `${f.doctorId} ${f.dia}`))
        .toEqual(['a 2026-11-17', 'a 2026-11-18']);
    });

    it('sin reserva, ninguno', () => {
      expect(medicoDiasEnElTope(filas, null)).toEqual([]);
    });
  });

  it('el texto para el panel', () => {
    expect(textoParteDelChat(null)).toBe('Sin reserva');
    expect(textoParteDelChat(100)).toBe('Sin reserva');
    expect(textoParteDelChat(80)).toBe(
      '80 % para el asistente, 20 % para el hospital',
    );
  });
});
