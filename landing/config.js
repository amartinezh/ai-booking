/**
 * Lo que se cambia sin tocar el resto de la landing.
 *
 * - ingresar: el login del panel de AgenIA.
 * - demo: a dónde lleva «Agendar una demostración» (correo o WhatsApp).
 * - resultados: los cuatro anillos de «Más asistencia, menos filas». Son cifras
 *   REALES del primer hospital conectado, medidas en AgenIA del 13 al 25 de
 *   octubre de 2026 (18 de 18 citas por chat en el HIS; 290 de 318 citas con
 *   recordatorio asistidas; 16 de 18 citas por chat de pacientes que registró
 *   el asistente; 580 de 685 recordatorios entregados, leídos). Se presentan
 *   como medidas: no se ponen cifras que no salgan de los datos. Publicarlas
 *   requiere la autorización del hospital.
 */
window.AGENIA = {
    ingresar: 'https://app.hsvpanserma.agenia.co/login',
    demo: 'mailto:agendamientoia.app@gmail.com?subject=Quiero%20una%20demostraci%C3%B3n%20de%20AgenIA',
    resultados: {
        nota: 'Medido en AgenIA en un hospital público de Colombia, del 13 al 25 de octubre de 2026.',
        anillos: [
            { valor: 100, texto: 'de las citas agendadas por chat quedaron en el sistema del hospital' },
            { valor: 91, texto: 'de asistencia en las citas con recordatorio entregado' },
            { valor: 89, texto: 'de las citas por chat las pidieron pacientes que el asistente registró solo' },
            { valor: 85, texto: 'de los recordatorios que llegan se leen en WhatsApp' },
        ],
    },
};
