/**
 * Traducciones entre el formato canónico de AgenIA y el del HIS de Anserma.
 *
 * Todo lo de este archivo es PURO: entra un dato, sale otro, sin tocar la red
 * ni la base. Así se puede probar carácter a carácter el SQL que se le va a
 * escribir a un hospital antes de escribírselo.
 *
 * La tabla de valores NO vive aquí: llega en `mappingJson` desde
 * `HospitalMirrorConfig`, y el agente la recibe en el handshake. Es
 * deliberado — la tabla de convenios está pendiente de que la valide la
 * agendadora del hospital, y cuando lo haga tiene que ser un cambio de
 * configuración, no un despliegue.
 */

export interface AnsermaMapping {
  /** `CD_CODI_LUAT_CIT` — sede. Decidido: solo la principal ('01'). */
  lugarAtencion: string;
  /** `CD_CODI_CECO_CIT` — centro de costos. Pendiente de confirmar a escala. */
  centroCostos?: string;
  /** Texto que marca el origen en `DE_DESC_CIT`. Decidido con el hospital. */
  marcaOrigen: string;
  /** `CD_CODI_MOTI_CIAN` del agente. Decidido: 'WB' (CANCELADO WEB). */
  motivoAnulacion: string;
  /**
   * AgenIA guarda 'M'/'F'; `NU_SEXO_PAC` es tinyint.
   *
   * ⚠️ DEUDA CON FECHA DE VENCIMIENTO: qué número es cuál NO está confirmado
   * contra la base del hospital. Se decidió provisionalmente para poder
   * avanzar, y mientras solo se escriba contra el mock local no hay riesgo.
   * ANTES del primer INSERT contra `PRUEBAS` con pacientes reales hay que
   * correr la consulta que lo confirme: escribirlo al revés deja el sexo
   * equivocado en la historia clínica de una persona.
   */
  sexo: Record<string, number>;
  /**
   * Convenio de facturación. Clave: `${nitEps}|${REGIMEN}`, o `${nitEps}|PYP`
   * cuando el servicio es de promoción y prevención, que usa convenio propio.
   */
  convenios: Record<string, number>;
  /** Pago directo. En el catálogo del hospital es el 26 (PARTICULARES). */
  convenioParticular: number;
  /** Servicios de PyP: usan el convenio `|PYP` de su EPS. */
  serviciosPyp: string[];
  /** `CD_CODI_ESP_CIT` por servicio. Correlaciona con el servicio, no con el médico. */
  especialidadPorServicio: Record<string, string>;
  /** Especialidad cuando el servicio no está en el mapa. */
  especialidadPorDefecto: string;
  /** `NU_DURA_CIT` cuando el turno no la impone. */
  duracionMinutos: number;
  /**
   * Días hacia adelante que vigila `detectChanges`.
   *
   * El hospital reserva hasta 12 meses, pero la instantánea completa de 13
   * meses son ~120.000 filas comparadas en cada vuelta. Lo que de verdad
   * importa para no sobrevender es el futuro cercano; el resto lo cubre la
   * reconciliación nocturna.
   */
  ventanaVigilanciaDias?: number;
}

export class MappingIncompletoError extends Error {}

/**
 * Formatea un instante UTC como `FE_HORA_CIT`: `'YYYY/MM/DD HH:MM'`.
 *
 * Con BARRAS y 16 caracteres exactos. El formato está confirmado en Fase 0 y
 * es parte de la clave primaria de `CITAS_MEDICAS`, así que un guion en vez de
 * una barra no da error: crea una cita que la aplicación del hospital no
 * encuentra. La prueba de inserción de Fase 0 usó guiones y pasó los
 * constraints — por eso hay una prueba dedicada a que nunca vuelva a pasar.
 *
 * La conversión de zona ocurre AQUÍ, en la frontera del driver: el protocolo
 * viaja en UTC y el HIS piensa en hora local (plan §8).
 */
export function formatFeHoraCit(iso: string, timeZone: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));

  const v = (t: string) => partes.find((p) => p.type === t)!.value;
  // `en-CA` con hour12:false puede devolver '24' para medianoche.
  const hora = v('hour') === '24' ? '00' : v('hour');
  return `${v('year')}/${v('month')}/${v('day')} ${hora}:${v('minute')}`;
}

