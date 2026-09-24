-- 2026-09-24 — data_version(): "¿cambiaron los datos?" en una consulta barata.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ESTADO: APLICADA SOLO EN EL SUPABASE LOCAL (Docker, puerto 54332).         ║
-- ║ PRODUCCIÓN: NO APLICADA. La aplica la sesión coordinadora ÚNICAMENTE con   ║
-- ║ la confirmación explícita de Manuel.                                       ║
-- ║                                                                            ║
-- ║ ORDEN DE DESPLIEGUE: indistinto. Sin esta función el cliente recibe 404 y  ║
-- ║ se comporta exactamente como antes (re-descarga todo en cada apertura):    ║
-- ║ nunca reutiliza el caché sin poder confirmar que los datos no cambiaron.   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- POR QUÉ: el plan gratuito de Supabase tiene 5 GB de egress por ciclo, y el
-- ciclo anterior se pasó. Cada apertura re-descargaba la ventana semanal entera
-- (y, en idle, mensual + diario) aunque nada hubiera cambiado. El cliente ahora
-- guarda las filas en IndexedDB y, antes de re-descargar, pregunta esto. Si la
-- versión y el conteo de filas coinciden con los del snapshot, reutiliza las
-- filas que ya tiene (ver src/shared/versionDatos.ts).
--
-- DE DÓNDE SALE LA VERSIÓN: `audit_log`. Cada INSERT/UPDATE/DELETE real sobre
-- estas tablas deja una fila vía `audit_trigger()` (los UPDATE no-op no se
-- registran: si nada cambió, la versión tampoco) — cubre la ingesta automática
-- (service_role también dispara triggers), los Excel subidos a mano, las
-- ediciones desde la app y los borrados. `get_last_ingest_at` solo cubría la
-- ingesta automática, y un re-upload que actualiza filas existentes deja el
-- mismo conteo: por eso no alcanzaba.
--
-- POR QUÉ count(*) ADEMÁS DE max(at): `at` es now() = hora de INICIO de la
-- transacción. Si una transacción larga (A) confirma DESPUÉS de una corta (B)
-- que empezó más tarde, max(at) queda en la hora de B y la escritura de A no
-- movería la versión. El conteo sí avanza con cada escritura confirmada, en
-- cualquier orden (audit_log es de solo-agregar; la purga manual de >180 días
-- lo baja, y eso también cambia la versión → una re-descarga, lo seguro).
--
-- COSTO (medido en local con 413.000 filas sintéticas en audit_log, dentro de
-- BEGIN...ROLLBACK): ~28 ms (Parallel Seq Scan + HashAggregate). Se probó un
-- índice (table_name, at): el planificador lo ignora para esta consulta (el
-- conteo recorre casi toda la tabla igual), así que NO se agrega — solo
-- encarecería cada escritura auditada. Si algún día audit_log crece más allá
-- de ~1-2 M de filas, la alternativa es max(at) por tabla con ese índice
-- (0,05 ms) aceptando el hueco de orden de confirmación descrito arriba.
--
-- SEGURIDAD: SECURITY DEFINER para leer audit_log (su SELECT es admin-only por
-- RLS). Devuelve SOLO conteos y fechas por tabla — ningún dato de fila, ningún
-- usuario. EXECUTE solo para `authenticated`.
--
-- Forma de la respuesta:
--   { "tablas":  { "rendimiento": [<filas en audit_log>, "<max(at)>"], ... },
--     "ingesta": { "semanal": "<max(at) ok>", "mensual": ..., "diario": ... } }
-- Una tabla sin historia en audit_log no aparece (el cliente la trata como null).

CREATE OR REPLACE FUNCTION public.data_version()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'tablas', COALESCE((
      SELECT jsonb_object_agg(table_name, jsonb_build_array(n, at))
        FROM (SELECT table_name, count(*) AS n, max(at) AS at
                FROM public.audit_log
               WHERE table_name = ANY (ARRAY[
                       'rendimiento', 'rendimiento_mensual', 'rendimiento_diario',
                       'partner_users', 'partners', 'fleetrooms', 'flotas',
                       'metas', 'proyectos', 'seguimiento', 'conversion_pais'])
               GROUP BY table_name) s
    ), '{}'::jsonb),
    'ingesta', COALESCE((
      SELECT jsonb_object_agg(scale, at)
        FROM (SELECT scale, max(at) AS at
                FROM public.ingest_log
               WHERE status = 'ok'
               GROUP BY scale) i
    ), '{}'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.data_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.data_version() FROM anon;
GRANT EXECUTE ON FUNCTION public.data_version() TO authenticated;

-- Verificación (con un JWT de cualquier rol autenticado):
--   SELECT public.data_version();
--   -> {"tablas": {"rendimiento": [N, "..."], ...}, "ingesta": {...}}
-- anon: SET ROLE anon; SELECT public.data_version();  -> 42501 permission denied
