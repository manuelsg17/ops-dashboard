-- Portal de Partners: identidad + RLS scoped por CLID (Track B4).
--
-- Nuevo rol 'partner' (JWT app_metadata.role, mismo mecanismo que admin/kam).
-- Un partner externo ve SOLO las filas de su(s) CLID(s), nunca las de otros.
-- Mapeo usuario→CLID en partner_users (un partner puede tener N CLIDs).
--
-- CORRECCIÓN de diseño respecto al borrador del plan: las políticas RLS
-- PERMISIVAS se combinan con OR. Por eso NO alcanza con "agregar" una política
-- restrictiva de partner: la política existente `..._select_auth USING (true)`
-- ya le concedería TODO al partner (true OR cualquier-cosa = true). Hay que
-- REESCRIBIR ese `USING (true)` a `USING (NOT is_partner())` en cada tabla, y
-- recién ahí sumar la política scoped del partner. Esto aplica por igual a las
-- tablas de hechos (rendimiento*) y a las de metadata (partners/flotas/...).
--
-- KILL-SWITCH estructural: my_clids() = {} si el usuario no tiene filas en
-- partner_users → dar role='partner' sin mapeo = login que NO ve nada (nunca
-- "ve todo por error"). Rollout seguro: aplicar esto con CERO usuarios partner.

-- ── Identidad ─────────────────────────────────────────────────────────────────
CREATE TABLE public.partner_users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clid       text NOT NULL REFERENCES public.partners(clid) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (user_id, clid)
);
CREATE INDEX partner_users_user_id_idx ON public.partner_users (user_id);

ALTER TABLE public.partner_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_users_admin_all ON public.partner_users
  FOR ALL TO authenticated
  USING ((select public.is_admin()))
  WITH CHECK ((select public.is_admin()));

CREATE TRIGGER audit_partner_users
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_users
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('true', 'user_id', 'clid');

-- ── Funciones (patrón is_admin: SECURITY DEFINER, search_path fijado) ────────
-- is_partner()/my_clids() son authenticated-executable INTENCIONAL (devuelven un
-- boolean/array sobre el propio JWT/uid; revocar EXECUTE rompe RLS con 42501).
CREATE OR REPLACE FUNCTION public.is_partner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'partner', false);
$function$;
GRANT EXECUTE ON FUNCTION public.is_partner() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_partner() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.my_clids()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT coalesce(array_agg(pu.clid), ARRAY[]::text[])
  FROM public.partner_users pu
  WHERE pu.user_id = auth.uid();
$function$;
GRANT EXECUTE ON FUNCTION public.my_clids() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.my_clids() FROM PUBLIC, anon;

-- ── Tablas de HECHOS: internal (todo salvo partner) + partner (scoped) ───────
-- rendimiento
DROP POLICY IF EXISTS rendimiento_select_auth ON public.rendimiento;
CREATE POLICY rendimiento_select_internal ON public.rendimiento
  FOR SELECT TO authenticated USING (NOT (select public.is_partner()));
CREATE POLICY rendimiento_select_partner ON public.rendimiento
  FOR SELECT TO authenticated
  USING ((select public.is_partner()) AND clid = ANY (public.my_clids()));

-- rendimiento_mensual
DROP POLICY IF EXISTS rendimiento_mensual_select_auth ON public.rendimiento_mensual;
CREATE POLICY rendimiento_mensual_select_internal ON public.rendimiento_mensual
  FOR SELECT TO authenticated USING (NOT (select public.is_partner()));
CREATE POLICY rendimiento_mensual_select_partner ON public.rendimiento_mensual
  FOR SELECT TO authenticated
  USING ((select public.is_partner()) AND clid = ANY (public.my_clids()));

-- rendimiento_diario
DROP POLICY IF EXISTS rendimiento_diario_select_auth ON public.rendimiento_diario;
CREATE POLICY rendimiento_diario_select_internal ON public.rendimiento_diario
  FOR SELECT TO authenticated USING (NOT (select public.is_partner()));
CREATE POLICY rendimiento_diario_select_partner ON public.rendimiento_diario
  FOR SELECT TO authenticated
  USING ((select public.is_partner()) AND clid = ANY (public.my_clids()));

