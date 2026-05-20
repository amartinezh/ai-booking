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
    Lightbulb,
    ListChecks,
    LogIn,
    ShieldAlert,
    Sparkles,
    UserCircle,
} from 'lucide-react';
import TableOfContents from './TableOfContents';

// Página PÚBLICA — el middleware solo protege /dashboard y /super-admin.
// Cualquier persona puede ver esta guía desde Internet.

export const metadata: Metadata = {
    title: 'Guía: Obtén tu API Key de Google AI Studio (Gemini) · AgenIA',
    description:
        'Paso a paso para crear tu API Key de Gemini en Google AI Studio y conectarla a AgenIA. Diseñada para no-técnicos.',
    openGraph: {
        title: 'Cómo obtener tu API Key de Gemini para AgenIA',
        description:
            'De cero a tener la IA de Google atendiendo a tus pacientes en menos de 20 minutos.',
        type: 'article',
    },
};

const SECTIONS = [
    { id: 'intro', label: 'Introducción' },
    { id: 'requisitos', label: 'Antes de empezar' },
    { id: 'paso-1', label: 'Paso 1 · Entrar a AI Studio' },
    { id: 'paso-2', label: 'Paso 2 · Aceptar términos' },
    { id: 'paso-3', label: 'Paso 3 · Sección API Keys' },
    { id: 'paso-4', label: 'Paso 4 · Crear la API Key' },
    { id: 'paso-5', label: 'Paso 5 · Copiar la llave' },
    { id: 'paso-6', label: 'Paso 6 · Gratis o facturación' },
    { id: 'paso-7', label: 'Paso 7 · Pegar en AgenIA' },
    { id: 'paso-8', label: 'Paso 8 · Elegir modelo' },
    { id: 'paso-9', label: 'Paso 9 · Prueba final' },
    { id: 'resumen', label: 'Resumen final' },
    { id: 'errores', label: 'Errores comunes' },
    { id: 'faq', label: 'Preguntas frecuentes' },
    { id: 'soporte', label: 'Soporte' },
];

