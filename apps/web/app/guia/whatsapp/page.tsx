import type { Metadata } from 'next';
import Link from 'next/link';
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    ClipboardCheck,
    Clock,
    Download,
    FileText,
    Info,
    KeyRound,
    LifeBuoy,
    Lightbulb,
    ListChecks,
    LogIn,
    Phone,
    ShieldAlert,
    Sparkles,
    UserCircle,
    Webhook,
} from 'lucide-react';
import BrandLogo from '@/app/components/BrandLogo';
import TableOfContents from './TableOfContents';

// Página PÚBLICA — el middleware solo protege /dashboard y /super-admin.
// Cualquier persona puede ver esta guía desde Internet.

export const metadata: Metadata = {
    title: 'Guía: Conecta tu WhatsApp · AgenIA',
    description:
        'Paso a paso para obtener tu WhatsApp Phone ID y Access Token de Meta y conectarlos a AgenIA. Diseñada para no-técnicos.',
    openGraph: {
        title: 'Cómo conectar tu WhatsApp a AgenIA',
        description:
            'De cero a recibir tus primeras citas por WhatsApp en menos de 45 minutos.',
        type: 'article',
    },
};

const SECTIONS = [
    { id: 'intro', label: 'Introducción' },
    { id: 'requisitos', label: 'Antes de empezar' },
    { id: 'paso-1', label: 'Paso 1 · Cuenta de Developers' },
    { id: 'paso-2', label: 'Paso 2 · Business Suite' },
    { id: 'paso-3', label: 'Paso 3 · Crear la App' },
    { id: 'paso-4', label: 'Paso 4 · Producto WhatsApp' },
    { id: 'paso-5', label: 'Paso 5 · Phone Number ID' },
    { id: 'paso-6', label: 'Paso 6 · ¿Test o real?' },
    { id: 'paso-7', label: 'Paso 7 · Tu número real' },
    { id: 'paso-8', label: 'Paso 8 · Token permanente' },
    { id: 'paso-9', label: 'Paso 9 · Pegar en AgenIA' },
    { id: 'paso-10', label: 'Paso 10 · Webhook' },
    { id: 'paso-11', label: 'Paso 11 · Suscribir WABA' },
    { id: 'paso-12', label: 'Paso 12 · Prueba final' },
    { id: 'resumen', label: 'Resumen final' },
    { id: 'errores', label: 'Errores comunes' },
    { id: 'faq', label: 'Preguntas frecuentes' },
    { id: 'soporte', label: 'Soporte' },
];

