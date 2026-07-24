-- Permisos granulares POR USUARIO, aditivos sobre el rol base (Track B2).
--
-- El rol JWT (admin/kam/viewer) sigue siendo el mecanismo base intacto. Esta
-- capa agrega grants puntuales por usuario para excepciones SIN duplicar el
-- sistema de roles: un viewer específico puede recibir 'write:metas' sin
-- promoverlo a kam; el borrado masivo deja de ser admin-only hardcodeado.
--
-- REGLA DE ORO: los permisos solo SUMAN, nunca restan. Toda política queda como
-- `<condición existente> OR can('...')`. Para RESTRINGIR a alguien se lo baja de
-- rol (kam→viewer) y se le otorgan grants puntuales — nunca lógica de deny (la
-- fuente clásica de bugs de autorización).
--
-- Taxonomía de permisos (atada a lo que hace cada tabla):
--   write:performance → rendimiento / rendimiento_mensual / rendimiento_diario
--   write:metas       → metas
--   write:config      → partners / flotas / fleetrooms / conversion_pais
--   write:seguimiento → seguimiento
--   delete:data       → borrado masivo (rendimiento* / metas)
--   manage:users      → capability para la pantalla admin de usuarios (C1); sin
--                       política de tabla todavía, la lee el cliente.

CREATE TABLE public.user_permissions (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- Admin gestiona todo.
CREATE POLICY user_permissions_admin_all ON public.user_permissions
  FOR ALL TO authenticated
  USING ((select public.is_admin()))
  WITH CHECK ((select public.is_admin()));

-- Cada usuario puede LEER solo sus propias filas (para que la UI sepa qué
-- mostrarle). No puede leer los grants de otros ni escribir los suyos.
CREATE POLICY user_permissions_self_select ON public.user_permissions
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- Auditoría (trigger genérico de B1, full old/new — es tabla sensible).
CREATE TRIGGER audit_user_permissions
  AFTER INSERT OR UPDATE OR DELETE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('true', 'user_id', 'permission');

-- ── Función can(perm) ─────────────────────────────────────────────────────────
-- Mismo patrón que is_admin()/is_kam_or_admin(): SECURITY DEFINER, search_path
-- fijado, EXECUTE solo para authenticated (las policies la invocan). Admin
-- siempre puede todo. NOTA: el advisor la marcará como "authenticated puede
-- ejecutar SECURITY DEFINER" — es INTENCIONAL y REQUERIDO (devuelve un boolean
-- sobre el propio JWT/uid, no filtra datos; revocar EXECUTE rompe RLS con 42501,
-- igual que is_admin — ver memoria del proyecto).
CREATE OR REPLACE FUNCTION public.can(perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT (select public.is_admin())
      OR EXISTS (
        SELECT 1 FROM public.user_permissions
        WHERE user_id = auth.uid() AND permission = perm
      );
$function$;

GRANT EXECUTE ON FUNCTION public.can(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can(text) FROM PUBLIC, anon;

-- ── Políticas de escritura: <existente> OR can('...') ────────────────────────
-- rendimiento / rendimiento_mensual / rendimiento_diario  (write:performance)
DROP POLICY IF EXISTS rendimiento_admin_insert ON public.rendimiento;
CREATE POLICY rendimiento_admin_insert ON public.rendimiento
  FOR INSERT TO authenticated WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:performance')));
DROP POLICY IF EXISTS rendimiento_admin_update ON public.rendimiento;
CREATE POLICY rendimiento_admin_update ON public.rendimiento
  FOR UPDATE TO authenticated USING (public.is_kam_or_admin() OR (select public.can('write:performance')))
                              WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:performance')));
DROP POLICY IF EXISTS rendimiento_admin_delete ON public.rendimiento;
CREATE POLICY rendimiento_admin_delete ON public.rendimiento
  FOR DELETE TO authenticated USING (public.is_admin() OR (select public.can('delete:data')));

DROP POLICY IF EXISTS rendimiento_mensual_admin_insert ON public.rendimiento_mensual;
CREATE POLICY rendimiento_mensual_admin_insert ON public.rendimiento_mensual
  FOR INSERT TO authenticated WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:performance')));
DROP POLICY IF EXISTS rendimiento_mensual_admin_update ON public.rendimiento_mensual;
CREATE POLICY rendimiento_mensual_admin_update ON public.rendimiento_mensual
  FOR UPDATE TO authenticated USING (public.is_kam_or_admin() OR (select public.can('write:performance')))
                              WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:performance')));
DROP POLICY IF EXISTS rendimiento_mensual_admin_delete ON public.rendimiento_mensual;
CREATE POLICY rendimiento_mensual_admin_delete ON public.rendimiento_mensual
  FOR DELETE TO authenticated USING (public.is_admin() OR (select public.can('delete:data')));

DROP POLICY IF EXISTS rendimiento_diario_admin_insert ON public.rendimiento_diario;
CREATE POLICY rendimiento_diario_admin_insert ON public.rendimiento_diario
  FOR INSERT TO authenticated WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:performance')));
DROP POLICY IF EXISTS rendimiento_diario_admin_update ON public.rendimiento_diario;
CREATE POLICY rendimiento_diario_admin_update ON public.rendimiento_diario
  FOR UPDATE TO authenticated USING (public.is_kam_or_admin() OR (select public.can('write:performance')))
                              WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:performance')));
DROP POLICY IF EXISTS rendimiento_diario_admin_delete ON public.rendimiento_diario;
CREATE POLICY rendimiento_diario_admin_delete ON public.rendimiento_diario
  FOR DELETE TO authenticated USING (public.is_admin() OR (select public.can('delete:data')));

-- metas  (write:metas + delete:data)
DROP POLICY IF EXISTS metas_admin_insert ON public.metas;
CREATE POLICY metas_admin_insert ON public.metas
  FOR INSERT TO authenticated WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:metas')));
DROP POLICY IF EXISTS metas_admin_update ON public.metas;
CREATE POLICY metas_admin_update ON public.metas
  FOR UPDATE TO authenticated USING (public.is_kam_or_admin() OR (select public.can('write:metas')))
                              WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:metas')));
DROP POLICY IF EXISTS metas_admin_delete ON public.metas;
CREATE POLICY metas_admin_delete ON public.metas
  FOR DELETE TO authenticated USING (public.is_admin() OR (select public.can('delete:data')));

-- partners / flotas / conversion_pais  (write:config, INSERT/UPDATE ya eran kam)
DROP POLICY IF EXISTS partners_admin_insert ON public.partners;
CREATE POLICY partners_admin_insert ON public.partners
  FOR INSERT TO authenticated WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:config')));
DROP POLICY IF EXISTS partners_admin_update ON public.partners;
CREATE POLICY partners_admin_update ON public.partners
  FOR UPDATE TO authenticated USING (public.is_kam_or_admin() OR (select public.can('write:config')))
                              WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:config')));

DROP POLICY IF EXISTS flotas_admin_insert ON public.flotas;
CREATE POLICY flotas_admin_insert ON public.flotas
  FOR INSERT TO authenticated WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:config')));
DROP POLICY IF EXISTS flotas_admin_update ON public.flotas;
CREATE POLICY flotas_admin_update ON public.flotas
  FOR UPDATE TO authenticated USING (public.is_kam_or_admin() OR (select public.can('write:config')))
                              WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:config')));

DROP POLICY IF EXISTS conversion_pais_admin_insert ON public.conversion_pais;
CREATE POLICY conversion_pais_admin_insert ON public.conversion_pais
  FOR INSERT TO authenticated WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:config')));
DROP POLICY IF EXISTS conversion_pais_admin_update ON public.conversion_pais;
CREATE POLICY conversion_pais_admin_update ON public.conversion_pais
  FOR UPDATE TO authenticated USING (public.is_kam_or_admin() OR (select public.can('write:config')))
                              WITH CHECK (public.is_kam_or_admin() OR (select public.can('write:config')));

-- fleetrooms  (write:config; INSERT/UPDATE eran admin-only)
DROP POLICY IF EXISTS fleetrooms_admin_insert ON public.fleetrooms;
CREATE POLICY fleetrooms_admin_insert ON public.fleetrooms
  FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR (select public.can('write:config')));
DROP POLICY IF EXISTS fleetrooms_admin_update ON public.fleetrooms;
CREATE POLICY fleetrooms_admin_update ON public.fleetrooms
  FOR UPDATE TO authenticated USING (public.is_admin() OR (select public.can('write:config')))
                              WITH CHECK (public.is_admin() OR (select public.can('write:config')));

-- seguimiento  (write:seguimiento; era admin-only)
DROP POLICY IF EXISTS seguimiento_admin_insert ON public.seguimiento;
CREATE POLICY seguimiento_admin_insert ON public.seguimiento
  FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR (select public.can('write:seguimiento')));
DROP POLICY IF EXISTS seguimiento_admin_update ON public.seguimiento;
CREATE POLICY seguimiento_admin_update ON public.seguimiento
  FOR UPDATE TO authenticated USING (public.is_admin() OR (select public.can('write:seguimiento')))
                              WITH CHECK (public.is_admin() OR (select public.can('write:seguimiento')));
DROP POLICY IF EXISTS seguimiento_admin_delete ON public.seguimiento;
CREATE POLICY seguimiento_admin_delete ON public.seguimiento
  FOR DELETE TO authenticated USING (public.is_admin() OR (select public.can('write:seguimiento')));

-- ── Rollout (a mano por un admin, hasta que exista la pantalla C1) ───────────
-- Otorgar un permiso puntual a un usuario ya existente en Supabase Auth:
--   INSERT INTO public.user_permissions (user_id, permission, granted_by)
--   SELECT u.id, 'write:metas', auth.uid()
--     FROM auth.users u WHERE u.email = '...@...';
-- Revocar:  DELETE FROM public.user_permissions
--             WHERE user_id = (SELECT id FROM auth.users WHERE email='...')
--               AND permission = 'write:metas';
