# VM simulada del hospital

Una VM Ubuntu 22.04 con systemd, dentro de Docker, que hace de **la VM que TI
entrega en Anserma**. El agente se instala en ella exactamente como se
instalará allá: usuario de servicio, unidad systemd endurecida, `agent.env` en
`0600`, firewall que bloquea todo lo entrante, y salida HTTPS contra un borde
con TLS real.

## Por qué, si ya existe el mock del SQL Server

`local-his-mock/` prueba **el driver** contra un SQL Server de verdad. Esto
prueba **el despliegue**: que `deploy/README.md` funcione tal como está
escrito, que la unidad systemd no ahogue al proceso con su propio
endurecimiento, que el agente sobreviva a un `kill -9` y a un reinicio de la
máquina, y que todo eso siga en pie con el cortafuegos cerrado.

Son cosas distintas y fallan por motivos distintos. Corriendo el agente con
`ts-node` desde el portátil, ninguna de ellas se ejercita.

Lo que encontró la primera vez que se levantó:

- `deploy/README.md` §2 movía el bundle a `dist/` sin haber creado ese
  directorio: el despliegue real habría fallado en el primer intento.
- Node 20 **no usa el almacén de CAs del sistema**. Sin `NODE_EXTRA_CA_CERTS`,
  `update-ca-certificates` no sirve de nada y el agente muere contra cualquier
  TLS corporativo — que es lo normal en una red hospitalaria.
- El estado del agente vivía en memoria. Un reinicio del servicio dejaba al
  agente **ciego** a todo lo que hubiera pasado en el HIS mientras estuvo
  caído: se paró el servicio, el hospital agendó una cita por ventanilla, se
  volvió a arrancar, y ese cupo siguió a la venta en WhatsApp para siempre.
- `fetch` no trae timeout. Con la VM desconectada de internet, el agente se
  quedó colgado sin escribir **una sola línea** en el journal, con
  `systemctl status` diciendo `active (running)`.

## Topología

```
   ┌─ hospital_lan 192.168.1.0/24 ─┐      ┌──── wan ────┐
   │  agenia_mirror_vm       .50   │      │ agenia_edge │  api.agenia.local
   │  agenia_mirror_his_mock .16   │      │  (Caddy,    │  ← TLS con CA propia
   │            :1433              │      │   tls internal)
   └───────────────────────────────┘      └──────┬──────┘
                                                 │
                                    apps/api en el host, :3001
```

Dos detalles que no son decorativos:

- El SQL Server simulado está en **192.168.1.16**, la misma IP que el real. El
  `driverConfig` que usa esta VM es, carácter por carácter, el de producción
  (`MIRROR_HIS_TARGET=hospital`): el cutover no cambia ni ese campo.
- La VM **no publica ni un puerto** y `ufw` bloquea todo lo entrante. Si el
  diseño de "solo salida" (plan §4.1) fuera falso, aquí se rompería.

## Uso

```bash
./apps/mirror-agent/local-vm/vm-up.sh      # crear + provisionar (la primera vez)
./apps/mirror-agent/local-vm/vm-deploy.sh  # redesplegar tras tocar el agente

docker exec agenia_mirror_vm journalctl -u agenia-mirror-agent -f
docker exec -it agenia_mirror_vm bash
```

Requisitos: la API corriendo en `:3001` (`./scripts/up.sh`) y el mock del HIS
con `PRUEBAS` ya creada (`local-his-mock/README.md`).

Para la prueba de punta a punta —conversación de WhatsApp real, firmada, hasta
la fila en `CITAS_MEDICAS`— está `scripts/e2e-espejo.mjs`.

## Diferencias con la VM real, y por qué

| | VM real | Aquí |
|---|---|---|
| Arquitectura | x86_64 | la del host |
| Hipervisor | el del hospital | Docker + systemd como PID 1 |
| TLS | certificado público | CA interna de Caddy |
| Recursos | 2 vCPU / 4 GB | los mismos, por `cpus`/`mem_limit` |

Lo de la arquitectura tiene historia: forzar `linux/amd64` era lo fiel, pero en
Apple Silicon eso pasa por Rosetta y **la traducción no sobrevive a un
`docker restart`** — la VM volvía a arrancar y ningún binario x86 se podía
ejecutar (`exec format error`), justo lo que impedía probar que la máquina se
recupera de un reinicio. Nada de este agente depende de la arquitectura (Node y
tedious son JavaScript puro), así que se prefirió poder probar el reinicio. En
un runner Linux x86 esto ya corre amd64 solo, sin tocar nada.

## Si algo dice `exec format error`

Le pasa al contenedor del SQL Server, que solo existe para amd64 y en Apple
Silicon corre emulado. La emulación de Docker Desktop se degrada cada tantas
horas: el motor sigue atendiendo conexiones por el puerto, pero ningún
`docker exec` vuelve a funcionar y el contenedor ya no se puede reiniciar.

Se arregla reiniciando Docker Desktop. **No** instales `tonistiigi/binfmt`
(qemu) para esquivarlo: SQL Server revienta con SIGSEGV bajo qemu, y encima
desplaza a Rosetta.

Por eso `scripts/e2e-espejo.mjs` consulta el HIS por TCP desde el host en vez
de con `docker exec sqlcmd`: hablarle por el puerto no depende de la emulación.