export default function GuiaGoogleAiStudioPage() {
    return (
        <div className="relative min-h-screen bg-zinc-50 dark:bg-zinc-950 selection:bg-sky-500 selection:text-white font-sans">
            {/* Orbes decorativos */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[90vh] overflow-hidden -z-10 pointer-events-none">
                <div className="absolute -top-[15%] -left-[10%] w-[55%] h-[55%] rounded-full bg-gradient-to-br from-sky-400/15 to-blue-400/15 blur-[120px]" />
                <div className="absolute top-[10%] -right-[10%] w-[40%] h-[60%] rounded-full bg-gradient-to-br from-indigo-400/15 to-violet-400/15 blur-[120px]" />
            </div>

            {/* Header */}
            <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/70 dark:bg-zinc-950/70 border-b border-zinc-200/60 dark:border-zinc-800/60">
                <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2">
                        <CorpLogo size={32} />
                        <span className="text-base font-bold tracking-tight text-zinc-900 dark:text-white">
                            AgenIA
                        </span>
                        <span className="hidden sm:inline-block ml-3 text-xs px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-900/30 border border-sky-200/70 dark:border-sky-800/40 text-sky-700 dark:text-sky-300 font-semibold">
                            Guía oficial
                        </span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <a
                            href="/docs/guia-google-ai-studio.md"
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
                    <CorpLogo
                        size={88}
                        className="mx-auto mb-8 rounded-2xl shadow-xl shadow-sky-600/10 ring-1 ring-zinc-200/60 dark:ring-zinc-800/60"
                    />

                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800/50 text-xs text-sky-700 dark:text-sky-400 font-semibold mb-6">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
                        </span>
                        Guía oficial · actualizada 2026
                    </div>

                    <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-zinc-900 dark:text-white leading-[1.1] mb-6">
                        Obtén tu API Key de{' '}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-600 to-blue-600 dark:from-sky-400 dark:to-blue-400">
                            Google AI Studio
                        </span>
                    </h1>

                    <p className="max-w-2xl mx-auto text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed mb-8">
                        Conecta la inteligencia artificial <strong>Gemini</strong> de
                        Google a AgenIA en{' '}
                        <strong className="text-zinc-900 dark:text-zinc-200">
                            menos de 20 minutos
                        </strong>
                        . No necesitas saber programar — solo una cuenta de Google.
                    </p>

                    {/* Pills meta */}
                    <div className="flex flex-wrap justify-center gap-2 mb-10">
                        <MetaPill icon={<Clock className="w-3.5 h-3.5" />}>
                            10–20 minutos
                        </MetaPill>
                        <MetaPill icon={<UserCircle className="w-3.5 h-3.5" />}>
                            Nivel: principiante
                        </MetaPill>
                        <MetaPill icon={<ListChecks className="w-3.5 h-3.5" />}>
                            9 pasos guiados
                        </MetaPill>
                        <MetaPill icon={<ShieldAlert className="w-3.5 h-3.5" />}>
                            Sin código
                        </MetaPill>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                        <a
                            href="#paso-1"
                            className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 hover:bg-sky-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-600/20 hover:scale-[1.02] transition-all"
                        >
                            Empezar Paso 1
                            <ArrowRight className="w-4 h-4" />
                        </a>
                        <a
                            href="#requisitos"
                            className="inline-flex items-center gap-2 rounded-2xl bg-white dark:bg-zinc-900 px-6 py-3 text-sm font-semibold text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 hover:border-sky-500 dark:hover:border-sky-500 transition-all"
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
                                <strong>Google AI Studio</strong> es la página oficial y
                                gratuita de Google para crear las{' '}
                                <strong>llaves de acceso (API Keys)</strong> a su
                                inteligencia artificial <strong>Gemini</strong>.
                            </p>
                            <ul className="list-disc list-outside space-y-1 ml-5 marker:text-sky-500">
                                <li>
                                    <strong>Gemini</strong> es el "cerebro" de IA de Google.
                                    Es <strong>multimodal</strong> (entiende texto y audio),
                                    por eso es el proveedor recomendado para el dictado
                                    clínico de tus médicos.
                                </li>
                                <li>
                                    Una <strong>API Key</strong> es una contraseña larga que
                                    le da permiso a <strong>AgenIA</strong> para usar Gemini{' '}
                                    <strong>en tu nombre</strong>.
                                </li>
                            </ul>
                            <p>
                                Al final del proceso tendrás{' '}
                                <strong>un solo dato</strong> que pegarás en AgenIA:
                            </p>

                            <DataTable
                                head={['Dato', '¿Qué es?', '¿Para qué?']}
                                rows={[
                                    [
                                        <Code key="key">API Key (Gemini)</Code>,
                                        <>
                                            Clave larga que suele empezar por{' '}
                                            <Code>AIza…</Code> (≈39 caracteres).
                                        </>,
                                        'Permite a AgenIA usar la IA de Google en tu nombre.',
                                    ],
                                ]}
                            />

                            <Callout variant="info" title="Tranquilo">
                                Es mucho más rápido que conectar WhatsApp. Si te atascas, las
                                soluciones a errores típicos están en la sección{' '}
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
                                        title: 'Una cuenta de Google activa',
                                        body: 'El Gmail de la clínica o una cuenta de Google Workspace. Si no tienes, créala gratis en accounts.google.com.',
                                    },
                                    {
                                        title: 'Preferiblemente cuenta corporativa',
                                        body: 'Usa la cuenta de la clínica, no la personal del administrador. Así la llave no se pierde si esa persona se va.',
                                    },
                                    {
                                        title: 'Un navegador',
                                        body: 'Chrome, Edge, Firefox o Safari. Cualquiera funciona.',
                                    },
                                    {
                                        title: 'Tu usuario Administrador de AgenIA',
                                        body: 'Para poder pegar la llave en la configuración al final.',
                                    },
                                ]}
                            />

                            <Callout variant="tip" title="¿Tiene costo?">
                                Google AI Studio ofrece un <strong>nivel gratuito</strong>{' '}
                                con un límite generoso de mensajes, suficiente para empezar y
                                para clínicas pequeñas. Si necesitas más volumen, puedes
                                activar facturación (Paso 6). Precios actualizados en{' '}
                                <ExternalLink href="https://ai.google.dev/pricing">
                                    ai.google.dev/pricing
                                </ExternalLink>
                                .
                            </Callout>
                        </Section>

                        {/* ===== PASO 1 ===== */}
                        <StepSection number={1} id="paso-1" title="Entrar a Google AI Studio">
                            <OrderedSteps>
                                <li>
                                    Abre tu navegador y entra a{' '}
                                    <ExternalLink href="https://aistudio.google.com">
                                        aistudio.google.com
                                    </ExternalLink>
                                    .
                                </li>
                                <li>
                                    Si te pide iniciar sesión, hazlo con la{' '}
                                    <strong>cuenta de Google de la clínica</strong>.
                                </li>
                                <li>
                                    La primera vez verás una pantalla de bienvenida y
                                    posiblemente un aviso de términos de servicio.
                                </li>
                            </OrderedSteps>
                            <Callout variant="warning" title="Ojo con la cuenta correcta">
                                Si arriba a la derecha aparece tu cuenta{' '}
                                <em>personal</em> en lugar de la corporativa, haz clic en la
                                foto → <strong>"Cambiar de cuenta"</strong> y entra con la de
                                la clínica antes de continuar. La llave queda ligada a esa
                                cuenta.
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 2 ===== */}
                        <StepSection number={2} id="paso-2" title="Aceptar los términos de servicio">
                            <OrderedSteps>
                                <li>
                                    Google mostrará los{' '}
                                    <strong>Términos de servicio de la API de Gemini</strong>
                                    .
                                </li>
                                <li>
                                    Marca la casilla de{' '}
                                    <strong>"Acepto los términos de servicio"</strong>.
                                </li>
                                <li>
                                    La segunda casilla (recibir correos) es opcional; puedes
                                    dejarla sin marcar.
                                </li>
                                <li>
                                    Clic en <strong>"Continuar"</strong>.
                                </li>
                            </OrderedSteps>
                            <Callout variant="info">
                                Esto solo aparece la primera vez. Si ya habías entrado antes,
                                AI Studio te lleva directo al panel.
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 3 ===== */}
                        <StepSection number={3} id="paso-3" title="Abrir la sección de API Keys">
                            <OrderedSteps>
                                <li>
                                    En el <strong>menú lateral izquierdo</strong>, busca{' '}
                                    <strong>"Get API key"</strong> (Obtener clave de API) o{' '}
                                    <strong>"API Keys"</strong>.
                                </li>
                                <li>
                                    También puedes ir directo a{' '}
                                    <ExternalLink href="https://aistudio.google.com/app/apikey">
                                        aistudio.google.com/app/apikey
                                    </ExternalLink>
                                    .
                                </li>
                                <li>
                                    Llegas a la pantalla <strong>"API keys"</strong> con un
                                    botón grande <strong>"Create API key"</strong>.
                                </li>
                            </OrderedSteps>
                            <Callout variant="info">
                                Si es tu primera vez, la lista de llaves estará vacía. Es
                                normal.
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 4 ===== */}
                        <StepSection number={4} id="paso-4" title="Crear tu API Key">
                            <OrderedSteps>
                                <li>
                                    Haz clic en <strong>"Create API key"</strong> (Crear
                                    clave de API).
                                </li>
                                <li>
                                    Google te puede preguntar por el{' '}
                                    <strong>proyecto</strong>. Tienes dos caminos:
                                </li>
                            </OrderedSteps>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-5">
                                <OptionCard
                                    badge="A"
                                    accent="sky"
                                    title="Proyecto nuevo (automático)"
                                    body='Si aparece "Create API key in new project", haz clic ahí. Google crea el proyecto por detrás y no tienes que configurar nada más.'
                                    recommended
                                />
                                <OptionCard
                                    badge="B"
                                    accent="indigo"
                                    title="Usar un proyecto existente"
                                    body="Si tu clínica ya usa Google Cloud, selecciónalo en el desplegable. Si no sabes qué es esto, usa la Opción A: es lo más simple."
                                />
                            </div>

                            <p>
                                En 2–3 segundos, Google genera la llave y te muestra una
                                ventana con la <strong>API Key en grande</strong>. Normalmente
                                empieza por <Code>AIza…</Code>.
                            </p>
                        </StepSection>

                        {/* ===== PASO 5 ===== */}
                        <StepSection
                            number={5}
                            id="paso-5"
                            title="Copiar y guardar la llave"
                            highlight="¡El dato más importante!"
                        >
                            <OrderedSteps>
                                <li>
                                    Clic en el ícono de copiar 📋 que aparece a la derecha de
                                    la llave.
                                </li>
                                <li>
                                    Pégala en un bloc de notas y rotúlala{' '}
                                    <Code>API Key de Gemini = AIza…</Code>.
                                </li>
                                <li>Guárdala en un lugar seguro.</li>
                            </OrderedSteps>

                            <Callout variant="warning" title="⚠ Trátala como una contraseña">
                                <DataTable
                                    head={['Sí debes', 'No debes']}
                                    rows={[
                                        [
                                            'Guardarla en un gestor de contraseñas o lugar privado.',
                                            'Pegarla en chats, correos públicos o documentos compartidos.',
                                        ],
                                        [
                                            'Pegarla únicamente en AgenIA.',
                                            'Subirla a redes sociales ni publicarla en tu web.',
                                        ],
                                        [
                                            'Regenerarla si crees que se filtró.',
                                            'Compartirla con personas ajenas a la clínica.',
                                        ],
                                    ]}
                                />
                            </Callout>

                            <Callout variant="success" title="Buena noticia">
                                A diferencia del token de WhatsApp, en Google{' '}
                                <strong>puedes volver a ver tus llaves</strong> entrando de
                                nuevo a{' '}
                                <ExternalLink href="https://aistudio.google.com/app/apikey">
                                    aistudio.google.com/app/apikey
                                </ExternalLink>
                                . Si la pierdes, borras la vieja y creas una nueva.
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 6 ===== */}
                        <StepSection number={6} id="paso-6" title="¿Nivel gratuito o facturación?">
                            <p>Google te da dos modos de uso:</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-5">
                                <OptionCard
                                    badge="✓"
                                    accent="sky"
                                    title="Nivel gratuito (free tier)"
                                    body="Sin tarjeta de crédito. Tiene límites por minuto y por día, suficientes para una clínica pequeña. Si ves 'Quota exceeded' con frecuencia, considera facturación."
                                    recommended
                                />
                                <OptionCard
                                    badge="$"
                                    accent="indigo"
                                    title="Nivel pagado (facturación)"
                                    body="Sube los límites drásticamente. Requiere vincular una cuenta de facturación de Google Cloud (tarjeta) al proyecto del Paso 4."
                                />
                            </div>
                            <Callout variant="tip">
                                Empieza con el nivel gratuito. Solo activa facturación si ves
                                errores de cuota frecuentes o tu volumen de pacientes crece
                                mucho.
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 7 ===== */}
                        <StepSection number={7} id="paso-7" title="Pegar la llave en AgenIA">
                            <OrderedSteps>
                                <li>Inicia sesión como Administrador de Clínica.</li>
                                <li>
                                    Menú → <strong>Configuración</strong> → sección{' '}
                                    <strong>"Integración de IA"</strong>.
                                </li>
                                <li>
                                    En <strong>"Proveedor activo"</strong>, haz clic en la
                                    tarjeta de <strong>"Google Gemini"</strong> (ícono de
                                    destellos ✨).
                                </li>
                                <li>
                                    En el formulario de credenciales:
                                    <ul className="list-disc ml-5 mt-2 space-y-1 marker:text-sky-500">
                                        <li>
                                            <strong>API Key</strong> → pega la cadena{' '}
                                            <Code>AIza…</Code> del Paso 5.
                                        </li>
                                        <li>
                                            <strong>Modelo</strong> → elige uno (ver Paso 8).
                                        </li>
                                    </ul>
                                </li>
                                <li>
                                    Clic en <strong>"Guardar integración"</strong>.
                                </li>
                            </OrderedSteps>
                            <Callout variant="info" title="Tu llave queda protegida">
                                Cuando veas <strong>"✅ Configuración guardada"</strong>, la
                                llave queda cifrada con <strong>AES-256-GCM</strong>. Por
                                seguridad el campo se vacía y AgenIA solo muestra los últimos
                                dígitos (<Code>•••XXXX</Code>).
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 8 ===== */}
                        <StepSection number={8} id="paso-8" title="Elegir el modelo de Gemini">
                            <p>
                                AgenIA te deja elegir entre varios modelos. Esta es la
                                recomendación según tu caso:
                            </p>
                            <DataTable
                                head={['Modelo', 'Cuándo usarlo']}
                                rows={[
                                    [
                                        <Code key="flash">gemini-2.5-flash</Code>,
                                        <>
                                            <strong>Recomendado por defecto.</strong> Rápido
                                            y económico. Ideal para chatear con pacientes y
                                            agendar citas.
                                        </>,
                                    ],
                                    [
                                        <Code key="pro">gemini-2.5-pro</Code>,
                                        'Para razonamiento más complejo o respuestas más elaboradas. Algo más lento y costoso.',
                                    ],
                                    [
                                        <Code key="15">gemini-1.5-flash</Code>,
                                        'Alternativa más antigua y muy económica. Útil para minimizar costos.',
                                    ],
                                ]}
                            />
                            <Callout variant="tip">
                                Si no estás seguro, deja{' '}
                                <Code>gemini-2.5-flash</Code>. Es el equilibrio ideal entre
                                velocidad, costo y calidad para una clínica.
                            </Callout>
                        </StepSection>

                        {/* ===== PASO 9 ===== */}
                        <StepSection number={9} id="paso-9" title="Prueba final">
                            <OrderedSteps>
                                <li>
                                    Escríbele al WhatsApp de tu clínica algo como{' '}
                                    <Code>Hola, quiero agendar una cita</Code>.
                                </li>
                            </OrderedSteps>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-5">
                                <Callout variant="success" title="Lo que debe pasar">
                                    <ul className="list-disc ml-5 space-y-1">
                                        <li>
                                            En unos segundos, AgenIA responde de forma natural
                                            y guía al paciente. Esa respuesta la genera{' '}
                                            <strong>Gemini con tu API Key</strong>.
                                        </li>
                                        <li>
                                            En AgenIA → Caja Negra (Auditoría) verás el
                                            mensaje y la respuesta de la IA.
                                        </li>
                                    </ul>
                                </Callout>
                                <Callout variant="warning" title="Si no responde">
                                    <ul className="list-disc ml-5 space-y-1">
                                        <li>
                                            Revisa que la llave no quedó pegada con espacios.
                                        </li>
                                        <li>
                                            Verifica que el proveedor activo sea{' '}
                                            <strong>Google Gemini</strong>.
                                        </li>
                                        <li>Mira la sección Errores comunes.</li>
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
                            <p>Cuando termines, tu bloc de notas debería verse así:</p>
                            <pre className="overflow-x-auto rounded-2xl bg-zinc-900 dark:bg-zinc-950 text-zinc-100 text-xs p-5 my-4 leading-relaxed font-mono border border-zinc-800 shadow-inner">
{`=== Datos para AgenIA (IA) ===
Proveedor:   Google Gemini
API Key:     AIza........................................
Modelo:      gemini-2.5-flash

=== Dónde regenerarla si la pierdes ===
https://aistudio.google.com/app/apikey`}
                            </pre>
                            <Callout variant="danger" title="Guárdala en un lugar seguro">
                                La <strong>API Key</strong> funciona como contraseña: quien
                                la tenga puede usar la IA de Google a nombre de tu clínica.
                                Trátala como una credencial bancaria.
                            </Callout>
                        </Section>

                        {/* ===== ERRORES COMUNES ===== */}
                        <Section
                            id="errores"
                            title="Errores comunes y cómo resolverlos"
                            icon={<AlertTriangle className="w-5 h-5" />}
                        >
                            <ErrorsGroup
                                heading="Al crear la llave (Paso 3–4)"
                                rows={[
                                    [
                                        'No veo el botón "Create API key"',
                                        'Aún no aceptaste los términos.',
                                        'Vuelve al Paso 2 y acepta los términos de servicio.',
                                    ],
                                    [
                                        'You must accept the terms',
                                        'Falta aceptar términos en esa cuenta.',
                                        'Marca la casilla de términos y reintenta.',
                                    ],
                                    [
                                        'Estoy en la cuenta de Google equivocada',
                                        'Tenías varias sesiones abiertas.',
                                        'Arriba a la derecha → cambia a la cuenta corporativa y crea la llave de nuevo.',
                                    ],
                                ]}
                            />

                            <ErrorsGroup
                                heading="Al pegar la llave en AgenIA (Paso 7)"
                                rows={[
                                    [
                                        'API key not valid / Invalid API key',
                                        'La llave quedó mal copiada o tiene espacios.',
                                        'Cópiala de nuevo desde AI Studio. Cuidado con espacios al inicio o final.',
                                    ],
                                    [
                                        'La IA no responde tras guardar',
                                        'El proveedor activo no es "Google Gemini".',
                                        'Asegúrate de que la tarjeta de Google Gemini esté marcada como "● Activo".',
                                    ],
                                    [
                                        'Guardé pero el campo aparece vacío',
                                        'Es normal: AgenIA lo vacía por seguridad.',
                                        'Confirma en "Estado actual": debe decir que la API key termina en •••XXXX.',
                                    ],
                                ]}
                            />

                            <ErrorsGroup
                                heading="Durante el uso (después de conectar)"
                                rows={[
                                    [
                                        'Quota exceeded / Resource exhausted',
                                        'Superaste el límite gratuito de mensajes.',
                                        'Espera unos minutos o activa facturación (Paso 6).',
                                    ],
                                    [
                                        'Permission denied / API not enabled',
                                        'El proyecto no tiene habilitada la API de Gemini.',
                                        'Crea la llave de nuevo con la Opción A del Paso 4 (proyecto nuevo).',
                                    ],
                                    [
                                        'La IA responde lento',
                                        'Estás usando gemini-2.5-pro con mucho texto.',
                                        'Cambia el modelo a gemini-2.5-flash en AgenIA.',
                                    ],
                                    [
                                        'Empezó a fallar de un día para otro',
                                        'Alguien borró o regeneró la llave en AI Studio.',
                                        'Crea una llave nueva y vuelve a pegarla en AgenIA (Paso 7).',
                                    ],
                                ]}
                            />
                        </Section>

                        {/* ===== FAQ ===== */}
                        <Section id="faq" title="Preguntas frecuentes" icon={<Info className="w-5 h-5" />}>
                            <FaqItem question="¿Esto tiene costo?">
                                El nivel gratuito de Google AI Studio no cuesta nada y suele
                                alcanzar para clínicas pequeñas. Si activas facturación,
                                pagas por uso según las tarifas de Google. Precios en{' '}
                                <ExternalLink href="https://ai.google.dev/pricing">
                                    ai.google.dev/pricing
                                </ExternalLink>
                                .
                            </FaqItem>
                            <FaqItem question="¿Diferencia entre Google AI Studio y Google Cloud / Vertex AI?">
                                AI Studio es la vía <strong>más simple y directa</strong> para
                                obtener una llave de Gemini. Vertex AI es la versión
                                empresarial avanzada. <strong>Para AgenIA usa Google AI
                                Studio.</strong>
                            </FaqItem>
                            <FaqItem question="¿Puedo usar mi cuenta personal de Gmail?">
                                Sí, funciona, pero recomendamos una{' '}
                                <strong>cuenta corporativa</strong> de la clínica para que la
                                llave no se pierda si la persona deja la organización.
                            </FaqItem>
                            <FaqItem question="¿Qué pasa si pierdo o borro la llave?">
                                No pasa nada grave. Entra a{' '}
                                <ExternalLink href="https://aistudio.google.com/app/apikey">
                                    aistudio.google.com/app/apikey
                                </ExternalLink>
                                , crea una nueva y pégala en AgenIA. La vieja deja de
                                funcionar al borrarla.
                            </FaqItem>
                            <FaqItem question="¿Puedo cambiar de Gemini a ChatGPT o Claude después?">
                                Sí. AgenIA soporta varios proveedores. Entra a Configuración →
                                Integración de IA, selecciona otro proveedor y pega su llave.
                            </FaqItem>
                            <FaqItem question="¿La misma llave sirve para WhatsApp?">
                                No. La <strong>API Key de Gemini</strong> es para la{' '}
                                <strong>IA</strong>; el <strong>Phone ID y Access Token</strong>{' '}
                                son para el <strong>canal de WhatsApp</strong> (otra guía).
                                Necesitas ambas para que AgenIA funcione completo.
                            </FaqItem>
                        </Section>

                        {/* ===== SOPORTE ===== */}
                        <Section
                            id="soporte"
                            title="¿Te quedaste atascado?"
                            icon={<Sparkles className="w-5 h-5" />}
                        >
                            <div className="rounded-2xl border border-sky-200 dark:border-sky-800/50 bg-gradient-to-br from-sky-50 to-white dark:from-sky-900/10 dark:to-zinc-900 p-6 md:p-8">
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
                                        Adjunta el screenshot y dinos en qué paso de esta guía
                                        estás.
                                    </li>
                                    <li>
                                        Nuestro equipo te responde en máximo 24 horas hábiles.
                                    </li>
                                </OrderedSteps>
                            </div>

                            <div className="mt-10 rounded-3xl bg-gradient-to-br from-sky-600 to-blue-600 text-white p-8 md:p-10 shadow-xl shadow-sky-600/20">
                                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                                    <div>
                                        <h3 className="text-2xl md:text-3xl font-extrabold mb-2">
                                            ¿Listo para activar la IA?
                                        </h3>
                                        <p className="text-sky-50 leading-relaxed max-w-xl">
                                            Con tu API Key de Gemini conectada, tu asistente
                                            virtual ya puede entender y responder a tus
                                            pacientes con la inteligencia de Google. Inicia
                                            sesión y entra a Configuración → Integración de
                                            IA.
                                        </p>
                                    </div>
                                    <Link
                                        href="/login"
                                        className="inline-flex items-center gap-2 rounded-2xl bg-white text-sky-700 px-6 py-3 text-sm font-bold shadow-md hover:scale-[1.03] transition-transform shrink-0"
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
                        <CorpLogo size={20} />
                        <span>
                            © {new Date().getFullYear()} AgenIA · Asistente virtual de
                            agendamiento médico
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <a
                            href="/docs/guia-google-ai-studio.md"
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

