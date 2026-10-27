/**
 * Lo que se cambia sin tocar el resto de la landing.
 *
 * - ingresar: el login del panel de AgenIA.
 * - demo: a dónde lleva «Agendar una demostración» (correo o WhatsApp).
 * - resultados: los cuatro anillos de «Más asistencia, menos filas». Son cifras
 *   reales del primer hospital conectado, medidas en AgenIA del 13 al 25 de
 *   octubre de 2026: publicarlas requiere la autorización del hospital.
 */
window.AGENIA = {
    ingresar: 'https://app.hsvpanserma.agenia.co/login',
    demo: 'mailto:agendamientoia.app@gmail.com?subject=Quiero%20una%20demostraci%C3%B3n%20de%20AgenIA',
    resultados: {
        nota: 'Medido en AgenIA en las primeras semanas de un hospital público de Colombia (octubre de 2026).',
        anillos: [
            { valor: 91, texto: 'de asistencia en las citas con recordatorio entregado' },
            { valor: 85, texto: 'de los recordatorios que llegan se leen en WhatsApp' },
            { valor: 35, texto: 'de los mensajes llegan cuando el hospital está cerrado' },
            { valor: 56, texto: 'de los cupos cancelados por chat los tomó otro paciente' },
        ],
    },
};
