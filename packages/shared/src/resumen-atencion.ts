/**
 * Resumen de la atención (docs/PLAN_RESUMEN_ATENCION.md): cuando el médico
 * termina la historia en el HIS, el paciente recibe el resumen y sus documentos.
 *
 * Aquí vive lo que comparten el agente del hospital, la API y el panel:
 *   · la configuración de la clínica y sus interruptores (§3.11), que se leen
 *     SIEMPRE como apagados si falta el dato;
 *   · la regla que decide si un documento puede salir por un canal;
 *   · la forma del resumen que arma el agente con lo que leyó del HIS;
 *   · los mensajes entre el agente y la API (`/mirror/attention-summaries*`).
 *
 * Sin dependencias de Node: el panel también lo importa.
 */

// ─── Configuración e interruptores (plan §3.11) ─────────────────────────────

export type CanalResumen = 'WHATSAPP' | 'TELEGRAM' | 'EMAIL';
export const CANALES_RESUMEN: readonly CanalResumen[] = ['WHATSAPP', 'TELEGRAM', 'EMAIL'];

/** Un campo de la plantilla del HIS que va al resumen (plan §3.2, D2). */
export interface CampoPlantillaResumen {
  /** Número de la plantilla en el HIS (en Anserma, `NU_NUME_PLHI`). */
  plantilla: number;
  /** Grupo del campo; `null` = cualquier grupo. */
  grupo: string | null;
  /** Nombre exacto del campo en el HIS. */
  campo: string;
  /** Cómo se titula en el resumen («Motivo», «Plan», «Próximo control»…). */
  seccion: string;
}

export interface ConfigResumenAtencion {
  /** «Leer del hospital»: el agente arma y sube resúmenes. Solo, sin «enviar», es la lectura en sombra. */
  leerDelHospital: boolean;
  /** «Enviar a pacientes»: el freno general. */
  enviar: boolean;
  /** Un interruptor por canal. */
  canales: Record<CanalResumen, boolean>;
  /**
   * Matriz servicio del HIS × canal. Un servicio que está aquí se LEE (aunque
   * tenga todos sus canales apagados: así se revisa en sombra); un canal suyo
   * encendido además lo ENVÍA. Un servicio que no está no se lee ni se envía.
   */
  servicios: Record<string, Record<CanalResumen, boolean>>;
  /** Mientras tenga destinos, solo se les envía a ellos (el equipo). */
  modoPrueba: { destinos: string[] };
  /**
   * El piloto aprobado: solo así «Enviar» funciona SIN números del equipo, es
   * decir, a los pacientes. Sin aprobar, la lista vacía no envía a nadie.
   */
  piloto: { aprobado: boolean; desdeIso: string | null };
  /** Minutos que se esperan desde que se guardó la historia (plan §3.1). */
  calmaMinutos: number;
  /** Horario de envío en la zona de la clínica: desde (incluida) hasta (excluida). */
  horario: { desdeHora: number; hastaHora: number };
  /** Campos de plantilla que van al resumen. `null` = los que el driver trae por defecto. */
  camposPlantilla: CampoPlantillaResumen[] | null;
}

export const LIMITES_RESUMEN_ATENCION = {
  /** Resúmenes por lote del agente. */
  maxPorLote: 50,
  calmaMinutosPorDefecto: 120,
  calmaMinutosMin: 30,
  calmaMinutosMax: 1440,
  horarioPorDefecto: { desdeHora: 7, hastaHora: 20 },
  /** D11: el contenido cifrado se borra a los 30 días. */
  retencionContenidoDias: 30,
  /** D11: los datos del envío (sin contenido) se quedan un año. */
  retencionMetadatosDias: 365,
  /** Tope del contenido de un resumen, en caracteres de JSON (uno normal pesa 3-10 KB). */
  maxCaracteresContenido: 200_000,
  /** La primera vez, desde cuántas horas atrás empieza a leer el agente. */
  horasHaciaAtrasAlEmpezar: 6,
  /** Vueltas medidas que se guardan (a 5 minutos por vuelta, un día). */
  medicionesGuardadas: 288,
  /** Una medición de más de una hora es un dato roto. */
  medicionMaxMs: 3_600_000,
  /** Fase 1: el hospital revisa 20 resúmenes contra el HIS antes de pensar en enviar. */
  revisionesParaCerrar: 20,
  maxCaracteresNotaRevision: 500,
} as const;

