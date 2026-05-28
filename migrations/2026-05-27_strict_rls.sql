-- ============================================================
-- 2026-05-27_strict_rls.sql
-- Sprint 0 - Endurecimiento RLS (resuelve hallazgo CRITICO C1)
-- ============================================================
--
-- LEER ANTES DE CORRER:
--   1. Esta migracion DROPea todas las policies actuales de las 7 tablas
--      del dashboard y las reemplaza por policies estrictas.
--   2. Modelo nuevo:
--        - SELECT  -> cualquier usuario autenticado puede LEER.
--        - INSERT/UPDATE/DELETE -> solo usuarios con app_metadata.role = 'admin'.
--        - Anonimos (sin login) -> SIN acceso (cierra el hueco de
--          rendimiento_diario que estaba abierto a "public").
--   3. La migracion promueve automaticamente al usuario
--        yango.hbexp@gmail.com  a role = 'admin'.
--      Si quieres otro admin tambien, repite el UPDATE final con su email.
--   4. Despues de correr la migracion DEBES cerrar sesion y volver a
--      entrar al dashboard para que tu JWT incluya la nueva claim.
--
-- Como correrla:  Supabase Dashboard -> SQL editor -> pegar todo -> RUN.
-- ============================================================

BEGIN;

-- ── Helper: is_admin() lee la claim del JWT ────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

REVOKE ALL    ON FUNCTION public.is_admin() FROM public;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ── Drop generico de policies viejas (idempotente) ─────────
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN (
         'partners','metas','rendimiento','rendimiento_mensual',
         'rendimiento_diario','flotas','proyectos'
       )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename
    );
  END LOOP;
END$$;

-- ── ENABLE RLS en las 7 tablas ─────────────────────────────
ALTER TABLE public.partners            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rendimiento         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rendimiento_mensual ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rendimiento_diario  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flotas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proyectos           ENABLE ROW LEVEL SECURITY;

-- ── SELECT: autenticado puede leer ─────────────────────────
CREATE POLICY partners_select_auth            ON public.partners            FOR SELECT TO authenticated USING (true);
CREATE POLICY metas_select_auth               ON public.metas               FOR SELECT TO authenticated USING (true);
CREATE POLICY rendimiento_select_auth         ON public.rendimiento         FOR SELECT TO authenticated USING (true);
CREATE POLICY rendimiento_mensual_select_auth ON public.rendimiento_mensual FOR SELECT TO authenticated USING (true);
CREATE POLICY rendimiento_diario_select_auth  ON public.rendimiento_diario  FOR SELECT TO authenticated USING (true);
CREATE POLICY flotas_select_auth              ON public.flotas              FOR SELECT TO authenticated USING (true);
CREATE POLICY proyectos_select_auth           ON public.proyectos           FOR SELECT TO authenticated USING (true);

-- ── INSERT: solo admin ─────────────────────────────────────
CREATE POLICY partners_admin_insert            ON public.partners            FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY metas_admin_insert               ON public.metas               FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY rendimiento_admin_insert         ON public.rendimiento         FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY rendimiento_mensual_admin_insert ON public.rendimiento_mensual FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY rendimiento_diario_admin_insert  ON public.rendimiento_diario  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY flotas_admin_insert              ON public.flotas              FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY proyectos_admin_insert           ON public.proyectos           FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- ── UPDATE: solo admin ─────────────────────────────────────
CREATE POLICY partners_admin_update            ON public.partners            FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY metas_admin_update               ON public.metas               FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY rendimiento_admin_update         ON public.rendimiento         FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY rendimiento_mensual_admin_update ON public.rendimiento_mensual FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY rendimiento_diario_admin_update  ON public.rendimiento_diario  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY flotas_admin_update              ON public.flotas              FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY proyectos_admin_update           ON public.proyectos           FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── DELETE: solo admin ─────────────────────────────────────
CREATE POLICY partners_admin_delete            ON public.partners            FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY metas_admin_delete               ON public.metas               FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY rendimiento_admin_delete         ON public.rendimiento         FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY rendimiento_mensual_admin_delete ON public.rendimiento_mensual FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY rendimiento_diario_admin_delete  ON public.rendimiento_diario  FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY flotas_admin_delete              ON public.flotas              FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY proyectos_admin_delete           ON public.proyectos           FOR DELETE TO authenticated USING (public.is_admin());

-- ── Bootstrap: promover tu usuario a admin ─────────────────
-- IMPORTANTE: si te cambias de email, edita la linea de abajo antes de correr.
UPDATE auth.users
   SET raw_app_meta_data =
         coalesce(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('role', 'admin')
 WHERE email = 'yango.hbexp@gmail.com';

COMMIT;

-- ── Verificacion (opcional, corre despues del COMMIT) ──────
-- 1. Confirma que tienes role=admin:
--    SELECT email, raw_app_meta_data->>'role' AS role
--      FROM auth.users
--     WHERE raw_app_meta_data ? 'role';
--
-- 2. Confirma las policies vigentes:
--    SELECT tablename, policyname, cmd, roles, qual, with_check
--      FROM pg_policies
--     WHERE schemaname = 'public'
--     ORDER BY tablename, cmd;
--
-- 3. Para promover a otro admin mas adelante:
--    UPDATE auth.users
--       SET raw_app_meta_data =
--             coalesce(raw_app_meta_data, '{}'::jsonb)
--             || jsonb_build_object('role', 'admin')
--     WHERE email = 'otro@correo.com';
