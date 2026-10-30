import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/actions/survey', () => ({ submitSurvey: jest.fn() }));

import { submitSurvey } from '@/app/actions/survey';
import SurveyForm from './SurveyForm';

const mSubmit = submitSurvey as jest.Mock;

const enviar = () => userEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }));

describe('Formulario de la encuesta (lo que abre el paciente desde WhatsApp)', () => {
  beforeEach(() => {
    mSubmit.mockReset();
    render(<SurveyForm tokenId="tok-1" clinicName="ESE San Vicente" />);
  });

  it('hace las tres preguntas, con el nombre de la IPS', () => {
    expect(screen.getByRole('radiogroup', { name: '¿Recomendaría la IPS?' })).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: '¿Recomendaría ESE San Vicente a sus familiares y amigos?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: '¿Cómo le fue en su experiencia?' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Calificación del asistente' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Escriba aquí su comentario')).toBeInTheDocument();
  });

  it('sin responder todo no envía y marca lo que falta', async () => {
    await enviar();
    expect(mSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Faltan 3 respuestas');
    expect(screen.getAllByText('Falta esta respuesta.')).toHaveLength(3);

    await userEvent.click(screen.getByRole('radio', { name: 'Sí' }));
    expect(screen.getAllByText('Falta esta respuesta.')).toHaveLength(2);
  });

  it('envía las respuestas y agradece', async () => {
    mSubmit.mockResolvedValue({ success: true });

    await userEvent.click(screen.getByRole('radio', { name: 'No' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Regular' }));
    await userEvent.click(screen.getByRole('radio', { name: /4 estrellas/ }));
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
    await userEvent.click(screen.getByRole('radio', { name: /5 estrellas/ }));
    await enviar();

    expect(mSubmit).toHaveBeenCalledWith('tok-1', expect.objectContaining({ experience: 'NO_ANSWER' }));
  });

  it('muestra el error del servidor y deja reintentar', async () => {
    mSubmit.mockResolvedValue({ success: false, error: 'Este enlace ya no es válido.' });

    await userEvent.click(screen.getByRole('radio', { name: 'Sí' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Buena' }));
    await userEvent.click(screen.getByRole('radio', { name: /1 estrella:/ }));
    await enviar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace ya no es válido.');
    expect(screen.getByRole('button', { name: 'Enviar respuestas' })).toBeEnabled();
  });
});