/**
 * Campos de plantilla que van al resumen si la clínica no configuró otros
 * (`camposPlantilla` = null), con los nombres exactos de ESEHSVP (ronda 4,
 * R4-5): plantilla 870 «Consulta externa» y 844 «Control crónicos». Driver
 * cnt-sanvicente-anserma. Los aprueba el comité (D2).
 */
export const CAMPOS_PLANTILLA_POR_DEFECTO: CampoPlantillaResumen[] = [
  // 870 CONSULTA EXTERNA (medicina general)
  {
    plantilla: 870,
    grupo: 'MOTIVO DE CONSULTA',
    campo: 'MC:',
    seccion: 'Motivo',
  },
  { plantilla: 870, grupo: 'CONDUCTA', campo: 'Anotaciones', seccion: 'Plan' },
  {
    plantilla: 870,
    grupo: 'EDUCACION.',
    campo: 'Acerca de:',
    seccion: 'Educación',
  },
  // 844 CONTROL CRÓNICOS (hipertensos y diabéticos)
  { plantilla: 844, grupo: 'CONDUCTA', campo: 'Conducta', seccion: 'Plan' },
  {
    plantilla: 844,
    grupo: 'CONDUCTA',
    campo: 'Proximo control*',
    seccion: 'Próximo control',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Metas de educacion para el proximo control',
    seccion: 'Metas',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Dieta hiposódica',
    seccion: 'Educación',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Dieta hipograsa',
    seccion: 'Educación',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Dieta hipoglucida',
    seccion: 'Educación',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Aumento del ejercicio',
    seccion: 'Educación',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Disminución de peso',
    seccion: 'Educación',
  },
  {
    plantilla: 844,
    grupo: 'EDUCACIÓN',
    campo: 'Disminucion del tabaquismo',
    seccion: 'Educación',
  },
  // 858 Medicina interna y 899 Ginecología
  {
    plantilla: 858,
    grupo: 'MOTIVO CONSULTA Y ENFERMEDAD ACTUAL',
    campo: 'Motivo de la Consulta',
    seccion: 'Motivo',
  },
  {
    plantilla: 858,
    grupo: 'EXAMEN FISICO GENERAL',
    campo: 'Análisis y Plan',
    seccion: 'Plan',
  },
  {
    plantilla: 899,
    grupo: 'MOTIVO CONSULTA Y ENFERMEDAD ACTUAL',
    campo: 'Motivo de la Consulta',
    seccion: 'Motivo',
  },
  {
    plantilla: 899,
    grupo: 'EXAMEN FISICO GENERAL',
    campo: 'Análisis y Plan',
    seccion: 'Plan',
  },
  // 907 Nutrición
  {
    plantilla: 907,
    grupo: 'MOTIVO CONSULTA',
    campo: 'Motivo de la Consulta',
    seccion: 'Motivo',
  },
  {
    plantilla: 907,
    grupo: 'RECOMENDACIONES Y OBSERVACIONES',
    campo: 'Recomendaciones',
    seccion: 'Recomendaciones',
  },
  {
    plantilla: 907,
    grupo: 'RECOMENDACIONES Y OBSERVACIONES',
    campo: 'Observaciones',
    seccion: 'Recomendaciones',
  },
  {
    plantilla: 907,
    grupo: 'RECOMENDACIONES Y OBSERVACIONES',
    campo: 'Próximo Control:',
    seccion: 'Próximo control',
  },
];