-- metas
DROP POLICY IF EXISTS metas_select_auth ON public.metas;
CREATE POLICY metas_select_internal ON public.metas
  FOR SELECT TO authenticated USING (NOT (select public.is_partner()));
CREATE POLICY metas_select_partner ON public.metas
  FOR SELECT TO authenticated
  USING ((select public.is_partner()) AND clid = ANY (public.my_clids()));

-- ── Tablas de METADATA (mapeo CLID→nombre/KAM): mismo split ──────────────────
-- Sin esto, un partner haría `select * from partners` y vería nombres/KAM de
-- TODOS los competidores. Es la fuga más fácil de olvidar.
DROP POLICY IF EXISTS partners_select_auth ON public.partners;
CREATE POLICY partners_select_internal ON public.partners
  FOR SELECT TO authenticated USING (NOT (select public.is_partner()));
CREATE POLICY partners_select_partner ON public.partners
  FOR SELECT TO authenticated
  USING ((select public.is_partner()) AND clid = ANY (public.my_clids()));

DROP POLICY IF EXISTS flotas_select_auth ON public.flotas;
CREATE POLICY flotas_select_internal ON public.flotas
  FOR SELECT TO authenticated USING (NOT (select public.is_partner()));
CREATE POLICY flotas_select_partner ON public.flotas
  FOR SELECT TO authenticated
  USING ((select public.is_partner()) AND clid = ANY (public.my_clids()));

DROP POLICY IF EXISTS fleetrooms_select_auth ON public.fleetrooms;
CREATE POLICY fleetrooms_select_internal ON public.fleetrooms
  FOR SELECT TO authenticated USING (NOT (select public.is_partner()));
CREATE POLICY fleetrooms_select_partner ON public.fleetrooms
  FOR SELECT TO authenticated
  USING ((select public.is_partner()) AND clid = ANY (public.my_clids()));

DROP POLICY IF EXISTS conversion_pais_select_auth ON public.conversion_pais;
CREATE POLICY conversion_pais_select_internal ON public.conversion_pais
  FOR SELECT TO authenticated USING (NOT (select public.is_partner()));
CREATE POLICY conversion_pais_select_partner ON public.conversion_pais
  FOR SELECT TO authenticated
  USING ((select public.is_partner()) AND clid = ANY (public.my_clids()));

-- ── Tablas que el partner NO debe ver: solo internal, sin política partner ───
-- (proyectos y seguimiento eran USING(true) → un partner las vería enteras).
DROP POLICY IF EXISTS proyectos_select_auth ON public.proyectos;
CREATE POLICY proyectos_select_internal ON public.proyectos
  FOR SELECT TO authenticated USING (NOT (select public.is_partner()));

DROP POLICY IF EXISTS seguimiento_select_auth ON public.seguimiento;
CREATE POLICY seguimiento_select_internal ON public.seguimiento
  FOR SELECT TO authenticated USING (NOT (select public.is_partner()));

-- ── Escritura del rol partner: NINGUNA ───────────────────────────────────────
-- No se agrega ninguna política de INSERT/UPDATE/DELETE para partner. RLS
-- deniega por defecto y las policies de escritura existentes gatean is_admin/
-- is_kam_or_admin/can → false para partner. Si algún día un partner escribe,
-- es OBLIGATORIO `WITH CHECK (clid = ANY (select my_clids()))` en INSERT Y
-- UPDATE, o podría escribir bajo el CLID de otro.

-- ── Rollout ──────────────────────────────────────────────────────────────────
-- 1) Crear/invitar el usuario en Supabase Auth (o via pantalla admin C1).
-- 2) Setear el rol:
--    UPDATE auth.users SET raw_app_meta_data =
--      coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('role','partner')
--    WHERE email = '...';
-- 3) Mapear su(s) CLID(s):
--    INSERT INTO public.partner_users (user_id, clid, created_by)
--    SELECT u.id, '400001234567', auth.uid() FROM auth.users u WHERE u.email='...';
-- 4) El partner debe RE-LOGUEAR (el rol se hornea en el JWT al emitirlo).
