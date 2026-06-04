-- ============================================================
-- 2026-06-02_advisors_a1_a2.sql
-- Sprint 1 - Cierre de advisors de seguridad A1 + A2
-- ============================================================
--
-- Contexto: tras el Sprint 0 (RLS estricto), el linter de Supabase
-- (Database Advisors) reporto WARN de seguridad sobre funciones:
--
--   A1) is_admin() es ejecutable como RPC directo por los roles
--       `anon` y `authenticated` (lints 0028 y 0029).
--       Riesgo: cualquiera con el anon key puede hacer
--       POST /rest/v1/rpc/is_admin. No filtra datos (solo devuelve un
--       booleano sobre el propio JWT), pero es superficie innecesaria.
--       Fix: revocar EXECUTE. Las 28 policies NO se rompen porque
--       is_admin() es SECURITY DEFINER y dentro de las policies corre
--       como su owner, no como el rol que consulta. El frontend nunca
--       llama is_admin() por RPC (lee el rol del JWT app_metadata).
--
--   A2) _flotas_touch_actualizado() (trigger de flotas) no tiene
--       search_path fijo (lint 0011 function_search_path_mutable).
--       Fix: fijar search_path = '' (vacio). El cuerpo solo hace
--       NEW.actualizado_en = NOW() y RETURN NEW; NOW() vive en pg_catalog,
--       asi que no necesita ningun schema en el path.
--
-- Verificado en vivo (workflow de 3 agentes) antes de aplicar:
--   - 0 call sites de is_admin() por RPC en el frontend.
--   - Revocar EXECUTE no rompe la evaluacion RLS (docs Supabase + lints).
--   - search_path='' no rompe ninguna de las dos funciones.
--
-- NOTA: NO se revoca de `service_role` (rol backend, key secreta, no es
--       superficie publica) ni se toca el search_path de is_admin (ya
--       tiene search_path=public, por eso 0011 no lo marca).
--
-- Como correrla:  Supabase Dashboard -> SQL editor -> pegar todo -> RUN.
--                 (aplicada via MCP apply_migration el 2026-06-02)
-- ============================================================

BEGIN;

-- ── A1: cerrar superficie RPC directa de is_admin() ────────
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated, public;

-- ── A2: fijar search_path del trigger de flotas ────────────
ALTER FUNCTION public._flotas_touch_actualizado() SET search_path = '';

COMMIT;

-- ── Verificacion (opcional, corre despues del COMMIT) ──────
-- 1. ACL y search_path de ambas funciones:
--    SELECT proname, prosecdef, proacl::text, proconfig
--      FROM pg_proc
--     WHERE pronamespace = 'public'::regnamespace
--       AND proname IN ('is_admin','_flotas_touch_actualizado');
--    -> is_admin ya NO debe listar anon ni authenticated con =X
--    -> _flotas_touch_actualizado debe mostrar proconfig {search_path=}
--
-- 2. Re-correr el linter:  Dashboard -> Advisors -> Security
--    -> deben desaparecer los lints 0011, 0028 y 0029.
