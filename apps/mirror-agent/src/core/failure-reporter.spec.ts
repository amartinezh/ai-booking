import { FailureReporter } from './failure-reporter';

describe('FailureReporter', () => {
  let lines: string[];
  let reporter: FailureReporter;

  beforeEach(() => {
    lines = [];
    // repeatEvery bajo para no tener que simular 20 vueltas en cada test.
    reporter = new FailureReporter((l) => lines.push(l), { repeatEvery: 3 });
  });

  it('emite el primer fallo completo', () => {
    reporter.report('AgenIA-HIS', 'el HIS cerro la conexion');

    expect(lines).toEqual([
      '[mirror-agent] AgenIA-HIS: el HIS cerro la conexion',
    ]);
  });

  it('calla los repetidos consecutivos hasta cumplir el intervalo', () => {
    for (let i = 0; i < 2; i++) reporter.report('AgenIA-HIS', 'mismo fallo');

    // La 1a se emite, la 2a se calla.
    expect(lines).toHaveLength(1);

    reporter.report('AgenIA-HIS', 'mismo fallo'); // la 3a: toca recuento
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('lleva 3 repeticiones');
  });

  it('no silencia un fallo DISTINTO: siempre se emite y reinicia la cuenta', () => {
    reporter.report('AgenIA-HIS', 'fallo A');
    reporter.report('AgenIA-HIS', 'fallo A');
    reporter.report('AgenIA-HIS', 'fallo B'); // distinto -> se emite
    reporter.report('AgenIA-HIS', 'fallo B');
    reporter.report('AgenIA-HIS', 'fallo B'); // 3a de B -> recuento

    expect(lines).toEqual([
      '[mirror-agent] AgenIA-HIS: fallo A',
      '[mirror-agent] AgenIA-HIS: fallo B',
      expect.stringContaining('lleva 3 repeticiones'),
    ]);
  });

  it('el mismo mensaje en etapas distintas son fallos distintos', () => {
    reporter.report('AgenIA-HIS', 'timeout');
    reporter.report('HIS-AgenIA', 'timeout');

    expect(lines).toHaveLength(2);
  });

  it('reset(etapa) hace que un fallo ya visto de ESA etapa vuelva a reportarse completo', () => {
    reporter.report('AgenIA-HIS', 'fallo A');
    reporter.report('AgenIA-HIS', 'fallo A'); // callado
    expect(lines).toHaveLength(1);

    reporter.reset('AgenIA-HIS'); // un ciclo limpio de ESA etapa
    reporter.report('AgenIA-HIS', 'fallo A'); // vuelve a fallar: se reporta
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('[mirror-agent] AgenIA-HIS: fallo A');
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🐛 Bug real de producción (Anserma, 2026-09-18): un único `reporter` se
  // reparte entre seis bucles independientes de `index.ts`. Con un solo
  // `lastKey`/`repeats` GLOBAL (versión anterior), cualquiera de esos bucles
  // reportando su propio fallo —o saliendo limpio y llamando a `reset()`—
  // borraba el progreso de amortiguación de TODOS los demás. El síntoma: la
  // misma línea de "avisos masivos: 403" en cada sondeo de ~30s durante
  // 2.833 vueltas en 24h, porque el sync-cycle principal (que corre varias
  // veces por minuto) reseteaba el contador antes de que llegara a
  // `repeatEvery`.
  // ══════════════════════════════════════════════════════════════════════
  it('🐛 un fallo de OTRA etapa entre medias NO reinicia el contador de esta', () => {
    reporter.report('avisos masivos', 'HIS no habilitado');
    reporter.report('avisos masivos', 'HIS no habilitado'); // 2a: callada

    // Algo totalmente ajeno reporta en el medio — antes, esto pisaba el
    // `lastKey` compartido y hacía que la SIGUIENTE de avisos-masivos se
    // viera "nueva" otra vez.
    reporter.report('reconciliación', 'DERIVA: 3 citas');

    reporter.report('avisos masivos', 'HIS no habilitado'); // 3a real: recuento

    expect(lines).toEqual([
      '[mirror-agent] avisos masivos: HIS no habilitado',
      '[mirror-agent] reconciliación: DERIVA: 3 citas',
      expect.stringContaining(
        'avisos masivos: el mismo fallo lleva 3 repeticiones',
      ),
    ]);
  });

  it('🐛 reset(etapa) de UN bucle no borra el progreso de amortiguación de otro', () => {
    reporter.report('avisos masivos', 'HIS no habilitado');
    reporter.report('avisos masivos', 'HIS no habilitado'); // callada

    // El sync-cycle sale limpio y resetea SU propia etapa — no la ajena.
    reporter.reset('AgenIA-HIS');

    reporter.report('avisos masivos', 'HIS no habilitado'); // 3a real: recuento

    expect(lines).toEqual([
      '[mirror-agent] avisos masivos: HIS no habilitado',
      expect.stringContaining(
        'avisos masivos: el mismo fallo lleva 3 repeticiones',
      ),
    ]);
  });

  it('reportAll procesa el lote respetando la amortiguacion', () => {
    reporter.reportAll('AgenIA-HIS', ['a', 'a', 'a', 'b']);

    // 'a' se emite una vez, se calla, y a la 3a emite recuento; 'b' se emite.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('[mirror-agent] AgenIA-HIS: a');
    expect(lines[1]).toContain('lleva 3 repeticiones');
    expect(lines[2]).toBe('[mirror-agent] AgenIA-HIS: b');
  });

  it('por defecto amortigua cada 20 repeticiones', () => {
    const otras: string[] = [];
    const porDefecto = new FailureReporter((l) => otras.push(l));

    for (let i = 0; i < 20; i++) porDefecto.report('etapa', 'mismo');

    expect(otras).toHaveLength(2); // la 1a + el recuento en la 20a
    expect(otras[1]).toContain('lleva 20 repeticiones');
  });
});
