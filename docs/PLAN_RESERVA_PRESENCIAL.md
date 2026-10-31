# Reserva de agenda para la atención presencial

**Estado: EVALUACIÓN (2026-10-31), nada construido.** Falta medir con datos de producción (§2.4, el SQL está listo) y que el usuario apruebe R1 … R10 (§6).

## 1. Qué se pide

Un ajuste **manual** de porcentaje (por ejemplo, 80 %): el asistente (WhatsApp y Telegram) agenda como mucho ese porcentaje de la agenda, y el resto queda para agendar **en el hospital** (ventanilla o teléfono), para quien no tiene acceso al chat o es de una EPS que el asistente no atiende (Nueva EPS, ≈ 20 % de medicina general, registrada inactiva desde el 21-oct).

**Lo que NO hace este plan:** no toca el sistema del hospital (HIS), ni el agente, ni `CITAS_DISPONIBLES`; no marca cupos en la ventanilla de CNT; no limita al personal (el panel y el hospital agendan como siempre); no cancela ni mueve citas ya dadas.

## 2. Cómo está hoy

### 2.1 De dónde salen los cupos

- Con el espejo en modo de agenda ON y fuente `HUECOS`, el agente manda **todos** los cupos de cada turno, libres u ocupados, cada 5 minutos para los próximos 7 días ([`mirror-availability.service.ts`](../apps/api/src/mirror/mirror-availability.service.ts)). AgenIA crea, cierra, libera o borra sus `ScheduleSlot` según esa foto.
- La ventanilla agenda en el HIS; la cita llega a AgenIA en unos 30 segundos y ocupa su cupo (origen `MIRROR`). Si no cae en la rejilla, AgenIA le crea un cupo a la medida y cierra los vecinos que se cruzan ([`mirror-apply.service.ts:335`](../apps/api/src/mirror/mirror-apply.service.ts#L335)).
- Por eso AgenIA ya sabe, en todo momento y sin preguntarle al hospital, cuántos cupos tiene cada médico cada día y quién tomó cada uno. **La reserva se puede resolver entera del lado de AgenIA.**

### 2.2 Las reglas que ya recortan lo que ofrece el asistente

El asistente solo ofrece cupos libres de médicos con WhatsApp ON (y homologados), de servicios activos, después de la anticipación mínima (60 min), dentro del plazo máximo para agendar (hoy 4 días) y fuera de los «Días sin citas». Cada regla se aplica en los mismos cinco lugares; la reserva tiene que entrar en todos:

| Camino | Dónde | Qué hace hoy con el plazo / los bloqueos |
|---|---|---|
| Buscar cupos para el menú (y «Otro día», «más allá del plazo», voz) | [`appointments.service.ts:86`](../apps/api/src/appointments/appointments.service.ts#L86) `getAvailableSlots` | Los quita en la consulta misma (si no, un día lleno se come la bolsa de cupos) |
| Reservar (chat y SÍ de la lista de espera) | [`appointments.service.ts:355`](../apps/api/src/appointments/appointments.service.ts#L355) `bookAppointment` | Revalida dentro de la transacción, solo para `WHATSAPP`/`TELEGRAM` |
| Cambiar la fecha por el chat | [`chatbot.service.ts`](../apps/api/src/chatbot/chatbot.service.ts) transacción del cambio (≈ línea 12385) | Revalida el cupo nuevo (no pasa por `bookAppointment`) |
| Ofrecer un cupo liberado a la lista de espera | [`waitlist.service.ts:151`](../apps/api/src/waitlist/waitlist.service.ts#L151) `notifyWaitlist` | No lo ofrece; la cola queda intacta |
| Resumen del panel («el asistente puede ofrecer N cupos») | [`apps/web/lib/plazo-agendar/resumen.ts`](../apps/web/lib/plazo-agendar/resumen.ts) | Cuenta con las mismas reglas |

El **plazo máximo para agendar** (2026-10-23) es el molde exacto: un campo en `OrganizationSettings`, la regla pura en `@agenia/shared`, funciones de la API que la leen ([`plazo-agendar.ts`](../apps/api/src/appointments/plazo-agendar.ts)), un control en Configuración con resumen y auditoría. La reserva es de ese mismo tamaño.

### 2.3 Lo que el hospital ya hace a mano

- **Citas «temporales» fuera del turno**: el hospital guarda cupos para Nueva EPS creando citas a nombre de personas al azar (§5.3 de la base de conocimiento, `metaLog.fueraDeTurno`). Con la reserva, eso deja de hacer falta.
- **Cierra días llenos** borrando el turno.

### 2.4 Lo que falta medir

La lectura de producción por SSH quedó bloqueada en esta sesión, así que la medición está lista para que la corra el usuario (solo lectura, probada contra un Postgres 15 con datos sembrados):

```
ssh -i ~/.ssh/agenia_89_117_61_28_ed25519 root@89.117.61.28 \
  'docker exec -i agenia_db psql -U agenia -d antigravity -X' \
  < docs/drivers/cnt-sanvicente-anserma/sql/RESERVA_PRESENCIAL_MEDIR_SOLO_LECTURA_POSTGRES.sql
```

Responde, para los últimos 14 días y los próximos 7, por médico y por día: capacidad, cuánto tomó el chat, cuánto el hospital y cuánto quedó libre (§1 y §3 del script); **cuántas veces habría frenado un tope del 90, 80, 70, 60 o 50 % y cuántas citas del chat no se habrían dado** (§2); con cuánta anticipación agenda cada origen (§4: si el hospital agenda casi todo para el mismo día, la reserva importa sobre todo en «hoy» y «mañana»); cuántos ya oyen «no hay cupos» por el chat (§5) y cuántas citas temporales crea el hospital (§6).

Con eso se elige el porcentaje: si el chat nunca pasa del 50 %, un 80 % no frena nada hoy y queda como guarda para cuando crezca la demanda.

## 3. La decisión de fondo: qué quiere decir «80 %»

Hay dos lecturas, y cambian lo que pasa cuando la ventanilla agenda mucho temprano. Ejemplo: una médica con 20 cupos un martes, ajuste en 80 %.

| | **Tope del chat** (recomendada) | **Colchón libre** |
|---|---|---|
| Regla | El chat no tiene más de ⌊20 × 80 %⌋ = **16** citas ese día | El chat agenda mientras queden **más de 4** cupos libres |
| Nadie agenda en ventanilla | Chat 16, quedan 4 libres | Chat 16, quedan 4 libres |
| La ventanilla agenda 2 temprano | Chat 16, quedan 2 libres | Chat 14, quedan 4 libres |
| La ventanilla agenda 6 temprano | Chat 14 (todo lo que queda), quedan 0 | Chat 10, quedan 4 libres |
| Para el hospital | El chat nunca pasa del 80 %; el hospital tiene al menos el 20 % del día, y lo que agende de más sale de lo que el chat no alcanzó a tomar | Siempre hay 4 libres para quien llegue tarde; cada cita de ventanilla le quita una al chat |
| Se explica como | «El asistente agenda como mucho el 80 % de cada día de cada médico» | «El asistente siempre deja libre el 20 %» |

Recomiendo el **tope del chat**: es lo que dice el pedido («solo agendemos por AgenIA el 80 %»), es predecible (la parte del chat no depende del ritmo de la ventanilla) y no se suma a las citas temporales que el hospital ya crea. El colchón libre protege más a quien llega tarde, a costa de que el chat agende menos cuanto más agende la ventanilla. Es la decisión R1.

## 4. El diseño recomendado

### 4.1 La regla en una línea

Para cada **médico y día** (en la zona de la clínica): **tope del chat = ⌊capacidad × % ⌋**, y el asistente puede tomar un cupo libre de ese médico ese día solo si las **citas vigentes del chat** de ese médico ese día son menos que el tope.

- **Capacidad** = cupos libres + cupos con una cita vigente, de cualquier origen y servicio. Los cupos cerrados sin cita no cuentan: son horas que el hospital no tiene en sus huecos o vecinos tapados por una cita fuera de la rejilla. Así, una cita temporal fuera del turno suma su cupo y resta los que tapa (queda igual), y una hora que el hospital bloquea no infla el tope.
- **Citas del chat** = vigentes con origen `WHATSAPP` o `TELEGRAM`. Las del panel (`MANUAL`) y las del hospital (`MIRROR`) son de la parte presencial.
- Se calcula en cada consulta, con lo que hay en la base: no se guarda estado nuevo, no hay tabla nueva y un cambio del hospital (abrir, cerrar o borrar un turno) se refleja solo.
- Sin ajuste (lo de fábrica) no hay reserva y nada cambia.

### 4.2 Quién está sujeto

Solo el asistente: agendar, cambiar la fecha (mover una cita del chat a otro médico o día exige estar bajo el tope del destino; dentro del mismo médico y día no cuenta doble) y el cupo de la lista de espera. El personal (panel) y el hospital agendan sin tope. Es la misma frontera del plazo y de los días sin citas.

### 4.3 Dónde se aplica

- **Al buscar** (`getAvailableSlots`): se calculan los médico-días que ya llegaron al tope dentro de la ventana (una consulta agrupada por médico y día en la zona de la clínica) y se quitan **en la consulta misma**, como los tramos de los días sin citas. Si no, un día en el tope se comería la bolsa de cupos y el asistente diría «no hay» con cupos de otros médicos. «Otro día», «más allá del plazo» y la voz heredan la regla porque pasan por aquí.
- **Al reservar y al cambiar la fecha**: se revalida dentro de la transacción con un candado por médico y día (`pg_advisory_xact_lock`), para que dos pacientes que confirman a la vez el último cupo del chat no lo pasen. Rechazo nuevo, `RESERVA_PRESENCIAL`.
- **Cupos apartados** (los 10 minutos mientras el paciente se registra): al buscar, los apartados por otros pacientes del chat cuentan como del chat; si no, cerca del tope tres pacientes verían el mismo último cupo y dos recibirían un rechazo al final (R9).
- **Lista de espera**: un cupo que se libera en un médico-día con el chat en el tope no se ofrece; la cola espera. Si se libera porque el chat canceló, el chat baja de su tope y sí se ofrece (R10).
- **No en el candado de la base** (`fn_interruptores_del_hospital`): el disparador no sabe quién mueve la cita (una cita del chat que el personal mueve desde el panel tiene origen `WHATSAPP` y no debe frenarse). Se queda en la aplicación, como el plazo y los bloqueos.

### 4.4 Qué le dice el asistente al paciente

- **No hay cupo del chat en ningún día del plazo, pero sí hay libres** (reservados): no puede decir «no hay cupos disponibles», que hoy dice `preguntaWaitlist`. Texto nuevo: «Por este medio ya no quedan cupos de … para estos días» + la lista de espera, en los dos tonos. Si hay cupo del chat más adelante del plazo, manda el mensaje de siempre del plazo («escríbanos desde el …»). Se sabe buscando una vez sin la reserva, como `ignorarPlazo` hoy.
- **Rechazo al confirmar** (`RESERVA_PRESENCIAL`): «Ese horario acaba de quedar para la atención en el hospital» y un menú nuevo con lo que queda (`reofrecerTrasCupoTomado`), no «lo tomó otro paciente».
- **¿Se le dice que en el hospital todavía hay cupos?** Es R6. Recomiendo que no: la reserva es para quien no tiene el chat, y mandar a la ventanilla a quien sí lo tiene se la come. Se ofrece la lista de espera.

### 4.5 Panel

- **Configuración › Asistente Virtual**, junto al plazo: «Parte de la agenda para el asistente», un número de 10 a 100 %, con la frase que lo explica («El asistente agenda como mucho el 80 % de cada día de cada médico; el resto queda para agendar en el hospital»). Solo el administrador (R8). Cada cambio queda en la auditoría del espejo (`SyncAudit` `CONFIG`, `BOT_SHARE_CHANGE`, valor anterior, nuevo y quién) y en la Actividad de usuarios, como el plazo.
- **Resumen de los próximos días** debajo del control, por día y médico: capacidad, tope del chat, citas del chat, citas del hospital y libres. Es lo que dice si el porcentaje está bien puesto y si la reserva se queda sin usar (R5).
- El resumen del plazo («el asistente puede ofrecer N cupos hoy») tiene que descontar la reserva; si no, dice que hay cupos que el chat no puede dar.

### 4.6 Caja Negra y Canales en vivo

- `WAITLIST_OPTIN_OFFERED` lleva `porReserva: true` cuando el «no hay» es por la reserva (como `porPlazo` hoy). Sin esto, «Sin agenda disponible» crece y nadie sabe si es la agenda llena o el ajuste.
- El rechazo al confirmar queda con su propio motivo («Horario reservado para el hospital»). `failureReason` es texto: no hace falta migración.

### 4.7 Lo que NO cambia

El HIS, el agente (no hay que actualizarlo por AnyDesk), el driver, `CITAS_DISPONIBLES`, los permisos de `agenia_sync`, el proxy, las plantillas de Meta, el candado de la base, la ventanilla de CNT y el panel. Se despliega con `./update.sh`, y la migración no cambia nada hasta que el administrador ponga un porcentaje.

## 5. Qué hay que construir

1. **Migración**: `OrganizationSettings.botAgendaSharePercent Int?` (nombre por confirmar), `CHECK` de 10 a 100; nulo = sin reserva.
2. **Regla pura** `packages/shared/src/reserva-presencial.ts` (+ spec): normalizar el porcentaje, tope de un médico-día, ¿puede agendar el chat?, y el resumen por día para el panel.
3. **API** `apps/api/src/appointments/reserva-presencial.ts`, funciones como `plazo-agendar.ts`: médico-días en el tope dentro de una ventana (SQL agrupado por día en la zona de la clínica) y la revalidación con candado para la reserva y el cambio de fecha.
4. **Búsqueda, reserva, cambio de fecha y lista de espera** (los cuatro caminos de §2.2), con la opción `ignorarReserva` para elegir el mensaje.
5. **Chat**: los dos textos (§4.4) en los dos tonos de `chatbot.constants.ts`; manejar `RESERVA_PRESENCIAL` en la reserva normal (≈ línea 10643) y en la de la lista de espera (≈ línea 13045); marca `porReserva` en la Caja Negra.
6. **Web**: el control y su resumen en Configuración, la acción en [`app/actions/settings.ts`](../apps/web/app/actions/settings.ts) con auditoría y actividad, el resumen del plazo con la reserva, y la etiqueta del motivo nuevo en Caja Negra y Canales en vivo.
7. **Conocimiento** (obligatorio, CLAUDE.md): Parte 1, Configuración (paso a paso «Reservar parte de la agenda para el hospital» y preguntas: ¿la ventanilla ve algo distinto?, ¿qué pasa con las citas ya dadas si bajo el porcentaje?, ¿por qué el asistente dice que no hay cupos si la agenda tiene libres?); Parte 2 §3.3, §3.5 y §11; bitácora; decidir si el asistente de soporte lo lee.
8. **Pruebas**: la regla pura (redondeos, días de 1 a 4 cupos, 100 %); la búsqueda (un médico en el tope no tapa a los demás), la reserva y el cambio de fecha (mismo día no cuenta doble), la lista de espera; los flujos del chat; la acción del panel; y contra un Postgres 15 real el SQL agrupado (cupo a las 23:30 en el día de Bogotá) y el candado con dos conexiones a la vez.

## 6. Decisiones por aprobar

| # | Decisión | Recomendación | Alternativa |
|---|---|---|---|
| R1 | Qué es el porcentaje (§3) | **Tope del chat**: ⌊capacidad × %⌋ citas del chat por médico y día | Colchón libre: el chat agenda mientras queden más de ⌈capacidad × (100 − %)⌉ libres |
| R2 | Unidad | **Por médico y por día**: cada médico guarda su parte cada día | Por servicio y día (todos los médicos juntos: el chat podría llenar a uno); por semana |
| R3 | Un valor para… | **La clínica** (hoy solo medicina general está activa, así que es lo mismo que por servicio) | Por servicio (si mañana se abre odontología con otra proporción); por médico (uno que atiende sobre todo ventanilla) |
| R4 | Redondeo | **Hacia abajo para el chat** (la reserva redondea hacia arriba): 7 cupos al 80 % → chat 5; 1 cupo → chat 0 | Al más cercano (7 → 6) |
| R5 | ¿Se libera la reserva sin usar cerca de la hora? | **No al principio**; medir dos semanas con el resumen del panel y decidir | Liberarla N horas antes (los cupos que nadie tomó en el hospital pasan al chat) |
| R6 | ¿El asistente dice que en el hospital puede haber cupos? | **No**: «por este medio ya no quedan» + lista de espera | Sí, con el teléfono del hospital |
| R7 | Valor de fábrica y rango | **Sin reserva** al desplegar (nada cambia); 10 a 100 % | Nacer en 80 % (cambia la conducta al desplegar, como nació el límite de citas) |
| R8 | Quién lo cambia | **Solo el administrador**, como el plazo | También el agente de reservas, como el límite de citas |
| R9 | Cupos apartados cerca del tope | **Cuentan como del chat al buscar** (no al reservar) | No contarlos: algunos pacientes reciben «quedó para el hospital» al confirmar |
| R10 | Lista de espera | **No ofrecer** un cupo de un médico-día con el chat en el tope; la cola espera | Ofrecerlo igual (al SÍ se rechazaría) |

## 7. Fases

- **Fase 0 — medir y acordar.** El usuario corre el SQL (§2.4); con las cifras se propone el porcentaje y se confirma con el hospital, junto con si dejará de crear citas temporales.
- **Fase 1 — la regla.** Migración, regla pura, API, chat, lista de espera, Caja Negra y pruebas (incluido Postgres real). Nace sin reserva.
- **Fase 2 — el panel y la ayuda.** Control, resumen, auditoría, resumen del plazo, etiquetas, Centro de ayuda y base de conocimiento.
- **Fase 3 — encender.** Despliegue con `./update.sh`; el administrador pone el porcentaje; revisión a los 3 y a los 14 días (el resumen del panel y el SQL de nuevo) y decisión de R5.

**Mientras tanto, sin construir nada:** «Días sin citas» ya permite bloquear unas horas para el asistente todos los días de la semana (por ejemplo, de 7:00 a 8:40 de lunes a viernes). Es una reserva por horas, no por porcentaje: las mismas horas para todos los médicos, así que el porcentaje real cambia según el turno de cada uno; pero deja esas horas para la ventanilla desde hoy, y si el hospital prefiere guardar las primeras horas para quien llega temprano, puede que sea justo lo que quiere.

## 8. Riesgos

- **Más «no hay cupos» por el chat.** Ya eran 38 personas en 7 días (diagnóstico del 30-oct) con el plazo de 4 días; la reserva los aumenta. Es el efecto buscado, pero se tiene que ver: por eso la marca `porReserva` (§4.6). El viernes, con el plazo de 4 días, es el día más afectado.
- **El porcentaje se elige a ciegas** si no se mide antes (§2.4).
- **La capacidad cambia** cuando el hospital abre, cierra o borra turnos: el tope se recalcula en cada consulta y nunca toca citas ya dadas. Bajar el porcentaje con días ya por encima solo frena las siguientes.
- **Carreras** al confirmar el último cupo del chat: candado por médico y día (§4.3).
- **Costo**: una consulta agrupada más por búsqueda. Con el plazo de 4 días son unos 70 médico-días; sin plazo hay que acotarla a los días de la bolsa de cupos.
- **La ventanilla no ve el tope en CNT.** Si el hospital quiere saber cuánto le queda, lo ve en el panel de AgenIA (§4.5).
