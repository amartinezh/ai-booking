import { esTipoDescarga, nombreDePantalla, rutaLimpia } from './pantallas';

describe('nombreDePantalla', () => {
    it('usa el nombre del menú de esa persona', () => {
        expect(nombreDePantalla('/dashboard', 'ORG_ADMIN')).toBe('Visión General');
        expect(nombreDePantalla('/dashboard', 'DOCTOR')).toBe('Mi Agenda');
        expect(nombreDePantalla('/dashboard/auditoria', 'BOOKING_AGENT')).toBe('Caja Negra (Auditoría)');
        expect(nombreDePantalla('/dashboard/bandeja', 'ORG_ADMIN')).toBe('Bandeja de sincronización');
        expect(nombreDePantalla('/super-admin/actividad', 'SUPER_ADMIN')).toBe('Actividad de usuarios');
    });

    it('las que no están en el menú tienen su nombre', () => {
        expect(nombreDePantalla('/dashboard/pacientes', 'ORG_ADMIN')).toBe('Pacientes');
        expect(nombreDePantalla('/super-admin/cuenta', 'SUPER_ADMIN')).toBe('Cambiar mi clave');
        expect(nombreDePantalla('/super-admin/organizations/abc-123/admins', 'SUPER_ADMIN')).toBe(
            'Administradores de una clínica',
        );
    });

    it('sin la consulta (puede llevar una cédula) ni la barra final', () => {
        expect(rutaLimpia('/dashboard/rastreo?q=1053123456#x')).toBe('/dashboard/rastreo');
        expect(rutaLimpia('/dashboard/pacientes/')).toBe('/dashboard/pacientes');
        expect(nombreDePantalla('/dashboard/pacientes/?buscar=1053123456', 'ORG_ADMIN')).toBe('Pacientes');
    });

    it('lo que no se reconoce no se anota', () => {
        expect(nombreDePantalla('/login', 'ORG_ADMIN')).toBeNull();
        expect(nombreDePantalla('/dashboard/inventada', 'ORG_ADMIN')).toBeNull();
        expect(nombreDePantalla('/super-admin/actividad', 'ORG_ADMIN')).toBeNull();
    });

    it('descargas conocidas', () => {
        expect(esTipoDescarga('AVISOS_SIN_CELULAR')).toBe(true);
        expect(esTipoDescarga('TODO_EL_PADRON')).toBe(false);
    });
});
