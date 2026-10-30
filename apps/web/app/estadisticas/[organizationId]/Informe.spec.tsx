import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
jest.mock('@/app/actions/estadisticas', () => ({
    entrarAEstadisticas: jest.fn(),
    salirDeEstadisticas: jest.fn(async () => ({ success: true })),
}));

import Informe from './Informe';
import FormularioClave from './FormularioClave';
import { armarInforme } from '@/lib/estadisticas/informe';
import type { DatosDeEstadisticas } from '@/lib/estadisticas/consultas';
import { entrarAEstadisticas } from '@/app/actions/estadisticas';

const ORG = '97f18182-d0d9-4a3b-9eb6-4fbc031b917c';
const corte = { hasta: '2026-10-26', ultimoDia: '2026-10-25', hastaUtc: new Date('2026-10-26T05:00:00Z') };

const datos: DatosDeEstadisticas = {
    recordatoriosPorDia: [
        { dia: '2026-10-13', enviados: 42, entregados: 36, leidos: 30 },
        { dia: '2026-10-25', enviados: 6, entregados: 6, leidos: 4 },
    ],
    confirmacionesPorDia: [{ dia: '2026-10-14', personas: 17 }],
    confirmaciones: { personas: 116, citas: 121 },
    cancelaciones: { total: 16, retomados: 10, horasMediana: 9.6 },
    cambiosDeFecha: 1,
    citasChat: { total: 18, fueraDeHorario: 6, pacientesNuevos: 16 },
    citasChatPorDia: [{ dia: '2026-10-22', n: 7 }],
    hospital: { entregadas: 18, segundosPromedio: 1.1 },
    avisosInasistencia: 5,
    consultas: 39,
    mensajes: { total: 1000, personas: 330, fueraDeHorario: 350 },
    mensajesPorHora: [{ hora: 9, n: 109 }],
    asistencia: [
        { recordada: true, citas: 333, asistieron: 303 },
        { recordada: false, citas: 162, asistieron: 145 },
    ],
    espera: {
        oportunidad: [
            { canal: 'chat', dias: 0, citas: 18, sumaDias: 0 },
            { canal: 'chat', dias: 1, citas: 76, sumaDias: 76 },
            { canal: 'chat', dias: 2, citas: 12, sumaDias: 24 },
            { canal: 'chat', dias: 3, citas: 5, sumaDias: 15 },
            { canal: 'personal', dias: 0, citas: 506, sumaDias: 0 },
            { canal: 'personal', dias: 1, citas: 431, sumaDias: 431 },
            { canal: 'personal', dias: 2, citas: 45, sumaDias: 90 },
            { canal: 'personal', dias: 3, citas: 55, sumaDias: 165 },
            { canal: 'personal', dias: 4, citas: 196, sumaDias: 1842 },
        ],
        servicios: ['Consulta ambulatoria de medicina general'],
        conversacion: { citas: 116, medidas: 83, medianaMin: 4.6, promedioMin: 6.0 },
        listaEspera: { asignadas: 7, medianaHoras: 8.5, promedioHoras: 22.7 },
    },
};

