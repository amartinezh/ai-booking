# Permanencia en la lista de espera: poder salir y no insistirle a quien ya no la quiere

**Estado: APROBADO (2026-11-26, L1-L9 sin cambios). Fase 0 HECHA** el 26-nov a las 21:04 (las dos entradas quedaron `CANCELLED` con `motivo = 'PIDIO_SALIR'`; copia previa en `/var/backups/agenia/waitlist-antes-salida-20261126-210347.csv`; la cola pasó de 18 a 16). **Fases 1 y 2 CONSTRUIDAS el 26-nov, sin commit ni despliegue** (§8).

## 1. Qué se pide

El médico director del hospital está en la lista de espera, ha intentado salirse y no puede: por más que escribe que no quiere recibir más ofertas, se las siguen enviando. Hay que investigar su caso y todos los demás, y evaluar la permanencia en la cola.

## 2. Cómo está hoy (código)

- **No hay forma de salir.** Ni el chat ni el panel sacan a alguien de la lista. La ventana «En lista de espera» de la Caja Negra (`apps/web/app/dashboard/auditoria/WaitlistModal.tsx`, `waiting-list/route.ts`) solo muestra la cola.
- **El NO a una oferta deja a la persona en su puesto** (regla del 2026-10-31, `confirmFromWaitlist`): ese cupo y ese día no se le vuelven a ofrecer, pero el día siguiente sí. La respuesta es `waitlistCupoRechazado` («usted sigue en la lista…»).
- **«No quiero recibir más ofertas» es un NO.** `interpretYesNo` da NO cuando aparece la palabra «no», en la oferta (`handleWaitlistConfirmStep`) y con la conversación en reposo (`atenderListaDeEsperaEnReposo` → respuesta tardía). Una frase de salida sin «no» («Salir de la lista de espera») llega a la IA o al menú de servicios, que no saben hacer nada con la lista.
- **Solo se sale de tres maneras:** consiguiendo cita **del mismo servicio** (`cerrarSiYaTieneCita`), aceptando un cupo, o dejando dos ofertas seguidas sin contestar (`OFERTAS_SIN_RESPUESTA_PARA_SALIR`). Cada respuesta pone en cero la cuenta de ofertas sin contestar: **contestar «no» amarra más a la persona a la lista**.
- **No hay tope de tiempo** en la cola.

## 3. Lo que muestran los datos (producción, 26-nov 20:40, solo lectura)

### 3.1 El caso del Dr. Jorge Iván

Anotado el 20-nov 8:21 en medicina general (Sura), puesto 55. Sin citas en AgenIA.

| Cuándo | Qué pasó |
|---|---|
| 24-nov 7:56 y 9:06 | Dos ofertas por plantilla. A la segunda: «No» → «usted sigue en nuestra lista». |
| 24-nov 12:10 | Oferta. «No» → «usted permanece en la lista». |
| 25-nov 8:38 | Oferta. «No» → «usted sigue en nuestra lista». |
| 26-nov 8:18 | Oferta; no contestó en 30 min → «usted sigue en la lista, en su mismo puesto». |
| 26-nov 8:50 | Otra oferta. «No» → «usted sigue en nuestra lista». |
| 26-nov 8:53 | «No» → «Únicamente puedo colaborarle con citas médicas». |
| 26-nov 8:54 | **«Quiero salir de la lista de espera»** → menú de servicios («¿Qué servicio necesita?»). |
| 26-nov 8:55 | **«Salir de lista de espera»** → «no logré entender bien su respuesta… ¿Me podría confirmar el servicio?». |

Recibió 7 ofertas en 3 días, 3 de ellas el 24-nov. Sigue **esperando**, con 4 días y 6 cupos rechazados. Mañana desde las 7:00 el barrido le vuelve a ofrecer cupos.

### 3.2 No es el único que no pudo salir

- **Héctor David** (Salud Total, anotado el 18-nov). 24-nov: «Ya no lo necesito muchas gracias» → «usted permanece en la lista». 25-nov: «Salir de la lista, ya no se necesita la cita médica muchas gracias» → el bot le pidió el documento para *cancelar una cita*. 26-nov: otra oferta. **Sigue esperando**, con 6 días rechazados.
- **Una persona el 11 y 12-nov**: «Ya no necesito esa cita» (le pidió la cédula para cancelar), «Ya no quiero estar en lista de espera» («no fue posible identificar el número»), «Ya no quiero permanecer en lista» y «Ya conseguí una cita, no necesito nada» («Listo, comencemos de nuevo»). Salió después, cuando el sistema vio su cita.
- **Frases de salida que el bot tomó como «ese horario no me sirve»** (la persona siguió en la lista): «Ya no lo necesito» (2), «ya no necesito la cita», «ya no quiero seguir gracias», «no ya asistí a consulta» (2), «no, tuve traslado a Pereira» (2), «ella se fue para Pereira…». Son 9 mensajes.
- Fuera de la oferta: «Ya no necesito citas» y «ya me dieron la cita» recibieron el menú de servicios, y «ya tengo la cita» recibió «no tiene citas próximas».

