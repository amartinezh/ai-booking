/* =============================================================================
   PERMISOS DE ESCRITURA DEL AGENTE (agenia_sync) EN ESEHSVP
   Base objetivo: ESEHSVP (el catálogo VIVO del hospital)
   =============================================================================

   PARA QUÉ (2026-10-15)
   AgenIA nunca ha escrito en ESEHSVP. Antes de encender «Cancelar citas por el
   asistente» hay que confirmar que el login del agente puede hacer, EN ESEHSVP,
   exactamente lo que hace el driver al cancelar (y al cambiar la fecha):

     1. Leer la cita viva con bloqueo:
          SELECT … FROM dbo.CITAS_MEDICAS WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
     2. Copiarla al registro de anuladas:
          INSERT INTO dbo.CITAS_ANULADAS (…) SELECT … FROM dbo.CITAS_MEDICAS
     3. Borrarla:
          DELETE FROM dbo.CITAS_MEDICAS WHERE … AND NU_HIST_PAC_CIT = @hist

   Y, para cuando se encienda agendar o cambiar fecha, lo del alta:
     4. INSERT INTO dbo.CITAS_MEDICAS
     5. INSERT INTO dbo.PACIENTES        (solo si el paciente no existe)
     6. EXEC dbo.PA_Ins_AUDITOR          (opcional: sin él la cita se crea igual)

   El script de instalación (`AGENIA_SYNC_SETUP.sql`, sección 4-ESEHSVP) concede
   todo esto; lo que se comprueba aquí es que de verdad quedó así en ESEHSVP.

   CÓMO
   `EXECUTE AS LOGIN = 'agenia_sync'` corre lo que sigue con el permiso REAL del
   agente (roles, GRANT y DENY incluidos), sin pedirle a nadie su contraseña. Lo
   ejecuta un administrador (quien corrió `AGENIA_SYNC_SETUP.sql`).

   GARANTÍAS DE INOCUIDAD — verificables leyendo el archivo:
     · PARTES A y B: solo SELECT y funciones de permisos. Ni INSERT, UPDATE,
       DELETE, MERGE, ALTER, CREATE, DROP ni GRANT. No cambian nada.
     · PARTE C (OPCIONAL, va comentada): prueba práctica dentro de una
       transacción que SIEMPRE se deshace (ROLLBACK), con condiciones imposibles
       (`WHERE 1 = 0`): no lee, no copia y no borra ninguna fila. Sirve para ver
       el permiso en la práctica, no en papel. Antes de correrla, mirar la
       sección A.3: si las tablas tienen disparadores, se ejecutan aunque no
       haya filas (y también se deshace lo que hagan dentro de la base).
   ============================================================================= */

USE ESEHSVP;
GO

SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
GO

/* ── A.1 — Lo concedido «en papel» al usuario agenia_sync ──────────────────────
   Esperado: SELECT, INSERT, DELETE en CITAS_MEDICAS; SELECT, INSERT en
   CITAS_ANULADAS; SELECT, INSERT en PACIENTES; EXECUTE en PA_Ins_AUDITOR.
   Todo con estado GRANT. Un DENY aquí gana sobre cualquier GRANT. */
SELECT
    objeto  = OBJECT_NAME(p.major_id),
    permiso = p.permission_name,
    estado  = p.state_desc
FROM sys.database_permissions p
JOIN sys.database_principals u ON u.principal_id = p.grantee_principal_id
WHERE u.name = 'agenia_sync'
  AND p.major_id IN (
        OBJECT_ID('dbo.CITAS_MEDICAS'),
        OBJECT_ID('dbo.CITAS_ANULADAS'),
        OBJECT_ID('dbo.PACIENTES'),
        OBJECT_ID('dbo.PA_Ins_AUDITOR'))
ORDER BY objeto, permiso;
GO

/* ── A.2 — Roles de agenia_sync en ESEHSVP ─────────────────────────────────────
   Un rol como db_denydatawriter le quitaría la escritura aunque A.1 diga GRANT.
   Esperado: ninguno, o solo roles de lectura. */
SELECT rol = r.name
FROM sys.database_role_members m
JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
WHERE u.name = 'agenia_sync';
GO

/* ── A.3 — Disparadores en las tablas que se tocan al cancelar ─────────────────
   Solo para saber qué más corre cuando el agente escribe (y antes de la PARTE C). */
SELECT
    tabla        = OBJECT_NAME(t.parent_id),
    disparador   = t.name,
    deshabilitado = t.is_disabled,
    cuando       = STUFF((SELECT ', ' + e.type_desc
                          FROM sys.trigger_events e
                          WHERE e.object_id = t.object_id
                          FOR XML PATH('')), 1, 2, '')
FROM sys.triggers t
WHERE t.parent_id IN (OBJECT_ID('dbo.CITAS_MEDICAS'), OBJECT_ID('dbo.CITAS_ANULADAS'));
GO

/* ── B — El permiso EFECTIVO, corriendo COMO agenia_sync ──────────────────────
   1 = lo tiene · 0 = no lo tiene · NULL = el objeto no existe o no es visible.
   Para cancelar hacen falta en 1: citas_select, citas_delete, anuladas_insert.
   Para agendar o cambiar fecha, además: citas_insert y pacientes_insert.
   auditor_execute es opcional. */
