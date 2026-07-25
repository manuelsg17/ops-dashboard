-- Fusiona políticas SELECT permisivas duplicadas (advisor de performance de
-- Supabase: "multiple permissive policies"). El diseño de B4 (portal de
-- partners) necesitó partir el SELECT en _select_internal (NOT is_partner())
-- + _select_partner (is_partner() AND clid=ANY(my_clids())) porque las
-- políticas permissive se OR-ean y una sola política con USING(true) para
-- todos + otra scoped no alcanzaba. Efecto secundario no buscado: Postgres
-- evalúa AMBAS políticas en CADA SELECT, incluso para admin/kam (que jamás
-- matchean la de partner) — overhead en el 100% de las queries del dashboard
-- interno, que hoy es prácticamente todo el tráfico.
--
-- Fix: mismo predicado final, fusionado en UNA sola política por tabla
-- (NOT is_partner() OR clid = ANY(my_clids())) — cero cambio de semántica,
-- kill-switch y scoping intactos (re-testeado a nivel SQL tras aplicar).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'partners','flotas','fleetrooms','metas',
    'rendimiento','rendimiento_diario','rendimiento_mensual','conversion_pais'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_internal', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_partner', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated ' ||
      'USING ((NOT (select public.is_partner())) OR (clid = ANY (public.my_clids())))',
      t || '_select', t
    );
  END LOOP;
END $$;

-- user_permissions: el FOR ALL de admin se solapaba con el FOR SELECT propio
-- del usuario (2 políticas permisivas en SELECT). Se separa el FOR ALL en sus
-- 3 comandos de escritura (mismo alcance: solo admin) + se fusiona el SELECT
-- en una sola política.
DROP POLICY IF EXISTS user_permissions_admin_all   ON public.user_permissions;
DROP POLICY IF EXISTS user_permissions_self_select ON public.user_permissions;

CREATE POLICY user_permissions_select ON public.user_permissions
  FOR SELECT TO authenticated
  USING ((select public.is_admin()) OR user_id = (select auth.uid()));

CREATE POLICY user_permissions_admin_insert ON public.user_permissions
  FOR INSERT TO authenticated WITH CHECK ((select public.is_admin()));

CREATE POLICY user_permissions_admin_update ON public.user_permissions
  FOR UPDATE TO authenticated USING ((select public.is_admin()));

CREATE POLICY user_permissions_admin_delete ON public.user_permissions
  FOR DELETE TO authenticated USING ((select public.is_admin()));

-- Índices faltantes en foreign keys (advisor de performance): sin índice
-- propio, cualquier lookup/cascada por esa columna es Seq Scan. Tablas chicas
-- hoy (partner_users, user_permissions) pero de costo cero agregarlos ahora.
CREATE INDEX IF NOT EXISTS partner_users_clid_idx        ON public.partner_users (clid);
CREATE INDEX IF NOT EXISTS partner_users_created_by_idx  ON public.partner_users (created_by);
CREATE INDEX IF NOT EXISTS user_permissions_granted_by_idx ON public.user_permissions (granted_by);
