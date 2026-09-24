-- SOLO ENTORNO LOCAL — espejo de una función que ya existe en PRODUCCIÓN.
--
-- `get_last_ingest_at()` se creó en producción desde el panel y nunca se
-- versionó, así que en local respondía 404 (el cliente lo tolera, pero dejaba un
-- error de red en cada arranque). Definición leída de producción el 2026-09-24
-- (solo lectura, por la sesión coordinadora):
--   select max(at) from public.ingest_log where status = 'ok'
--   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
-- Los GRANT no se leyeron: se asumen los mismos que las otras RPC de la app
-- (EXECUTE para `authenticated`, no para `anon`).
--
-- NO hay archivo equivalente en migrations/: la función ya está en producción y
-- esto no debe aplicarse allá (no cambiaría nada, pero no es su fuente de verdad).

CREATE OR REPLACE FUNCTION public.get_last_ingest_at()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select max(at) from public.ingest_log where status = 'ok'
$function$;

REVOKE ALL ON FUNCTION public.get_last_ingest_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_last_ingest_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_last_ingest_at() TO authenticated;
