import Link from "next/link";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950 selection:bg-blue-600 selection:text-white font-sans">

      {/* ========================================= */}
      {/* EFECTOS DE FONDO (GLOWING ORBS) MODERNOS    */}
      {/* ========================================= */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-gradient-to-br from-blue-400/20 to-purple-400/20 blur-[120px]" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] rounded-full bg-gradient-to-br from-emerald-400/20 to-teal-400/20 blur-[120px]" />
      </div>

      {/* ========================================= */}
      {/* NAVBAR MINIMALISTA                          */}
      {/* ========================================= */}
      <header className="absolute top-0 w-full z-50">
        <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-3xl">🏥</span>
            <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
              San Vicente <span className="text-blue-600 font-black">AI</span>
            </span>
          </div>
          <nav>
            <Link
              href="/dashboard"
              className="text-sm font-semibold text-zinc-600 hover:text-blue-600 dark:text-zinc-300 dark:hover:text-blue-400 transition-colors"
            >
              Acceso Administrativo &rarr;
            </Link>
          </nav>
        </div>
      </header>

      {/* ========================================= */}
      {/* HERO SECTION (CONTENIDO PRINCIPAL)          */}
      {/* ========================================= */}
      <main className="relative pt-32 pb-16 sm:pt-40 sm:pb-24 lg:pb-32 px-6 mx-auto max-w-7xl flex flex-col items-center text-center z-10">

        {/* Badge superior */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800/50 text-sm text-blue-600 dark:text-blue-400 font-medium mb-8 animate-fade-in">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
          Sistema impulsado por Inteligencia Artificial
        </div>

        {/* Título Principal */}
        <h1 className="max-w-4xl text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-8 leading-[1.1]">
          La salud no debería tener <br className="hidden sm:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400">
            barreras tecnológicas.
          </span>
        </h1>

        {/* Subtítulo enfocado en la misión */}
        <p className="max-w-2xl text-lg sm:text-xl text-zinc-600 dark:text-zinc-400 mb-10 leading-relaxed">
          Diseñado para nuestras comunidades. Agende sus citas médicas enviando una simple <strong className="font-semibold text-zinc-900 dark:text-zinc-200">nota de voz por WhatsApp</strong>. Nuestra Inteligencia Artificial entiende su necesidad y gestiona su atención al instante.
        </p>

        {/* Botones de Acción */}
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
          <Link
            href="/dashboard"
            className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white px-8 py-4 text-sm font-semibold text-white dark:text-zinc-900 shadow-xl shadow-zinc-900/20 dark:shadow-white/10 hover:scale-105 transition-all duration-200"
          >
            📊 Abrir Panel de Control
          </Link>
          <a
            href="https://wa.me/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-2xl bg-white dark:bg-zinc-900 px-8 py-4 text-sm font-semibold text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 shadow-sm hover:border-emerald-500 hover:text-emerald-600 dark:hover:border-emerald-500 dark:hover:text-emerald-400 hover:scale-105 transition-all duration-200"
          >
            💬 Probar Bot en WhatsApp
          </a>
        </div>

      </main>

      {/* ========================================= */}
      {/* SECCIÓN DE CARACTERÍSTICAS (BENTO GRID)     */}
      {/* ========================================= */}
      <section className="relative max-w-7xl mx-auto px-6 pb-32 z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Tarjeta 1 */}
          <div className="p-8 rounded-3xl bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 shadow-lg hover:shadow-xl transition-shadow">
            <div className="h-12 w-12 rounded-xl bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center text-2xl mb-6">🎙️</div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-3">Reconocimiento Natural</h3>
            <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
              No importa el acento, el ruido de fondo o las palabras coloquiales. El sistema procesa el audio y extrae la especialidad, la fecha y el documento de identidad sin fricción.
            </p>
          </div>

          {/* Tarjeta 2 */}
          <div className="p-8 rounded-3xl bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 shadow-lg hover:shadow-xl transition-shadow md:-translate-y-4">
            <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-2xl mb-6">⚡</div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-3">Memoria a Corto Plazo</h3>
            <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
              Arquitectura tolerante a fallos. Si olvida mencionar su cédula, el bot se la pedirá de manera amigable recordando siempre el contexto de la conversación.
            </p>
          </div>

          {/* Tarjeta 3 */}
          <div className="p-8 rounded-3xl bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 shadow-lg hover:shadow-xl transition-shadow">
            <div className="h-12 w-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-2xl mb-6">🛡️</div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-3">Validación y Seguridad</h3>
            <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
              Sistema de doble "Opt-In". Ninguna cita médica se guarda en la base de datos hasta que el paciente confirma explícitamente los datos extraídos por la IA.
            </p>
          </div>

        </div>
      </section>

    </div>
  );
}