const apagados = (): Record<CanalResumen, boolean> => ({ WHATSAPP: false, TELEGRAM: false, EMAIL: false });

const esObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function leerCanales(x: unknown): Record<CanalResumen, boolean> {
  const r = apagados();
  if (!esObjeto(x)) return r;
  for (const c of CANALES_RESUMEN) r[c] = x[c] === true;
  return r;
}

function enteroEntre(x: unknown, min: number, max: number): number | null {
  return typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max ? x : null;
}

function leerCamposPlantilla(x: unknown): CampoPlantillaResumen[] | null {
  if (!Array.isArray(x)) return null;
  const r: CampoPlantillaResumen[] = [];
  for (const c of x) {
    if (!esObjeto(c)) continue;
    const plantilla = enteroEntre(c.plantilla, 1, 1_000_000);
    const campo = typeof c.campo === 'string' ? c.campo.trim() : '';
    const seccion = typeof c.seccion === 'string' ? c.seccion.trim() : '';
    if (plantilla === null || !campo || !seccion) continue;
    const grupo = typeof c.grupo === 'string' && c.grupo.trim() ? c.grupo.trim() : null;
    r.push({ plantilla, grupo, campo, seccion });
  }
  return r;
}

/**
 * Lee `HospitalMirrorConfig.resumenAtencion` tal como esté guardado.
 *
 * `null`/`undefined` (o algo que no es un objeto) = la función no existe para
 * esta clínica. Cualquier interruptor que falte o no sea exactamente `true` se
 * lee APAGADO: un dato roto nunca enciende un envío.
 */
export function leerConfigResumenAtencion(json: unknown): ConfigResumenAtencion | null {
  if (!esObjeto(json)) return null;

  const servicios: ConfigResumenAtencion['servicios'] = {};
  if (esObjeto(json.servicios)) {
    for (const [codigo, canales] of Object.entries(json.servicios)) {
      const clave = codigo.trim();
      if (clave) servicios[clave] = leerCanales(canales);
    }
  }

  const destinos: string[] = [];
  if (esObjeto(json.modoPrueba) && Array.isArray(json.modoPrueba.destinos)) {
    for (const d of json.modoPrueba.destinos) {
      if (typeof d === 'string' && d.trim()) destinos.push(d.trim());
    }
  }

  const L = LIMITES_RESUMEN_ATENCION;
  let horario: ConfigResumenAtencion['horario'] = { ...L.horarioPorDefecto };
  if (esObjeto(json.horario)) {
    const desde = enteroEntre(json.horario.desdeHora, 0, 23);
    const hasta = enteroEntre(json.horario.hastaHora, 1, 24);
    if (desde !== null && hasta !== null && desde < hasta) horario = { desdeHora: desde, hastaHora: hasta };
  }

  const aprobado = esObjeto(json.piloto) && json.piloto.aprobado === true;
  const desdeIso =
    aprobado && esObjeto(json.piloto) && typeof json.piloto.desdeIso === 'string' ? json.piloto.desdeIso : null;

  return {
    leerDelHospital: json.leerDelHospital === true,
    enviar: json.enviar === true,
    canales: leerCanales(json.canales),
    servicios,
    modoPrueba: { destinos },
    piloto: { aprobado, desdeIso },
    calmaMinutos: enteroEntre(json.calmaMinutos, L.calmaMinutosMin, L.calmaMinutosMax) ?? L.calmaMinutosPorDefecto,
    horario,
    camposPlantilla: leerCamposPlantilla(json.camposPlantilla),
  };
}

/** La configuración con la que nace la función para una clínica: todo apagado. */
export function configResumenAtencionApagada(): ConfigResumenAtencion {
  return leerConfigResumenAtencion({}) as ConfigResumenAtencion;
}