export default function GuiaWhatsappPage() {
    return (
        <div className="relative min-h-screen bg-zinc-50 dark:bg-zinc-950 selection:bg-emerald-500 selection:text-white font-sans">
            {/* Orbes decorativos */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[90vh] overflow-hidden -z-10 pointer-events-none">
                <div className="absolute -top-[15%] -left-[10%] w-[55%] h-[55%] rounded-full bg-gradient-to-br from-emerald-400/15 to-teal-400/15 blur-[120px]" />
                <div className="absolute top-[10%] -right-[10%] w-[40%] h-[60%] rounded-full bg-gradient-to-br from-indigo-400/15 to-violet-400/15 blur-[120px]" />
            </div>

            {/* Header */}
            <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/70 dark:bg-zinc-950/70 border-b border-zinc-200/60 dark:border-zinc-800/60">
                <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2">
                        <BrandLogo size={28} alt="AgenIA" />
                        <span className="text-base font-bold tracking-tight text-zinc-900 dark:text-white">
                            AgenIA
                        </span>
                        <span className="hidden sm:inline-block ml-3 text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200/70 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-300 font-semibold">
                            Guía oficial
                        </span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <a
                            href="/docs/guia-whatsapp-phone-id.md"
                            download
                            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white px-3 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Descargar .md
                        </a>
                        <Link
                            href="/login"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-zinc-900 dark:bg-white dark:text-zinc-900 px-3 py-1.5 rounded-lg shadow-sm hover:scale-[1.02] transition-transform"
                        >
                            <LogIn className="w-3.5 h-3.5" />
                            Ir al panel
                        </Link>
                    </div>
                </div>
            </header>

            {/* Hero */}
            <section className="relative pt-16 pb-12 sm:pt-24 sm:pb-16 px-6">
                <div className="max-w-5xl mx-auto text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/50 text-xs text-emerald-700 dark:text-emerald-400 font-semibold mb-6">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        Guía oficial · actualizada para Meta 2026
                    </div>

                    <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-zinc-900 dark:text-white leading-[1.1] mb-6">
                        Conecta tu WhatsApp{' '}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-600 dark:from-emerald-400 dark:to-teal-400">
                            a AgenIA
                        </span>
                    </h1>

                    <p className="max-w-2xl mx-auto text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed mb-8">
                        De cero a recibir tus primeras citas por WhatsApp en{' '}
                        <strong className="text-zinc-900 dark:text-zinc-200">
                            menos de 45 minutos
                        </strong>
                        . No necesitas saber programar — solo seguir los pasos en orden.
                    </p>

                    {/* Pills meta */}
                    <div className="flex flex-wrap justify-center gap-2 mb-10">
                        <MetaPill icon={<Clock className="w-3.5 h-3.5" />}>
                            25–45 minutos
                        </MetaPill>
                        <MetaPill icon={<UserCircle className="w-3.5 h-3.5" />}>
                            Nivel: principiante
                        </MetaPill>
                        <MetaPill icon={<ListChecks className="w-3.5 h-3.5" />}>
                            12 pasos guiados
                        </MetaPill>
                        <MetaPill icon={<ShieldAlert className="w-3.5 h-3.5" />}>
                            Sin código
                        </MetaPill>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                        <a
                            href="#paso-1"
                            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 hover:scale-[1.02] transition-all"
                        >
                            Empezar Paso 1
                            <ArrowRight className="w-4 h-4" />
                        </a>
                        <a
                            href="#requisitos"
                            className="inline-flex items-center gap-2 rounded-2xl bg-white dark:bg-zinc-900 px-6 py-3 text-sm font-semibold text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 hover:border-emerald-500 dark:hover:border-emerald-500 transition-all"
                        >
                            <Lightbulb className="w-4 h-4" />
                            Ver requisitos primero
                        </a>
                    </div>
                </div>
            </section>

            {/* Cuerpo con TOC sticky */}
            <div className="max-w-7xl mx-auto px-6 pb-32">
                <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-10">
                    {/* TOC */}
                    <aside className="hidden lg:block">
                        <div className="sticky top-24">
                            <TableOfContents sections={SECTIONS} />
                        </div>
                    </aside>

                    {/* Contenido */}
                    <article className="max-w-3xl">
                        {/* ===== INTRO ===== */}
                        <Section id="intro" title="¿Qué vas a conseguir?">
                            <p>
                                WhatsApp Business y la <strong>API de WhatsApp</strong> son
                                dos cosas distintas:
                            </p>
                            <ul className="list-disc list-outside space-y-1 ml-5 marker:text-emerald-500">
                                <li>
                                    <strong>WhatsApp Business</strong> (la app del celular)
                                    es para chatear manualmente desde tu teléfono.
                                </li>
                                <li>
                                    <strong>WhatsApp Business API</strong> (lo que vamos a
                                    configurar) es un canal técnico que permite que un
                                    sistema como <strong>AgenIA</strong> envíe y reciba
                                    mensajes automáticamente en nombre de tu institución
                                    24/7.
                                </li>
                            </ul>
                            <p>
                                Para usar la API, <strong>Meta</strong> te pide tres cosas:
                                una cuenta de Facebook personal, una cuenta empresarial
                                (Business Suite) y una App de desarrollador. Al final del
                                proceso tendrás tres datos que pegarás en AgenIA:
                            </p>

                            <DataTable
                                head={['Dato', '¿Qué es?', '¿Para qué?']}
                                rows={[
                                    [
                                        <Code key="phone">Phone Number ID</Code>,
                                        'Número largo (15–17 dígitos) que Meta asigna a tu línea.',
                                        'Le dice a AgenIA desde qué número mandar mensajes.',
                                    ],
                                    [
                                        <Code key="token">Access Token</Code>,
                                        <>
                                            Contraseña larga que empieza por <Code>EAA…</Code>
                                        </>,
                                        'Permite a AgenIA enviar mensajes en tu nombre.',
                                    ],
                                    [
                                        <Code key="verify">Verify Token</Code>,
                                        'Texto secreto (lo genera AgenIA automáticamente).',
                                        'Sirve para que Meta y AgenIA se reconozcan al recibir mensajes.',
                                    ],
                                ]}
                            />

                            <Callout variant="info" title="Tranquilo">
                                Te llevamos de la mano para conseguir cada uno. Si te
                                atascas en algún paso, todas las soluciones a errores
                                típicos están en la sección{' '}
                                <a href="#errores" className="underline font-semibold">
                                    Errores comunes
                                </a>
                                .
                            </Callout>
                        </Section>

                        {/* ===== REQUISITOS ===== */}
                        <Section id="requisitos" title="Antes de empezar — lo que necesitas a la mano">
                            <ChecklistGrid
                                items={[
                                    {
                                        title: 'Cuenta de Facebook personal',
                                        body: 'Si no tienes, créala en facebook.com (gratis, 5 min). Solo identifica al dueño técnico — no se publica nada.',
                                    },
                                    {
                                        title: 'Correo corporativo de la clínica',
                                        body: 'Ej. contacto@miclinica.com. Evita Gmail/Hotmail personales.',
                                    },
                                    {
                                        title: 'Un número de celular disponible',
                                        body: 'Que NO esté usándose en la app móvil de WhatsApp. Si vas a usar el número actual de la clínica, primero elimina la cuenta del celular.',
                                    },
                                    {
                                        title: 'Nombre legal de la clínica',
                                        body: 'Tal como aparece en la Cámara de Comercio.',
                                    },
                                ]}
                            />

                            <Callout variant="tip" title="Recomendación">
                                Compra una <strong>línea nueva</strong> dedicada a AgenIA
                                (Claro, Movistar, Tigo, una SIM virtual…). Así no
                                interrumpes tu WhatsApp actual ni a tu equipo
                                administrativo.
                            </Callout>
                        </Section>

                        {/* ===== PASO 1 ===== */}
                        <StepSection number={1} id="paso-1" title="Crear o entrar a Meta for Developers">
                            <p>
                                Meta for Developers es el panel desde donde se crean
                                integraciones técnicas.
                            </p>
                            <OrderedSteps>
                                <li>
                                    Abre tu navegador y entra a{' '}
                                    <ExternalLink href="https://developers.facebook.com">
                                        developers.facebook.com
                                    </ExternalLink>
                                    .
                                </li>
                                <li>
                                    Esquina superior derecha → botón azul{' '}
                                    <strong>"Comenzar"</strong>.
                                </li>
                                <li>
                                    Inicia sesión con tu cuenta de Facebook (si ya estás
                                    logueado, se autocompleta).
                                </li>
                                <li>
                                    Acepta las políticas para desarrolladores y verifica
                                    tu cuenta por SMS o correo.
                                </li>
                                <li>
                                    Cuando te pregunte tu rol, elige{' '}
                                    <strong>"Desarrollador"</strong>.
                                </li>
                            </OrderedSteps>
                            <Callout variant="info">
                                "Desarrollador" no significa que tengas que programar — es
                                solo el tipo de cuenta que Meta usa internamente.
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 2 ===== */}
                        <StepSection number={2} id="paso-2" title="Crear tu cuenta de Meta Business Suite">
                            <p>
                                Esto representa a tu institución como empresa dentro del
                                ecosistema de Meta — distinto al perfil personal.
                            </p>
                            <OrderedSteps>
                                <li>
                                    Abre{' '}
                                    <ExternalLink href="https://business.facebook.com">
                                        business.facebook.com
                                    </ExternalLink>{' '}
                                    en una pestaña nueva.
                                </li>
                                <li>
                                    <strong>"Crear cuenta"</strong> en la esquina superior
                                    derecha.
                                </li>
                                <li>
                                    Llena:
                                    <ul className="list-disc ml-5 mt-2 space-y-1 marker:text-emerald-500">
                                        <li>
                                            <strong>Nombre de la empresa:</strong> el
                                            nombre legal de tu clínica (lo verán tus
                                            pacientes).
                                        </li>
                                        <li>
                                            <strong>Tu nombre completo</strong> (cédula).
                                        </li>
                                        <li>
                                            <strong>Correo de la empresa</strong>{' '}
                                            (corporativo).
                                        </li>
                                    </ul>
                                </li>
                                <li>
                                    Confirma el correo desde tu bandeja (revisa Spam si no
                                    llega en 5 min).
                                </li>
                            </OrderedSteps>
                            <Callout variant="info" title="¿Ya tenías un Business Manager?">
                                Puedes saltarte este paso y usar el existente. Solo
                                necesitas ser <strong>administrador</strong> dentro de él.
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 3 ===== */}
                        <StepSection number={3} id="paso-3" title="Crear la App en Meta for Developers">
                            <p>
                                Una "App" es un proyecto técnico al que se le conectan
                                productos de Meta. Vamos a crear una solo para AgenIA.
                            </p>
                            <OrderedSteps>
                                <li>
                                    En el panel de Developers → botón{' '}
                                    <strong>"Crear app"</strong>.
                                </li>
                                <li>
                                    "¿Qué quieres hacer con tu app?" → baja hasta{' '}
                                    <strong>"Otro"</strong>.
                                </li>
                                <li>
                                    "Selecciona el tipo de app" →{' '}
                                    <strong>"Negocios"</strong> (Business).
                                </li>
                                <li>
                                    En "Proporciona detalles":
                                    <ul className="list-disc ml-5 mt-2 space-y-1 marker:text-emerald-500">
                                        <li>
                                            <strong>Nombre de la app:</strong>{' '}
                                            <Code>AgenIA - Clínica del Sol</Code>{' '}
                                            (privado, solo lo verás tú).
                                        </li>
                                        <li>
                                            <strong>Correo de contacto:</strong> el
                                            corporativo.
                                        </li>
                                        <li>
                                            <strong>Cuenta empresarial:</strong> la del
                                            Paso 2.
                                        </li>
                                    </ul>
                                </li>
                                <li>
                                    Re-ingresa tu contraseña de Facebook si te la piden.
                                </li>
                            </OrderedSteps>
                        </StepSection>

                        {/* ===== PASO 4 ===== */}
                        <StepSection number={4} id="paso-4" title="Agregar el producto WhatsApp">
                            <OrderedSteps>
                                <li>
                                    En el panel de la App, busca la tarjeta{' '}
                                    <strong>"WhatsApp"</strong> (logo verde).
                                </li>
                                <li>
                                    Clic en <strong>"Configurar"</strong>.
                                </li>
                                <li>
                                    Asocia tu cuenta empresarial cuando te lo pida.
                                </li>
                            </OrderedSteps>
                            <p>Meta creará automáticamente:</p>
                            <ul className="list-disc list-outside space-y-1 ml-5 marker:text-emerald-500">
                                <li>
                                    Una <strong>WhatsApp Business Account (WABA)</strong>.
                                </li>
                                <li>
                                    Un <strong>número de prueba</strong> con saldo gratis
                                    limitado.
                                </li>
                            </ul>
                            <p>
                                En el menú lateral izquierdo, debajo de "WhatsApp",
                                aparecerán:{' '}
                                <Code>Inicio rápido</Code>, <Code>API Setup</Code>,{' '}
                                <Code>Configuration</Code>, <Code>Plantillas</Code>.
                            </p>
                            <Callout variant="info">
                                Si no aparecen, refresca la página (F5). A veces Meta
                                tarda 10–20 segundos.
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 5 ===== */}
                        <StepSection
                            number={5}
                            id="paso-5"
                            title="Encontrar y copiar tu Phone Number ID"
                            highlight="¡El dato más importante!"
                        >
                            <p>Léelo con calma: aquí está el dato más confundido.</p>
                            <OrderedSteps>
                                <li>
                                    Menú izquierdo → <strong>WhatsApp → API Setup</strong>{' '}
                                    (también puede aparecer como{' '}
                                    <em>"Configuración de la API"</em>).
                                </li>
                                <li>
                                    En la sección "Send and receive messages" verás un
                                    esquema parecido a este:
                                </li>
                            </OrderedSteps>

                            <pre className="overflow-x-auto rounded-2xl bg-zinc-900 dark:bg-zinc-950 text-zinc-100 text-xs p-5 my-4 leading-relaxed font-mono border border-zinc-800 shadow-inner">
{`┌────────────────────────────────────────────────────────┐
│  From (desde)                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  ▼  +1 555 123 4567 — Test number                │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  Phone number ID:           123456789012345  [Copiar]  │ ← ESTE
│  WhatsApp Business Account ID: 987654321098765 [Copy]  │
│                                                        │
│  To (a)                                                │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Agregar número de prueba                        │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘`}
                            </pre>

                            <OrderedSteps start={3}>
                                <li>
                                    Lo que necesitas es el texto al lado de{' '}
                                    <strong>"Phone number ID"</strong>. Son entre 15 y 17
                                    dígitos.
                                </li>
                                <li>
                                    Clic en el ícono de copiar 📋 que aparece a su
                                    derecha.
                                </li>
                                <li>
                                    Pégalo en un bloc de notas, etiquetado{' '}
                                    <Code>Phone Number ID = …</Code>.
                                </li>
                            </OrderedSteps>

                            <Callout variant="warning" title="⚠ Evita estas confusiones">
                                <DataTable
                                    head={['Lo que NO es', 'Cómo se ve', 'Por qué no']}
                                    rows={[
                                        [
                                            'El número telefónico visible',
                                            <Code key="1">+1 555 123 4567</Code>,
                                            'Es solo la representación humana, no el ID interno.',
                                        ],
                                        [
                                            'WABA ID',
                                            'Aparece justo debajo',
                                            'Identifica la cuenta empresarial, no la línea.',
                                        ],
                                        [
                                            'App ID',
                                            'Aparece arriba en otra pantalla',
                                            'Identifica tu app, no la línea.',
                                        ],
                                    ]}
                                />
                                <p className="mt-3 text-sm">
                                    <strong>Regla mnemotécnica:</strong> el Phone Number{' '}
                                    <em>ID</em> siempre está pegado a un{' '}
                                    <em>número de teléfono</em> en pantalla. Si no ves un
                                    teléfono cerca, no es el correcto.
                                </p>
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 6 ===== */}
                        <StepSection number={6} id="paso-6" title="¿Número de prueba o número real?">
                            <p>
                                Meta te regala un número de prueba, pero tiene{' '}
                                <strong>dos limitaciones grandes</strong>:
                            </p>
                            <ul className="list-disc list-outside space-y-1 ml-5 marker:text-rose-500">
                                <li>
                                    Solo puedes mandar mensajes a{' '}
                                    <strong>5 destinatarios pre-aprobados</strong>.
                                </li>
                                <li>
                                    Solo recibes mensajes <strong>de esos 5</strong>,
                                    nadie más.
                                </li>
                            </ul>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-5">
                                <OptionCard
                                    badge="A"
                                    accent="indigo"
                                    title="Empezar con número de prueba"
                                    body="Perfecto para ver cómo funciona AgenIA antes de comprometer tu línea oficial. Si eliges esta opción, el Phone Number ID del Paso 5 ya te sirve. Salta directo al Paso 8."
                                />
                                <OptionCard
                                    badge="B"
                                    accent="emerald"
                                    title="Conectar tu número real"
                                    body="Lo que vas a necesitar en producción. Sigue el Paso 7."
                                    recommended
                                />
                            </div>
                        </StepSection>

                        {/* ===== PASO 7 ===== */}
                        <StepSection number={7} id="paso-7" title="Conectar tu número real">
                            <OrderedSteps>
                                <li>
                                    En <strong>API Setup</strong> → sección "From" → enlace{' '}
                                    <strong>"Add phone number"</strong>.
                                </li>
                                <li>
                                    Llena el formulario:
                                    <ul className="list-disc ml-5 mt-2 space-y-1.5 marker:text-emerald-500">
                                        <li>
                                            <strong>Display name:</strong> nombre con el
                                            que aparecerás. Reglas: mínimo 3 caracteres,
                                            sin mayúsculas seguidas (
                                            <Code>CLINICA</Code> no se acepta), sin
                                            referencias a Meta/WhatsApp, y debe coincidir
                                            con tu marca real.
                                        </li>
                                        <li>
                                            <strong>Categoría:</strong> "Salud".
                                        </li>
                                        <li>
                                            <strong>Descripción:</strong> opcional pero
                                            recomendada. Ej.{' '}
                                            <em>
                                                "Clínica especializada en medicina general
                                                y odontología. Agenda tu cita con nuestra
                                                asistente virtual AgenIA."
                                            </em>
                                        </li>
                                        <li>
                                            <strong>Sitio web:</strong> URL de tu clínica.
                                            Facebook o Instagram también valen si no
                                            tienes web.
                                        </li>
                                    </ul>
                                </li>
                                <li>
                                    "Verifica tu número": código de país (+57 Colombia),
                                    10 dígitos del celular, método{' '}
                                    <strong>"SMS"</strong> o{' '}
                                    <strong>"Llamada de voz"</strong>.
                                </li>
                                <li>Ingresa el código de 6 dígitos que recibas.</li>
                                <li>
                                    Tu número real aparece ahora en el selector "From".{' '}
                                    <strong>
                                        Selecciónalo y vuelve a copiar el Phone Number ID
                                    </strong>{' '}
                                    (será distinto al del número de prueba).
                                </li>
                            </OrderedSteps>

                            <Callout variant="warning" title="Si te dio error">
                                <DataTable
                                    head={['Mensaje', 'Significa', 'Solución']}
                                    rows={[
                                        [
                                            <Code key="1">already registered with WhatsApp</Code>,
                                            'El número está activo en la app móvil.',
                                            'Borra la cuenta desde el celular (Ajustes → Cuenta → Eliminar). Espera 5 min y reintenta.',
                                        ],
                                        [
                                            'No llega el SMS',
                                            'Algunos operadores bloquean SMS internacionales.',
                                            'Cambia a verificación por llamada de voz.',
                                        ],
                                        [
                                            <Code key="3">Display name violates policies</Code>,
                                            'El nombre tiene mayúsculas seguidas o palabras prohibidas.',
                                            'Reescríbelo evitando "WhatsApp", "Oficial" y mayúsculas en bloque.',
                                        ],
                                        [
                                            <Code key="4">Maximum phone numbers reached</Code>,
                                            'Cuenta no verificada limitada a 2 números.',
                                            'Haz la Business Verification en Business Settings.',
                                        ],
                                    ]}
                                />
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 8 ===== */}
                        <StepSection
                            number={8}
                            id="paso-8"
                            title="Generar el Access Token permanente"
                        >
                            <Callout variant="danger" title="⚠ Muy importante">
                                El token que aparece arriba en API Setup{' '}
                                <strong>expira en 24 horas</strong>. Si lo pegas en
                                AgenIA, mañana deja de funcionar. Tenemos que crear uno
                                permanente con un{' '}
                                <strong>System User</strong> (usuario robot dentro de tu
                                cuenta empresarial).
                            </Callout>

                            <SubStep label="8.1" title="Crear el Usuario del Sistema">
                                <OrderedSteps>
                                    <li>
                                        Entra a{' '}
                                        <ExternalLink href="https://business.facebook.com/settings">
                                            Configuración del negocio
                                        </ExternalLink>
                                        .
                                    </li>
                                    <li>
                                        Menú lateral → <strong>Usuarios</strong> →{' '}
                                        <strong>Usuarios del sistema</strong>.
                                    </li>
                                    <li>
                                        Clic en <strong>"Agregar"</strong> (botón azul).
                                    </li>
                                    <li>
                                        Nombre:{' '}
                                        <Code>AgenIA Integration</Code>. Rol:{' '}
                                        <strong>"Admin"</strong>.
                                    </li>
                                    <li>
                                        Acepta los términos y{' '}
                                        <strong>"Crear usuario del sistema"</strong>.
                                    </li>
                                </OrderedSteps>
                            </SubStep>

                            <SubStep label="8.2" title="Asignar permisos sobre tu WABA">
                                <OrderedSteps>
                                    <li>
                                        Con el System User seleccionado, clic en{' '}
                                        <strong>"Agregar activos"</strong>.
                                    </li>
                                    <li>
                                        Elige <strong>"Cuentas de WhatsApp"</strong>.
                                    </li>
                                    <li>Marca tu WABA del listado.</li>
                                    <li>
                                        A la derecha, activa{' '}
                                        <strong>"Control total"</strong>.
                                    </li>
                                    <li>
                                        <strong>"Guardar cambios"</strong>.
                                    </li>
                                </OrderedSteps>
                            </SubStep>

                            <SubStep label="8.3" title="Generar el token">
                                <OrderedSteps>
                                    <li>
                                        Con el System User seleccionado →{' '}
                                        <strong>"Generar nuevo token"</strong>.
                                    </li>
                                    <li>
                                        En el diálogo:
                                        <ul className="list-disc ml-5 mt-2 space-y-1 marker:text-emerald-500">
                                            <li>
                                                <strong>App:</strong> la que creaste en el
                                                Paso 3.
                                            </li>
                                            <li>
                                                <strong>Caducidad:</strong>{' '}
                                                <strong>"Nunca"</strong>.
                                            </li>
                                            <li>
                                                <strong>Permisos obligatorios:</strong>{' '}
                                                <Code>whatsapp_business_messaging</Code> +{' '}
                                                <Code>whatsapp_business_management</Code>.
                                            </li>
                                        </ul>
                                    </li>
                                    <li>
                                        Clic en <strong>"Generar token"</strong>.
                                    </li>
                                </OrderedSteps>
                                <Callout variant="danger" title="🚨 Crítico">
                                    Meta solo te muestra el token{' '}
                                    <strong>UNA vez</strong>. Si cierras la ventana sin
                                    copiarlo, lo pierdes y debes generar otro. Cópialo a tu
                                    bloc de notas como{' '}
                                    <Code>Access Token = EAA…</Code>.
                                </Callout>
                            </SubStep>
                        </StepSection>

                        {/* ===== PASO 9 ===== */}
                        <StepSection number={9} id="paso-9" title="Pegar los datos en AgenIA">
                            <OrderedSteps>
                                <li>Inicia sesión como Administrador de Clínica.</li>
                                <li>
                                    Menú →{' '}
                                    <strong>Configuración → Integraciones (IA y Canales)</strong>{' '}
                                    → sección <strong>"Canal de WhatsApp (Meta)"</strong>.
                                </li>
                                <li>
                                    Pega:
                                    <ul className="list-disc ml-5 mt-2 space-y-1 marker:text-emerald-500">
                                        <li>
                                            <strong>WhatsApp Phone ID</strong> → el número
                                            de 15–17 dígitos del Paso 5 o 7.
                                        </li>
                                        <li>
                                            <strong>Access Token</strong> → la cadena{' '}
                                            <Code>EAA…</Code> del Paso 8.3.
                                        </li>
                                    </ul>
                                </li>
                                <li>
                                    Clic en <strong>"Guardar canal de WhatsApp"</strong>.
                                </li>
                            </OrderedSteps>
                            <p>
                                AgenIA cifra tu Access Token con{' '}
                                <strong>AES-256-GCM</strong> antes de guardarlo. Nunca se
                                almacena en texto plano.
                            </p>
                        </StepSection>

                        {/* ===== PASO 10 ===== */}
                        <StepSection number={10} id="paso-10" title="Configurar el Webhook">
                            <p>
                                Hasta aquí AgenIA puede <strong>enviar</strong> mensajes.
                                Para que también pueda{' '}
                                <strong>recibir</strong> los mensajes de tus pacientes,
                                Meta necesita saber a qué URL mandar las notificaciones.
                            </p>
                            <OrderedSteps>
                                <li>
                                    En AgenIA, copia la <strong>Callback URL</strong> y el{' '}
                                    <strong>Verify Token</strong> que se muestran en el
                                    formulario (con los botones "Copiar").
                                </li>
                                <li>
                                    En Meta for Developers → tu app →{' '}
                                    <strong>WhatsApp → Configuration</strong>.
                                </li>
                                <li>
                                    En la sección "Webhook" → <strong>"Editar"</strong>.
                                </li>
                                <li>
                                    Pega ambos valores. El Verify Token debe ser{' '}
                                    <strong>exactamente igual</strong>, sin espacios al
                                    inicio ni al final.
                                </li>
                                <li>
                                    Clic en <strong>"Verificar y guardar"</strong>.
                                </li>
                                <li>
                                    Una vez verificado, baja a{' '}
                                    <strong>"Webhook fields"</strong> →{' '}
                                    <strong>"Manage"</strong> y marca:
                                    <ul className="list-disc ml-5 mt-2 space-y-1 marker:text-emerald-500">
                                        <li>
                                            <Code>messages</Code> ✅ (obligatorio para
                                            recibir mensajes entrantes)
                                        </li>
                                        <li>
                                            <Code>message_status</Code> ✅ (opcional pero
                                            recomendado)
                                        </li>
                                    </ul>
                                </li>
                                <li>
                                    <strong>"Save"</strong>.
                                </li>
                            </OrderedSteps>
                        </StepSection>

                        {/* ===== PASO 11 ===== */}
                        <StepSection number={11} id="paso-11" title="Suscribir tu WABA al webhook">
                            <Callout variant="warning">
                                Este paso es fácil de pasar por alto y{' '}
                                <strong>rompe la integración completa</strong> si se
                                omite.
                            </Callout>
                            <OrderedSteps>
                                <li>Sigue en WhatsApp → Configuration.</li>
                                <li>
                                    Baja hasta <strong>"WhatsApp Business Account"</strong>
                                    .
                                </li>
                                <li>
                                    Clic en <strong>"Subscribe"</strong>.
                                </li>
                                <li>
                                    Confirma seleccionando tu cuenta → <strong>"Done"</strong>.
                                </li>
                            </OrderedSteps>
                        </StepSection>

                        {/* ===== PASO 12 ===== */}
                        <StepSection number={12} id="paso-12" title="Prueba final desde tu propio celular">
                            <OrderedSteps>
                                <li>Toma tu celular personal (distinto al conectado).</li>
                                <li>
                                    Abre WhatsApp y escribe al número de tu clínica un{' '}
                                    <Code>Hola</Code>.
                                </li>
                            </OrderedSteps>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-5">
                                <Callout variant="success" title="Lo que debe pasar">
                                    <ul className="list-disc ml-5 space-y-1">
                                        <li>
                                            En 2–5 segundos, AgenIA responde
                                            automáticamente con el saludo personalizado.
                                        </li>
                                        <li>
                                            En AgenIA → Caja Negra (Auditoría) verás el
                                            mensaje registrado.
                                        </li>
                                        <li>
                                            Puedes pedir una cita y AgenIA te guiará.
                                        </li>
                                    </ul>
                                </Callout>
                                <Callout variant="warning" title="Si no responde">
                                    <ul className="list-disc ml-5 space-y-1">
                                        <li>Espera 30 segundos más (Meta tarda al inicio).</li>
                                        <li>
                                            Mira Caja Negra: si tu mensaje no aparece, el
                                            webhook no está recibiendo. Vuelve al Paso 10
                                            y 11.
                                        </li>
                                        <li>
                                            Si aparece pero no contesta, mira Errores
                                            comunes.
                                        </li>
                                    </ul>
                                </Callout>
                            </div>
                        </StepSection>

                        {/* ===== RESUMEN ===== */}
                        <Section
                            id="resumen"
                            title="Chuleta final"
                            icon={<ClipboardCheck className="w-5 h-5" />}
                        >
                            <p>
                                Cuando termines, tu bloc de notas debería verse así:
                            </p>
                            <pre className="overflow-x-auto rounded-2xl bg-zinc-900 dark:bg-zinc-950 text-zinc-100 text-xs p-5 my-4 leading-relaxed font-mono border border-zinc-800 shadow-inner">
{`=== Datos para AgenIA ===
Phone Number ID:  123456789012345
Access Token:     EAAB.................................................
Verify Token:     ag3n14_w3bh00k_s3cr3t_xxxxxxxxx  (este lo da AgenIA)
Callback URL:     https://api.agendamiento-ia.com/chatbot/webhook

=== Otros datos útiles (por si los pide soporte) ===
App ID:           1234567890123456
WABA ID:          987654321098765
Número conectado: +57 300 123 4567
Nombre mostrado:  Clínica del Sol`}
                            </pre>
                            <Callout variant="danger" title="Guárdalo en un lugar seguro">
                                El <strong>Access Token</strong> funciona como contraseña:
                                quien lo tenga puede enviar mensajes en nombre de tu
                                clínica. Trátalo como una credencial bancaria.
                            </Callout>
                        </Section>

                        {/* ===== ERRORES COMUNES ===== */}
                        <Section
                            id="errores"
                            title="Errores comunes y cómo resolverlos"
                            icon={<AlertTriangle className="w-5 h-5" />}
                        >
                            <ErrorsGroup
                                heading="Al verificar el número (Paso 7)"
                                rows={[
                                    [
                                        'This phone number is already registered with WhatsApp',
                                        'El número está activo en la app móvil.',
                                        'Borra la cuenta desde el celular (Ajustes → Cuenta → Eliminar) y espera 5 min.',
                                    ],
                                    [
                                        'No llega el SMS',
                                        'Operadores que bloquean SMS internacionales.',
                                        'Cambia a verificación por llamada de voz.',
                                    ],
                                    [
                                        'Display name violates policies',
                                        'Nombre con problemas de formato.',
                                        'Evita mayúsculas seguidas, palabras como "WhatsApp" u "Oficial".',
                                    ],
                                    [
                                        'Maximum phone numbers reached',
                                        'Cuenta no verificada limitada a 2 números.',
                                        'Haz la Business Verification en Business Settings.',
                                    ],
                                ]}
                            />

                            <ErrorsGroup
                                heading="Al generar el token (Paso 8)"
                                rows={[
                                    [
                                        'No aparece el botón "Generar token"',
                                        'El System User no tiene la app asignada.',
                                        'Vuelve al 8.2 y asigna la app además de la WABA.',
                                    ],
                                    [
                                        'Cerré la ventana antes de copiar',
                                        'Meta solo lo muestra una vez.',
                                        'Genera otro desde el mismo System User (no rompe nada).',
                                    ],
                                    [
                                        'Token expira aún siendo permanente',
                                        'No marcaste "Nunca" en caducidad.',
                                        'Genera otro asegurándote de marcar Never expires.',
                                    ],
                                ]}
                            />

                            <ErrorsGroup
                                heading="Al conectar con AgenIA (Paso 9)"
                                rows={[
                                    [
                                        'Invalid access token',
                                        'Pegaste el token temporal de 24h.',
                                        'Genera el permanente con System User (Paso 8).',
                                    ],
                                    [
                                        'Phone number not found',
                                        'Phone Number ID mal copiado.',
                                        'Vuelve al Paso 5 y cuidado con espacios.',
                                    ],
                                    [
                                        'Forbidden / Permission denied',
                                        'System User sin Control Total sobre la WABA.',
                                        'Vuelve al 8.2 y marca "Control total".',
                                    ],
                                ]}
                            />

                            <ErrorsGroup
                                heading="Al configurar el webhook (Paso 10–11)"
                                rows={[
                                    [
                                        'Webhook verification failed',
                                        'Verify Token no coincide.',
                                        'Copia el token desde AgenIA y pégalo sin espacios.',
                                    ],
                                    [
                                        'Could not connect to callback URL',
                                        'AgenIA no está respondiendo o la URL incluye un puerto inválido.',
                                        'Verifica que la URL no tenga :3000 y que apunte al subdominio público correcto.',
                                    ],
                                    [
                                        'Los mensajes no llegan',
                                        'Olvidaste suscribir la WABA (Paso 11).',
                                        'Vuelve y haz clic en "Subscribe".',
                                    ],
                                    [
                                        'Llegan pero AgenIA no responde',
                                        'Falta marcar messages en webhook fields.',
                                        'Paso 10.6 → marca la casilla messages.',
                                    ],
                                ]}
                            />
                        </Section>

                        {/* ===== FAQ ===== */}
                        <Section id="faq" title="Preguntas frecuentes" icon={<Info className="w-5 h-5" />}>
                            <FaqItem question="¿Esto tiene costo?">
                                Crear la cuenta de desarrollador y la WABA es gratis. La
                                API cobra por <strong>conversación iniciada</strong> con
                                precios que varían por país y tipo de mensaje (servicio,
                                utilidad, marketing). Meta da créditos gratuitos al inicio.
                            </FaqItem>
                            <FaqItem question="¿Puedo cambiar el número después?">
                                Sí. Repite el Paso 7 con el nuevo número. El Phone Number
                                ID cambia, así que tendrás que actualizarlo en AgenIA.
                            </FaqItem>
                            <FaqItem question="¿Si elimino la app de Meta for Developers, pierdo todo?">
                                Sí. La WABA queda huérfana y los tokens dejan de
                                funcionar. No la borres a menos que estés migrando
                                intencionalmente.
                            </FaqItem>
                            <FaqItem question="¿Mi conversación de WhatsApp Business actual se pierde al pasar a la API?">
                                Sí. La API es un canal técnicamente distinto al de la app
                                móvil. <strong>Los chats viejos no se traspasan.</strong>{' '}
                                Por eso recomendamos un número nuevo dedicado a AgenIA.
                            </FaqItem>
                            <FaqItem question="¿Qué pasa con la verificación azul?">
                                Es independiente. Una vez tu integración esté activa y
                                tengas algo de volumen, puedes solicitar la insignia
                                verde de cuenta oficial en Meta.
                            </FaqItem>
                            <FaqItem question="¿AgenIA puede ver mis chats personales de WhatsApp?">
                                No. AgenIA solo tiene acceso al número que conectaste vía
                                API, no a tu WhatsApp personal.
                            </FaqItem>
                        </Section>

                        {/* ===== SOPORTE ===== */}
                        <Section
                            id="soporte"
                            title="¿Te quedaste atascado?"
                            icon={<LifeBuoy className="w-5 h-5" />}
                        >
                            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/50 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-900/10 dark:to-zinc-900 p-6 md:p-8">
                                <p className="text-zinc-700 dark:text-zinc-200 mb-4">
                                    Si después de seguir esta guía algo no funciona:
                                </p>
                                <OrderedSteps>
                                    <li>
                                        Toma un <strong>screenshot</strong> de la pantalla
                                        donde estás bloqueado.
                                    </li>
                                    <li>
                                        Entra a AgenIA →{' '}
                                        <strong>Soporte → Crear ticket</strong>.
                                    </li>
                                    <li>
                                        Adjunta el screenshot y dinos en qué paso de esta
                                        guía estás.
                                    </li>
                                    <li>
                                        Nuestro equipo te responde en máximo 24 horas
                                        hábiles.
                                    </li>
                                </OrderedSteps>
                            </div>

                            <div className="mt-10 rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white p-8 md:p-10 shadow-xl shadow-emerald-600/20">
                                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                                    <div>
                                        <h3 className="text-2xl md:text-3xl font-extrabold mb-2">
                                            ¿Listo para conectar?
                                        </h3>
                                        <p className="text-emerald-50 leading-relaxed max-w-xl">
                                            En unos minutos vas a tener una asistente
                                            virtual atendiendo a tus pacientes 24/7. Inicia
                                            sesión y entra a Integraciones → Canal de
                                            WhatsApp.
                                        </p>
                                    </div>
                                    <Link
                                        href="/login"
                                        className="inline-flex items-center gap-2 rounded-2xl bg-white text-emerald-700 px-6 py-3 text-sm font-bold shadow-md hover:scale-[1.03] transition-transform shrink-0"
                                    >
                                        <LogIn className="w-4 h-4" />
                                        Ir al panel de AgenIA
                                    </Link>
                                </div>
                            </div>
                        </Section>
                    </article>
                </div>
            </div>

            {/* Footer */}
            <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500 dark:text-zinc-500">
                    <div className="flex items-center gap-2">
                        <BrandLogo size={20} alt="AgenIA" />
                        <span>
                            © {new Date().getFullYear()} AgenIA · Asistente virtual de
                            agendamiento médico
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <a
                            href="/docs/guia-whatsapp-phone-id.md"
                            download
                            className="hover:text-zinc-900 dark:hover:text-white transition-colors flex items-center gap-1.5"
                        >
                            <FileText className="w-3.5 h-3.5" />
                            Descargar guía
                        </a>
                        <Link
                            href="/"
                            className="hover:text-zinc-900 dark:hover:text-white transition-colors"
                        >
                            Volver al inicio
                        </Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}

