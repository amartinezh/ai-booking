import { Logger } from '@nestjs/common';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getMenusForRole } from '@agenia/shared';
import { SupportBotKnowledgeService } from './support-bot-knowledge.service';

/** El manual del asistente: el AGENIA.md de siempre, leído por la API. */
describe('SupportBotKnowledgeService', () => {
  const ENV = process.env.AGENIA_CONOCIMIENTO_PATH;
  const REAL = join(__dirname, '../../../../docs/conocimiento/AGENIA.md');
  let error: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    delete process.env.AGENIA_CONOCIMIENTO_PATH;
  });
  afterEach(() => {
    if (ENV === undefined) delete process.env.AGENIA_CONOCIMIENTO_PATH;
    else process.env.AGENIA_CONOCIMIENTO_PATH = ENV;
    jest.restoreAllMocks();
  });

  it('encuentra AGENIA.md subiendo desde el directorio de trabajo y lo guarda', () => {
    const svc = new SupportBotKnowledgeService();
    const a = svc.cargar();
    expect(a?.contenido.temas.length).toBeGreaterThan(10);
    expect(svc.cargar()).toBe(a);
  });

  it('arma el manual de cada rol una vez por versión del archivo', () => {
    const svc = new SupportBotKnowledgeService();
    const menus = getMenusForRole('DOCTOR');
    const m = svc.manualPara('DOCTOR', menus);
    expect(m?.delUsuario).toContain('- Rol: Médico.');
    expect(svc.manualPara('DOCTOR', menus)).toBe(m);
    expect(svc.manualPara('ORG_ADMIN', getMenusForRole('ORG_ADMIN'))).not.toBe(
      m,
    );
  });

  it('el buscador encuentra lo más cercano del manual', () => {
    const r = new SupportBotKnowledgeService().buscar(
      'clonar la agenda de un día a otro',
    );
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r[0]).toMatchObject({ tema: 'Agendas (Slots)' });
    expect(r[0].extracto.length).toBeGreaterThan(0);
  });

  it('un término del glosario sale como «Glosario»', () => {
    const r = new SupportBotKnowledgeService().buscar('qué es el padrón', 3);
    expect(
      r.some((x) => x.tema === 'Glosario' || x.tema.includes('Padrón')),
    ).toBe(true);
  });

  describe('con un archivo propio', () => {
    let dir: string;
    let ruta: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'agenia-manual-'));
      ruta = join(dir, 'AGENIA.md');
      writeFileSync(ruta, readFileSync(REAL, 'utf8'));
      process.env.AGENIA_CONOCIMIENTO_PATH = ruta;
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('relee el archivo cuando cambia', () => {
      const svc = new SupportBotKnowledgeService();
      const a = svc.cargar();
      writeFileSync(
        ruta,
        readFileSync(REAL, 'utf8').replace('# Parte 2', '# Parte 2'),
      );
      utimesSync(ruta, new Date(), new Date(Date.now() + 5_000));
      expect(svc.cargar()).not.toBe(a);
    });

    it('si el archivo se rompe, sigue con el último bueno y avisa UNA vez', () => {
      const svc = new SupportBotKnowledgeService();
      const bueno = svc.cargar();
      writeFileSync(ruta, 'roto');
      utimesSync(ruta, new Date(), new Date(Date.now() + 10_000));
      expect(svc.cargar()).toBe(bueno);
      expect(svc.cargar()).toBe(bueno);
      expect(error).toHaveBeenCalledTimes(1);
    });
  });

  it('sin archivo: null, sin manual, sin resultados, y avisa una vez', () => {
    process.env.AGENIA_CONOCIMIENTO_PATH = '/no/existe/AGENIA.md';
    const svc = new SupportBotKnowledgeService();
    expect(svc.cargar()).toBeNull();
    expect(svc.manualPara('DOCTOR', [])).toBeNull();
    expect(svc.buscar('agenda')).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('sin la variable y lejos del repositorio, tampoco lo encuentra', () => {
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue('/');
    expect(new SupportBotKnowledgeService().cargar()).toBeNull();
    cwd.mockRestore();
  });
});