/** ¿El agente debe leer la historia clínica del hospital? */
export function puedeLeerDelHospital(config: ConfigResumenAtencion | null): boolean {
  return config !== null && config.leerDelHospital;
}

/** Los servicios del HIS que se leen: los que están en la matriz. */
export function serviciosALeer(config: ConfigResumenAtencion | null): string[] {
  return config ? Object.keys(config.servicios).sort() : [];
}

/** Un destino, comparable: teléfono solo con dígitos, correo en minúsculas, chat de Telegram tal cual. */
export function normalizarDestino(canal: CanalResumen, destino: string): string {
  const d = destino.trim();
  if (canal === 'WHATSAPP') return d.replace(/\D/g, '');
  if (canal === 'EMAIL') return d.toLowerCase();
  return d;
}

export type MotivoNoEnvio =
  | 'FUNCION_INEXISTENTE'
  | 'ENVIO_APAGADO'
  | 'CANAL_APAGADO'
  | 'SERVICIO_APAGADO'
  | 'FUERA_DE_MODO_PRUEBA'
  | 'PILOTO_SIN_APROBAR';

export const TEXTO_MOTIVO_NO_ENVIO: Record<MotivoNoEnvio, string> = {
  FUNCION_INEXISTENTE: 'La función no está habilitada para la clínica',
  ENVIO_APAGADO: '«Enviar a pacientes» está apagado',
  CANAL_APAGADO: 'Ese canal está apagado',
  SERVICIO_APAGADO: 'El servicio de la consulta no tiene ese canal encendido',
  FUERA_DE_MODO_PRUEBA: 'Modo prueba: el destino no está en la lista del equipo',
  PILOTO_SIN_APROBAR: 'El piloto no está aprobado: sin números del equipo no sale nada',
};

/**
 * ¿Puede salir un documento por este canal? Solo los interruptores (§3.11): las
 * exclusiones clínicas, la baja, el contacto y el horario los revisa quien envía.
 * Se llama al programar y otra vez justo antes de mandar.
 */
export function puedeEnviarPorCanal(
  config: ConfigResumenAtencion | null,
  envio: { canal: CanalResumen; servicio: string | null; destino: string },
): { ok: true } | { ok: false; motivo: MotivoNoEnvio } {
  if (!config) return { ok: false, motivo: 'FUNCION_INEXISTENTE' };
  if (!config.enviar) return { ok: false, motivo: 'ENVIO_APAGADO' };
  if (!config.canales[envio.canal]) return { ok: false, motivo: 'CANAL_APAGADO' };
  const servicio = envio.servicio?.trim() ?? '';
  if (!servicio || !config.servicios[servicio]?.[envio.canal]) return { ok: false, motivo: 'SERVICIO_APAGADO' };
  if (config.modoPrueba.destinos.length > 0) {
    const destino = normalizarDestino(envio.canal, envio.destino);
    const lista = config.modoPrueba.destinos.map((d) => normalizarDestino(envio.canal, d));
    if (!destino || !lista.includes(destino)) return { ok: false, motivo: 'FUERA_DE_MODO_PRUEBA' };
  } else if (!config.piloto.aprobado) {
    // Sin la lista del equipo, solo el piloto aprobado deja salir a pacientes:
    // una configuración rota o escrita a mano nunca le envía a nadie.
    return { ok: false, motivo: 'PILOTO_SIN_APROBAR' };
  }
  return { ok: true };
}

// ─── Lo que el panel puede cambiar en la Fase 1 ─────────────────────────────

export interface CambioLecturaResumen {
  leerDelHospital?: boolean;
  /** Los servicios del HIS que se leen; reemplaza la lista. */
  serviciosALeer?: string[];
  calmaMinutos?: number;
}

const enLetras = (b: boolean) => (b ? 'encendido' : 'apagado');

