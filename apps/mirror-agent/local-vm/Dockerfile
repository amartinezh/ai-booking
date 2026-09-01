# ═══════════════════════════════════════════════════════════════════════════
# Simulación de la VM del hospital — Ubuntu Server 22.04 LTS con systemd.
#
# Esta imagen representa la VM TAL COMO LA ENTREGA TI: sistema base, systemd
# como PID 1, y nada más. Node, el usuario de servicio, el agente y el
# firewall NO se instalan aquí a propósito — los instala `provision.sh`, que
# es `deploy/README.md` convertido en script ejecutable. Si el runbook tiene
# un paso mal, el provisioning falla, que es justo lo que queremos descubrir
# antes de estar frente a la VM real con TI esperando.
#
# Specs pedidas a TI (docs/drivers/cnt-sanvicente-anserma/CORREO_PRUEBA_HIS.md):
# Ubuntu Server 22.04/24.04 LTS, 2 vCPU, 4 GB RAM, 30 GB disco. Los límites de
# CPU/RAM se aplican en docker-compose.yml, no aquí.
# ═══════════════════════════════════════════════════════════════════════════
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Solo lo que trae un Ubuntu Server recién instalado. `iproute2`, `ping` y
# `netcat` entran porque el runbook los usa para diagnosticar la red del
# hospital (`nc -zv 192.168.1.16 1433`) y en una VM real ya están.
RUN apt-get update && apt-get install -y --no-install-recommends \
      systemd systemd-sysv dbus dbus-user-session \
      ca-certificates curl gnupg sudo \
      iproute2 iputils-ping netcat-openbsd dnsutils \
      tzdata \
 && rm -rf /var/lib/apt/lists/*

# La VM del hospital corre en hora de Colombia. Importa de verdad: el driver
# escribe FE_HORA_CIT en hora local, y una VM en UTC pondría las citas cinco
# horas adelantadas (misma clase de error que la regla de fechas de CLAUDE.md).
RUN ln -fs /usr/share/zoneinfo/America/Bogota /etc/localtime \
 && dpkg-reconfigure -f noninteractive tzdata

# Unidades que no tienen sentido dentro de un contenedor y solo ensucian el
# arranque de systemd con fallos ruidosos.
RUN rm -f /lib/systemd/system/multi-user.target.wants/* \
          /etc/systemd/system/*.wants/* \
          /lib/systemd/system/local-fs.target.wants/* \
          /lib/systemd/system/sockets.target.wants/*udev* \
          /lib/systemd/system/sockets.target.wants/*initctl* \
          /lib/systemd/system/sysinit.target.wants/systemd-tmpfiles-setup* \
          /lib/systemd/system/systemd-update-utmp*

# SIGRTMIN+3 es el "apagar la máquina" de systemd: `docker stop` así apaga la
# VM ordenadamente en vez de matarla, igual que un shutdown real.
STOPSIGNAL SIGRTMIN+3

CMD ["/lib/systemd/systemd"]