/** Logo corporativo servido desde /public/LogoAgenAI.png */
function CorpLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src="/LogoAgenAI.png"
            alt="AgenIA"
            width={size}
            height={size}
            className={`block object-contain select-none ${className}`}
            style={{ width: size, height: size }}
            draggable={false}
        />
    );
}

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
                    <span className="text-sky-600 dark:text-sky-400">{icon}</span>
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
                <div className="shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white font-extrabold text-lg shadow-lg shadow-sky-600/30">
                    {padded}
                </div>
                <div className="pt-1">
                    {highlight && (
                        <span className="inline-block mb-1 text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
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
            className="list-decimal list-outside space-y-2 ml-5 marker:text-sky-500 marker:font-bold"
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
            className="text-sky-700 dark:text-sky-400 font-semibold underline underline-offset-2 hover:text-sky-900 dark:hover:text-sky-300"
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
                    <CheckCircle2 className="shrink-0 w-5 h-5 text-sky-500 mt-0.5" />
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
    accent: 'indigo' | 'sky';
    recommended?: boolean;
}) {
    const styles =
        accent === 'sky'
            ? {
                  ring: 'ring-sky-500/30',
                  badgeBg:
                      'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
                  border: 'border-sky-200 dark:border-sky-800/50',
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
                <span className="absolute -top-2 right-4 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-sky-600 text-white shadow">
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
const _unused = { KeyRound };
void _unused;
