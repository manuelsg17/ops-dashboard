-- ============================================================================
-- RLS en la tabla de respaldo de las semanas duplicadas.
--
-- HALLAZGO (advisor de seguridad, 05-sep-2026, nivel ERROR). Al crear el backup
-- el 03-sep con `CREATE TABLE ... AS SELECT` quedo SIN RLS y con GRANT a `anon`:
-- 696 filas de rendimiento REAL legibles con la anon key, que es publica por
-- diseno (viaja en el bundle). No es un bug de la app — ninguna vista la lee —
-- pero era una fuga de datos abierta al que tuviera la key.
--
-- Es la trampa de `CREATE TABLE AS`: hereda los privilegios por defecto del
-- esquema (que incluyen anon, porque PostgREST expone `public`) y NO hereda el
-- RLS de la tabla de origen. Cualquier tabla temporal o de respaldo creada asi
-- nace expuesta. Vale para la proxima.
--
-- Se habilita RLS y NO se crea ninguna politica: asi solo la alcanzan
-- postgres/service_role, igual que `audit_log`. Verificado despues de aplicar:
-- un admin autenticado lee 0 filas.
-- ============================================================================
ALTER TABLE public.rendimiento_dup_martes_20260903 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rendimiento_dup_martes_20260903 FROM anon;