BEGIN TRY
    EXECUTE AS LOGIN = 'agenia_sync';

    SELECT
        ejecutando_como  = SUSER_SNAME(),   -- debe decir agenia_sync
        usuario_en_la_bd = USER_NAME(),
        base             = DB_NAME();       -- debe decir ESEHSVP

    SELECT
        citas_select      = HAS_PERMS_BY_NAME('dbo.CITAS_MEDICAS',  'OBJECT', 'SELECT'),
        citas_delete      = HAS_PERMS_BY_NAME('dbo.CITAS_MEDICAS',  'OBJECT', 'DELETE'),
        anuladas_insert   = HAS_PERMS_BY_NAME('dbo.CITAS_ANULADAS', 'OBJECT', 'INSERT'),
        citas_insert      = HAS_PERMS_BY_NAME('dbo.CITAS_MEDICAS',  'OBJECT', 'INSERT'),
        pacientes_select  = HAS_PERMS_BY_NAME('dbo.PACIENTES',      'OBJECT', 'SELECT'),
        pacientes_insert  = HAS_PERMS_BY_NAME('dbo.PACIENTES',      'OBJECT', 'INSERT'),
        auditor_execute   = HAS_PERMS_BY_NAME('dbo.PA_Ins_AUDITOR', 'OBJECT', 'EXECUTE');

    REVERT;
END TRY
BEGIN CATCH
    IF ORIGINAL_LOGIN() <> SUSER_SNAME() REVERT;
    SELECT error = ERROR_NUMBER(), mensaje = ERROR_MESSAGE();
END CATCH;
GO

/* ── C (OPCIONAL) — Prueba práctica de la cancelación, sin tocar ninguna fila ───
   Para correrla, quitar las dos marcas de comentario que la encierran
   (la línea de apertura justo abajo y la de cierre al final). Ejecuta las MISMAS sentencias
   del agente, con `WHERE 1 = 0` (ninguna fila cumple) y dentro de una
   transacción que siempre termina en ROLLBACK. Resultado esperado: una sola fila
   «cancelación: permisos OK». Si falta un permiso, sale el error 229 con el
   nombre del permiso y del objeto. */

/*
BEGIN TRY
    EXECUTE AS LOGIN = 'agenia_sync';
    BEGIN TRANSACTION;

    -- 1. Lectura con bloqueo (igual que el agente).
    SELECT NU_HIST_PAC_CIT hist
      FROM dbo.CITAS_MEDICAS WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
     WHERE 1 = 0;

    -- 2. Copia a CITAS_ANULADAS (las mismas columnas del agente).
    INSERT INTO dbo.CITAS_ANULADAS (
      CD_CODI_MED_CIAN, FE_HORA_CIAN, CD_CODI_SER_CIAN,
      NU_HIST_PAC_CIAN, NU_DURA_CIAN, FE_ELAB_CIAN, FE_FECH_CIAN,
      NU_DIA_CIAN, NU_NUME_MOVI_CIAN, NU_PRIM_CIAN, NU_NUME_CONE_CIAN,
      NU_CONE_CALL_CIAN, CD_CODI_ESP_CIAN, CD_CODI_CONS_CIAN,
      NU_NUME_CONV_CIAN, NU_TIPO_CIAN, DE_DESC_CIAN, NU_AUTO_AGRU_CIAN,
      CD_CODI_EST_CIAN, CD_CODI_CAMP_CIAN, NU_CODIGO_HSWE_CIAN,
      CD_CODI_MOTI_CIAN, TX_OBSE_CIAN
    )
    SELECT
      CD_CODI_MED_CIT, FE_HORA_CIT, CD_CODI_SER_CIT,
      NU_HIST_PAC_CIT, NU_DURA_CIT, FE_ELAB_CIT, FE_FECH_CIT,
      NU_DIA_CIT, COALESCE(NU_NUME_MOVI_CIT, 0), NU_PRIM_CIT, NU_NUME_CONE_CIT,
      NU_CONE_CALL_CIT, CD_CODI_ESP_CIT, CD_CODI_CONS_CIT,
      NU_NUME_CONV_CIT, NU_TIPO_CIT, DE_DESC_CIT, NU_AUTO_AGRU_CIT,
      CD_CODI_EST_CIT, CD_CODI_CAMP_CIT, NU_CODIGO_HSWE_CIT,
      'WB', 'prueba de permisos (0 filas)'
    FROM dbo.CITAS_MEDICAS
    WHERE 1 = 0;

    -- 3. Borrado.
    DELETE FROM dbo.CITAS_MEDICAS WHERE 1 = 0;

    ROLLBACK TRANSACTION;
    REVERT;
    SELECT resultado = 'cancelación: permisos OK (0 filas, todo deshecho)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    IF ORIGINAL_LOGIN() <> SUSER_SNAME() REVERT;
    SELECT error = ERROR_NUMBER(), mensaje = ERROR_MESSAGE();
END CATCH;
*/
GO
