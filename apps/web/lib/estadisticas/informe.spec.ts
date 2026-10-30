import type { DatosDeEstadisticas } from './consultas';
import { GESTION, armarInforme } from './informe';
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
});