// ════════════════════════════════════════════════════════════════
// Primitivos visuales (todos server-renderable)
// ════════════════════════════════════════════════════════════════

function MetaPill({
    icon,
    children,
}: {
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300 shadow-sm">
            <span className="text-zinc-400">{icon}</span>
            {children}
        </span>
    );
}

function Section({
    id,
    title,
    icon,
    children,
}: {
    id: string;
    title: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section id={id} className="scroll-mt-24 py-8">
            <h2 className="flex items-center gap-2 text-2xl md:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-5">
                {icon && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                        {icon}
                    </span>
                )}
                {title}
            </h2>
            <div className="space-y-4 text-zinc-700 dark:text-zinc-300 leading-relaxed">
                {children}
            </div>
        </section>
    );
}

function StepSection({
    number,
    id,
    title,
    highlight,
    children,
}: {
    number: number;
    id: string;
    title: string;
    highlight?: string;
    children: React.ReactNode;
}) {
    const padded = String(number).padStart(2, '0');
    return (
        <section id={id} className="scroll-mt-24 py-10">
            <div className="flex items-start gap-4 mb-6">
                <div className="shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-extrabold text-lg shadow-lg shadow-emerald-600/30">
                    {padded}
                </div>
                <div className="pt-1">
                    {highlight && (
                        <span className="inline-block mb-1 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                            {highlight}
                        </span>
                    )}
                    <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white leading-tight">
                        Paso {number}: {title}
                    </h2>
                </div>
            </div>
            <div className="space-y-4 text-zinc-700 dark:text-zinc-300 leading-relaxed ml-0 sm:ml-[72px]">
                {children}
            </div>
        </section>
    );
}

