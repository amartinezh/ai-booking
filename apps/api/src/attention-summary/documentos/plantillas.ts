import {
  PIE_RESUMEN_POR_DEFECTO,
  cantidadConLetras,
  comoTomarlo,
  contenidoDelResumen,
  fechaHoraDocumento,
  formatDateShort,
  fuenteDelDocumento,
  hastaDeIncapacidad,
} from '@agenia/shared';
import type {
  ConfigDocumentosResumen,
  DocumentoDelResumen,
  OrdenResumen,
  ResumenAtencionHis,
} from '@agenia/shared';
import {
  Bloque,
  HOJA,
  Maquetador,
  TAM,
  type Elemento,
  type Hoja,
  type Medidor,
} from './plano';
import { dimensionesImagen } from './render';

/**
 * Las plantillas de los documentos (plan §3.9): el encabezado y el «Registro»
 * como en el papel del HIS, el cuerpo de cada tipo y el pie con el médico.
 *
 * Valores por defecto mientras no se aprueben (plan §8.2):
 *  · D21: sin QR y con la marca de agua «Copia para el paciente»;
 *  · D22: la firma en texto («Firmado electrónicamente por…»), sin la imagen.
 * Lo distinto del papel, a propósito: la indicación del médico en vez del texto
 * que arma el HIS (D19), la cantidad en letras en español, letra de 10 puntos,
 * «Generado para el paciente» y sin campos vacíos.
 */

export interface ContextoDocumentos {
  documentos: ConfigDocumentosResumen;
  /** Si el encabezado no tiene nombre: el de la clínica en AgenIA. */
  nombreClinica: string;
  ahora: Date;
  timeZone: string;
}

const ANCHO_UTIL = HOJA.ancho - 2 * HOJA.margen;
const LOGO_MAX = { ancho: 110, alto: 46 };

function dibujar(b: Bloque, y: number): Elemento[] {
  const els: Elemento[] = [];
  let yy = y;
  for (const r of b.renglones) {
    els.push(...r.dibujar(yy));
    yy += r.alto;
  }
  return els;
}

const nombreHospital = (ctx: ContextoDocumentos) =>
  ctx.documentos.encabezado.nombre ?? ctx.nombreClinica;

