// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
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
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // Convención del repo: un parámetro/variable prefijado con `_` es
      // intencionalmente no usado (p.ej. para mantener la forma de la firma
      // entre funciones hermanas de un mismo pool de mensajes).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
      // Evita reintroducir el bug de "hora UTC" en mensajes/TTS: cualquier
      // `.toLocale(Date|Time)?String('es-CO', ...)` SIN una propiedad
      // `timeZone` en sus opciones se considera incorrecto. Preferir los
      // helpers de `@agenia/shared` (formatAppointmentLong,
      // formatDateShort, etc.) o, si se necesita formato técnico, pasar
      // `timeZone:'America/Bogota'` explícito.
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/][arguments.0.value='es-CO']:not(:has(Property[key.name='timeZone']))",
          message:
            "Usa `@agenia/shared` (formatAppointmentLong, formatDateShort, etc.) o pasa `timeZone: 'America/Bogota'` explícito. Sin TZ, el contenedor UTC muestra hora errónea al paciente.",
        },
      ],
    },
  },
  // ── Pruebas ────────────────────────────────────────────────────────────
  //
  // Los dobles de prueba son `any` por naturaleza: un mock de Prisma o de un
  // proveedor externo no tiene —ni debe tener— los tipos generados del real.
  // La familia `no-unsafe-*` existe para proteger el código de PRODUCCIÓN de
  // valores sin tipar que vienen de la red o de la base; aplicarla a los
  // mocks solo produce ruido que esconde los hallazgos que sí importan.
  //
  // El resto de reglas (incluida la de fechas de CLAUDE.md y prettier) sigue
  // activa aquí. Ver el bloque A del plan de remediación en .github/workflows:
  // el objetivo es que el lint llegue a ser una barrera, y separar la deuda de
  // las pruebas de la de producción es el paso que lo hace alcanzable.
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // Un helper de prueba `async () => valor` es idiomático: describe un
      // colaborador asíncrono aunque el cuerpo no espere nada.
      '@typescript-eslint/require-await': 'off',
      // `expect(servicio.metodo).toHaveBeenCalled()` es el uso normal de un
      // espía; la regla apunta a un riesgo de `this` que aquí no existe.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