/** Fecha de la cita a medianoche, en hora del hospital: `FE_FECH_CIT`. */
export function fechaCitaLocal(iso: string, timeZone: string): string {
  return formatFeHoraCit(iso, timeZone).slice(0, 10).replace(/\//g, '-');
}

/**
 * Convenio de facturación de la cita.
 *
 * Regla confirmada en Fase 0 y validada de forma cruzada con la prueba manual
 * del hospital: EPS (por NIT) + régimen + si el servicio es de PyP. NO se
 * puede deducir solo de la EPS — varias operan los dos regímenes, y fijar un
 * convenio constante facturaría todas las citas al contrato equivocado.
 */
export function resolveConvenio(
  mapping: AnsermaMapping,
  datos: {
    epsNit?: string;
    patientRegime?: string;
    serviceExternalKey?: string;
  },
): number {
  // Sin EPS es pago directo: el paciente paga la consulta él mismo.
  if (!datos.epsNit) return mapping.convenioParticular;

  const esPyp = mapping.serviciosPyp.includes(datos.serviceExternalKey ?? '');
  if (esPyp) {
    const pyp = mapping.convenios[`${datos.epsNit}|PYP`];
    if (pyp !== undefined) return pyp;
    // Sin convenio de PyP para esa EPS se cae al régimen normal: es mejor
    // facturar al contrato general que no facturar.
  }

  if (!datos.patientRegime) {
    throw new MappingIncompletoError(
      `El paciente declara EPS ${datos.epsNit} pero no tiene régimen: sin él no ` +
        `se puede elegir el convenio (la misma EPS tiene uno por régimen).`,
    );
  }

  const convenio = mapping.convenios[`${datos.epsNit}|${datos.patientRegime}`];
  if (convenio === undefined) {
    throw new MappingIncompletoError(
      `No hay convenio homologado para la EPS ${datos.epsNit} en régimen ` +
        `${datos.patientRegime}. Revisa mappingJson de HospitalMirrorConfig.`,
    );
  }
  return convenio;
}

/** AgenIA 'M'/'F' → `NU_SEXO_PAC`. Ver la advertencia en `AnsermaMapping.sexo`. */
export function mapSexo(mapping: AnsermaMapping, gender?: string): number {
  const codigo = mapping.sexo[(gender ?? '').toUpperCase()];
  if (codigo === undefined) {
    throw new MappingIncompletoError(
      `Sexo "${gender ?? '(vacío)'}" sin equivalencia en el HIS. El paciente no ` +
        `se puede dar de alta: NU_SEXO_PAC es NOT NULL.`,
    );
  }
  return codigo;
}

/** `CD_CODI_ESP_CIT`. Correlaciona con el servicio, no con el médico. */
export function resolveEspecialidad(
  mapping: AnsermaMapping,
  serviceExternalKey?: string,
): string {
  return (
    mapping.especialidadPorServicio[serviceExternalKey ?? ''] ??
    mapping.especialidadPorDefecto
  );
}

/**
 * Inverso de `formatFeHoraCit`: de `'YYYY/MM/DD HH:MM'` en hora del hospital
 * a un instante UTC ISO-8601.
 *
 * Hace falta porque los eventos que SUBEN al servidor viajan en UTC, igual
 * que los que bajan. La conversión se hace calculando el desfase real de esa
 * zona en esa fecha concreta — no con un offset fijo, que se rompería el día
 * que una zona tenga horario de verano.
 */
export function feHoraCitAIso(feHora: string, timeZone: string): string {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(feHora.trim());
  if (!m) {
    throw new MappingIncompletoError(
      `FE_HORA_CIT con formato inesperado: "${feHora}". Se esperaba 'YYYY/MM/DD HH:MM'.`,
    );
  }
  const [, y, mo, d, h, mi] = m;

  // Se parte de interpretar los componentes como si fueran UTC y se corrige
  // con el desfase que esa zona tenía en ese instante.
  const comoUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  const desfase = offsetDeZonaMs(new Date(comoUtc), timeZone);
  return new Date(comoUtc - desfase).toISOString();
}

/** Desfase de una zona respecto a UTC, en ms, en un instante dado. */
function offsetDeZonaMs(instante: Date, timeZone: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)!.value);
  const local = Date.UTC(
    v('year'), v('month') - 1, v('day'),
    v('hour') % 24, v('minute'), v('second'),
  );
  return local - instante.getTime();
}