function SubStep({
    label,
    title,
    children,
}: {
    label: string;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className="mt-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 backdrop-blur-sm p-5">
            <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40">
                    {label}
                </span>
                {title}
            </h3>
            <div className="space-y-3 text-sm">{children}</div>
        </div>
    );
}

function OrderedSteps({
    children,
    start = 1,
}: {
    children: React.ReactNode;
    start?: number;
}) {
    return (
        <ol
            start={start}
            className="list-decimal list-outside space-y-2 ml-5 marker:text-emerald-500 marker:font-bold"
        >
            {children}
        </ol>
    );
}

function Code({ children }: { children: React.ReactNode }) {
    return (
        <code className="font-mono text-[0.85em] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200/60 dark:border-zinc-700/60">
            {children}
        </code>
    );
}

function ExternalLink({
    href,
    children,
}: {
    href: string;
    children: React.ReactNode;
}) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-700 dark:text-emerald-400 font-semibold underline underline-offset-2 hover:text-emerald-900 dark:hover:text-emerald-300"
        >
            {children}
        </a>
    );
}

function Callout({
    variant,
    title,
    children,
}: {
    variant: 'info' | 'tip' | 'warning' | 'danger' | 'success';
    title?: string;
    children: React.ReactNode;
}) {
    const palettes = {
        info: {
            border: 'border-blue-200 dark:border-blue-800/40',
            bg: 'bg-blue-50/70 dark:bg-blue-900/15',
            iconBg: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300',
            icon: <Info className="w-4 h-4" />,
        },
        tip: {
            border: 'border-violet-200 dark:border-violet-800/40',
            bg: 'bg-violet-50/70 dark:bg-violet-900/15',
            iconBg:
                'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300',
            icon: <Lightbulb className="w-4 h-4" />,
        },
        warning: {
            border: 'border-amber-200 dark:border-amber-800/40',
            bg: 'bg-amber-50/70 dark:bg-amber-900/15',
            iconBg:
                'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300',
            icon: <AlertTriangle className="w-4 h-4" />,
        },
        danger: {
            border: 'border-rose-200 dark:border-rose-800/40',
            bg: 'bg-rose-50/70 dark:bg-rose-900/15',
            iconBg: 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300',
            icon: <ShieldAlert className="w-4 h-4" />,
        },
        success: {
            border: 'border-emerald-200 dark:border-emerald-800/40',
            bg: 'bg-emerald-50/70 dark:bg-emerald-900/15',
            iconBg:
                'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300',
            icon: <CheckCircle2 className="w-4 h-4" />,
        },
    } as const;
    const p = palettes[variant];
    return (
        <div className={`rounded-2xl border ${p.border} ${p.bg} p-4 md:p-5 my-4`}>
            <div className="flex items-start gap-3">
                <div
                    className={`shrink-0 rounded-lg p-2 ${p.iconBg}`}
                    aria-hidden="true"
                >
                    {p.icon}
                </div>
                <div className="flex-1 text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed">
                    {title && (
                        <div className="font-bold text-zinc-900 dark:text-white mb-1">
                            {title}
                        </div>
                    )}
                    {children}
                </div>
            </div>
        </div>
    );
}

