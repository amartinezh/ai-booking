import type { DatosDeEstadisticas } from './consultas';
import { GESTION, armarInforme, armarOcupacion, ocupacionDelMes } from './informe';
import type { CorteDeEstadisticas } from './periodo';

const corte = (ultimoDia: string, hasta: string): CorteDeEstadisticas => ({
    hasta,
    ultimoDia,
    hastaUtc: new Date(`${hasta}T05:00:00Z`),
});

/** Las cifras de la página que se armó a mano el 24-oct (hasta ese sábado). */
function datosDel24(): DatosDeEstadisticas {
    return {
        recordatoriosPorDia: [
            { dia: '2026-10-13', enviados: 42, entregados: 36, leidos: 30 },
            { dia: '2026-10-14', enviados: 119, entregados: 94, leidos: 78 },
            { dia: '2026-10-17', enviados: 91, entregados: 70, leidos: 61 },
            { dia: '2026-10-19', enviados: 8, entregados: 6, leidos: 5 },
            { dia: '2026-10-24', enviados: 50, entregados: 39, leidos: 33 },
        ],
        confirmacionesPorDia: [
            { dia: '2026-10-14', personas: 17 },
            { dia: '2026-10-24', personas: 4 },
        ],
        confirmaciones: { personas: 113, citas: 118 },
        cancelaciones: { total: 15, retomados: 9, horasMediana: 7.3 },
        cambiosDeFecha: 1,
        citasChat: { total: 15, fueraDeHorario: 4, pacientesNuevos: 13 },
        citasChatPorDia: [
            { dia: '2026-10-22', n: 7 },
            { dia: '2026-10-24', n: 4 },
        ],
        hospital: { entregadas: 15, segundosPromedio: 1.1 },
        avisosInasistencia: 5,
        consultas: 38,
        mensajes: { total: 926, personas: 321, fueraDeHorario: 291 },
        mensajesPorHora: [
            { hora: 6, n: 57 },
            { hora: 11, n: 117 },
        ],
        asistencia: [
            { recordada: false, citas: 157, asistieron: 141 },
            { recordada: true, citas: 317, asistieron: 289 },
        ],
        espera: {
            oportunidad: [
                { canal: 'chat', dias: 0, citas: 18, sumaDias: 0 },
                { canal: 'chat', dias: 1, citas: 76, sumaDias: 76 },
                { canal: 'chat', dias: 2, citas: 12, sumaDias: 24 },
                { canal: 'chat', dias: 3, citas: 5, sumaDias: 15 },
                { canal: 'personal', dias: 0, citas: 506, sumaDias: 0 },
                { canal: 'personal', dias: 1, citas: 431, sumaDias: 431 },
                { canal: 'personal', dias: 2, citas: 45, sumaDias: 90 },
                { canal: 'personal', dias: 3, citas: 55, sumaDias: 165 },
                { canal: 'personal', dias: 4, citas: 196, sumaDias: 1842 },
            ],
            servicios: ['Consulta ambulatoria de medicina general'],
            conversacion: { citas: 116, medidas: 83, medianaMin: 4.6, promedioMin: 6.0 },
            listaEspera: { asignadas: 7, medianaHoras: 8.5, promedioHoras: 22.7 },
        },
        documentos: null,
    };
}

