# Landing de AgenIA (agenia.co)

La página pública de AgenIA. Vive aparte del producto: HTML, CSS y JavaScript
estáticos, sin compilación ni dependencias, servidos por Caddy. No comparte
código ni base de datos con `apps/` ni `packages/`: si se borra esta carpeta, el
panel y la API siguen igual.

La estructura sigue las grandes portadas de salud (portada con foto, tarjetas
que se abren, anillos de resultados, pie con la marca grande), con la marca,
los textos y las fotos de AgenIA. Ningún logo, texto ni foto es de otra empresa.

## Qué tiene

| Sección | Contenido | De dónde sale |
|---|---|---|
| Cinta «En vivo» | Indicadores de salud de Colombia y últimos titulares | `data/pulso.json` |
| Portada | Mensaje principal, «Conocer la plataforma», «Ver una conversación» | `index.html` |
| Etapas de la cita | Agendar, recordatorios, cancelar y liberar cupos, conexión con el HIS | `index.html` |
| Así se agenda | Conversación animada con las fechas de los próximos días hábiles | `app.js` (`GUION`) |
| Para el equipo | Estadísticas para compartir, Rastreo de paciente, Bandeja | `index.html` |
| La plataforma | Canales, herramientas del panel, seguridad, voz, validaciones, analíticas | `index.html` |
| Resultados | Cuatro anillos con cifras reales del primer hospital | `config.js` (`resultados`) |
| Pulso de la salud | Titulares de la semana por tema, indicadores del Banco Mundial y novedades | `data/pulso.json`, `data/novedades.json` |

«Ingresar» lleva al login del panel y «Agendar una demo» al correo de contacto.
Los dos se cambian en `config.js`.

> ⚠️ Los anillos de resultados son cifras reales del primer hospital conectado,
> medidas en AgenIA del 13 al 25 de octubre de 2026. Publicarlas requiere la
> autorización del hospital; si no la da, se cambian o se quitan en `config.js`
> (sin anillos, la sección queda solo con el título).

## Verla en local

```sh
cd landing
node scripts/actualizar-pulso.mjs   # trae titulares e indicadores (data/pulso.json)
node scripts/servir.mjs             # http://localhost:4321
node --test scripts/*.test.mjs      # pruebas del agregador del pulso
```

## El pulso de la salud (en vivo)

`scripts/actualizar-pulso.mjs` arma `data/pulso.json` y lo deja listo para la
página. Es la misma idea del «pulso del sector» de Preztia, con temas de salud:

- **Titulares**: Google News RSS, español, última semana, cinco temas (Salud en
  Colombia, EPS y aseguramiento, Citas y acceso, Salud digital, Hospitales). Se
  toman a lo sumo 8 por tema y 40 en total, sin repetidos. Solo entran los que
  hablan de salud en el título, de medios que no son de otro país, y sin
  crímenes, violencia, loterías ni columnas políticas (lista `EXCLUIR` en
  `scripts/pulso.mjs`).
- **Indicadores**: el último dato publicado por el Banco Mundial para Colombia
  (esperanza de vida, médicos, enfermeras y camas por cada 1.000 habitantes,
  gasto en salud, mortalidad infantil y vacunación contra el sarampión).
- **Resistente a caídas**: cada fuente falla por separado y lo que no llega
  conserva lo último bueno. Si no llega nada, el archivo queda como estaba.

En el servidor lo corre el cron a las 6:00 a. m. de Colombia
(`scripts/pulso-cron.sh`). Las novedades de AgenIA (`data/novedades.json`) se
escriben a mano, para el público y sin nombres de clínicas ni de pacientes.

## Publicarla

El DNS de `agenia.co` y `www.agenia.co` apunta a `173.249.12.226`.

1. Subir los archivos, actualizar el pulso e instalar el cron:
   `bash landing/deploy/desplegar.sh` (o `--host usuario@ip` para otro servidor,
   `--dry-run` para ver qué subiría).
2. La primera vez, agregar al Caddy de ese servidor el bloque de
   `deploy/Caddyfile.ejemplo`, con respaldo, `caddy validate` y solo entonces
   `caddy reload`. Si Caddy corre en Docker, montar `/srv/agenia-landing`.

Al cambiar CSS o JS, subir el `?v=` de `index.html` para que los navegadores no
usen la versión vieja.

## Fotos

De Unsplash, con licencia gratuita (ver `assets/img/CREDITOS.md`).