/**
 * Aplica sobre la configuración guardada lo que el panel deja cambiar mientras
 * solo existe la lectura en sombra (Fase 1): «Leer del hospital», qué servicios
 * se leen y la calma.
 *
 * NUNCA enciende «Enviar» ni un canal: el envío llega en las Fases 2-4, y si el
 * panel dejara prenderlos hoy, al desplegar el envío saldría todo de una vez
 * (decisión del usuario: nace apagado). Un servicio que sigue en la matriz
 * conserva sus canales; uno nuevo entra con todos apagados; el resto del Json
 * queda tal cual.
 *
 * Devuelve la configuración nueva y, en palabras, lo que cambió (para la
 * Actividad de usuarios), o el motivo si el cambio no es válido.
 */
export function aplicarCambioDeLectura(
  json: unknown,
  cambio: CambioLecturaResumen,
): { ok: true; config: Record<string, unknown>; cambios: string[] } | { ok: false; error: string } {
  const base: Record<string, unknown> = esObjeto(json) ? { ...json } : {};
  const antes = leerConfigResumenAtencion(base) ?? configResumenAtencionApagada();
  const cambios: string[] = [];

  if (cambio.leerDelHospital !== undefined) {
    const nuevo = cambio.leerDelHospital === true;
    if (nuevo !== antes.leerDelHospital) cambios.push(`Leer del hospital: ${enLetras(antes.leerDelHospital)} → ${enLetras(nuevo)}`);
    base.leerDelHospital = nuevo;
  }

  if (cambio.serviciosALeer !== undefined) {
    if (!Array.isArray(cambio.serviciosALeer)) return { ok: false, error: 'La lista de servicios no es válida.' };
    const lista = [...new Set(cambio.serviciosALeer.map((s) => String(s).trim()).filter(Boolean))].sort();
    if (lista.some((s) => s.length > 20)) return { ok: false, error: 'Un código de servicio es demasiado largo.' };
    const guardados = esObjeto(base.servicios) ? base.servicios : {};
    const servicios: Record<string, unknown> = {};
    for (const codigo of lista) {
      const previo = Object.entries(guardados).find(([k]) => k.trim() === codigo)?.[1];
      servicios[codigo] = esObjeto(previo) ? previo : apagados();
    }
    const antesLista = Object.keys(antes.servicios).sort();
    if (antesLista.join(',') !== lista.join(',')) {
      cambios.push(`Servicios que se leen: ${antesLista.join(', ') || 'ninguno'} → ${lista.join(', ') || 'ninguno'}`);
    }
    base.servicios = servicios;
  }

  if (cambio.calmaMinutos !== undefined) {
    const L = LIMITES_RESUMEN_ATENCION;
    const m = enteroEntre(cambio.calmaMinutos, L.calmaMinutosMin, L.calmaMinutosMax);
    if (m === null) return { ok: false, error: `La calma va de ${L.calmaMinutosMin} a ${L.calmaMinutosMax} minutos.` };
    if (m !== antes.calmaMinutos) cambios.push(`Calma: ${antes.calmaMinutos} → ${m} minutos`);
    base.calmaMinutos = m;
  }

  return { ok: true, config: base, cambios };
}

// ─── El resumen que arma el agente (plan §3.2 y §3.9) ───────────────────────

export type TipoOrdenResumen = 'MEDICAMENTOS' | 'LABORATORIO' | 'PROCEDIMIENTO' | 'CONSULTA' | 'CIRUGIA';

export interface RenglonMedicamentoResumen {
  codigo: string;
  nombre: string;
  cum: string | null;
  invima: string | null;
  medida: string | null;
  concentracion: string | null;
  forma: string | null;
  via: string | null;
  cantidad: number | null;
  /** Días de tratamiento. */
  duracionDias: number | null;
  /** La indicación tal como la escribió el médico (D19). Nunca el texto que arma el HIS. */
  indicacion: string | null;
  /** Frecuencia estructurada ya traducida («cada 12 horas»): solo de respaldo si no hay indicación (D19). */
  frecuencia: string | null;
  /** `true` si farmacia ya lo entregó. */
  entregado: boolean;
}

