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
   * ✅ CONFIRMADO contra ESEHSVP (catálogo vivo, 2026-09-01 — bloque 26 de
   * FASE0_DESCUBRIMIENTO_HIS.sql): `1 = Masculino`, `0 = Femenino`.
   *
   * Tres evidencias independientes, todas consistentes:
   *  · El paciente del piloto guiado por el hospital (CC 9696544, nombre
   *    registrado "CARLOS") tiene NU_SEXO_PAC=1.
   *  · Cruce estadístico por nombre sobre la tabla completa: NU_SEXO_PAC=0
   *    correlaciona con nombres femeninos 11.287 a 307; NU_SEXO_PAC=1 con
   *    nombres masculinos 10.740 a 291 (>97% de consistencia en ambos casos).
   *  · Los recién nacidos sin nombre propio confirman el mismo patrón:
   *    "HIJO DE ..." → 1, "HIJA DE ..." → 0.
   *
   * Se llegó a escribir la tabla INVERTIDA (`M:0, F:1`) como decisión
   * provisional para poder avanzar antes de tener esta confirmación — nunca
   * llegó a escribirse contra un paciente real, solo contra el mock local.
   */
  sexo: Record<string, number>;
  /**
   * Convenio de facturación.
   *
   * Clave: `${nitEps}|${REGIMEN}`, y opcionalmente
   * `${nitEps}|${REGIMEN}|PYP` cuando esa combinación tiene un convenio
   * propio de promoción y prevención. Si la clave de PyP no existe se usa la
   * del régimen — que es lo que hace el hospital con Sura (su PyP va al
   * convenio normal) y con Nueva EPS contributivo.
   */
  convenios: Record<string, number>;
  /** Pago directo. En el catálogo del hospital es el 26 (PARTICULARES). */
  convenioParticular: number;
  /**
   * Servicios de promoción y prevención. Solo cambian el convenio si existe
   * la clave `|PYP` de SU régimen; si no, facturan como una consulta normal.
   */
  serviciosPyp: string[];
  /**
   * Servicios que la EPS paga **por evento** y no por cápita.
   *
   * Es el cuarto eje de la regla de convenio, y salió de la sección G.2
   * (2026-09-03). La misma EPS y el mismo régimen facturan a contratos
   * DISTINTOS según el tipo de servicio:
   *
   * ```
   *   Sura subsidiado + atención primaria  → 467 SUBS          (cápita)
   *   Sura subsidiado + especialista       → 535 EVENSURASUB   (evento)
   * ```
   *
   * El prefijo de los propios convenios lo dice: `EVEN`/`EVENTOS`. En 90 días,
   * Sura subsidiado con un especialista usó el 535 en **605** citas y el 467
   * en **4**. Sin este eje, encender un especialista factura al contrato
   * equivocado en el 99 % de los casos — y en silencio, porque el 467 es un
   * convenio perfectamente válido de la misma EPS.
   *
   * A diferencia de `serviciosPyp`, aquí **NO hay repliegue**: si el servicio
   * está en esta lista y falta su clave `|EVENTO`, `resolveConvenio` lanza. El
   * repliegue de PyP es correcto porque el hospital lo hace así de verdad
   * (medido en la sección D); replegarse aquí sería justo el error que este
   * campo existe para impedir.
   */
  serviciosEvento?: string[];
  /** `CD_CODI_ESP_CIT` por servicio. Correlaciona con el servicio, no con el médico. */
  especialidadPorServicio: Record<string, string>;
  /**
   * Especialidad para un servicio que NO está en `especialidadPorServicio`.
   *
   * ⚠️ OPCIONAL, Y ANSERMA NO LA DECLARA — a propósito. Tenía `'000'`
   * (MEDICINA GENERAL) y eso convertía cada servicio sin mapear en una cita
   * mal etiquetada **en silencio**: una consulta de dermatología entrando al
   * HIS como medicina general no da error, no deja rastro, y se descubre
   * cuando la EPS glosa la factura.
   *
   * No era teórico. `especialidadPorServicio` se generó filtrando a médicos
   * con turnos futuros, y eso dejó fuera cinco servicios con citas reales
   * (890242ESP, 890342ESP/SUR, 890350ESP/SUR) — entre ellos la mitad «control»
   * de ginecología, justo lo primero que hace falta cuando el chatbot empieza
   * a preguntar «¿primera vez o control?».
   *
   * Sin default, `resolveEspecialidad` lanza `MappingIncompletoError`, que es
   * lo mismo que ya hacen `mapConvenio` y `mapSexo` ante un hueco. La cita
   * falla, se reporta y alguien añade una línea al mapping — ruidoso, visible
   * y reparable en minutos, frente a un dato malo que nadie va a mirar.
   *
   * Se deja como escape para un hospital cuyo catálogo sí tenga un cajón de
   * sastre legítimo; declararla es afirmar que adivinar es aceptable ahí.
   */
  especialidadPorDefecto?: string;
  /** `NU_DURA_CIT` cuando el turno no la impone. */
  duracionMinutos: number;
  /**
   * Override de duración por servicio, para cuando un servicio no dura lo
   * mismo que el resto. Opcional: sin él todo usa `duracionMinutos`.
   */
  duracionPorServicio?: Record<string, number>;
  /**
   * Override por médico. Es el que sirve de verdad hoy: `TURNOS_MEDICOS` no
   * lleva servicio, así que al generar los cupos de un turno lo único que se
   * conoce es de quién es. "El odontólogo atiende cada 30 minutos" se resuelve
   * con una fila, no con un despliegue.
   */
  duracionPorMedico?: Record<string, number>;
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
 * El día SIGUIENTE a una fecha local, como literal `YYYYMMDD`.
 *
 * Existe para poder filtrar por rango sin envolver la columna en una función.
 * `WHERE CONVERT(varchar(10), FE_FECH_CIT, 23) BETWEEN @a AND @b` es correcto
 * pero **no es sargable**: tocar la columna con `CONVERT` le impide a SQL
 * Server usar un índice sobre ella, y lo obliga a evaluar la conversión fila
 * por fila sobre la tabla entera.
 *
 * No es teórico. El hospital TIENE un índice con `FE_FECH_CIT` como primera
 * columna de la clave (bloque 29a) y `CITAS_MEDICAS` tiene 1.084.093 filas /
 * 855 MB. La forma con `CONVERT` los ignoraba y el agente releía eso cada
 * pocos segundos.
 *
 * La forma sargable es `COL >= @desde AND COL < @hastaExclusivo`, y de ahí
 * este helper: el borde superior tiene que ser el día siguiente, porque
 * `BETWEEN` sobre fechas incluía el último día y `<` no.
 *
 * La suma se hace en UTC a propósito: aquí una fecha es un día del calendario,
 * no un instante, así que no hay zona ni horario de verano que aplicar.
 */