describe('estadísticas — de las cifras a la página', () => {
    it('las gestiones suman lo resuelto por chat, de la más a la menos frecuente', () => {
        const i = armarInforme(datosDel24(), corte('2026-10-24', '2026-10-25'), { conHospital: true })!;
        expect(i.totalGestiones).toBe(192);
        expect(i.gestiones.map((g) => [g.tipo, g.n])).toEqual([
            [GESTION.CONFIRMADAS, 118],
            [GESTION.CONSULTAS, 38],
            [GESTION.AGENDADAS, 15],
            [GESTION.CANCELADAS, 15],
            [GESTION.AVISOS, 5],
            [GESTION.CAMBIOS, 1],
        ]);
        expect(i.desde).toBe('2026-10-13');
        expect(i.dias).toBe(12);
    });

    it('un día sin recordatorios sale en cero, no desaparece de la gráfica', () => {
        const i = armarInforme(datosDel24(), corte('2026-10-24', '2026-10-25'), { conHospital: true })!;
        expect(i.recordatorios.porDia).toHaveLength(12);
        expect(i.recordatorios.porDia.find((r) => r.dia === '2026-10-18')).toEqual({
            dia: '2026-10-18',
            enviados: 0,
            entregados: 0,
            leidos: 0,
            confirmaron: 0,
        });
        expect(i.recordatorios.porDia.find((r) => r.dia === '2026-10-24')?.confirmaron).toBe(4);
        expect(i.recordatorios).toMatchObject({ enviados: 310, entregados: 245, leidos: 207, recortada: false });
        // Las citas por chat arrancan el día de la primera, con el 23 en cero.
        expect(i.citasChat.porDia).toEqual([
            { dia: '2026-10-22', n: 7 },
            { dia: '2026-10-23', n: 0 },
            { dia: '2026-10-24', n: 4 },
        ]);
    });

    it('los mensajes por hora siempre son 24, con cero en las horas sin mensajes', () => {
        const i = armarInforme(datosDel24(), corte('2026-10-24', '2026-10-25'), { conHospital: true })!;
        expect(i.mensajes.porHora).toHaveLength(24);
        expect(i.mensajes.porHora[6]).toBe(57);
        expect(i.mensajes.porHora[11]).toBe(117);
        expect(i.mensajes.porHora[0]).toBe(0);
    });

    it('la asistencia va con recordatorio primero, aunque la consulta los traiga al revés', () => {
        const i = armarInforme(datosDel24(), corte('2026-10-24', '2026-10-25'), { conHospital: true })!;
        expect(i.asistencia).toEqual([
            { grupo: 'Con recordatorio entregado', citas: 317, asistieron: 289, destacado: true },
            { grupo: 'Sin recordatorio entregado', citas: 157, asistieron: 141, destacado: false },
        ]);
        const sinUnGrupo = { ...datosDel24(), asistencia: [{ recordada: true, citas: 3, asistieron: 3 }] };
        expect(armarInforme(sinUnGrupo, corte('2026-10-24', '2026-10-25'), { conHospital: true })!.asistencia).toEqual([]);
    });

    it('la espera por la cita: promedio de días, dentro de 3 días y reparto, por chat primero', () => {
        const { espera } = armarInforme(datosDel24(), corte('2026-10-24', '2026-10-25'), { conHospital: true })!;
        expect(espera!.canales.map((c) => c.canal)).toEqual(['chat', 'personal']);
        const [chat, personal] = espera!.canales;
        expect(chat).toMatchObject({ citas: 111, reparto: [18, 76, 12, 5, 0], dentroDe3: 1 });
        expect(chat.promedioDias).toBeCloseTo(115 / 111, 5); // 1,04 días
        expect(personal).toMatchObject({ citas: 1233, reparto: [506, 431, 45, 55, 196] });
        // El promedio usa los días reales de las que pasan de 3, no el tope del reparto.
        expect(personal.promedioDias).toBeCloseTo(2528 / 1233, 5); // 2,05 días
        expect(personal.dentroDe3).toBeCloseTo(1037 / 1233, 5); // 84 %
        expect(espera!.conversacion.medianaMin).toBe(4.6);
        expect(espera!.listaEspera.asignadas).toBe(7);
    });

    it('sin citas que medir no hay sección de espera; un canal sin citas no aparece', () => {
        const sinNada = {
            ...datosDel24(),
            espera: { oportunidad: [], servicios: [], conversacion: { citas: 0, medidas: 0, medianaMin: null, promedioMin: null }, listaEspera: { asignadas: 0, medianaHoras: null, promedioHoras: null } },
        };
        expect(armarInforme(sinNada, corte('2026-10-24', '2026-10-25'), { conHospital: true })!.espera).toBeNull();
        expect(armarInforme({ ...datosDel24(), espera: null }, corte('2026-10-24', '2026-10-25'), { conHospital: true })!.espera).toBeNull();
        const soloChat = { ...datosDel24(), espera: { ...datosDel24().espera!, oportunidad: datosDel24().espera!.oportunidad.filter((f) => f.canal === 'chat') } };
        expect(armarInforme(soloChat, corte('2026-10-24', '2026-10-25'), { conHospital: true })!.espera!.canales.map((c) => c.canal)).toEqual(['chat']);
    });

    it('📄 documentos de la consulta: sin avisos a pacientes no hay sección; con ellos, días con ceros y los totales', () => {
        expect(armarInforme(datosDel24(), corte('2026-10-24', '2026-10-25'), { conHospital: true })!.documentos).toBeNull();
        const conDocumentos = {
            ...datosDel24(),
            documentos: {
                desde: '2026-10-20',
                embudo: {
                    atenciones: { leidas: 120, avisadas: 100, excluidas: 8, porBaja: 1, sinContacto: 5, sinEnviar: 7 },
                    avisos: { total: 104, reenvios: 2, whatsapp: 90, telegram: 10, correo: 4 },
                    avisosQueNoSalieron: 1,
                    whatsapp: { entregados: 85, leidos: 70, fallidos: 3, sinConfirmar: 2 },
                    pidieron: 60,
                    verificados: 58,
                    recibieron: 62,
                    archivos: { enviados: 300, entregados: 295, leidos: 200 },
                    abrieronLaPagina: 9,
                    bajas: 2,
                    porDia: [
                        { dia: '2026-10-20', avisos: 50, entregados: 40, leidos: 30, pidieron: 25, recibieron: 26 },
                        { dia: '2026-10-25', avisos: 54, entregados: 45, leidos: 40, pidieron: 35, recibieron: 36 },
                    ],
                },
            },
        };
        const doc = armarInforme(conDocumentos, corte('2026-10-25', '2026-10-26'), { conHospital: true })!.documentos!;
        expect(doc.desde).toBe('2026-10-20');
        expect(doc.porDia.map((p) => p.dia)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
        expect(doc.porDia[1]).toEqual({ dia: '2026-10-21', avisos: 0, entregados: 0, leidos: 0, pidieron: 0, recibieron: 0 });
        expect(doc.recortada).toBe(false);
        expect(doc.totales.recibieron).toBe(62);
        expect('porDia' in doc.totales).toBe(false);
    });

    it('sin conexión con el hospital no habla del sistema del hospital', () => {
        const i = armarInforme(datosDel24(), corte('2026-10-24', '2026-10-25'), { conHospital: false })!;
        expect(i.citasChat.enHospital).toBeNull();
        expect(i.citasChat.segundosAlHospital).toBeNull();
        const con = armarInforme(datosDel24(), corte('2026-10-24', '2026-10-25'), { conHospital: true })!;
        expect(con.citasChat.enHospital).toBe(15);
        expect(con.citasChat.segundosAlHospital).toBe(1.1);
    });

    it('con más de 30 días, las gráficas muestran los últimos 30 y las cifras todo', () => {
        const i = armarInforme(datosDel24(), corte('2026-12-31', '2027-01-01'), { conHospital: true })!;
        expect(i.recordatorios.porDia).toHaveLength(30);
        expect(i.recordatorios.porDia[0].dia).toBe('2026-12-02');
        expect(i.recordatorios.recortada).toBe(true);
        expect(i.recordatorios.enviados).toBe(310);
        expect(i.citasChat.porDia).toHaveLength(30);
        expect(i.citasChat.recortada).toBe(true);
        expect(i.dias).toBe(80);
    });

    it('sin recordatorios ni mensajes ni citas no hay página que mostrar', () => {
        const vacio: DatosDeEstadisticas = {
            ...datosDel24(),
            recordatoriosPorDia: [],
            confirmacionesPorDia: [],
            citasChatPorDia: [],
            mensajes: { total: 0, personas: 0, fueraDeHorario: 0 },
            mensajesPorHora: [],
        };
        expect(armarInforme(vacio, corte('2026-10-24', '2026-10-25'), { conHospital: false })).toBeNull();
    });

    it('sin recordatorios todavía, el período arranca con la primera cita por chat', () => {
        const d = { ...datosDel24(), recordatoriosPorDia: [], confirmacionesPorDia: [] };
        const i = armarInforme(d, corte('2026-10-24', '2026-10-25'), { conHospital: false })!;
        expect(i.desde).toBe('2026-10-22');
        expect(i.dias).toBe(3);
    });

    it('🔒 autorización de datos: solo aparece cuando alguien ya respondió', () => {
        const c = corte('2026-10-24', '2026-10-25');
        expect(armarInforme(datosDel24(), c, { conHospital: true })!.autorizaciones).toBeNull();
        expect(
            armarInforme({ ...datosDel24(), autorizaciones: { aceptaron: 0, noAceptaron: 0, retiraron: 1 } }, c, { conHospital: true })!
                .autorizaciones,
        ).toBeNull();
        expect(
            armarInforme({ ...datosDel24(), autorizaciones: { aceptaron: 40, noAceptaron: 2, retiraron: 1 } }, c, { conHospital: true })!
                .autorizaciones,
        ).toEqual({ aceptaron: 40, noAceptaron: 2, retiraron: 1 });
    });
});

// 🩺 2026-11-25: qué tan ocupada estuvo la agenda de los médicos.
describe('estadísticas — ocupación de la agenda de los médicos', () => {
    const fila = (over: Partial<import('./consultas').FilaDeOcupacion>) => ({
        nombre: 'ISABELLA GOMEZ VILLEGAS',
        codigo: 'MD09',
        chat: true,
        mes: '2026-10',
        personal: 0,
        asistente: 0,
        libres: 0,
        ...over,
    });

    it('un renglón por médico con todos los meses; el mes sin agenda queda vacío', () => {
        const o = armarOcupacion([
            fila({ mes: '2026-10', personal: 177, asistente: 18, libres: 3 }),
            fila({ mes: '2026-11', personal: 237, asistente: 74, libres: 0 }),
            fila({ nombre: 'MEDICO DISPONIBLE HSVP 02', codigo: 'MDD2', chat: false, mes: '2026-11', personal: 232, libres: 71 }),
        ])!;
        expect(o.meses).toEqual(['2026-10', '2026-11']);
        const md09 = o.medicos.find((m) => m.codigo === 'MD09')!;
        expect(md09.meses).toEqual([
            { mes: '2026-10', personal: 177, asistente: 18, libres: 3 },
            { mes: '2026-11', personal: 237, asistente: 74, libres: 0 },
        ]);
        const mdd2 = o.medicos.find((m) => m.codigo === 'MDD2')!;
        expect(mdd2.meses[0]).toBeNull();
        expect(mdd2).toMatchObject({ chat: false, libres: 71 });
    });

    it('los totales suman a todos los médicos por mes', () => {
        const o = armarOcupacion([
            fila({ mes: '2026-10', personal: 177, asistente: 18, libres: 3 }),
            fila({ codigo: 'AP04', nombre: 'FABIO', chat: false, mes: '2026-10', personal: 128, libres: 90 }),
            fila({ mes: '2026-11', personal: 237, asistente: 74 }),
        ])!;
        expect(o.totales).toEqual([
            { mes: '2026-10', personal: 305, asistente: 18, libres: 93 },
            { mes: '2026-11', personal: 237, asistente: 74, libres: 0 },
        ]);
    });

    it('primero los que dejaron más cupos sin agendar', () => {
        const o = armarOcupacion([
            fila({ codigo: 'MD09', libres: 3 }),
            fila({ codigo: 'AP04', nombre: 'FABIO', libres: 90 }),
            fila({ codigo: 'MDD1', nombre: 'MEDICO DISPONIBLE HSVP 01', libres: 84 }),
        ])!;
        expect(o.medicos.map((m) => m.codigo)).toEqual(['AP04', 'MDD1', 'MD09']);
    });

    it('agendas con el mismo nombre van separadas por su código; sin código, por el nombre', () => {
        const o = armarOcupacion([
            fila({ codigo: '76', nombre: 'Programa de Hipertensión', personal: 33, libres: 40 }),
            fila({ codigo: '077', nombre: 'Programa de Hipertensión', personal: 38, libres: 27 }),
            fila({ codigo: null, nombre: 'Dra. Ruiz', personal: 5 }),
            fila({ codigo: null, nombre: 'Dra. Ruiz', mes: '2026-11', personal: 6 }),
        ])!;
        expect(o.medicos).toHaveLength(3);
        expect(o.medicos.find((m) => m.nombre === 'Dra. Ruiz')!.meses.map((m) => m?.personal)).toEqual([5, 6]);
    });

    it('ocupación = cupos con cita entre todos los cupos; sin cupos, 0', () => {
        expect(ocupacionDelMes({ personal: 33, asistente: 0, libres: 40 })).toBeCloseTo(33 / 73, 5);
        expect(ocupacionDelMes({ personal: 0, asistente: 0, libres: 0 })).toBe(0);
    });

    it('sin filas (o un corte de antes sin ellas) no hay sección', () => {
        expect(armarOcupacion([])).toBeNull();
        expect(armarOcupacion(undefined)).toBeNull();
        expect(armarInforme(datosDel24(), corte('2026-10-24', '2026-10-25'), { conHospital: true })!.ocupacion).toBeNull();
        const i = armarInforme(
            { ...datosDel24(), ocupacion: [fila({ personal: 10, asistente: 2, libres: 1 })] },
            corte('2026-10-24', '2026-10-25'),
            { conHospital: true },
        )!;
        expect(i.ocupacion!.totales).toEqual([{ mes: '2026-10', personal: 10, asistente: 2, libres: 1 }]);
    });
});