describe('estadísticas — la página', () => {
    beforeEach(() => jest.clearAllMocks());

    it('arriba, la conclusión y las seis cifras con el período completo', () => {
        const informe = armarInforme(datos, corte, { conHospital: true })!;
        render(<Informe informe={informe} clinica="Hospital San Vicente de Paúl" organizationId={ORG} />);
        expect(screen.getByRole('heading', { level: 1, name: 'AgenIA en cifras' })).toBeInTheDocument();
        // 121 + 39 + 18 + 16 + 5 + 1 = 200 gestiones en 13 días (13 al 25 de octubre).
        expect(screen.getByText(/pacientes y familias hicieron/).textContent).toMatch(/En 13 días.*hicieron 200 gestiones/);
        expect(screen.getByText(/Del martes 13 de octubre al domingo 25 de octubre de 2026/)).toBeInTheDocument();
        const cifras = within(screen.getByRole('region', { name: 'Cifras principales' }));
        expect(cifras.getByText('Mensajes fuera de horario').nextSibling).toHaveTextContent('35,0 %');
        expect(cifras.getByText(/quedó escrito en el sistema del hospital/)).toHaveTextContent('El 100,0 % quedó escrito');
        expect(screen.getByText('Con recordatorio entregado')).toBeInTheDocument();
        expect(screen.getByText('91,0 %')).toBeInTheDocument();
    });

    it('cuánto espera el paciente: por chat y por el personal, con el estándar de 3 días', () => {
        const informe = armarInforme(datos, corte, { conHospital: true })!;
        render(<Informe informe={informe} clinica="Hospital San Vicente de Paúl" organizationId={ORG} />);
        expect(screen.getByRole('heading', { level: 2, name: '¿Cuánto espera el paciente por su cita?' })).toBeInTheDocument();
        const cifras = within(screen.getByRole('region', { name: 'Cifras principales' }));
        expect(cifras.getByText('Días hasta la cita por chat').nextSibling).toHaveTextContent('1,0');
        expect(cifras.getByText(/Por el personal del hospital/)).toHaveTextContent('2,1 días');
        expect(cifras.getByText(/El estándar de medicina general es de/)).toHaveTextContent('3 días');
        const chat = screen.getByRole('img', { name: /^Por chat \(WhatsApp y Telegram\): El mismo día: 16,2 %; Al día siguiente: 68,5 %/ });
        expect(chat).toBeInTheDocument();
        expect(screen.getByRole('img', { name: /Por el personal del hospital.*A más de 3 días: 15,9 %/ })).toBeInTheDocument();
        expect(screen.getByText(/84,1 %/)).toBeInTheDocument();
        expect(screen.getByText('4,6')).toBeInTheDocument();
        expect(screen.getByText('83 de 116')).toBeInTheDocument();
        expect(screen.getByText('8,5')).toBeInTheDocument();
    });

    it('sin datos de espera no muestra la sección ni la cifra', () => {
        const informe = armarInforme({ ...datos, espera: null }, corte, { conHospital: true })!;
        render(<Informe informe={informe} clinica="Clínica" organizationId={ORG} />);
        expect(screen.queryByText('¿Cuánto espera el paciente por su cita?')).not.toBeInTheDocument();
        expect(screen.queryByText('Días hasta la cita por chat')).not.toBeInTheDocument();
    });

    it('sin conexión con el hospital no menciona su sistema', () => {
        const informe = armarInforme(datos, corte, { conHospital: false })!;
        render(<Informe informe={informe} clinica="Clínica" organizationId={ORG} />);
        expect(screen.queryByText(/sistema del hospital/)).not.toBeInTheDocument();
    });

    it('«Salir» borra el acceso y vuelve a pedir la clave', async () => {
        const informe = armarInforme(datos, corte, { conHospital: true })!;
        render(<Informe informe={informe} clinica="Clínica" organizationId={ORG} />);
        await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
        expect(refresh).toHaveBeenCalled();
    });
});

describe('estadísticas — la clave en la página pública', () => {
    beforeEach(() => jest.clearAllMocks());

    it('con la clave equivocada lo dice y no recarga', async () => {
        (entrarAEstadisticas as jest.Mock).mockResolvedValueOnce({ success: false, error: 'La clave no es correcta.' });
        render(<FormularioClave organizationId={ORG} clinica="Hospital San Vicente de Paúl" />);
        await userEvent.type(screen.getByLabelText('Clave'), 'otra');
        await userEvent.click(screen.getByRole('button', { name: 'Ver estadísticas' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('La clave no es correcta.');
        expect(entrarAEstadisticas).toHaveBeenCalledWith(ORG, 'otra');
        expect(refresh).not.toHaveBeenCalled();
    });

    it('con la correcta recarga la página, que ya muestra las cifras', async () => {
        (entrarAEstadisticas as jest.Mock).mockResolvedValueOnce({ success: true });
        render(<FormularioClave organizationId={ORG} clinica="Hospital San Vicente de Paúl" />);
        await userEvent.type(screen.getByLabelText('Clave'), 'Anserma2026');
        await userEvent.click(screen.getByRole('button', { name: 'Ver estadísticas' }));
        await screen.findByRole('button', { name: 'Ver estadísticas' });
        expect(refresh).toHaveBeenCalled();
    });
});