export function diaSiguienteLiteralSql(fechaLocal: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaLocal);
  if (!m) {
    throw new MappingIncompletoError(
      `Fecha con formato inesperado: "${fechaLocal}". Se esperaba 'YYYY-MM-DD'.`,
    );
  }
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${dos(d.getUTCMonth() + 1)}${dos(d.getUTCDate())}`;
}

/**
 * `NU_ESTA_CIT` traducido al vocabulario de AgenIA.
 *
 * ═══ Por qué existe ═══
 * El protocolo canónico viaja en el idioma de AgenIA, no en el del HIS — igual
 * que las horas viajan en UTC y se convierten aquí, en la frontera. El driver
 * mandaba `String(fila.e)`, o sea el código crudo del hospital ('1', '2'), y
 * al otro lado `Appointment.attendanceStatus` es un enum de Prisma
 * (`PENDING | ATTENDED | NO_SHOW`). Aunque el evento hubiera llegado completo,
 * escribir '1' ahí habría reventado igual.
 *
 * ═══ Lo que se sabe y lo que no ═══
 * · `0` = cita vigente. No es un desenlace: no hay nada que reportar.
 * · `1` = atendida. Confirmado: las citas históricas en estado 1 siguen siendo
 *   filas únicas de CITAS_MEDICAS, nunca aparecen en CITAS_ANULADAS.
 * · `2` = existe pero es raro, y NADIE ha confirmado qué lo dispara
 *   (MAPEO_HIS.md §2.1). Se devuelve `null` en vez de adivinar: escribir mal
 *   la asistencia de un paciente es peor que no escribirla.
 *
 * ═══ Y el "no asistió" NO pasa por aquí ═══
 * Contra lo que sugiere el nombre, el no-show del hospital no es un estado
 * distinto: es un DELETE de CITAS_MEDICAS + archivo en CITAS_ANULADAS con
 * motivo `NA` (285 casos históricos). Al agente le llega como una
 * CANCELACIÓN, no como un desenlace de atención. Distinguir "canceló" de "no
 * se presentó" exige leer `CD_CODI_MOTI_CIAN` de la fila archivada, que hoy
 * no se lee — anotado en ESTADO.md, no se resuelve aquí.
 */
export function desenlaceDeAtencion(
  estado: number,
): 'ATTENDED' | null {
  return estado === 1 ? 'ATTENDED' : null;
}

/**
 * Una fecha local (`YYYY-MM-DD`) como literal `YYYYMMDD` para SQL Server.
 *
 * ═══ Por qué no se manda un `Date` ═══
 * `FE_FECH_CIT` es una fecha SIN ZONA: el hospital la guarda a medianoche. Un
 * `Date` de JavaScript, en cambio, es un instante, y `mssql` lo serializa en
 * UTC. Mandar `new Date('2026-09-02T00:00:00')` desde un proceso en Bogotá
 * hacía que al servidor llegara `2026-09-02 05:00:00` — la fecha correcta con
 * cinco horas pegadas que ninguna fila del hospital tiene.
 *
 * Peor aún: el resultado dependía de la zona del PROCESO. El mismo código
 * escribía `05:00` en la VM (`America/Bogota`) y `00:00` en un contenedor sin
 * `TZ`. Un dato del hospital no puede depender de dónde corra el agente.
 *
 * Un literal de texto no tiene zona ni instante, así que no hay nada que
 * convertir. Se usa `YYYYMMDD` y no `YYYY-MM-DD` porque para `datetime` es el
 * único formato que SQL Server interpreta igual bajo cualquier `DATEFORMAT` o
 * idioma de la sesión — y es además el que usó el hospital en su propia prueba
 * (MAPEO_HIS.md §2.1).
 */
export function fechaLiteralSql(fechaLocal: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaLocal);
  if (!m) {
    throw new MappingIncompletoError(
      `Fecha con formato inesperado: "${fechaLocal}". Se esperaba 'YYYY-MM-DD'.`,
    );
  }
  return `${m[1]}${m[2]}${m[3]}`;
}

/**
 * Convenio de facturación de la cita.
 *
 * Regla confirmada en Fase 0 y validada de forma cruzada con la prueba manual
 * del hospital: EPS (por NIT) + régimen + si el servicio es de PyP + si se
 * factura por evento. NO se puede deducir solo de la EPS — varias operan los
 * dos regímenes, y fijar un convenio constante facturaría todas las citas al
 * contrato equivocado.
 *
 * Los cuatro ejes, en orden de precedencia:
 *   1. sin EPS            → `convenioParticular`
 *   2. PyP                → `nit|REGIMEN|PYP`, y si no existe se repliega al
 *                           del régimen (el hospital lo hace así — sección D)
 *   3. facturado por evento → `nit|REGIMEN|EVENTO`, **sin repliegue** (G.2)
 *   4. el resto           → `nit|REGIMEN`
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

  if (!datos.patientRegime) {
    throw new MappingIncompletoError(
      `El paciente declara EPS ${datos.epsNit} pero no tiene régimen: sin él no ` +
        `se puede elegir el convenio (la misma EPS tiene uno por régimen).`,
    );
  }

  // PyP depende del RÉGIMEN, no solo de la EPS.
  //
  // Antes la clave era `${nit}|PYP`, y eso mandaba al convenio de PyP a
  // cualquier régimen de esa EPS. Los datos del hospital dicen que no: en
  // 90 días, el PyP de Nueva EPS SUBSIDIADO va al 489 (PYPSUBS, 94,4 % de
  // 2.001 citas) pero el de Nueva EPS CONTRIBUTIVO va al 473 igual que una
  // consulta normal (65,6 % de 390) — y el PyP de Sura no tiene convenio
  // propio en absoluto: usa el 467 de su régimen (94,3 % de 2.566).
  //
  // Con la clave vieja, un paciente contributivo de Nueva EPS que reservara
  // un servicio de PyP se facturaba a un contrato SUBSIDIADO.
  const esPyp = mapping.serviciosPyp.includes(datos.serviceExternalKey ?? '');
  if (esPyp) {
    const pyp =
      mapping.convenios[`${datos.epsNit}|${datos.patientRegime}|PYP`];
    if (pyp !== undefined) return pyp;
    // Sin convenio de PyP para esa combinación se cae al del régimen: es lo
    // que hace el hospital con Sura y con Nueva EPS contributivo.
  }

  // Facturación por EVENTO — el cuarto eje, y el único sin repliegue.
  //
  // Un especialista de la misma EPS y el mismo régimen va a un contrato
  // distinto que la atención primaria: Sura subsidiado usa 467 SUBS en
  // primaria y 535 EVENSURASUB con un especialista (605 citas contra 4, en
  // 90 días — sección G.2). El repliegue al convenio del régimen, que en PyP
  // es lo correcto, aquí sería exactamente el error que hay que evitar: un
  // contrato válido de la EPS correcta, y aun así el equivocado.
  const esEvento = (mapping.serviciosEvento ?? []).includes(
    datos.serviceExternalKey ?? '',
  );
  if (esEvento) {
    const evento =
      mapping.convenios[
        `${datos.epsNit}|${datos.patientRegime}|EVENTO`
      ];
    if (evento !== undefined) return evento;

    throw new MappingIncompletoError(
      `El servicio "${datos.serviceExternalKey}" se factura por evento, pero no ` +
        `hay convenio de evento para la EPS ${datos.epsNit} en régimen ` +
        `${datos.patientRegime}. Falta la clave ` +
        `"${datos.epsNit}|${datos.patientRegime}|EVENTO" en el mappingJson. ` +
        `Usar el convenio de cápita facturaría la cita a un contrato que no ` +
        `cubre este servicio.`,
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

/**
 * `CD_CODI_ESP_CIT`. Correlaciona con el SERVICIO, no con el médico.
 *
 * Lanza si el servicio no está mapeado y el hospital no declaró un default.
 * Ver la nota de `AnsermaMapping.especialidadPorDefecto`: preferimos que la
 * cita falle a la vista de todos antes que entrar al HIS con la especialidad
 * equivocada sin que salte nada.
 */
export function resolveEspecialidad(
  mapping: AnsermaMapping,
  serviceExternalKey?: string,
): string {
  const especialidad =
    mapping.especialidadPorServicio[serviceExternalKey ?? ''];
  if (especialidad !== undefined) return especialidad;

  if (mapping.especialidadPorDefecto !== undefined) {
    return mapping.especialidadPorDefecto;
  }

  throw new MappingIncompletoError(
    `El servicio "${serviceExternalKey ?? '(vacío)'}" no tiene especialidad ` +
      `homologada (CD_CODI_ESP_CIT). Añádelo a especialidadPorServicio en el ` +
      `mappingJson de HospitalMirrorConfig; adivinarla escribiría una cita ` +
      `con la especialidad equivocada en el HIS sin que nadie se entere.`,
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
/**
 * Variante TOLERANTE de `feHoraCitAIso`: devuelve `null` en vez de lanzar
 * cuando la cadena no tiene el formato esperado.
 *
 * POR QUÉ EXISTE
 * `MAPEO_HIS.md` §2.1 lo pide desde el bloque 5 — «el lector del agente debe
 * ser tolerante; el escritor, estricto»— y el lector no lo era. En el catálogo
 * vivo, el **5,7 %** de las citas elaboradas en 30 días (419 de 7.403) tiene
 * un `FE_HORA_CIT` que no se puede interpretar: longitudes 12/13, una fila con
 * `'2026/08/29 1'`, otra con `'31'`.
 *
 * Con el lector estricto bastaba UNA de esas filas dentro de la ventana para
 * que `detectChanges` y `snapshotAppointments` lanzaran, y con ellos se caían
 * las dos direcciones que dependen de leer el HIS: la detección de cambios
 * (HIS → AgenIA) y la reconciliación diaria, que es la última red contra la
 * deriva silenciosa. No se había visto porque el mock local tiene datos
 * limpios — el mismo punto ciego que escondió el `NO_NOMB_PAC varchar(20)`.
 *
 * El escritor sigue usando la versión estricta: escribir una hora que no
 * cumple el formato de la aplicación del hospital sí es inaceptable.
 */
export function feHoraCitAIsoOrNull(
  feHora: string | null | undefined,
  timeZone: string,
): string | null {
  if (!feHora) return null;
  try {
    return feHoraCitAIso(feHora, timeZone);
  } catch {
    return null;
  }
}

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

  // 🚨 El regex comprueba la FORMA, no el RANGO, y `Date.UTC` desborda en
  // silencio: `2026/08/29 99:99` se convertía en el 2 de septiembre, y
  // `2026/13/45 10:00` en el 14 de febrero del año siguiente — seis meses de
  // diferencia, sin un solo error. Sobre la fecha de una cita eso significa
  // reportarle al servidor un cambio en un día que no es, o colocar la cita
  // de un paciente en otra fecha durante la reconciliación.
  //
  // La comprobación de ida y vuelta es la forma barata de exigir el rango:
  // si al reconstruir la fecha no salen los mismos componentes, hubo
  // desbordamiento. Cubre horas y minutos imposibles, meses > 12, días que
  // ese mes no tiene, y el 29 de febrero de un año no bisiesto.
  const reconstruida = new Date(comoUtc);
  if (
    reconstruida.getUTCFullYear() !== +y ||
    reconstruida.getUTCMonth() !== +mo - 1 ||
    reconstruida.getUTCDate() !== +d ||
    reconstruida.getUTCHours() !== +h ||
    reconstruida.getUTCMinutes() !== +mi
  ) {
    throw new MappingIncompletoError(
      `FE_HORA_CIT con una fecha u hora que no existe: "${feHora}". ` +
        `Tiene la forma correcta pero algún componente está fuera de rango.`,
    );
  }

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


// ═══════════════════════════════════════════════════════════════════════════
// Disponibilidad (Fase 2): de turnos del HIS a cupos de AgenIA.
//
// El hospital NO guarda cupos: guarda BLOQUES de turno por médico, fecha y
// consultorio (`TURNOS_MEDICOS`, esquema confirmado en el bloque 7), y su
// aplicación calcula los huecos dividiendo el bloque entre la duración de la
// cita y descontando las ya ocupadas. Replicar esa división aquí es lo que
// permite que la agenda de AgenIA SEA la del hospital y no una copia hecha a
// mano que se desincroniza sola.
// ═══════════════════════════════════════════════════════════════════════════

export interface TurnoHis {
  /** `FE_FECH_TUME`, solo la fecha, en hora local del hospital: 'YYYY-MM-DD'. */
  fechaLocal: string;
  /** `FE_HOIN_TUME`, solo la hora: 'HH:MM'. */
  horaInicio: string;
  /** `FE_HOFI_TUME`, solo la hora: 'HH:MM'. */
  horaFin: string;
}

export interface CupoGenerado {
  startTimeIso: string;
  endTimeIso: string;
  /** La misma hora en el formato del HIS — sirve para cruzar con CITAS_MEDICAS. */
  feHoraCit: string;
}

/**
 * Divide un turno en cupos de `duracionMinutos`.
 *
 * Un resto que no alcanza para una cita completa se descarta: media consulta
 * no es un cupo, y ofrecerla haría que el paciente llegue a una hora en la que
 * el médico ya se fue.
 */
export function cuposDelTurno(
  turno: TurnoHis,
  duracionMinutos: number,
  timeZone: string,
): CupoGenerado[] {
  const aMinutos = (hhmm: string): number => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) {
      throw new MappingIncompletoError(
        `Hora de turno con formato inesperado: "${hhmm}". Se esperaba 'HH:MM'.`,
      );
    }
    return +m[1] * 60 + +m[2];
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(turno.fechaLocal)) {
    throw new MappingIncompletoError(
      `Fecha de turno con formato inesperado: "${turno.fechaLocal}". Se esperaba 'YYYY-MM-DD'.`,
    );
  }
  if (duracionMinutos <= 0) {
    throw new MappingIncompletoError(
      `Duración de cita inválida: ${duracionMinutos} minutos.`,
    );
  }

  const inicio = aMinutos(turno.horaInicio);
  const fin = aMinutos(turno.horaFin);
  const fecha = turno.fechaLocal.replace(/-/g, '/');

  const cupos: CupoGenerado[] = [];
  for (let t = inicio; t + duracionMinutos <= fin; t += duracionMinutos) {
    const hhmm = (min: number) =>
      `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    const feHoraCit = `${fecha} ${hhmm(t)}`;
    cupos.push({
      feHoraCit,
      startTimeIso: feHoraCitAIso(feHoraCit, timeZone),
      endTimeIso: feHoraCitAIso(
        `${fecha} ${hhmm(t + duracionMinutos)}`,
        timeZone,
      ),
    });
  }
  return cupos;
}