export interface RenglonExamenResumen {
  codigo: string;
  nombre: string;
  cantidad: number | null;
  indicacion: string | null;
}

/** Una orden = una hoja de la fórmula o de la orden de exámenes (D25). */
export interface OrdenResumen {
  numero: string;
  tipo: TipoOrdenResumen;
  /** Fórmula: `AI` farmacia del hospital, `AE` dispensador externo. */
  farmacia: 'AI' | 'AE' | null;
  escritaIso: string | null;
  /** Orden posfechada: desde cuándo se reclama. */
  desdeIso: string | null;
  /** Número de la orden que encabeza la serie posfechada. */
  serie: string | null;
  vigencia: string | null;
  medicamentos: RenglonMedicamentoResumen[];
  examenes: RenglonExamenResumen[];
}

export interface RemisionResumen {
  numero: string;
  fechaIso: string | null;
  remiteA: string | null;
  servicioPedido: string | null;
  /** CUPS de la consulta pedida. */
  cups: string | null;
  /** Código del HIS (0-3); se traduce cuando se confirme el catálogo. */
  prioridad: string | null;
  motivo: string | null;
  observaciones: string | null;
  /** Lo que mide la descripción del caso clínico. El texto no viaja en esta versión (D24). */
  casoClinicoCaracteres: number;
}

export interface IncapacidadResumen {
  numero: string;
  desdeIso: string | null;
  dias: number | null;
  prorroga: boolean;
  tipo: string | null;
  origen: string | null;
  observacion: string | null;
}

export interface DiagnosticoResumen {
  cie10: string;
  descripcion: string | null;
  tipo: string | null;
  principal: boolean;
}

export interface ResumenAtencionHis {
  version: 1;
  historia: {
    /** Llave de la atención en el HIS (en Anserma, `NU_NUME_HICL`). */
    numero: string;
    guardadaIso: string;
    servicio: string | null;
    nombreServicio: string | null;
    plantilla: number | null;
    codigoPlantilla: string | null;
    nombrePlantilla: string | null;
    especialidad: string | null;
    edad: number | null;
  };
  paciente: {
    documento: string;
    tipoDocumento: string | null;
    nombre: string;
    fechaNacimientoIso: string | null;
    celular: string | null;
    correo: string | null;
    celularAcompanante: string | null;
    correoAcompanante: string | null;
  };
  medico: { codigo: string | null; nombre: string | null; documento: string | null; registro: string | null };
  afiliacion: { convenio: string | null; administradora: string | null; tipoUsuario: string | null };
  diagnosticos: DiagnosticoResumen[];
  ordenes: OrdenResumen[];
  remisiones: RemisionResumen[];
  incapacidades: IncapacidadResumen[];
  interconsultas: { especialidad: string | null; observacion: string | null }[];
  /** Indicaciones del médico al paciente (en consulta externa son para él: ronda 5). */
  indicaciones: string[];
  /** Solo los campos de plantilla de la lista (`camposPlantilla`). */
  campos: { seccion: string; grupo: string | null; campo: string; valor: string }[];
}

// ─── Mensajes entre el agente y la API ──────────────────────────────────────

/** GET /mirror/attention-summaries/state — qué debe hacer el agente en esta vuelta. */
export interface EstadoResumenesAgente {
  leer: boolean;
  /** Último número de historia leído; `null` = empezar desde hace `horasHaciaAtrasAlEmpezar`. */
  cursor: string | null;
  calmaMinutos: number;
  maxPorLote: number;
  /** Servicios del HIS que se leen (la matriz). Vacío = no se lee nada. */
  servicios: string[];
  /** `null` = los campos de plantilla por defecto del driver. */
  camposPlantilla: CampoPlantillaResumen[] | null;
}

