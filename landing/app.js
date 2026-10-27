/**
 * AgenIA — landing (agenia.co). Sin dependencias ni compilación.
 *
 * - Enlaces de «Ingresar» y «Agendar una demo» desde config.js.
 * - Menú (desplegables y hamburguesa), tarjetas de etapas que se abren.
 * - Conversación animada con fechas reales (las de los próximos días).
 * - Anillos de resultados que se llenan al verlos.
 * - Pulso de la salud en Colombia: data/pulso.json (lo actualiza el cron a las
 *   6 a. m. con scripts/actualizar-pulso.mjs) y data/novedades.json.
 */
(function () {
    'use strict';

    var CONFIG = window.AGENIA || {};
    var ZONA = 'America/Bogota';
    var reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var $ = function (sel, raiz) { return (raiz || document).querySelector(sel); };
    var $$ = function (sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); };

    function el(tag, clase, texto) {
        var e = document.createElement(tag);
        if (clase) e.className = clase;
        if (texto !== undefined) e.textContent = texto;
        return e;
    }

    // ── Enlaces configurables ────────────────────────────────
    $$('[data-ingresar]').forEach(function (a) { a.href = CONFIG.ingresar || '#'; });
    $$('[data-demo]').forEach(function (a) { a.href = CONFIG.demo || '#'; });
    var anio = $('#anio');
    if (anio) anio.textContent = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, year: 'numeric' }).format(new Date());

    // ── Navegación ───────────────────────────────────────────
    var nav = $('#nav');
    var alDesplazar = function () { nav.classList.toggle('compacta', window.scrollY > 40); };
    window.addEventListener('scroll', alDesplazar, { passive: true });
    alDesplazar();

    var grupos = $$('.nav-grupo');
    function cerrarGrupos(excepto) {
        grupos.forEach(function (g) {
            if (g === excepto) return;
            g.classList.remove('abierto');
            $('.nav-enlace', g).setAttribute('aria-expanded', 'false');
        });
    }
    grupos.forEach(function (g) {
        var boton = $('.nav-enlace', g);
        boton.addEventListener('click', function (e) {
            e.stopPropagation();
            var abrir = !g.classList.contains('abierto');
            cerrarGrupos(g);
            g.classList.toggle('abierto', abrir);
            boton.setAttribute('aria-expanded', String(abrir));
        });
        if (window.matchMedia('(hover: hover) and (min-width: 1361px)').matches) {
            g.addEventListener('mouseenter', function () { cerrarGrupos(g); g.classList.add('abierto'); boton.setAttribute('aria-expanded', 'true'); });
            g.addEventListener('mouseleave', function () { g.classList.remove('abierto'); boton.setAttribute('aria-expanded', 'false'); });
        }
    });
    document.addEventListener('click', function () { cerrarGrupos(null); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { cerrarGrupos(null); cerrarMenu(); }
    });

    var hamburguesa = $('#nav-hamburguesa');
    function cerrarMenu() {
        nav.classList.remove('menu-abierto');
        hamburguesa.setAttribute('aria-expanded', 'false');
        hamburguesa.setAttribute('aria-label', 'Abrir el menú');
    }
    hamburguesa.addEventListener('click', function (e) {
        e.stopPropagation();
        var abrir = !nav.classList.contains('menu-abierto');
        nav.classList.toggle('menu-abierto', abrir);
        hamburguesa.setAttribute('aria-expanded', String(abrir));
        hamburguesa.setAttribute('aria-label', abrir ? 'Cerrar el menú' : 'Abrir el menú');
    });
    $$('#nav-menu a').forEach(function (a) { a.addEventListener('click', function () { cerrarMenu(); cerrarGrupos(null); }); });

    // ── Reloj de Colombia ────────────────────────────────────
    var reloj = $('#reloj');
    var formatoHora = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, hour: 'numeric', minute: '2-digit', hour12: true });
    function tic() { reloj.textContent = 'Colombia · ' + formatoHora.format(new Date()); }
    tic();
    setInterval(tic, 15000);

    // ── Tarjetas de etapas ───────────────────────────────────
    var etapas = $$('.etapa');
    function activar(etapa) { etapas.forEach(function (e) { e.classList.toggle('activa', e === etapa); }); }
    etapas.forEach(function (etapa) {
        etapa.addEventListener('mouseenter', function () { activar(etapa); });
        etapa.addEventListener('focus', function () { activar(etapa); });
        etapa.addEventListener('click', function () { activar(etapa); });
    });
    $('#etapas-fila').addEventListener('mouseleave', function () { activar(null); });

    // ── Aparecer al verlo ────────────────────────────────────
    function alVerlo(nodo, fn, umbral) {
        if (!nodo) return;
        if (!('IntersectionObserver' in window)) { fn(); return; }
        var obs = new IntersectionObserver(function (entradas) {
            if (entradas.some(function (e) { return e.isIntersecting; })) { obs.disconnect(); fn(); }
        }, { threshold: umbral || 0.3 });
        obs.observe(nodo);
    }
    alVerlo($('#pila'), function () { $('#pila').classList.add('visible'); });

    // ── Conversación animada ─────────────────────────────────
    var formatoDia = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' });
    function proximoDiaHabil(desde) {
        var d = new Date(desde.getTime() + 24 * 3600 * 1000);
        for (var i = 0; i < 7; i++) {
            var dia = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, weekday: 'short' }).format(d);
            if (dia !== 'Sat' && dia !== 'Sun') return d;
            d = new Date(d.getTime() + 24 * 3600 * 1000);
        }
        return d;
    }
    var dia1 = proximoDiaHabil(new Date());
    var dia2 = proximoDiaHabil(dia1);
    var f1 = formatoDia.format(dia1);
    var f2 = formatoDia.format(dia2);
    var horaBogota = Number(new Intl.DateTimeFormat('en-US', { timeZone: ZONA, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    var saludo = horaBogota < 12 ? 'buenos días' : horaBogota < 19 ? 'buenas tardes' : 'buenas noches';
    var GUION = [
        { quien: 'paciente', texto: 'Hola, ' + saludo + '. Necesito una cita', paso: 0 },
        { quien: 'asistente', texto: '¡Hola! Soy el asistente virtual del hospital. ¿Para qué servicio necesita la cita?\n\n1. Medicina general', paso: 0 },
        { quien: 'paciente', texto: 'Medicina general', paso: 1 },
        { quien: 'asistente', texto: 'Con gusto. ¿Con qué EPS está afiliado(a), o la cita es particular?', paso: 1 },
        { quien: 'paciente', texto: 'Salud Total', paso: 1 },
        { quien: 'asistente', texto: 'Estos son los horarios disponibles:\n\n1. ' + f1 + ', 8:20 a. m.\n2. ' + f1 + ', 10:40 a. m.\n3. ' + f2 + ', 7:00 a. m.\n\nResponda con el número del horario.', paso: 2 },
        { quien: 'paciente', texto: 'La 1', paso: 2 },
        { quien: 'asistente', texto: 'Resumen de su cita:\nMedicina general\n' + f1 + ', 8:20 a. m.\n\n¿La confirmo? Responda SÍ o NO.', paso: 3 },
        { quien: 'paciente', texto: 'SÍ', paso: 3 },
        { quien: 'asistente', texto: '✅ Su cita quedó registrada en el sistema del hospital. Le enviaremos un recordatorio un día antes. ¡Que esté muy bien!', paso: 3 },
    ];
    var chat = $('#demo-chat');
    var estado = $('#demo-estado');
    var pasos = $$('#demo-pasos li');
    var temporizadores = [];
    function marcarPaso(n) { pasos.forEach(function (p, i) { p.classList.toggle('activo', i === n); }); }
    function hora(minutosDespues) {
        var d = new Date(Date.now() + minutosDespues * 60000);
        return formatoHora.format(d);
    }
    function burbuja(m, i) {
        var b = el('div', 'burbuja ' + m.quien, m.texto);
        var t = el('time', null, hora(Math.floor(i / 2)));
        b.appendChild(t);
        chat.appendChild(b);
        while (chat.children.length > 8) chat.removeChild(chat.firstChild);
    }
    function reproducir() {
        temporizadores.forEach(clearTimeout);
        temporizadores = [];
        chat.textContent = '';
        if (reducirMovimiento) {
            GUION.forEach(burbuja);
            marcarPaso(3);
            return;
        }
        var t = 300;
        GUION.forEach(function (m, i) {
            if (m.quien === 'asistente') {
                temporizadores.push(setTimeout(function () {
                    estado.textContent = 'escribiendo…';
                    var e = el('div', 'escribiendo');
                    e.innerHTML = '<i></i><i></i><i></i>';
                    e.id = 'escribiendo';
                    chat.appendChild(e);
                }, t));
                t += 900 + Math.min(1400, m.texto.length * 9);
            }
            temporizadores.push(setTimeout(function () {
                var e = $('#escribiendo');
                if (e) e.remove();
                estado.textContent = 'en línea';
                burbuja(m, i);
                marcarPaso(m.paso);
            }, t));
            t += m.quien === 'paciente' ? 1100 : 1500;
        });
    }
    alVerlo($('#demo'), reproducir, 0.35);
    $('#demo-repetir').addEventListener('click', reproducir);

    // ── Anillos de resultados ────────────────────────────────
    // Los degradados de los anillos salen del tema (--anillos en styles.css): «claro oscuro, claro oscuro, …».
    var COLORES = getComputedStyle(document.documentElement).getPropertyValue('--anillos').split(',')
        .map(function (par) { return par.trim().split(/\s+/); })
        .filter(function (par) { return par.length === 2; });
    if (COLORES.length === 0) COLORES = [['#7dd3fc', '#2563eb']];
    var R = 46;
    var CIRC = 2 * Math.PI * R;
    var res = CONFIG.resultados || { anillos: [] };
    var cajaAnillos = $('#anillos');
    res.anillos.forEach(function (a, i) {
        var id = 'grad-' + i;
        var c = COLORES[i % COLORES.length];
        var div = el('div', 'anillo');
        div.innerHTML =
            '<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs>' +
            '<circle class="anillo-fondo" cx="50" cy="50" r="' + R + '"/>' +
            '<circle class="anillo-valor" cx="50" cy="50" r="' + R + '" stroke="url(#' + id + ')" stroke-dasharray="' + CIRC + '" stroke-dashoffset="' + CIRC + '"/></svg>';
        var texto = el('div', 'anillo-texto');
        var numero = el('span', 'anillo-numero', '0 %');
        texto.appendChild(numero);
        texto.appendChild(el('p', null, a.texto));
        div.appendChild(texto);
        div.setAttribute('role', 'img');
        div.setAttribute('aria-label', a.valor + ' % ' + a.texto);
        cajaAnillos.appendChild(div);
        alVerlo(div, function () {
            $('.anillo-valor', div).style.strokeDashoffset = String(CIRC * (1 - a.valor / 100));
            contar(numero, a.valor);
        }, 0.4);
    });
    if (res.nota) $('#resultados-nota').textContent = res.nota;

    function contar(nodo, hasta) {
        if (reducirMovimiento) { nodo.textContent = hasta + ' %'; return; }
        var inicio = performance.now();
        var dur = 1600;
        (function paso(ahora) {
            var p = Math.min(1, (ahora - inicio) / dur);
            var suave = 1 - Math.pow(1 - p, 3);
            nodo.textContent = Math.round(hasta * suave) + ' %';
            if (p < 1) requestAnimationFrame(paso);
        })(inicio);
    }

    // ── Pulso de la salud ────────────────────────────────────
    var nf = function (dec) { return new Intl.NumberFormat('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec }); };
    var formatoActualizado = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true });
    var formatoFechaCorta = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, day: 'numeric', month: 'short' });

    function haceCuanto(iso) {
        if (!iso) return '';
        var min = Math.round((Date.now() - Date.parse(iso)) / 60000);
        if (min < 1) return 'hace un momento';
        if (min < 60) return 'hace ' + min + ' min';
        var h = Math.round(min / 60);
        if (h < 24) return 'hace ' + h + (h === 1 ? ' hora' : ' horas');
        var d = Math.round(h / 24);
        if (d < 7) return 'hace ' + d + (d === 1 ? ' día' : ' días');
        return formatoFechaCorta.format(new Date(iso));
    }

    function traer(url) {
        return fetch(url, { cache: 'no-cache', headers: { accept: 'application/json' } }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    var pulso = null;
    var temaActivo = 'Todos';

    function pintarTemas() {
        var caja = $('#pulso-temas');
        caja.textContent = '';
        ['Todos'].concat(pulso.temas || []).forEach(function (t) {
            var hay = t === 'Todos' || pulso.titulares.some(function (x) { return x.tema === t; });
            if (!hay) return;
            var b = el('button', 'tema', t);
            b.type = 'button';
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', String(t === temaActivo));
            b.addEventListener('click', function () { temaActivo = t; pintarTemas(); pintarTitulares(); });
            caja.appendChild(b);
        });
    }

    function pintarTitulares() {
        var caja = $('#titulares');
        caja.textContent = '';
        var lista = pulso.titulares.filter(function (t) { return temaActivo === 'Todos' || t.tema === temaActivo; }).slice(0, 13);
        if (lista.length === 0) {
            caja.appendChild(el('p', 'titulares-vacio', 'No hay titulares de este tema por ahora.'));
            return;
        }
        lista.forEach(function (t, i) {
            var a = el('a', 'titular' + (i === 0 ? ' destacado' : ''));
            a.href = t.enlace;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.appendChild(el('span', 'titular-tema', t.tema));
            a.appendChild(el('h3', null, t.titulo));
            a.appendChild(el('span', 'titular-meta', [t.medio, haceCuanto(t.publicado)].filter(Boolean).join(' · ')));
            caja.appendChild(a);
        });
    }

    function valorIndicador(i) {
        return nf(i.decimales).format(i.valor);
    }

    function pintarIndicadores() {
        var caja = $('#indicadores');
        caja.textContent = '';
        (pulso.indicadores || []).forEach(function (i) {
            var fila = el('div', 'indicador');
            fila.appendChild(el('span', 'indicador-nombre', i.nombre));
            var v = el('span', 'indicador-valor', valorIndicador(i));
            if (i.unidad) v.appendChild(el('small', null, i.unidad));
            fila.appendChild(v);
            fila.appendChild(el('span', 'indicador-anio', 'Dato de ' + i.anio));
            caja.appendChild(fila);
        });
    }

    function pintarCinta() {
        var pista = $('#cinta-pista');
        pista.textContent = '';
        var items = [];
        (pulso.indicadores || []).forEach(function (i) {
            var s = el('span', 'cinta-item');
            s.appendChild(document.createTextNode(i.nombre + ' '));
            s.appendChild(el('b', null, valorIndicador(i) + (i.unidad ? ' ' + i.unidad : '')));
            s.appendChild(document.createTextNode(' (' + i.anio + ')'));
            items.push(s);
        });
        pulso.titulares.slice(0, 8).forEach(function (t) {
            var s = el('span', 'cinta-item');
            s.appendChild(el('span', 'cinta-tema', t.tema));
            var a = el('a', null, t.titulo);
            a.href = t.enlace;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            s.appendChild(a);
            items.push(s);
        });
        if (items.length === 0) return;
        // Dos copias seguidas: la animación corre la mitad y vuelve sin salto.
        items.concat(items.map(function (n) { var c = n.cloneNode(true); c.setAttribute('aria-hidden', 'true'); return c; }))
            .forEach(function (n) { pista.appendChild(n); });
    }

    traer('data/pulso.json')
        .then(function (p) {
            pulso = { temas: p.temas || [], titulares: p.titulares || [], indicadores: p.indicadores || [] };
            $('#pulso-estado').textContent =
                'Actualizado el ' + formatoActualizado.format(new Date(p.actualizado)) + ' · ' + pulso.titulares.length +
                ' titulares de los últimos 7 días (Google News) e indicadores del Banco Mundial.';
            pintarTemas();
            pintarTitulares();
            pintarIndicadores();
            pintarCinta();
        })
        .catch(function () {
            $('#pulso-estado').textContent = 'El pulso de la salud no está disponible en este momento.';
            $('#titulares').appendChild(el('p', 'titulares-vacio', 'Vuelva más tarde: los titulares se actualizan cada mañana.'));
            $('#cinta-pista').textContent = 'AgenIA · citas médicas por WhatsApp y Telegram para hospitales e IPS de Colombia';
        });

    var formatoNovedad = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', day: 'numeric', month: 'long' });
    traer('data/novedades.json')
        .then(function (lista) {
            var ol = $('#novedades-lista');
            lista.slice(0, 5).forEach(function (n) {
                var li = el('li');
                var t = el('time', null, formatoNovedad.format(new Date(n.fecha + 'T12:00:00Z')));
                t.dateTime = n.fecha;
                li.appendChild(t);
                li.appendChild(el('strong', null, n.titulo));
                li.appendChild(el('p', null, n.texto));
                ol.appendChild(li);
            });
        })
        .catch(function () { $('#novedades').hidden = true; });
})();
