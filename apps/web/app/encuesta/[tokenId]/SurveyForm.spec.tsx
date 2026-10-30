import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/survey', () => ({ submitSurvey: jest.fn(), saveSurveyRating: jest.fn() }));

import { saveSurveyRating, submitSurvey } from '@/app/actions/survey';
import SurveyForm from './SurveyForm';

const mSubmit = submitSurvey as jest.Mock;
const mRating = saveSurveyRating as jest.Mock;

const enviar = () => userEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));
const estrella = (n: number) => screen.getByRole('radio', { name: new RegExp(`^${n} estrellas?:`) });
const preguntaIps = () => screen.queryByRole('radiogroup', { name: '¿Recomendaría la IPS?' });

describe('Formulario de la encuesta (lo que abre el paciente desde WhatsApp)', () => {
  beforeEach(() => {
    mSubmit.mockReset();
    mRating.mockReset().mockResolvedValue({ success: true });
  });

  describe('paso 1: las estrellas, primero y solas', () => {
    beforeEach(() => render(<SurveyForm tokenId="tok-1" clinicName="ESE San Vicente" />));

    it('al abrir solo se ven las estrellas; las preguntas del hospital esperan', () => {
      expect(screen.getByRole('radiogroup', { name: 'Calificación del asistente' })).toBeInTheDocument();
      expect(preguntaIps()).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Enviar respuestas' })).not.toBeInTheDocument();
    });

    it('⭐ tocar una estrella la guarda al instante y muestra las 2 preguntas del hospital', async () => {
      await userEvent.click(estrella(4));

      expect(mRating).toHaveBeenCalledWith('tok-1', 4);
      expect(await screen.findByText('Calificación guardada')).toBeInTheDocument();
      expect(screen.getByText('¡Gracias! ¿Nos ayuda con 2 preguntas más sobre ESE San Vicente?')).toBeInTheDocument();
      expect(
        screen.getByRole('group', { name: '¿Recomendaría ESE San Vicente a sus familiares y amigos?' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: '¿Cómo le fue en su experiencia?' })).toBeInTheDocument();
      // Guardar la estrella NO es enviar la encuesta.
      expect(mSubmit).not.toHaveBeenCalled();
    });

    it('cambiar de estrella vuelve a guardar; si toca rápido, gana la última (nunca una vieja encima)', async () => {
      let soltar: (v: unknown) => void = () => undefined;
      mRating.mockImplementationOnce(() => new Promise((r) => (soltar = r)));

      await userEvent.click(estrella(2));
      await userEvent.click(estrella(3));
      await userEvent.click(estrella(5)); // mientras la primera sigue en camino
      expect(mRating).toHaveBeenCalledTimes(1);

      soltar({ success: true });
      await waitFor(() => expect(mRating).toHaveBeenCalledTimes(2));
      expect(mRating).toHaveBeenLastCalledWith('tok-1', 5);
    });

    it('si no se pudo guardar, lo dice y deja seguir', async () => {
      mRating.mockResolvedValueOnce({
        success: false,
        error: 'No se pudo guardar su calificación. Toque la estrella de nuevo.',
      });
      await userEvent.click(estrella(3));
      expect(
        await screen.findByText('No se pudo guardar su calificación. Toque la estrella de nuevo.'),
      ).toBeInTheDocument();
      expect(preguntaIps()).toBeInTheDocument();
    });

    it('un enlace vencido o ya usado lo dice y no muestra el formulario', async () => {
      mRating.mockResolvedValueOnce({ success: false, invalidLink: true, error: 'Este enlace ya no es válido.' });
      await userEvent.click(estrella(5));
      expect(await screen.findByText('Este enlace ya no está disponible')).toBeInTheDocument();
      expect(preguntaIps()).not.toBeInTheDocument();
    });
  });

  describe('paso 2: las preguntas del hospital', () => {
    beforeEach(async () => {
      render(<SurveyForm tokenId="tok-1" clinicName="ESE San Vicente" />);
      await userEvent.click(estrella(4));
      await screen.findByText('Calificación guardada');
    });

    it('sin responderlas no envía y marca lo que falta', async () => {
      await enviar();
      expect(mSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('Faltan las 2 respuestas');
      expect(screen.getAllByText('Falta esta respuesta.')).toHaveLength(2);

      await userEvent.click(screen.getByRole('radio', { name: 'Sí' }));
      expect(screen.getAllByText('Falta esta respuesta.')).toHaveLength(1);
    });

    it('envía todo (con la estrella) y agradece', async () => {
      mSubmit.mockResolvedValue({ success: true });

      await userEvent.click(screen.getByRole('radio', { name: 'No' }));
      await userEvent.click(screen.getByRole('radio', { name: 'Regular' }));
      await userEvent.type(screen.getByPlaceholderText('Escriba aquí su comentario'), 'Muy demorado');
      await enviar();

      expect(mSubmit).toHaveBeenCalledWith('tok-1', {
        wouldRecommend: false,
        experience: 'FAIR',
        rating: 4,
        feedback: 'Muy demorado',
      });
      expect(await screen.findByText('¡Gracias por su opinión!')).toBeInTheDocument();
    });

    it('«Prefiero no responder» se guarda como «No responde»', async () => {
      mSubmit.mockResolvedValue({ success: true });
      await userEvent.click(screen.getByRole('radio', { name: 'Sí' }));
      await userEvent.click(screen.getByRole('radio', { name: 'Prefiero no responder' }));
      await enviar();
      expect(mSubmit).toHaveBeenCalledWith('tok-1', expect.objectContaining({ experience: 'NO_ANSWER' }));
    });

    it('muestra el error del servidor y deja reintentar', async () => {
      mSubmit.mockResolvedValue({ success: false, error: 'Este enlace ya no es válido.' });
      await userEvent.click(screen.getByRole('radio', { name: 'Sí' }));
      await userEvent.click(screen.getByRole('radio', { name: 'Buena' }));
      await enviar();

      expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace ya no es válido.');
      expect(screen.getByRole('button', { name: 'Enviar respuestas' })).toBeEnabled();
    });
  });

  it('si vuelve al enlace después de calificar, ve su estrella y las preguntas del hospital', () => {
    render(<SurveyForm tokenId="tok-1" clinicName="ESE San Vicente" initialRating={3} />);
    expect(estrella(3)).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Calificación guardada')).toBeInTheDocument();
    expect(preguntaIps()).toBeInTheDocument();
    expect(mRating).not.toHaveBeenCalled();
  });
});
