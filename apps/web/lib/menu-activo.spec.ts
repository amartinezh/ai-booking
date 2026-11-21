import { getMenusForRole } from './menus';
import { opcionActiva } from './menu-activo';

describe('opcionActiva: qué opción del menú se resalta', () => {
  const menus = getMenusForRole('ORG_ADMIN', {
    conEspejo: true,
    conAvisosDriver: true,
    conResumen: true,
  });

  it.each([
    ['/dashboard', '/dashboard'],
    ['/dashboard/', '/dashboard'],
    ['/dashboard/bandeja', '/dashboard/bandeja'],
    ['/dashboard/padron/historial/abc', '/dashboard/padron'],
    ['/dashboard/espejo/homologacion', '/dashboard/espejo'],
    ['/dashboard/espejo/avisos', '/dashboard/espejo/avisos'],
    ['/dashboard/espejo/resumen-atencion/envios', '/dashboard/espejo/resumen-atencion/envios'],
    ['/dashboard/configuracion?tab=kb', '/dashboard/configuracion'],
    ['/dashboard/encuestas', '/dashboard/encuestas'],
    ['/dashboard/configuracion/agenda', '/dashboard/configuracion'],
    ['/dashboard/soporte/ayuda#agenda', '/dashboard/soporte'],
  ])('%s → %s', (ruta, esperado) => {
    expect(opcionActiva(menus, ruta)).toBe(esperado);
  });

  it.each(['/dashboard/cuenta', '/dashboard/pacientes', '/dashboard/agendas', '/login', ''])(
    '%p no es de ninguna opción (ni de la Visión General)',
    (ruta) => {
      expect(opcionActiva(menus, ruta)).toBeNull();
    },
  );
});
