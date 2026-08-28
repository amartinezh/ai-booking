# Correo para TI del hospital — prueba de ciclo de vida + servidor virtual

> Listo para copiar/pegar. Reemplazar `[Nombre]` y el documento de ejemplo.

---

**Asunto:** Integración de citas — prueba corta en BD PRUEBAS (10 min) y solicitud de servidor virtual

Estimados [Nombre / equipo TI]:

Para avanzar con la integración de citas entre AgenIA y el sistema del hospital les pedimos el favor con dos puntos concretos:

## 1. Prueba de ciclo de vida de una cita (10 minutos, solo en la BD PRUEBAS)

Desde la **aplicación** del hospital (conectada a la BD **PRUEBAS**, no producción), con un paciente de prueba:

1. **Creen una cita nueva** (anoten documento del paciente, médico, fecha y hora).
2. Ejecuten en SSMS la consulta de abajo y copien el resultado → márquenlo **PASO 1**.
3. **Cancelen esa misma cita** desde la aplicación.
4. Ejecuten de nuevo la consulta → **PASO 2**.
5. Si la aplicación lo permite, **agenden otra cita en el mismo horario y médico** (mismo u otro paciente).
6. Ejecuten de nuevo la consulta → **PASO 3**.

Consulta (reemplazar `12345678` por el documento del paciente de prueba):

```sql
USE PRUEBAS;

SELECT NU_ESTA_CIT      AS estado,
       CD_CODI_MED_CIT  AS medico,
       FE_HORA_CIT      AS fecha_hora,
       FE_ELAB_CIT      AS creada,
       CD_CODI_SER_CIT  AS servicio,
       NU_NUME_CONV_CIT AS convenio,
       NU_NUME_CONE_CIT AS consecutivo
FROM dbo.CITAS_MEDICAS
WHERE NU_HIST_PAC_CIT = '12345678'
ORDER BY FE_ELAB_CIT DESC;
```

Nos envían por favor los tres resultados marcados **PASO 1 / PASO 2 / PASO 3** (copia de la grilla o pantallazo). Con eso confirmamos cómo registra el sistema las cancelaciones y reasignaciones — es el último dato técnico que necesitamos para no tocar nada indebidamente.

Si la aplicación no se puede conectar a la BD PRUEBAS, avísennos **antes** de hacer cualquier cosa en producción y coordinamos la alternativa.

Aprovechamos para pedir que, cuando puedan, **refresquen PRUEBAS con una copia reciente de ESEHSVP** (la actual es del 15 de agosto).

## 2. Servidor virtual Linux para el agente de integración

Para las pruebas definitivas del agente que comunicará la base de datos con AgenIA, ¿nos pueden habilitar una máquina virtual pequeña con lo siguiente?

- **Ubuntu Server 22.04 o 24.04 LTS**
- 2 vCPU, 4 GB de RAM, 30 GB de disco
- Acceso de red al servidor SQL (`192.168.1.16`, puerto 1433)
- Salida a internet **solo HTTPS (puerto 443)**
- Un usuario con `sudo` para instalar el servicio

El agente corre como servicio del sistema, **solo hace conexiones salientes** (no expone ningún puerto hacia internet) y se conectará a la base de datos con un usuario de **permisos mínimos** que crearemos junto con ustedes (nunca con el usuario administrador).

Quedamos atentos. Muchas gracias.

[Firma]