/** Lo que tardaron las consultas del agente al HIS en una vuelta (Fase 1: «la consulta pesa poco»). */
export interface MedicionLecturaResumen {
  /** La consulta que busca las historias terminadas. */
  detectarMs: number;
  /** Las consultas que leen esas historias (0 si no hubo ninguna). */
  leerMs: number;
  /** Cuántas historias leyó. */
  historias: number;
}

/** POST /mirror/attention-summaries */
export interface ResumenesAtencionInput {
  resumenes: ResumenAtencionHis[];
  /** Hasta dónde quedó leído; el servidor lo guarda para la vuelta siguiente. */
  nextCursor: string;
  /** Un agente anterior no la manda. */
  medicion?: MedicionLecturaResumen;
}

export interface ResumenesAtencionResult {
  recibidos: number;
  nuevos: number;
  actualizados: number;
  sinCambios: number;
  rechazados: { numero: string | null; motivo: string }[];
}

const textoOpcional = (x: unknown, max: number) => x === null || (typeof x === 'string' && x.length <= max);

/**
 * Revisa un resumen que llega del agente. Devuelve el motivo si no sirve, o
 * `null`. No es exhaustivo campo por campo: asegura lo que la API usa (llave,
 * fecha, documento, listas) y que nada sea desmedido.
 */
export function validarResumenAtencion(x: unknown): string | null {
  if (!esObjeto(x)) return 'no es un objeto';
  if (x.version !== 1) return 'versión desconocida';
  const h = x.historia;
  if (!esObjeto(h)) return 'falta la historia';
  if (typeof h.numero !== 'string' || !/^\d{1,18}$/.test(h.numero)) return 'número de historia inválido';
  if (typeof h.guardadaIso !== 'string' || Number.isNaN(Date.parse(h.guardadaIso))) return 'fecha de la historia inválida';
  if (!textoOpcional(h.servicio, 20)) return 'servicio inválido';
  const p = x.paciente;
  if (!esObjeto(p)) return 'falta el paciente';
  if (typeof p.documento !== 'string' || !p.documento.trim() || p.documento.length > 20) return 'documento del paciente inválido';
  for (const lista of ['diagnosticos', 'ordenes', 'remisiones', 'incapacidades', 'interconsultas', 'indicaciones', 'campos'] as const) {
    if (!Array.isArray(x[lista])) return `${lista} no es una lista`;
    if ((x[lista] as unknown[]).length > 300) return `${lista} demasiado larga`;
  }
  for (const o of x.ordenes as unknown[]) {
    if (!esObjeto(o) || !Array.isArray(o.medicamentos) || !Array.isArray(o.examenes)) return 'orden inválida';
    if (o.medicamentos.length + o.examenes.length > 200) return 'orden demasiado larga';
  }
  if (JSON.stringify(x).length > LIMITES_RESUMEN_ATENCION.maxCaracteresContenido) return 'resumen demasiado grande';
  return null;
}

// ─── Medición de la lectura (Fase 1) ────────────────────────────────────────

/** Una vuelta medida, como se guarda en `HospitalMirrorConfig.resumenAtencionMedicion`. */
export interface VueltaMedidaResumen extends MedicionLecturaResumen {
  iso: string;
}

const msValido = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= LIMITES_RESUMEN_ATENCION.medicionMaxMs;

/** La medición que manda el agente, o `null` si no sirve (no se guarda, pero el lote sí). */
export function validarMedicion(x: unknown): MedicionLecturaResumen | null {
  if (!esObjeto(x)) return null;
  const historias = enteroEntre(x.historias, 0, LIMITES_RESUMEN_ATENCION.maxPorLote);
  if (!msValido(x.detectarMs) || !msValido(x.leerMs) || historias === null) return null;
  return { detectarMs: Math.round(x.detectarMs), leerMs: Math.round(x.leerMs), historias };
}