function DataTable({
    head,
    rows,
}: {
    head: string[];
    rows: React.ReactNode[][];
}) {
    return (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 my-3">
            <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-900/60 text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wider">
                    <tr>
                        {head.map((h, i) => (
                            <th
                                key={i}
                                className="px-3 py-2 font-semibold border-b border-zinc-200 dark:border-zinc-800"
                            >
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {rows.map((row, ri) => (
                        <tr
                            key={ri}
                            className="hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40 transition-colors"
                        >
                            {row.map((cell, ci) => (
                                <td
                                    key={ci}
                                    className="px-3 py-2 align-top text-zinc-700 dark:text-zinc-300"
                                >
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ChecklistGrid({
    items,
}: {
    items: Array<{ title: string; body: string }>;
}) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-3">
            {items.map((it, i) => (
                <div
                    key={i}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4 flex gap-3"
                >
                    <CheckCircle2 className="shrink-0 w-5 h-5 text-emerald-500 mt-0.5" />
                    <div>
                        <div className="font-semibold text-zinc-900 dark:text-white text-sm mb-0.5">
                            {it.title}
                        </div>
                        <div className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                            {it.body}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function OptionCard({
    badge,
    title,
    body,
    accent,
    recommended = false,
}: {
    badge: string;
    title: string;
    body: string;
    accent: 'indigo' | 'emerald';
    recommended?: boolean;
}) {
    const styles =
        accent === 'emerald'
            ? {
                  ring: 'ring-emerald-500/30',
                  badgeBg:
                      'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
                  border: 'border-emerald-200 dark:border-emerald-800/50',
              }
            : {
                  ring: 'ring-indigo-500/20',
                  badgeBg:
                      'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
                  border: 'border-indigo-200 dark:border-indigo-800/50',
              };
    return (
        <div
            className={`relative rounded-2xl border ${styles.border} bg-white dark:bg-zinc-900/50 p-5 ${
                recommended ? `ring-2 ${styles.ring}` : ''
            }`}
        >
            {recommended && (
                <span className="absolute -top-2 right-4 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-emerald-600 text-white shadow">
                    Recomendado
                </span>
            )}
            <div className="flex items-center gap-2 mb-2">
                <span
                    className={`w-7 h-7 rounded-lg font-bold text-sm flex items-center justify-center ${styles.badgeBg}`}
                >
                    {badge}
                </span>
                <h3 className="font-bold text-zinc-900 dark:text-white">{title}</h3>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {body}
            </p>
        </div>
    );
}

function ErrorsGroup({
    heading,
    rows,
}: {
    heading: string;
    rows: Array<[string, string, string]>;
}) {
    return (
        <div className="my-5">
            <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                {heading}
            </h3>
            <DataTable head={['Síntoma', 'Causa', 'Solución']} rows={rows} />
        </div>
    );
}

function FaqItem({
    question,
    children,
}: {
    question: string;
    children: React.ReactNode;
}) {
    return (
        <details className="group rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 my-2 open:shadow-sm">
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3 select-none">
                <span className="font-semibold text-zinc-900 dark:text-white text-sm">
                    {question}
                </span>
                <span className="text-zinc-400 group-open:rotate-45 transition-transform text-xl leading-none">
                    +
                </span>
            </summary>
            <div className="px-4 pb-4 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                {children}
            </div>
        </details>
    );
}

// Suprimir unused-imports warning si algún ícono no se utiliza.
const _unused = { KeyRound, Phone, Sparkles, Webhook };
void _unused;
