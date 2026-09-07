// @ts-check
//
// Lint del agente espejo. Existía el script en package.json y NO existía este
// archivo: `pnpm --filter @agenia/mirror-agent lint` moría con "ESLint couldn't
// find an eslint.config file", y como tampoco había `lint:ci`, el
// `turbo run lint:ci` del CI se lo saltaba sin decir nada. La única app que se
// despliega DENTRO de la LAN de un hospital era la única sin lint.
//
// Se calca el de apps/api para que la convención sea una sola en el repo, con
// dos diferencias deliberadas, ambas anotadas más abajo.
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'src/coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        // `tsconfig.eslint.json` y no el de build: aquel excluye `*.spec.ts`
        // para no meter las pruebas en `dist/`, y sin este los 14 archivos de
        // prueba quedarían sin lintear con un "not found by the project
        // service" que es fácil pasar por alto.
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // Convención del repo: un parámetro prefijado con `_` es
      // intencionalmente no usado. Aquí pasa a menudo, porque el contrato
      // `HisDriver` obliga a mantener firmas cuyos métodos aún son de Fase 3+.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
      // `require-await` OFF, y es una decisión, no una rendición.
      //
      // Este paquete está construido sobre dos contratos —`AgentStateStore` y
      // `HisDriver`— cuyos métodos devuelven `Promise` A PROPÓSITO: la
      // implementación de hoy guarda en un archivo y habla con SQL Server, pero
      // la interfaz existe para poder cambiarla (un store en la nube, un driver
      // sobre HTTP) sin tocar `core/`. Una implementación que resuelve sin
      // esperar nada —`getOutboxCursor`, que lee un campo en memoria— sigue
      // cumpliendo el contrato, y quitarle el `async` obligaría a escribir
      // `return Promise.resolve(x)`, que es peor de leer y significa lo mismo.
      //
      // Los `no-floating-promises` y `no-misused-promises` siguen activos, que
      // son los que atrapan los errores reales con promesas.
      '@typescript-eslint/require-await': 'off',
      // La regla de fechas de CLAUDE.md. En el agente NO hay ni un `.toLocale*`
      // hoy y tiene que seguir así: este proceso corre en una VM cuya hora es
      // la de Bogotá, pero el protocolo con la nube viaja SIEMPRE en UTC. Un
      // formateo sin `timeZone` aquí escribiría `FE_HORA_CIT` movido en la
      // base del hospital, que es peor que mostrárselo mal a alguien.
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/][arguments.0.value='es-CO']:not(:has(Property[key.name='timeZone']))",
          message:
            "Usa `@agenia/shared` (formatAppointmentLong, formatDateShort, etc.) o pasa `timeZone: 'America/Bogota'` explícito. Sin TZ, la VM en UTC escribe la cita con hora errónea.",
        },
      ],
    },
  },
  // ── Pruebas ────────────────────────────────────────────────────────────
  // Mismo criterio que en apps/api: los dobles de prueba son `any` por
  // naturaleza. Un `recordset` simulado del SQL Server del hospital no tiene
  // —ni debe tener— los tipos de `mssql`. La familia `no-unsafe-*` protege al
  // código de PRODUCCIÓN de valores sin tipar que llegan de la red o de la
  // base; aplicarla a los mocks solo esconde los hallazgos que sí importan.
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // Hay una prueba que lanza una CADENA a propósito
      // (`core/bordes.spec.ts`: "un fallo que no es un Error se reporta igual,
      // con su texto"). Es exactamente el caso que el agente tiene que
      // sobrevivir —un driver o una librería que lanza algo que no es `Error`—
      // así que la prueba no puede cumplir la regla sin dejar de probar lo que
      // prueba.
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
);