function leerVueltas(json: unknown): VueltaMedidaResumen[] {
  const lista = esObjeto(json) && Array.isArray(json.vueltas) ? json.vueltas : [];
  const r: VueltaMedidaResumen[] = [];
  for (const v of lista) {
    const m = validarMedicion(v);
    if (m && esObjeto(v) && typeof v.iso === 'string' && !Number.isNaN(Date.parse(v.iso))) r.push({ iso: v.iso, ...m });
  }
  return r;
}

/** Suma una vuelta a lo guardado y se queda con las últimas `medicionesGuardadas`. */
export function agregarMedicion(
  json: unknown,
  medicion: MedicionLecturaResumen,
  ahora: Date,
): { vueltas: VueltaMedidaResumen[] } {
  const vueltas = [...leerVueltas(json), { iso: ahora.toISOString(), ...medicion }];
  return { vueltas: vueltas.slice(-LIMITES_RESUMEN_ATENCION.medicionesGuardadas) };
}

export interface ResumenMedicionesLectura {
  /** Vueltas del último día que consultaron el HIS. */
  vueltas: number;
  historias: number;
  detectar: { medianaMs: number; maxMs: number };
  /** Solo de las vueltas que leyeron alguna historia; `null` si ninguna leyó. */
  leer: { medianaMs: number; maxMs: number; medianaPorHistoriaMs: number } | null;
  ultimaIso: string;
}

function mediana(xs: number[]): number {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
}

/** Cuánto tardaron las consultas al HIS en las últimas 24 horas; `null` si no hubo ninguna. */
export function resumirMediciones(json: unknown, ahora: Date): ResumenMedicionesLectura | null {
  const desde = ahora.getTime() - 86_400_000;
  const vueltas = leerVueltas(json).filter((v) => Date.parse(v.iso) >= desde);
  if (vueltas.length === 0) return null;
  const conLectura = vueltas.filter((v) => v.historias > 0);
  return {
    vueltas: vueltas.length,
    historias: vueltas.reduce((n, v) => n + v.historias, 0),
    detectar: {
      medianaMs: mediana(vueltas.map((v) => v.detectarMs)),
      maxMs: Math.max(...vueltas.map((v) => v.detectarMs)),
    },
    leer: conLectura.length
      ? {
          medianaMs: mediana(conLectura.map((v) => v.leerMs)),
          maxMs: Math.max(...conLectura.map((v) => v.leerMs)),
          medianaPorHistoriaMs: mediana(conLectura.map((v) => Math.round(v.leerMs / v.historias))),
        }
      : null,
    ultimaIso: vueltas[vueltas.length - 1].iso,
  };
}

// ─── Revisión del hospital contra el HIS (Fase 1) ───────────────────────────

export type ResultadoRevisionResumen = 'CORRECTO' | 'CON_ERROR';

/**
 * Lo que marca quien revisa un resumen contra el HIS. «Con error» exige decir
 * qué está mal: con eso se corrige el driver antes de enviar.
 */
export function validarRevision(
  entrada: unknown,
): { ok: true; resultado: ResultadoRevisionResumen; nota: string | null } | { ok: false; error: string } {
  if (!esObjeto(entrada)) return { ok: false, error: 'Falta la revisión.' };
  const { resultado } = entrada;
  if (resultado !== 'CORRECTO' && resultado !== 'CON_ERROR') return { ok: false, error: 'Marque «Correcto» o «Con error».' };
  const nota = typeof entrada.nota === 'string' ? entrada.nota.trim() : '';
  if (nota.length > LIMITES_RESUMEN_ATENCION.maxCaracteresNotaRevision) {
    return { ok: false, error: `La nota tiene más de ${LIMITES_RESUMEN_ATENCION.maxCaracteresNotaRevision} caracteres.` };
  }
  if (resultado === 'CON_ERROR' && !nota) return { ok: false, error: 'Escriba qué está mal: con eso se corrige la lectura.' };
  return { ok: true, resultado, nota: nota || null };
}
