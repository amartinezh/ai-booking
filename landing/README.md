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
| Ecosistema de atención | «No es solo agendar»: el paciente en el centro (diagrama) y tres destacados: lista de espera automática, cambiar o cancelar en segundos (1,3 s medidos hasta el HIS) y el asistente de soporte del personal | `index.html` |
| Para el equipo | Estadísticas para compartir, Rastreo de paciente, Bandeja | `index.html` |
| La plataforma | Canales, herramientas del panel, seguridad, voz, validaciones, analíticas | `index.html` |
| Resultados | Cuatro anillos con cifras reales del primer hospital | `config.js` (`resultados`) |
| Pulso de la salud | Titulares de la semana por tema, indicadores del Banco Mundial y novedades | `data/pulso.json`, `data/novedades.json` |
| Llamado final | «Que cada paciente se sienta importante»: cuatro pilares (24/7, 1,3 s, lista de espera, soporte) y los botones de demo e ingreso | `index.html` |

«Ingresar» lleva al login del panel y «Agendar una demo» al correo de contacto.
Los dos se cambian en `config.js`.

> ⚠️ Los anillos de resultados son cifras reales del primer hospital conectado,
> medidas en AgenIA del 13 al 25 de octubre de 2026 (100 % de las citas por chat
> en el HIS, 91 % de asistencia con recordatorio, 89 % de citas por chat de
> pacientes que registró el asistente, 85 % de recordatorios leídos). Se
> presentan como medidas, así que solo llevan cifras que salen de los datos,
> redondeadas al entero más cercano: nada inventado. Publicarlas requiere la
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

Vive en el mismo VPS de `./update.sh` (89.117.61.28) y la sirve el mismo Caddy
(`agenia_proxy`) desde `/data/landing`: la subcarpeta `landing/` de su volumen
de datos (`agenia_caddy_data`). No hay contenedor, red ni proceso nuevo, y
`update.sh` no la toca (su rsync va a `/opt/agenia`).

- **Actualizarla**: `bash landing/deploy/desplegar.sh` (`--dry-run` para ver
  qué subiría). Sube los archivos (nunca fuera de `.../_data/landing`: en la
  raíz del volumen están los certificados), actualiza el pulso y deja
  `/etc/cron.d/agenia-landing-pulso` a las 6:00 a. m. (registro en
  `/var/log/agenia-landing-pulso.log`). El pulso corre con la imagen
  `node:22-alpine`, porque el servidor no tiene Node.
- **Caddy**: el bloque de `deploy/Caddyfile.ejemplo` ya está al final de
  `/opt/agenia/deploy/Caddyfile` (2026-10-26; respaldo en `/var/backups/agenia`).
  Solo se vuelve a tocar para cambiar el sitio, con el procedimiento de
  `docs/INSTALACION_VPS.md` §16.
- **DNS**: registros A `agenia.co` y `www.agenia.co` → `89.117.61.28` en
  Hostinger. Caddy pide el certificado solo en cuanto el DNS apunta al VPS.
- **Quitarla**: borrar el bloque del Caddyfile (y recargar), la carpeta
  `.../_data/landing` y `/etc/cron.d/agenia-landing-pulso`. Nada más depende de
  ella.

Al cambiar CSS o JS, subir el `?v=` de `index.html` para que los navegadores no
usen la versión vieja.

## Fotos

De Unsplash, con licencia gratuita (ver `assets/img/CREDITOS.md`).
