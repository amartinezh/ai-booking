/**
 * Prueba el lector del resumen de la atención (resumen-atencion.ts del driver)
 * contra el mock local, conectado COMO agenia_sync: solo con las columnas del
 * bloque P-7 que le dio setup.ts. Si el agente lee una columna que P-7 no
 * pide, aquí falla con «The SELECT permission was denied», igual que fallaría
 * en el hospital el día que TI conceda los permisos.
 *
 * Revisa las seis historias de historia-clinica.sql: toma E1-E3, nunca E4
 * (urgencias), E5 (evolución) ni E6 (sin calma), y que de E1 salga todo lo del
 * resumen sin lo que no debe subir (el texto clínico libre, el anulado, el caso
 * clínico de la remisión).
 *
 * Uso, después de setup.ts:
 *   AGENIA_SYNC_PASSWORD='...' \
 *     pnpm --filter @agenia/database exec tsx ../../apps/mirror-agent/local-his-mock/probar-resumen.ts
 */
import * as sql from 'mssql';
import { validarResumenAtencion } from '@agenia/shared';
import {
  detectarAtencionesTerminadas,
  leerResumenesDeAtencion,
} from '../src/drivers/cnt-sanvicente-anserma/resumen-atencion';

const PORT = Number(process.env.HIS_MOCK_PORT ?? 1433);
const PASSWORD = process.env.AGENIA_SYNC_PASSWORD;
const TZ = 'America/Bogota';

let fallas = 0;
function revisa(condicion: boolean, que: string) {
  console.log(`${condicion ? '✓' : '✗'} ${que}`);
  if (!condicion) fallas++;
}

async function main() {
  if (!PASSWORD) throw new Error('Falta AGENIA_SYNC_PASSWORD (la misma de setup.ts).');
  const pool = await new sql.ConnectionPool({
    server: 'localhost',
    port: PORT,
    user: 'agenia_sync',
    password: PASSWORD,
    database: 'PRUEBAS',
    options: { trustServerCertificate: true, encrypt: false },
  }).connect();

  try {
    // El permiso es por columna: leer la tabla entera sigue prohibido.
    const todo = await pool
      .request()
      .query('SELECT TOP 1 * FROM dbo.HISTORIACLINICA')
      .then(() => 'leyó')
      .catch((e: Error) => e.message);
    revisa(/permission was denied/i.test(todo), 'agenia_sync no puede leer la historia completa (solo las columnas de P-7)');

    const ahora = Date.now();
    const parametros = {
      desde: null,
      hasta: new Date(ahora - 15 * 60_000), // 15 minutos de calma
      inicio: new Date(ahora - 24 * 3600_000),
      servicios: ['S39141'],
      limite: 50,
    };
    const d1 = await detectarAtencionesTerminadas(pool, TZ, parametros);
    revisa(d1.numeros.length === 3, `detecta tres atenciones (E1-E3): ${d1.numeros.join(', ')}`);
    const d2 = await detectarAtencionesTerminadas(pool, TZ, { ...parametros, desde: d1.cursor });
    revisa(d2.numeros.length === 0, 'la vuelta siguiente no repite nada ni toma la recién guardada (E6)');
    const sinCalma = await detectarAtencionesTerminadas(pool, TZ, {
      ...parametros,
      desde: d1.cursor,
      hasta: new Date(ahora + 60_000),
    });
    revisa(sinCalma.numeros.length === 1, 'sin la calma, E6 sí sale (urgencias y evolución nunca)');

    const resumenes = await leerResumenesDeAtencion(pool, TZ, d1.numeros, null);
    revisa(resumenes.length === 3, 'arma los tres resúmenes');
    const invalidos = resumenes.map(validarResumenAtencion).filter(Boolean);
    revisa(invalidos.length === 0, `los tres pasan la validación de la API${invalidos.length ? `: ${invalidos.join('; ')}` : ''}`);

    const [e1, e2, e3] = [...resumenes].sort((a, b) => Number(a.historia.numero) - Number(b.historia.numero));
    const formula = e1.ordenes.find((o) => o.tipo === 'MEDICAMENTOS' && !o.desdeIso);
    const posfechada = e1.ordenes.find((o) => o.tipo === 'MEDICAMENTOS' && o.desdeIso);
    const laboratorio = e1.ordenes.find((o) => o.tipo === 'LABORATORIO');
    revisa(e1.diagnosticos.map((d) => d.cie10).join(',') === 'E790,I10X', 'E1: diagnósticos en orden, el principal primero');
    revisa(formula?.medicamentos.length === 2, 'E1: la fórmula trae dos medicamentos (el anulado no)');
    const acetaminofen = formula?.medicamentos.find((m) => m.codigo === 'A002');
    revisa(
      acetaminofen?.indicacion === null && acetaminofen?.frecuencia === 'cada 8 horas',
      'E1: sin indicación del médico, la frecuencia del HIS llega como «cada 8 horas»',
    );
    revisa(!!posfechada && posfechada.serie === formula?.numero, 'E1: la posfechada apunta a la fórmula del día');
    revisa(laboratorio?.examenes.length === 2, 'E1: la orden de laboratorio trae dos exámenes');
    revisa(
      e1.remisiones.length === 1 && e1.remisiones[0].casoClinicoCaracteres > 0,
      'E1: una remisión, del caso clínico solo su largo',
    );
    revisa(e1.incapacidades[0]?.dias === 3, 'E1: incapacidad de tres días');
    revisa(e1.interconsultas[0]?.especialidad === 'MEDICINA INTERNA', 'E1: interconsulta a medicina interna');
    revisa(e1.indicaciones.length === 1, 'E1: las indicaciones');
    revisa(
      e1.campos.map((c) => c.campo).join(',') === 'MC:,Anotaciones,Acerca de:',
      `E1: solo los campos de la lista (${e1.campos.map((c) => c.campo).join(', ')})`,
    );
    revisa(e1.afiliacion.tipoUsuario === 'SUBSIDIADO' && !!e1.afiliacion.administradora, 'E1: convenio, administradora y tipo de usuario');
    const textoE1 = JSON.stringify(e1);
    revisa(
      !/NO DEBE SUBIR|NO DEBE SALIR|Caso clínico|72\.5/.test(textoE1),
      'E1: nada del texto clínico libre, del anulado ni del caso clínico',
    );
    revisa(
      e2.paciente.tipoDocumento === 'TI' && e2.paciente.celularAcompanante === '3001110002' && !e2.paciente.celular,
      'E2: menor de edad con el celular del acudiente',
    );
    revisa(e3.historia.plantilla === 844 && e3.campos.some((c) => c.campo === 'Proximo control*'), 'E3: control de crónicos con la fecha del próximo control');
    revisa(e3.diagnosticos.some((d) => d.cie10 === 'F412'), 'E3: trae el diagnóstico que excluye el envío (lo decide la API)');
  } finally {
    await pool.close();
  }

  console.log(fallas === 0 ? '\nTodo bien.' : `\n${fallas} revisión(es) fallaron.`);
  process.exitCode = fallas === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('[probar-resumen] error:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
