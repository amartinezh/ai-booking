import { MARCA_FIN, MARCA_INICIO } from './conocimiento';

/** Un archivo de conocimiento mínimo y válido, con lo que se le quiera agregar. */
export const MD_MINIMO = `# Conocimiento de prueba

Texto antes de la ayuda: no se lee.

${MARCA_INICIO}

## Portada

- **Presentación:** Ayuda de prueba para la clínica.
- **Búsquedas frecuentes:** Abrir la agenda, Ver turnos
- **Glosario destacado:** Turno

## Categoría: Para empezar {#inicio}

Lo primero que hay que hacer.

### 🚀 Primeros pasos {#primeros-pasos}

- **Resumen:** Por dónde empezar a usar la clínica de prueba.
- **Relacionados:** [Agenda](#agenda), [Glosario](#glosario)
- **Palabras clave:** empezar, inicio

#### Para qué sirve

Explica el orden en que se configura la clínica de prueba
y por qué ese orden importa.

#### Paso a paso

##### Configurar la clínica

1. Abre la agenda.
2. Crea los turnos
   de la semana.

> 💡 Se puede volver después.

#### Preguntas frecuentes

##### ¿Puedo saltarme pasos?

Puedes, pero la agenda quedará vacía.

## Categoría: Agenda y catálogos {#catalogos}

Lo que el asistente necesita.

<!-- Nota para quien mantiene el archivo: no se muestra. -->

### 📅 Agenda {#agenda}

- **Ruta:** \`/dashboard/agenda\`
- **Resumen:** Los turnos de cada médico, para que el asistente los ofrezca.
- **Disponibilidad:** Siempre.
- **Relacionados:** [Primeros pasos](#primeros-pasos)
- **Palabras clave:** turnos, cupos

#### Para qué sirve

Un turno es un espacio de tiempo de un médico en el que se puede agendar una cita.

#### Paso a paso

##### Abrir turnos

1. Elige el médico.

#### Qué ves en la pantalla

- **Azul:** Turno libre.
- **Rojo:** Turno ocupado.

#### Preguntas frecuentes

##### ¿Cómo borro un turno?

No se puede.

#### Si algo no sale bien

##### Sale «Médico inválido».

Asígnale un servicio.

## Glosario {#glosario}

- **Turno:** Espacio de tiempo de un médico.
  - También se dice: cupo, slot
  - Se ve en: [Agenda](#agenda)
- **EPS:** La aseguradora.

${MARCA_FIN}

# Parte 2

## Esto no lo lee la ayuda

- **Cualquier cosa:** con cualquier formato.
`;
