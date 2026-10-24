/**
 * ══════════════════════════════════════════════════════════════════════════
 * 🩺 MÉDICOS DEL HOSPITAL QUE AGENIA TODAVÍA NO CONOCE (2026-10-24)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Un médico del hospital con citas de un servicio que AgenIA maneja (en Anserma,
 * medicina general) y que no está homologado deja a sus pacientes sin
 * recordatorio, y nadie se entera: pasó con la Dra. de código RU68, que volvió a
 * tener turnos después de que se dejara por fuera.
 *
 * Aquí se decide, con lo que el agente sube del hospital (`MirrorCatalogEntry`),
 * si se puede crear y homologar:
 *
 *  - BLOQUEOS — ni una persona con el botón puede: no hay a quién atarlo con
 *    certeza. Sin cédula; cédula repetida en el hospital (las agendas de
 *    programa comparten documentos de relleno); más de un médico de AgenIA con
 *    esa cédula; o el que la tiene ya está homologado con otro código.
 *  - ADVERTENCIAS — una persona puede igual (el botón las muestra), pero AgenIA
 *    no lo hace solo: el cargo no es de médico, su servicio principal no es uno
 *    que AgenIA maneje, o figura inactivo en el hospital.
 *
 * Puro: sin base de datos. Lo usan la API (el alta, el caso, el modo automático)
 * y el panel (el botón).
 */

export interface MedicoDelCatalogo {
  externalKey: string;
  /** El nombre que tiene en el hospital. */
  label: string;
  /** Lo que el driver manda: `cedula`, `cargo`, `estado`, `servicioDominante`… */
  extra?: Record<string, unknown> | null;
}

export interface ServicioDeAgenIA {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface ContextoMedicoNuevo {
  /** Cuántos médicos del catálogo del hospital tienen cada cédula (`cedulaNormalizada`). */
  vecesCedulaEnCatalogo: ReadonlyMap<string, number>;
  /** Los médicos de AgenIA que tienen su misma cédula, y con qué código están homologados. */
  medicosConLaCedula: readonly {
    id: string;
    fullName: string;
    homologadoComo: string | null;
  }[];
  /** El servicio de AgenIA de cada código de servicio del hospital. */
  servicioDeClaveHis: ReadonlyMap<string, ServicioDeAgenIA>;
}

export interface EvaluacionMedicoNuevo {
  externalKey: string;
  nombre: string;
  cedula: string | null;
  cargo: string | null;
  /** Su servicio principal en el hospital, ya en AgenIA (null si AgenIA no lo tiene). */
  servicio: ServicioDeAgenIA | null;
  /** CREAR un médico nuevo o ENLAZAR el que ya tiene esa cédula; null con bloqueos. */
  accion: 'CREAR' | 'ENLAZAR' | null;
  doctorIdExistente: string | null;
  bloqueos: string[];
  advertencias: string[];
}

const texto = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';

/** Solo dígitos y sin ceros a la izquierda; '' si no queda nada. */
export function cedulaNormalizada(v: unknown): string {
  return texto(v).replace(/\D/g, '').replace(/^0+/, '');
}

const sinTildes = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** «MEDICO RURAL», «MEDICO GENERAL», «MÉDICA»: sí. Auxiliares, enfermería, odontología…: no. */
export function esCargoDeMedico(cargo: string | null | undefined): boolean {
  const c = sinTildes(cargo ?? '');
  if (!/\bmedic[oa]s?\b/.test(c)) return false;
  return !/\b(aux\w*|enfermer\w*|odontolog\w*|fisioterap\w*|psicolog\w*|bacteriolog\w*|nutricion\w*|terapeut\w*|instrumentador\w*|regente)\b/.test(
    c,
  );
}

/** Las reglas, para un médico del catálogo que AgenIA no tiene homologado. */
export function evaluarMedicoNuevo(
  m: MedicoDelCatalogo,
  ctx: ContextoMedicoNuevo,
): EvaluacionMedicoNuevo {
  const extra = (m.extra ?? {}) as Record<string, unknown>;
  const cedula = cedulaNormalizada(extra.cedula) || null;
  const cargo = texto(extra.cargo) || null;
  const servicio =
    ctx.servicioDeClaveHis.get(texto(extra.servicioDominante)) ?? null;
  const bloqueos: string[] = [];
  const advertencias: string[] = [];

  if (!cedula || cedula.length < 5) {
    bloqueos.push('El hospital no tiene su cédula.');
  } else if ((ctx.vecesCedulaEnCatalogo.get(cedula) ?? 0) > 1) {
    bloqueos.push(
      `Su cédula la tienen ${ctx.vecesCedulaEnCatalogo.get(cedula)} médicos del hospital (un documento de relleno): no se sabe cuál es.`,
    );
  }

  let accion: EvaluacionMedicoNuevo['accion'] = 'CREAR';
  let doctorIdExistente: string | null = null;
  if (ctx.medicosConLaCedula.length > 1) {
    bloqueos.push(
      `Hay ${ctx.medicosConLaCedula.length} médicos en AgenIA con su cédula.`,
    );
  } else if (ctx.medicosConLaCedula.length === 1) {
    const d = ctx.medicosConLaCedula[0];
    if (d.homologadoComo && d.homologadoComo !== m.externalKey) {
      bloqueos.push(
        `Su cédula ya es de ${d.fullName} en AgenIA, homologado con el código ${d.homologadoComo}.`,
      );
    } else {
      accion = 'ENLAZAR';
      doctorIdExistente = d.id;
    }
  }
  if (bloqueos.length > 0) accion = null;

  if (!esCargoDeMedico(cargo)) {
    advertencias.push(
      cargo
        ? `Su cargo en el hospital es «${cargo}», no de médico.`
        : 'El hospital no dice su cargo.',
    );
  }
  if (!servicio) {
    advertencias.push(
      'Su servicio principal en el hospital no está en AgenIA: quedaría sin servicio.',
    );
  } else if (!servicio.activo) {
    advertencias.push(
      `Su servicio principal en el hospital es «${servicio.nombre}», que AgenIA no maneja.`,
    );
  }
  if (extra.estado !== undefined && texto(extra.estado) !== '1') {
    advertencias.push('Figura inactivo en el sistema del hospital.');
  }

  return {
    externalKey: m.externalKey,
    nombre: m.label.trim(),
    cedula,
    cargo,
    servicio,
    accion,
    doctorIdExistente,
    bloqueos,
    advertencias,
  };
}

/** Lo puede crear y homologar una persona con el botón (las advertencias se le muestran). */
export const puedeHomologarseConBoton = (e: EvaluacionMedicoNuevo): boolean =>
  e.bloqueos.length === 0 && e.accion !== null;

/** Lo puede hacer AgenIA solo: sin bloqueos y sin una sola advertencia. */
export const puedeHomologarseSolo = (e: EvaluacionMedicoNuevo): boolean =>
  puedeHomologarseConBoton(e) && e.advertencias.length === 0;
