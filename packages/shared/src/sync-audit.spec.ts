import { SYNC_AUDIT_DIRECTION } from './sync-audit';

describe('SYNC_AUDIT_DIRECTION', () => {
  // Estas cadenas YA están escritas en las filas históricas de SyncAudit y la
  // pantalla de auditoría del espejo las traduce con su propio mapa. Renombrar
  // una aquí no migra esas filas: partiría la historia en dos y los filtros
  // dejarían de encontrar lo anterior. Si de verdad hay que cambiar una, es una
  // migración de datos, no una edición de constante.
  it('conserva los valores históricos, uno por dirección', () => {
    expect(SYNC_AUDIT_DIRECTION).toEqual({
      AGENIA_TO_HIS: 'AGENIA_TO_HIS',
      INBOUND: 'INBOUND',
      HIS_TO_AGENIA: 'HIS_TO_AGENIA',
      RECONCILE: 'RECONCILE',
      CONFIG: 'CONFIG',
    });
  });

  it('cada clave es igual a su valor (una errata no crea una dirección nueva)', () => {
    for (const [clave, valor] of Object.entries(SYNC_AUDIT_DIRECTION)) {
      expect(valor).toBe(clave);
    }
  });
});
