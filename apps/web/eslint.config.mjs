import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Evita reintroducir el bug de "hora UTC" en pantallas/dashboards:
      // cualquier `.toLocale(Date|Time)?String('es-CO', ...)` SIN una
      // propiedad `timeZone` se considera incorrecto. Usar los helpers de
      // `@/lib/date` (re-exporta `@antigravity/shared`) o, si se necesita
      // formato técnico crudo, pasar `timeZone:'America/Bogota'` explícito.
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/][arguments.0.value='es-CO']:not(:has(Property[key.name='timeZone']))",
          message:
            "Usa `@/lib/date` (formatAppointmentLong, formatDateShort, etc.) o pasa `timeZone: 'America/Bogota'` explícito. Sin TZ, la hora se muestra en zona del navegador (variable) en vez de Colombia.",
        },
      ],
    },
  },
]);

export default eslintConfig;
