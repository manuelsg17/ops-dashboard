-- Fase 3 (rediseñada): roles de PERMISOS dentro del Dashboard, no de datos.
-- Todos los logueados siguen viendo los mismos datos (SELECT sin cambios).
-- Nuevo rol 'kam' (via el mismo JWT app_metadata.role que ya usa is_admin(),
-- promovido con el mismo comando SQL documentado en CLAUDE.md, solo con
-- role='kam' en vez de 'admin') puede escribir (INSERT/UPDATE, NO delete) en
-- las tablas operativas de uploads + Calculadora de metas. Borrado masivo y
-- seguimiento/proyectos/fleetrooms siguen exclusivos de admin.
CREATE OR REPLACE FUNCTION public.is_kam_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'kam'),
    false
  );
$function$;

GRANT EXECUTE ON FUNCTION public.is_kam_or_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_kam_or_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_kam_or_admin() FROM anon;

-- rendimiento
DROP POLICY IF EXISTS rendimiento_admin_insert ON public.rendimiento;
CREATE POLICY rendimiento_admin_insert ON public.rendimiento
  FOR INSERT TO authenticated WITH CHECK (is_kam_or_admin());
DROP POLICY IF EXISTS rendimiento_admin_update ON public.rendimiento;
CREATE POLICY rendimiento_admin_update ON public.rendimiento
  FOR UPDATE TO authenticated USING (is_kam_or_admin()) WITH CHECK (is_kam_or_admin());

-- rendimiento_mensual
DROP POLICY IF EXISTS rendimiento_mensual_admin_insert ON public.rendimiento_mensual;
CREATE POLICY rendimiento_mensual_admin_insert ON public.rendimiento_mensual
  FOR INSERT TO authenticated WITH CHECK (is_kam_or_admin());
DROP POLICY IF EXISTS rendimiento_mensual_admin_update ON public.rendimiento_mensual;
CREATE POLICY rendimiento_mensual_admin_update ON public.rendimiento_mensual
  FOR UPDATE TO authenticated USING (is_kam_or_admin()) WITH CHECK (is_kam_or_admin());

-- rendimiento_diario
DROP POLICY IF EXISTS rendimiento_diario_admin_insert ON public.rendimiento_diario;
CREATE POLICY rendimiento_diario_admin_insert ON public.rendimiento_diario
  FOR INSERT TO authenticated WITH CHECK (is_kam_or_admin());
DROP POLICY IF EXISTS rendimiento_diario_admin_update ON public.rendimiento_diario;
CREATE POLICY rendimiento_diario_admin_update ON public.rendimiento_diario
  FOR UPDATE TO authenticated USING (is_kam_or_admin()) WITH CHECK (is_kam_or_admin());

-- metas
DROP POLICY IF EXISTS metas_admin_insert ON public.metas;
CREATE POLICY metas_admin_insert ON public.metas
  FOR INSERT TO authenticated WITH CHECK (is_kam_or_admin());
DROP POLICY IF EXISTS metas_admin_update ON public.metas;
CREATE POLICY metas_admin_update ON public.metas
  FOR UPDATE TO authenticated USING (is_kam_or_admin()) WITH CHECK (is_kam_or_admin());

-- partners
DROP POLICY IF EXISTS partners_admin_insert ON public.partners;
CREATE POLICY partners_admin_insert ON public.partners
  FOR INSERT TO authenticated WITH CHECK (is_kam_or_admin());
DROP POLICY IF EXISTS partners_admin_update ON public.partners;
CREATE POLICY partners_admin_update ON public.partners
  FOR UPDATE TO authenticated USING (is_kam_or_admin()) WITH CHECK (is_kam_or_admin());

-- flotas
DROP POLICY IF EXISTS flotas_admin_insert ON public.flotas;
CREATE POLICY flotas_admin_insert ON public.flotas
  FOR INSERT TO authenticated WITH CHECK (is_kam_or_admin());
DROP POLICY IF EXISTS flotas_admin_update ON public.flotas;
CREATE POLICY flotas_admin_update ON public.flotas
  FOR UPDATE TO authenticated USING (is_kam_or_admin()) WITH CHECK (is_kam_or_admin());

-- conversion_pais
DROP POLICY IF EXISTS conversion_pais_admin_insert ON public.conversion_pais;
CREATE POLICY conversion_pais_admin_insert ON public.conversion_pais
  FOR INSERT TO authenticated WITH CHECK (is_kam_or_admin());
DROP POLICY IF EXISTS conversion_pais_admin_update ON public.conversion_pais;
CREATE POLICY conversion_pais_admin_update ON public.conversion_pais
  FOR UPDATE TO authenticated USING (is_kam_or_admin()) WITH CHECK (is_kam_or_admin());

-- ── Rollout ───────────────────────────────────────────────────────────────
-- Mismo comando que "Promover otro admin" (ver README de este repo), solo con
-- role='kam'. Requiere que el KAM ya tenga cuenta en Supabase Auth (hoy los 4
-- correos que se evaluaron para esto NO tienen cuenta todavia):
--
-- UPDATE auth.users
--    SET raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb)
--                          || jsonb_build_object('role','kam')
--  WHERE email = '...@yango-team.com';
