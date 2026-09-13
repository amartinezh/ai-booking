-- FASE 2 DE AVISOS MASIVOS — nunca truncar en silencio (§5).
--
-- Si el driver trae más candidatos que `maxDestinatariosPorLote`, el
-- servidor recorta la lista — pero la pantalla, que hace polling sobre esta
-- misma fila, tiene que poder avisarlo. Antes de esta columna, `applyRoster`
-- calculaba el truncamiento pero lo perdía al terminar la transacción: solo
-- quedaba en el log del servidor, nunca llegaba a quien pidió la lista.
ALTER TABLE "NoticeRosterRequest" ADD COLUMN "truncated" BOOLEAN NOT NULL DEFAULT false;
