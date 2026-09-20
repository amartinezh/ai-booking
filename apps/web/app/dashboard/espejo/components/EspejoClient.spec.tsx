import { render, screen } from '@testing-library/react';
import EspejoClient from './EspejoClient';

jest.mock('@/app/actions/espejo', () => ({ reprocesarEvento: jest.fn(), cambiarModoAgenda: jest.fn() }));
jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

// ══════════════════════════════════════════════════════════════════════════
// La consulta en vivo del rastreo se ve en el panel del espejo, en SOLO LECTURA.
// Apagada es el estado por defecto y no es un problema: no se muestra. Lo que sí
// lo es: encendida con un agente que no la admite, porque cada consulta fallará.
// ══════════════════════════════════════════════════════════════════════════

const base = (config: Partial<Parameters<typeof EspejoClient>[0]['data']['config']> = {}) => ({
    config: {
        driverKey: 'cnt-sanvicente-anserma',
        enabled: true,
        availabilityMode: 'SHADOW',
        pushEnabled: true,
        pullEnabled: true,
        lastHeartbeatAt: new Date(),
        lastHisReachable: true,
        lastHisDetail: null,
        lookupEnabled: false,
        lastLookupCapable: null as boolean | null,
        ...config,
    },
    edadLatidoMin: 1,
    pendientes: 0,
    colaDesde: null,
    deadLetters: [],
    ultimaReconciliacion: null,
    ultimaAgenda: null,
    conflictos: [],
    cuposFuturos: 0,
});

describe('EspejoClient — consulta en vivo del rastreo', () => {
    it('apagada (por defecto): no se muestra, no es un problema', () => {
        render(<EspejoClient data={base()} />);
        expect(screen.queryByText('Consulta en vivo al HIS (rastreo)')).not.toBeInTheDocument();
    });

    it('encendida con un agente que la admite: en verde', () => {
        render(<EspejoClient data={base({ lookupEnabled: true, lastLookupCapable: true })} />);
        expect(screen.getByText('Consulta en vivo al HIS (rastreo)')).toBeInTheDocument();
        expect(screen.getByText(/puede preguntarle al hospital en vivo/)).toBeInTheDocument();
    });

    it('🚨 encendida pero el agente no informa que la admita (desactualizado): en rojo y dice qué hacer', () => {
        render(<EspejoClient data={base({ lookupEnabled: true, lastLookupCapable: null })} />);
        expect(screen.getByText(/no informa que la admita.*actualícelo/)).toBeInTheDocument();
    });

    it('🚨 encendida pero el driver no la implementa: en rojo', () => {
        render(<EspejoClient data={base({ lookupEnabled: true, lastLookupCapable: false })} />);
        expect(screen.getByText(/el driver del agente no la implementa/)).toBeInTheDocument();
    });

    it('es solo lectura: no hay ningún control para encenderla desde aquí', () => {
        render(<EspejoClient data={base({ lookupEnabled: true, lastLookupCapable: true })} />);
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /consulta en vivo/i })).not.toBeInTheDocument();
    });
});
