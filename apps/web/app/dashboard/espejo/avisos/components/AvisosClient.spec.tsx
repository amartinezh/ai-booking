import { render, screen } from '@testing-library/react';

jest.mock('@/app/actions/avisos', () => ({
    getBatchAction: jest.fn(),
    getNoticeRequestStatusAction: jest.fn(),
    loadAvisosFileAction: jest.fn(),
    requestNoticeRosterAction: jest.fn(),
    sendBatchAction: jest.fn(),
    toggleRecipientSelectionAction: jest.fn(),
    updateAvisosConfigAction: jest.fn(),
    updateBatchNotaAdicionalAction: jest.fn(),
    validateAvisosFileAction: jest.fn(),
    listBatchesAction: jest.fn(),
}));

import AvisosClient from './AvisosClient';

const DOCTORES = [{ externalKey: '076', label: 'ADRIAN CAMILO SALAZAR SANCHEZ' }];

/**
 * 🐛 El agendador no recibe la configuración (es del administrador) y la
 * pantalla, sin ella, mostraba el flujo de archivo aunque la clínica trajera
 * la lista del hospital. Ahora la fuente le llega aparte.
 */
describe('AvisosClient — cómo se arma la lista según el perfil', () => {
    it('el AGENDADOR, con la clínica en «Traer del hospital», ve ese flujo y no el de archivo', () => {
        render(
            <AvisosClient
                isOrgAdmin={false}
                conAvisos
                initialConfig={null}
                fuente="ESPEJO"
                initialBatches={[]}
                initialDoctors={DOCTORES}
            />,
        );
        expect(screen.getByText(/Paso 1 · Traer del hospital/)).toBeInTheDocument();
        expect(screen.queryByText(/Validar archivo/)).not.toBeInTheDocument();
    });

    it('con la clínica en archivo, el agendador ve el flujo de archivo', () => {
        render(
            <AvisosClient
                isOrgAdmin={false}
                conAvisos
                initialConfig={null}
                fuente="CSV"
                initialBatches={[]}
                initialDoctors={DOCTORES}
            />,
        );
        expect(screen.getByText(/Validar archivo/)).toBeInTheDocument();
        expect(screen.queryByText(/Paso 1 · Traer del hospital/)).not.toBeInTheDocument();
    });
});