/**
 * Cuánto dura una cita de ese servicio.
 *
 * El HIS no guarda la duración en ninguna parte (`SERVICIOS` no la tiene): su
 * aplicación usa un valor operativo fijo. Por eso vive en `mappingJson`, con
 * override por servicio — el día que el hospital diga "odontología es de 30
 * minutos" eso es cambiar una fila, no desplegar.
 */
export function duracionDeServicio(
  mapping: AnsermaMapping,
  servicio?: string,
  medico?: string,
): number {
  const porMedico = mapping.duracionPorMedico ?? {};
  const porServicio = mapping.duracionPorServicio ?? {};
  return (
    (medico && porMedico[medico]) ||
    (servicio && porServicio[servicio]) ||
    mapping.duracionMinutos
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Nombre del paciente: AgenIA guarda uno solo, PACIENTES tiene cuatro.
//
// 🚨 ESTO ROMPÍA PRODUCCIÓN. El driver escribía el nombre COMPLETO en
// `NO_NOMB_PAC`, que en el hospital es `varchar(20)` — cualquier nombre de más
// de 20 caracteres (o sea, casi todos) habría reventado el INSERT con el error
// 8152 de SQL Server y el paciente no se habría podido dar de alta. No se vio
// antes porque el mock local declaraba `varchar(60)`.
//
// El mapeo de Fase 0 ya lo decía —"NO_NOMB_PAC (primer nombre)"— y el driver
// lo ignoró. Las otras tres columnas se confirmaron en el bloque 27:
//   NO_NOMB_PAC varchar(20)  primer nombre    (NOT NULL)
//   NO_SGNO_PAC varchar(20)  segundo nombre
//   DE_PRAP_PAC varchar(30)  primer apellido
//   DE_SGAP_PAC varchar(30)  segundo apellido
// ═══════════════════════════════════════════════════════════════════════════

export interface NombrePartido {
  primerNombre: string;
  segundoNombre: string | null;
  primerApellido: string | null;
  segundoApellido: string | null;
}

/** Anchos reales de las columnas en el HIS (bloque 27a). */
const ANCHO = { nombre: 20, apellido: 30 } as const;

/**
 * Parte el `fullName` de AgenIA en las cuatro columnas del HIS.
 *
 * ⚠️ ES UNA HEURÍSTICA, y en un caso es ambigua de verdad. Con tres palabras,
 * "JUAN PEREZ GOMEZ" (un nombre y dos apellidos) y "JUAN CARLOS PEREZ" (dos
 * nombres y un apellido) son indistinguibles sin un diccionario de nombres.
 * Se elige la primera lectura porque en Colombia los dos apellidos son el
 * identificador legal: quien acorta su nombre suele soltar el segundo nombre,
 * no un apellido.
 *
 * La forma de quitarse la ambigüedad de encima es preguntar nombres y
 * apellidos por separado en el chatbot — hoy se pregunta "nombre completo".
 * Mientras eso no cambie, esto es lo mejor que se puede hacer sin inventar.
 */
export function partirNombre(fullName?: string): NombrePartido {
  const partes = (fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (partes.length === 0) {
    throw new MappingIncompletoError(
      'El paciente no tiene nombre: NO_NOMB_PAC es NOT NULL en PACIENTES.',
    );
  }

  const cortar = (t: string | null, max: number) =>
    t === null ? null : t.slice(0, max);

  // Una sola palabra: solo hay primer nombre. Es lo que tiene el 98% de las
  // historias viejas del hospital (bloque 27b), así que no es un caso raro.
  if (partes.length === 1) {
    return {
      primerNombre: cortar(partes[0], ANCHO.nombre)!,
      segundoNombre: null,
      primerApellido: null,
      segundoApellido: null,
    };
  }

  if (partes.length === 2) {
    return {
      primerNombre: cortar(partes[0], ANCHO.nombre)!,
      segundoNombre: null,
      primerApellido: cortar(partes[1], ANCHO.apellido),
      segundoApellido: null,
    };
  }

  if (partes.length === 3) {
    return {
      primerNombre: cortar(partes[0], ANCHO.nombre)!,
      segundoNombre: null,
      primerApellido: cortar(partes[1], ANCHO.apellido),
      segundoApellido: cortar(partes[2], ANCHO.apellido),
    };
  }

  // Cuatro o más: dos nombres y dos apellidos, que es la forma canónica. Lo
  // que sobre se pega al segundo apellido — los apellidos compuestos ("DE LA
  // CRUZ") son más frecuentes que los nombres de tres palabras.
  return {
    primerNombre: cortar(partes[0], ANCHO.nombre)!,
    segundoNombre: cortar(partes[1], ANCHO.nombre),
    primerApellido: cortar(partes[2], ANCHO.apellido),
    segundoApellido: cortar(partes.slice(3).join(' '), ANCHO.apellido),
  };
}


/**
 * Reparte nombres y apellidos que el paciente YA separó, sin adivinar nada.
 *
 * Es el camino bueno: el chatbot pregunta nombres y apellidos en dos pasos, y
 * la frontera —la parte imposible de deducir— la pone quien sí la sabe.
 * `partirNombre` sigue existiendo para los pacientes anteriores al cambio y
 * para los que no entran por WhatsApp.
 */
export function partirNombreDado(
  nombres: string,
  apellidos?: string,
): NombrePartido {
  const trozos = (t: string | undefined) =>
    (t ?? '').trim().split(/\s+/).filter((x) => x.length > 0);

  const n = trozos(nombres);
  const a = trozos(apellidos);

  if (n.length === 0) {
    throw new MappingIncompletoError(
      'El paciente no tiene nombre: NO_NOMB_PAC es NOT NULL en PACIENTES.',
    );
  }

  // Lo que sobre de cada lado se pega al último campo de ese lado: un nombre
  // de tres palabras no se puede tirar, y un apellido compuesto tampoco.
  return {
    primerNombre: n[0].slice(0, ANCHO.nombre),
    segundoNombre: n.length > 1 ? n.slice(1).join(' ').slice(0, ANCHO.nombre) : null,
    primerApellido: a.length > 0 ? a[0].slice(0, ANCHO.apellido) : null,
    segundoApellido:
      a.length > 1 ? a.slice(1).join(' ').slice(0, ANCHO.apellido) : null,
  };
}