### 3.3 Permanencia en la cola

- **Historia (desde el 23-oct): 519 entradas.** 356 terminaron en cita (69 %), con una mediana de 21 h desde que se anotaron y p90 de 3,8 días. 94 salieron por no contestar dos ofertas (18 %). 49 consiguieron cita del mismo servicio por otro camino. 2 se cancelaron con la regla vieja del NO (29-oct). 18 siguen esperando.
- **La cola de hoy: 18 personas**, todas de medicina general. 13 llevan menos de 3 días, 1 entre 3 y 7, y 4 entre 7 y 14. El más antiguo es del 17-nov (9 días). **El tiempo no es el problema**: la lista se mueve rápido.
- **El tercer NO es la señal.** De cada 100 ofertas, cuántas terminaron en cita según los NO que la persona ya había dicho:

| NO previos | Ofertas | Tomadas |
|---|---|---|
| 0 | 785 | 37,6 % |
| 1 | 150 | 23,3 % |
| 2 | 90 | 24,4 % |
| 3 o más | 111 | **3,6 %** (4) |

  Por persona: con 1 NO, 55 % terminó en cita; con 2, 61 %; con 3 o más, 16 % (4 de 25: 10 dejaron de contestar, 2 consiguieron cita por otro camino y 9 siguen esperando). Esas 111 ofertas dejaron cupos apartados 30 minutos o más, que el chat no le mostró a nadie.
- **La mitad de la cola de hoy ya dijo NO tres veces o más** (9 de 18): 8, 7, 6, 4, 4, 3, 3, 3 y 3 días rechazados.
- **Atendidos en otro servicio.** 15 personas tuvieron cita en otro servicio después de anotarse y siguieron recibiendo ofertas (46 en total): lectura de exámenes 7, salud oral 3, la agenda s39141-13 2, control posparto 1, control de hipertensos 1 y examen de primera vez 1. Hoy son 3 de los 18 (dos con lectura de exámenes ya atendida y uno con s39141-13 hoy). Los tres ya tienen 3 o más NO.
- **Varias ofertas el mismo día.** Días-persona con 1 oferta: 277; con 2: 181; con 3: 59; con 4: 29; con 5: 10; de 6 a 9: 4. Pero una oferta que llega menos de 12 h después de un NO todavía se toma el 21,5 % de las veces, así que **una pausa tras cada NO costaría citas**: no se propone.
- **Rechazos por la hora, no por la cita.** Unos 15 NO dicen por qué: vereda o finca, no hay transporte a esa hora, «que sea en la tarde», «muy temprano». Cada día reciben otro cupo de madrugada.
- **Salir por no contestar funciona.** De los 94 que salieron así, 23 se volvieron a anotar y 34 tuvieron cita en los 14 días siguientes (15 del hospital).
- **Un número, varias personas.** Hoy hay un número con dos personas en la lista.

## 4. La propuesta en una línea

**Que salir sea tan fácil como entrar, y que al tercer día rechazado el asistente pregunte si la persona todavía necesita la cita en vez de seguirle ofreciendo cupos.**

## 5. Decisiones (con mi recomendación)

**L1. Salir por el chat con frases fijas, sin IA**, en cualquier paso, por texto y por voz (como la baja de recordatorios, D2 del alta en caliente). Dos grupos:
- **Nombran la lista o las ofertas:** «salir de la lista», «quiero salir de la lista de espera», «sáquenme de la lista», «ya no quiero estar/permanecer/seguir en la lista», «no quiero recibir más ofertas/mensajes». Valen siempre que el número tenga una entrada activa.
- **Dicen que ya no la necesitan:** «ya no lo necesito», «ya no necesito la cita/citas», «ya no quiero seguir», «ya me dieron la cita», «ya conseguí cita», «ya asistí», «tuve traslado». Valen con una oferta vigente o vencida en las últimas 24 h. Sin oferta, solo si la persona no tiene una cita próxima. Si la tiene, sigue el camino de hoy (cancelar), porque puede referirse a esa cita.
- *Recomiendo* sacarla **sin preguntar «¿está seguro?»**. Ya escribió que quiere salir, y volver es fácil (pierde el puesto). Un «Salir» a secas sigue siendo cerrar la conversación.

