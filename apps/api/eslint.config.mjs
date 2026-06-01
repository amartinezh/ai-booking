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
      "prettier/prettier": ["error", { endOfLine: "auto" }],
      // Evita reintroducir el bug de "hora UTC" en mensajes/TTS: cualquier
      // `.toLocale(Date|Time)?String('es-CO', ...)` SIN una propiedad
      // `timeZone` en sus opciones se considera incorrecto. Preferir los
      // helpers de `@antigravity/shared` (formatAppointmentLong,
      // formatDateShort, etc.) o, si se necesita formato técnico, pasar
      // `timeZone:'America/Bogota'` explícito.
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/][arguments.0.value='es-CO']:not(:has(Property[key.name='timeZone']))",
          message:
            "Usa `@antigravity/shared` (formatAppointmentLong, formatDateShort, etc.) o pasa `timeZone: 'America/Bogota'` explícito. Sin TZ, el contenedor UTC muestra hora errónea al paciente.",
        },
      ],
    },
  },
);
