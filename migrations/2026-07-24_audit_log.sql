-- Trazabilidad: quién hace qué cambio en la BD, imposible de eludir desde el
-- cliente (auditar en JS es decorativo — con la anon key + un JWT se llama a
-- PostgREST directo sin pasar por el dashboard). Por eso el log lo escribe un
-- TRIGGER en Postgres, no una llamada desde data.js.
--
-- Diseño (ver plan de arquitectura, Track B1):
--   - Tablas de config/negocio sensible: old_data/new_data COMPLETOS (jsonb).
--   - Tablas de series (rendimiento*): solo row_key + acción + usuario (los
--     uploads pisan miles de filas idénticas por semana; loguear el diff de
--     ~55 columnas por fila no aporta y satura la tabla).
--   - Tamper-evident: SIN políticas INSERT/UPDATE/DELETE para NADIE, ni admin.
--     Solo escribe el trigger (SECURITY DEFINER, corre como owner postgres,
--     bypassa RLS). Si hay que reescribir la historia, no se puede vía API.

CREATE TABLE public.audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    uuid DEFAULT auth.uid(),
  user_email text,                    -- denormalizado: el cliente no puede joinear auth.users
  action     text NOT NULL,           -- INSERT | UPDATE | DELETE
  table_name text NOT NULL,
  row_key    text,                    -- clave natural legible (clid·city·fecha·db_id, etc.)
  old_data   jsonb,
  new_data   jsonb
);

CREATE INDEX audit_log_at_idx         ON public.audit_log (at DESC);
CREATE INDEX audit_log_table_name_idx ON public.audit_log (table_name);
CREATE INDEX audit_log_user_id_idx    ON public.audit_log (user_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_admin_select ON public.audit_log
  FOR SELECT TO authenticated
  USING ((select public.is_admin()));
-- Sin policies de INSERT/UPDATE/DELETE a propósito.

-- ── Función genérica de trigger ───────────────────────────────────────────────
-- full_columns=true → loguea old_data/new_data completos (tablas de config).
-- full_columns=false → solo row_key (tablas de series, evita inflar el log).
-- row_key se arma con las columnas indicadas en TG_ARGV a partir del índice 1.
CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  full_columns boolean := TG_ARGV[0]::boolean;
  key_cols     text[]  := TG_ARGV[1:array_length(TG_ARGV, 1)];
  rec          jsonb;
  key_parts    text[] := ARRAY[]::text[];
  col          text;
BEGIN
  rec := to_jsonb(COALESCE(NEW, OLD));
  FOREACH col IN ARRAY key_cols LOOP
    key_parts := key_parts || COALESCE(rec ->> col, '');
  END LOOP;

  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
    RETURN NEW;   -- no-op (upsert que no cambió nada) → no loguear ruido
  END IF;

  INSERT INTO public.audit_log (user_id, user_email, action, table_name, row_key, old_data, new_data)
  VALUES (
    auth.uid(),
    (auth.jwt() ->> 'email'),
    TG_OP,
    TG_TABLE_NAME,
    array_to_string(key_parts, '·'),
    CASE WHEN full_columns AND TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN full_columns AND TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_trigger() FROM PUBLIC;

-- ── Triggers: tablas de config/negocio sensible (full old/new) ───────────────
CREATE TRIGGER audit_partners
  AFTER INSERT OR UPDATE OR DELETE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('true', 'clid');

CREATE TRIGGER audit_flotas
  AFTER INSERT OR UPDATE OR DELETE ON public.flotas
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('true', 'clid');

CREATE TRIGGER audit_fleetrooms
  AFTER INSERT OR UPDATE OR DELETE ON public.fleetrooms
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('true', 'db_id');

CREATE TRIGGER audit_metas
  AFTER INSERT OR UPDATE OR DELETE ON public.metas
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('true', 'clid', 'city', 'mes');

CREATE TRIGGER audit_seguimiento
  AFTER INSERT OR UPDATE OR DELETE ON public.seguimiento
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('true', 'id');

CREATE TRIGGER audit_conversion_pais
  AFTER INSERT OR UPDATE OR DELETE ON public.conversion_pais
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('true', 'clid', 'mes');

CREATE TRIGGER audit_proyectos
  AFTER INSERT OR UPDATE OR DELETE ON public.proyectos
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('true', 'id');

-- ── Triggers: tablas de series (solo row_key, sin jsonb — evita inflar el log) ─
CREATE TRIGGER audit_rendimiento
  AFTER INSERT OR UPDATE OR DELETE ON public.rendimiento
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('false', 'clid', 'city', 'fecha', 'db_id');

CREATE TRIGGER audit_rendimiento_mensual
  AFTER INSERT OR UPDATE OR DELETE ON public.rendimiento_mensual
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('false', 'clid', 'city', 'mes', 'db_id');

CREATE TRIGGER audit_rendimiento_diario
  AFTER INSERT OR UPDATE OR DELETE ON public.rendimiento_diario
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger('false', 'clid', 'city', 'date', 'db_id');

-- ── Retención (a correr manualmente por un admin cuando haga falta) ──────────
-- DELETE FROM public.audit_log WHERE at < now() - interval '180 days';

-- ── Hardening aparte (advisor WARN ya detectado, incluido acá por prolijidad) ─
ALTER FUNCTION public._fleetrooms_touch() SET search_path = public;