**L2. Varias personas en el mismo número.** Con una oferta pendiente, sale la entrada de esa oferta. Si hay una sola entrada, esa. Si hay varias, se pregunta con letras: «A) Agustín, B) Angela, C) Las dos».

**L3. Qué pasa al salir.** La entrada queda en `CANCELLED` con `metadata.motivo = 'PIDIO_SALIR'` y el texto que escribió. Si tenía un cupo ofrecido, se suelta y pasa al siguiente. La respuesta: «Listo, le saqué de la lista de espera de *medicina general*. No le enviaré más ofertas. Si más adelante necesita la cita, escríbame *Hola*.» En la Caja Negra queda el paso `WAITLIST_SALIDA`. No hay migración de base de datos.

**L4. Los mensajes dicen cómo salir:** la oferta por texto, la respuesta al NO, la anotación y la respuesta tardía llevan «Si ya no necesita la cita, escriba *Salir de la lista*». La plantilla de Meta no se toca (cambiarla pide aprobación nueva y arriesga la categoría Utilidad).

**L5. Al tercer día rechazado, preguntar antes de seguir.** En lugar de «usted sigue en la lista», el asistente responde: «Entendido, libero ese cupo. Ya van 3 que no le han servido. ¿Todavía necesita la cita? Responda *SÍ* para seguir en la lista, en su mismo puesto, o *NO* para salir. Si no me responde antes de mañana a esta hora, le saco de la lista para no seguir escribiéndole.»
- Mientras la pregunta está pendiente, no se le ofrecen cupos.
- SÍ: sigue en su puesto, y la siguiente pregunta llega después de 3 días rechazados más.
- NO o una frase de L1: sale, como en L3.
- Sin respuesta en 24 h: sale con `motivo = 'NO_CONFIRMO'`. La pregunta va siempre por texto, porque se hace en la misma conversación del NO.
- La cuenta usa `metadata.diasRechazados`, que ya existe. Los 9 de hoy reciben la pregunta en su próximo NO, sin tocar nada a mano.
- *Alternativa:* sacarla sola al tercer NO. No la recomiendo: 4 de esas 25 personas sí tomaron un cupo después.

**L6. Un NO de quien ya tuvo cita en otro servicio**, después de anotarse, dispara la misma pregunta de L5 enseguida, aunque sea su primer NO, y nombra la cita: «Vi que el *20 de noviembre* tuvo cita de *Lectura de exámenes*. ¿Todavía necesita la de *medicina general*?» No se saca a nadie sin preguntar: la salud oral, por ejemplo, no reemplaza la consulta.

**L7. Panel: «Quitar de la lista»** en la ventana «En lista de espera» de la Caja Negra (ORG_ADMIN y BOOKING_AGENT). Solo para entradas que esperan, con un motivo opcional y constancia en la Actividad. La ventana muestra además, por persona, las ofertas recibidas, los días rechazados y el último texto con que rechazó, para que el personal vea a los atascados.

**L8. Sin tope por tiempo por ahora.** La entrada más vieja tiene 9 días y el p90 hasta la cita es de 3,8 días. Se revisa si aparecen entradas de más de 21 días.

**L9. Fuera de este plan (para una fase aparte, si se quiere):** guardar la jornada que la persona pide al rechazar («en la tarde», «muy temprano», vereda o transporte) y ofrecerle solo cupos de esa jornada. También: un «no» dentro de una disculpa por tardar («estaba retirado del celular y no oí el mensaje», «no había podido revisar», 2 casos) se tomó como NO.

## 6. Fases

**Fase 0. Sacar ya a los dos que lo pidieron** (escritura en producción, **con confirmación**). Hay que hacerlo antes de las 7:00 del 27-nov, cuando el barrido vuelve a ofrecer.

```sql
BEGIN;
UPDATE "WaitlistEntry"
SET status = 'CANCELLED',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'motivo', 'PIDIO_SALIR',
      'quitadoPor', 'Equipo AgenIA (el paciente lo pidió por el chat)',
      'quitadoEn', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    "updatedAt" = now() AT TIME ZONE 'UTC'
WHERE id IN ('45c21f07-e9aa-40d1-b164-e2a48031e7b7',  -- Jorge Iván
             '37222a47-c309-48be-a082-ca67f440d1dc')  -- Héctor David
  AND status = 'WAITING';
-- Debe decir UPDATE 2; si no, ROLLBACK.
COMMIT;
```

