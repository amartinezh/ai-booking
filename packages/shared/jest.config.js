/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  // `index.ts` es solo un barril de re-exportaciones: cubrirlo no dice nada.
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!index.ts'],
  // Trinquete: estos helpers son los que CLAUDE.md declara obligatorios para
  // toda fecha que ve un paciente. Bajar de aquí es una regresión, no un
  // "todavía no lo probamos".
  coverageThreshold: {
    global: { statements: 95, branches: 86, functions: 100, lines: 96 },
  },
};