/** «1980-05-17» → «17/05/1980», sin pasar por Date (sería el día anterior en Bogotá). */
function fechaSinHora(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function diagnosticoPrincipal(r: ResumenAtencionHis): string | null {
  const d =
    r.diagnosticos.find((x) => x.principal) ?? r.diagnosticos[0] ?? null;
  return d ? `${d.cie10} — ${d.descripcion ?? ''}`.replace(/ — $/, '') : null;
}

/** El encabezado de cada hoja: hospital, título y el «Registro» del paciente. */
function encabezado(
  medidor: Medidor,
  r: ResumenAtencionHis,
  doc: DocumentoDelResumen,
  ctx: ContextoDocumentos,
): { alto: number; elementos: Elemento[] } {
  const els: Elemento[] = [];
  const e = ctx.documentos.encabezado;

  let logo: { datos: Buffer; ancho: number; alto: number } | null = null;
  if (ctx.documentos.logo) {
    const datos = Buffer.from(ctx.documentos.logo, 'base64');
    const dim = dimensionesImagen(datos);
    if (dim && dim.ancho > 0 && dim.alto > 0) {
      const k = Math.min(LOGO_MAX.ancho / dim.ancho, LOGO_MAX.alto / dim.alto);
      logo = { datos, ancho: dim.ancho * k, alto: dim.alto * k };
    }
  }
  const desplazamiento = logo ? logo.ancho + 10 : 0;

  const hospital = new Bloque(
    medidor,
    HOJA.margen + desplazamiento,
    ANCHO_UTIL - desplazamiento,
  );
  hospital.parrafo(nombreHospital(ctx), {
    tam: TAM.hospital,
    negrita: true,
  });
  const datos = [
    e.nit ? `NIT ${e.nit}` : null,
    e.direccion,
    e.telefono ? `Tel. ${e.telefono}` : null,
  ].filter(Boolean);
  if (datos.length) hospital.parrafo(datos.join(' · '));

  let y = HOJA.margen;
  if (logo) {
    els.push({
      tipo: 'imagen',
      x: HOJA.margen,
      y,
      ancho: logo.ancho,
      alto: logo.alto,
      datos: logo.datos,
    });
  }
  els.push(...dibujar(hospital, y));
  y += Math.max(hospital.alto, logo?.alto ?? 0) + 2;

  const h = r.historia;
  const p = r.paciente;
  const registro = new Bloque(medidor, HOJA.margen, ANCHO_UTIL)
    .linea(0.8)
    .parrafo(doc.titulo, { tam: TAM.titulo, negrita: true })
    .espacio(2)
    .campos([
      ['Fecha de la consulta', fechaHoraDocumento(h.guardadaIso, ctx.timeZone)],
      ['Historia', h.numero],
      ['Paciente', p.nombre],
      ['Documento', [p.tipoDocumento, p.documento].filter(Boolean).join(' ')],
      ['Edad', h.edad !== null ? `${h.edad} años` : null],
      ['Fecha de nacimiento', fechaSinHora(p.fechaNacimientoIso)],
      ['EPS', r.afiliacion.administradora],
      [
        'Convenio',
        [r.afiliacion.convenio, r.afiliacion.tipoUsuario]
          .filter(Boolean)
          .join(' · '),
      ],
      ['Servicio', h.nombreServicio ?? h.servicio],
      ['Especialidad', h.especialidad],
    ])
    .linea(0.8);
  els.push(...dibujar(registro, y));
  y += registro.alto;
  return { alto: y - HOJA.margen, elementos: els };
}

/** El pie de cada hoja: el médico, la firma en texto (D22) y «Hoja N de M». */
function pie(
  medidor: Medidor,
  r: ResumenAtencionHis,
  ctx: ContextoDocumentos,
  hoja: number,
  de: number,
): Bloque {
  const m = r.medico;
  const b = new Bloque(medidor, HOJA.margen, ANCHO_UTIL).linea(0.6);
  const datosMedico = [
    m.nombre ?? 'No registrado',
    m.documento ? `Documento ${m.documento}` : null,
    r.historia.especialidad,
    m.registro ? `Registro ${m.registro}` : null,
  ].filter(Boolean);
  b.parrafo([
    { texto: 'Médico: ', negrita: true },
    { texto: datosMedico.join(' · ') },
  ]);
  if (m.nombre) {
    b.parrafo(
      `Firmado electrónicamente por ${m.nombre}${m.registro ? `, registro ${m.registro}` : ''}, el ${fechaHoraDocumento(r.historia.guardadaIso, ctx.timeZone)}.`,
    );
  }
  b.parrafo(
    `Generado por ${nombreHospital(ctx)} para el paciente el ${fechaHoraDocumento(ctx.ahora.toISOString(), ctx.timeZone)}.`,
  );
  b.parrafo(`Hoja ${hoja} de ${de}`, { derecha: true });
  return b;
}

// ─── Cuerpos ────────────────────────────────────────────────────────────────

function cuerpoResumen(
  m: Maquetador,
  r: ResumenAtencionHis,
  ctx: ContextoDocumentos,
): void {
  const secciones = contenidoDelResumen(r, {
    timeZone: ctx.timeZone,
    frecuenciaDelHis: ctx.documentos.frecuenciaDelHis,
  });
  if (secciones.length === 0) {
    m.colocar(
      m
        .bloque()
        .parrafo(
          'El médico no registró diagnósticos, indicaciones ni órdenes en esta consulta.',
        ),
    );
  }
  for (const s of secciones) {
    // El título va con su primer renglón: nunca solo al pie de una hoja.
    const cabeza = m
      .bloque()
      .espacio(6)
      .parrafo(s.titulo, { tam: TAM.seccion, negrita: true })
      .espacio(1)
      .parrafo(s.renglones[0], { vineta: true });
    m.colocar(cabeza);
    for (const renglon of s.renglones.slice(1)) {
      m.colocar(m.bloque().parrafo(renglon, { vineta: true }));
    }
  }
  m.colocar(
    m
      .bloque()
      .espacio(10)
      .parrafo(ctx.documentos.pie ?? PIE_RESUMEN_POR_DEFECTO),
  );
}

function cuerpoFormula(
  m: Maquetador,
  r: ResumenAtencionHis,
  o: OrdenResumen,
  ctx: ContextoDocumentos,
): void {
  const tz = ctx.timeZone;
  m.colocar(
    m
      .bloque()
      .campos([
        [
          'Fecha de la orden',
          o.escritaIso ? formatDateShort(o.escritaIso, { timeZone: tz }) : null,
        ],
        [
          'Reclamar desde',
          o.desdeIso ? formatDateShort(o.desdeIso, { timeZone: tz }) : null,
        ],
        ['Vigencia', o.vigencia],
        ['Serie', o.serie && o.serie !== o.numero ? `N.º ${o.serie}` : null],
      ])
      .campos([['Diagnóstico principal', diagnosticoPrincipal(r)]], 1)
      .espacio(4),
  );
  o.medicamentos.forEach((x, i) => {
    const b = m
      .bloque()
      .parrafo(`${i + 1}. ${x.nombre}`, { negrita: true })
      .campos(
        [
          ['Código', x.codigo],
          ['CUM', x.cum],
          ['Invima', x.invima],
          ['Medida', x.medida],
          ['Concentración', x.concentracion],
          ['Forma farmacéutica', x.forma],
          ['Vía', x.via],
          [
            'Cantidad',
            x.cantidad !== null ? cantidadConLetras(x.cantidad) : null,
          ],
          [
            'Duración',
            x.duracionDias
              ? `${x.duracionDias} día${x.duracionDias === 1 ? '' : 's'}`
              : null,
          ],
        ],
        3,
      )
      .parrafo([
        { texto: 'Dosis y frecuencia: ', negrita: true },
        { texto: comoTomarlo(x, ctx.documentos.frecuenciaDelHis) },
      ])
      .parrafo([
        { texto: 'Cantidad entregada: ', negrita: true },
        { texto: '____________________' },
      ])
      .espacio(8);
    m.colocar(b);
  });
}

function cuerpoOrden(
  m: Maquetador,
  r: ResumenAtencionHis,
  o: OrdenResumen,
  ctx: ContextoDocumentos,
): void {
  m.colocar(
    m
      .bloque()
      .campos([
        [
          'Fecha de la orden',
          o.escritaIso
            ? formatDateShort(o.escritaIso, { timeZone: ctx.timeZone })
            : null,
        ],
        ['Vigencia', o.vigencia],
      ])
      .campos([['Diagnóstico principal', diagnosticoPrincipal(r)]], 1)
      .espacio(4),
  );
  o.examenes.forEach((x, i) => {
    m.colocar(
      m
        .bloque()
        .parrafo(`${i + 1}. ${x.nombre}`, { negrita: true })
        .campos(
          [
            ['Código (CUPS)', x.codigo],
            ['Cantidad', x.cantidad],
          ],
          2,
        )
        .campos([['Indicaciones', x.indicacion]], 1)
        .espacio(6),
    );
  });
}

function cuerpoRemision(
  m: Maquetador,
  r: ResumenAtencionHis,
  x: ResumenAtencionHis['remisiones'][number],
  ctx: ContextoDocumentos,
): void {
  const b = m.bloque().campos(
    [
      [
        'Fecha',
        x.fechaIso
          ? formatDateShort(x.fechaIso, { timeZone: ctx.timeZone })
          : null,
      ],
      ['Remite a', x.remiteA],
      ['Servicio pedido', x.servicioPedido],
      ['Código (CUPS)', x.cups],
      ['Prioridad', x.prioridad],
      ['Diagnóstico principal', diagnosticoPrincipal(r)],
      ['Motivo', x.motivo],
      ['Observaciones', x.observaciones],
    ],
    1,
  );
  if (x.casoClinicoCaracteres > 0) {
    // D24: la descripción del caso clínico no viaja; el especialista la ve en el HIS.
    b.espacio(6).parrafo(
      'La descripción del caso clínico está en la historia clínica del hospital.',
    );
  }
  m.colocar(b, { junto: false });
}

function cuerpoIncapacidad(
  m: Maquetador,
  r: ResumenAtencionHis,
  x: ResumenAtencionHis['incapacidades'][number],
  ctx: ContextoDocumentos,
): void {
  m.colocar(
    m
      .bloque()
      .campos(
        [
          [
            'Desde',
            x.desdeIso
              ? formatDateShort(x.desdeIso, { timeZone: ctx.timeZone })
              : null,
          ],
          ['Hasta', hastaDeIncapacidad(x.desdeIso, x.dias, ctx.timeZone)],
          ['Días', x.dias],
          ['Prórroga', x.prorroga ? 'Sí' : 'No'],
          ['Tipo', x.tipo],
          ['Origen', x.origen],
        ],
        2,
      )
      .campos(
        [
          ['Diagnóstico principal', diagnosticoPrincipal(r)],
          ['Observación', x.observacion],
        ],
        1,
      ),
    { junto: false },
  );
}

/**
 * Las hojas de un documento: el cuerpo se reparte entre el encabezado y el pie;
 * después se agregan a cada hoja la marca de agua, el encabezado y el pie con
 * «Hoja N de M». `null` si el documento no corresponde a este resumen.
 */
export function armarHojas(
  medidor: Medidor,
  r: ResumenAtencionHis,
  doc: DocumentoDelResumen,
  ctx: ContextoDocumentos,
): Hoja[] | null {
  const fuente = fuenteDelDocumento(r, doc);
  if (!fuente) return null;

  const cabeza = encabezado(medidor, r, doc, ctx);
  const altoPie = pie(medidor, r, ctx, 99, 99).alto;
  const arriba = HOJA.margen + cabeza.alto + 6;
  const abajo = HOJA.alto - HOJA.margen - altoPie - 6;
  const m = new Maquetador(medidor, arriba, abajo);

  switch (fuente.tipo) {
    case 'RESUMEN':
      cuerpoResumen(m, r, ctx);
      break;
    case 'FORMULA':
      cuerpoFormula(m, r, fuente.orden, ctx);
      break;
    case 'ORDEN':
      cuerpoOrden(m, r, fuente.orden, ctx);
      break;
    case 'REMISION':
      cuerpoRemision(m, r, fuente.remision, ctx);
      break;
    case 'INCAPACIDAD':
      cuerpoIncapacidad(m, r, fuente.incapacidad, ctx);
      break;
  }

  const cuerpos = m.terminar();
  return cuerpos.map((cuerpo, i) => {
    const p = pie(medidor, r, ctx, i + 1, cuerpos.length);
    return [
      // Detrás de todo, para no tapar nada.
      { tipo: 'marca', texto: ctx.documentos.marcaDeAgua.toUpperCase() },
      ...cabeza.elementos,
      ...cuerpo,
      ...dibujar(p, HOJA.alto - HOJA.margen - p.alto),
    ] satisfies Hoja;
  });
}