`WaitlistEntry` no tiene disparadores. Antes se guarda una copia de las dos filas en `/var/backups/agenia`. Lo ideal es avisarles: WhatsApp deja escribirles texto hasta el 27-nov a las 8:19 (Héctor) y a las 8:55 (el doctor).

**Fase 1. API** (L1-L6):
- Frases de L1 en un archivo propio, como `pide-lista-de-espera.ts`, con sus pruebas.
- El enganche por texto va antes de la respuesta a la lista en reposo y de la despedida (`processIncomingMessageUnsafe`). Por voz, después de la transcripción, junto a la baja de recordatorios.
- `WaitlistService.salirDeLaLista` y la pregunta de L5 y L6, con un estado nuevo del chat y su barrido de 24 h. `notifyWaitlist` salta a quien tiene la pregunta pendiente.
- Textos en los dos estilos de `chatbot.constants.ts`.
- `AGENIA.md`: §3.5, la Caja Negra (💡 y preguntas frecuentes) y la bitácora.

**Fase 2. Panel** (L7): la acción para quitar, las columnas nuevas y la constancia. `AGENIA.md`, Parte 1 (Caja Negra › Gestionar la lista de espera).

## 7. Cómo se verifica

- Pruebas de las frases con los textos reales de §3.2 (los que deben sacar) y con los que no deben: «No», «no que sea en la tarde», «no tienes uno para el jueves», «Salir», «ya me la dieron» tras un recordatorio, «ya no necesito esa cita» de quien tiene una cita próxima.
- Prueba del barrido de 24 h con el reloj movido.
- En producción, el primer día: pasos `WAITLIST_SALIDA` y la pregunta en la Caja Negra, y que la cola ya no ofrezca a quien tiene la pregunta pendiente.

## 8. Bitácora de la construcción (2026-11-26)

- **Fase 0:** respaldo de las dos filas y `UPDATE` en una transacción que solo confirma si toca exactamente dos (`UPDATE 2`, `COMMIT`).
- **Fase 1 (API):** `apps/api/src/chatbot/salir-de-la-lista.ts` (frases de L1, con los textos reales de §3.2 en su prueba); en `WaitlistService`: `entradasActivas`, `salirDeLaLista`, `tienePreguntaPendiente`, `responderSiSigue`, el barrido `vencerPreguntasSinRespuesta` (cada 10 min) y `preguntaAlRechazar` en el NO a tiempo y en el tardío; `notifyWaitlist` salta a quien tiene la pregunta pendiente. En el chat: `atenderSalidaDeLaLista` (por texto antes de la baja de comunicados, por voz tras la transcripción), los pasos `AWAITING_WAITLIST_SIGUE` (no se cierra por inactividad) y `AWAITING_WAITLIST_SALIDA`, y la respuesta a la pregunta en reposo. Textos nuevos en los dos estilos y «Si ya no necesita la cita, escriba *Salir de la lista*» en la oferta, el NO, la anotación, la respuesta tardía y el vencimiento. Sin migración: todo vive en `WaitlistEntry.metadata`.
- **Fase 2 (panel):** `quitarDeLaListaDeEsperaAction` (`apps/web/app/dashboard/auditoria/actions.ts`), `apps/web/lib/lista-espera/quitar.ts` y `resumen.ts`; en la ventana de la lista, la columna Ofertas (recibidas, días rechazados en ámbar desde 3, último rechazo, pregunta pendiente) y «Quitar de la lista» con nota opcional; acción `WAITLIST_ENTRY_REMOVED` en la Actividad de usuarios.
- **Verificación:** API 5.290 pruebas OK (nuevas: 49 de frases, 18 del servicio, 15 de conversación), 16 mutaciones de las reglas clave detectadas, `tsc` y `nest build` OK; web 2.202 pruebas OK (13 nuevas) y `tsc` OK; lint limpio en lo tocado; `check-conocimiento` y las pruebas del Centro de ayuda y del asistente de soporte OK. `AGENIA.md`: Caja Negra (pasos, nota, pantalla, pregunta frecuente), §3.5, §7 y bitácora.
- **Al desplegar:** solo API y web (el agente del hospital no cambia). Los 9 de la cola con tres o más días rechazados reciben la pregunta en su próximo NO, sin tocar nada a mano. Vigilar en la Caja Negra los pasos `WAITLIST_SALIDA`, `WAITLIST_SIGUE` y la pregunta, y que no aparezcan salidas de quien no lo pidió.
