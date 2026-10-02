-- SEGURIDAD: leer exige un ROL EXPLÍCITO (2-oct-2026, aprobado por Manuel: "aplica lo
-- necesario para proteger la web y no haya brechas de seguridad").
--
-- El hallazgo: las políticas de lectura internas eran `NOT is_partner()`, así que una
-- cuenta SIN rol (app_metadata.role vacío) contaba como interna y leía TODO. Con el
-- registro público abierto (ya cerrado por Manuel el 2-oct), cualquiera podía crear
-- una cuenta y leer rendimiento, metas, partners… (verificado en producción).
-- Ahora, además de tener el registro cerrado (primera barrera), la base exige:
--   - interno = rol admin / kam / viewer  → is_internal()
--   - partner = rol partner Y solo sus CLIDs (my_clids())
--   - sin rol o rol desconocido → nada.
-- Aplica a las 10 políticas de lectura, a data_version, get_partner_kpi_summary,
-- portal_mercado y a la inserción en access_log.

CREATE OR REPLACE FUNCTION public.is_internal()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'kam', 'viewer'), false);
$$;
-- Igual que is_admin(): las políticas la evalúan como `authenticated`, así que ese rol
-- NECESITA EXECUTE (sin él, toda lectura da 42501). anon no.
REVOKE ALL ON FUNCTION public.is_internal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_internal() TO authenticated;

-- Tablas que el partner también lee (sus CLIDs).
ALTER POLICY conversion_pais_select ON public.conversion_pais USING ((SELECT public.is_internal()) OR ((SELECT public.is_partner()) AND clid = ANY (public.my_clids())));
ALTER POLICY fleetrooms_select ON public.fleetrooms USING ((SELECT public.is_internal()) OR ((SELECT public.is_partner()) AND clid = ANY (public.my_clids())));
ALTER POLICY flotas_select ON public.flotas USING ((SELECT public.is_internal()) OR ((SELECT public.is_partner()) AND clid = ANY (public.my_clids())));
ALTER POLICY metas_select ON public.metas USING ((SELECT public.is_internal()) OR ((SELECT public.is_partner()) AND clid = ANY (public.my_clids())));
ALTER POLICY partner_logos_select ON public.partner_logos USING ((SELECT public.is_internal()) OR ((SELECT public.is_partner()) AND clid = ANY (public.my_clids())));
ALTER POLICY partners_select ON public.partners USING ((SELECT public.is_internal()) OR ((SELECT public.is_partner()) AND clid = ANY (public.my_clids())));

-- Tablas solo internas (el partner lee rendimiento por portal_rendimiento*()).
ALTER POLICY proyectos_select_internal ON public.proyectos USING ((SELECT public.is_internal()));
ALTER POLICY rendimiento_select ON public.rendimiento USING ((SELECT public.is_internal()));
ALTER POLICY rendimiento_mensual_select ON public.rendimiento_mensual USING ((SELECT public.is_internal()));
ALTER POLICY rendimiento_diario_select ON public.rendimiento_diario USING ((SELECT public.is_internal()));
ALTER POLICY seguimiento_select_internal ON public.seguimiento USING ((SELECT public.is_internal()));

-- Telemetría: solo quien tiene un rol registra sus propios eventos.
ALTER POLICY access_log_insert_own ON public.access_log
  WITH CHECK (user_id = (SELECT auth.uid()) AND ((SELECT public.is_internal()) OR (SELECT public.is_partner())));

-- data_version: solo internos (antes: todo el que no fuera partner).
CREATE OR REPLACE FUNCTION public.data_version()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN NOT public.is_internal() THEN NULL ELSE jsonb_build_object(
    'tablas', COALESCE((
      SELECT jsonb_object_agg(table_name, jsonb_build_array(n, at))
        FROM (SELECT table_name, count(*) AS n, max(at) AS at
                FROM public.audit_log
               WHERE table_name = ANY (ARRAY[
                 'rendimiento', 'rendimiento_mensual', 'rendimiento_diario', 'partner_users',
                 'partners', 'fleetrooms', 'flotas', 'metas', 'proyectos', 'seguimiento', 'conversion_pais'])
               GROUP BY table_name) s
    ), '{}'::jsonb),
    'ingesta', COALESCE((
      SELECT jsonb_object_agg(scale, at)
        FROM (SELECT scale, max(at) AS at FROM public.ingest_log WHERE status = 'ok' GROUP BY scale) i
    ), '{}'::jsonb)
  ) END;
$function$;

-- get_partner_kpi_summary: internos todo; partner sus CLIDs; sin rol nada.
CREATE OR REPLACE FUNCTION public.get_partner_kpi_summary(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
RETURNS TABLE(clid text, total_trips numeric, max_active_drivers numeric, total_supply_hours numeric, total_gmv numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT r.clid,
         COALESCE(SUM(r.trips), 0), COALESCE(MAX(r.active_drivers), 0),
         COALESCE(SUM(r.supply_hours), 0), COALESCE(SUM(r.gmv), 0)
    FROM public.rendimiento r
   WHERE (p_start_date IS NULL OR r.fecha >= p_start_date)
     AND (p_end_date IS NULL OR r.fecha <= p_end_date)
     AND ((SELECT public.is_internal()) OR ((SELECT public.is_partner()) AND r.clid = ANY (public.my_clids())))
   GROUP BY r.clid;
$function$;

-- get_last_ingest_at: solo con rol (devuelve NULL sin rol).
CREATE OR REPLACE FUNCTION public.get_last_ingest_at()
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN (SELECT public.is_internal()) OR (SELECT public.is_partner())
              THEN (SELECT max(at) FROM public.ingest_log WHERE status = 'ok') END;
$function$;

-- portal_mercado: igual que antes + solo internos o partners.
DROP FUNCTION IF EXISTS public.portal_mercado(text, text, text, text);
CREATE FUNCTION public.portal_mercado(scale text, desde text, hasta text, ciudad text DEFAULT NULL)
RETURNS TABLE (metrica text, tu numeric, mediana numeric, p25 numeric, p75 numeric, n integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  tabla text; colp text; nuevos text; n50 text; mios text[];
BEGIN
  IF scale = 'semanal' THEN tabla := 'rendimiento'; colp := 'fecha::text'; nuevos := 'coalesce(new_from_partner,0)+coalesce(new_from_service,0)';
  ELSIF scale = 'mensual' THEN tabla := 'rendimiento_mensual'; colp := 'mes'; nuevos := 'coalesce(new_from_partner,0)+coalesce(new_from_service,0)';
  ELSIF scale = 'diario' THEN tabla := 'rendimiento_diario'; colp := 'date::text'; nuevos := 'coalesce(new_partner,0)+coalesce(new_service,0)';
  ELSE RAISE EXCEPTION 'escala invalida: %', scale; END IF;
  n50 := 'coalesce(new_from_partner_50t,0)+coalesce(new_from_service_50t,0)';
  -- Solo internos o partners: una cuenta sin rol no recibe ni los agregados del mercado.
  IF NOT ((SELECT public.is_internal()) OR (SELECT public.is_partner())) THEN RETURN; END IF;
  mios := CASE WHEN (SELECT public.is_partner()) THEN public.my_clids() ELSE ARRAY[]::text[] END;

  RETURN QUERY EXECUTE format($q$
    WITH filas AS (
      SELECT r.clid, %1$s AS per, r.active_drivers ad, (%2$s) nue, r.reactivated rea, (%3$s) n50,
             r.supply_hours sh, r.trips tr, r.gmv, r.acceptance_rate acc, r.completion_rate com, r.driver_support_requests_share sop
        FROM public.%4$I r
        LEFT JOIN public.fleetrooms f ON f.db_id = r.db_id
       WHERE %1$s >= $1 AND %1$s <= $2
         AND ($3 IS NULL OR upper(trim(r.city)) = upper(trim($3)))
         AND NOT coalesce(f.is_delivery OR f.is_cargo OR f.exclude_from_taxi, false)
    ),
    porper AS (
      SELECT clid, per, sum(ad) ad, sum(nue) nue, sum(rea) rea, sum(sh) sh
        FROM filas GROUP BY clid, per
    ),
    ult AS (
      SELECT clid, per, ad, nue, rea, sh, row_number() OVER (PARTITION BY clid ORDER BY per DESC) k
        FROM porper
    ),
    tot AS (
      SELECT clid, sum(nue) nue, sum(rea) rea, sum(n50) n50, sum(sh) sh, sum(tr) tr, sum(gmv) gmv,
             sum(acc*tr) FILTER (WHERE acc IS NOT NULL) acc_n, sum(tr) FILTER (WHERE acc IS NOT NULL) acc_d,
             sum(com*tr) FILTER (WHERE com IS NOT NULL) com_n, sum(tr) FILTER (WHERE com IS NOT NULL) com_d,
             sum(sop*tr) FILTER (WHERE sop IS NOT NULL) sop_n, sum(tr) FILTER (WHERE sop IS NOT NULL) sop_d
        FROM filas GROUP BY clid
    ),
    porpartner AS (
      SELECT t.clid, u1.ad ad_ult,
        CASE WHEN u2.ad > 0 THEN (u1.ad - u1.nue - u1.rea) / u2.ad END retencion,
        CASE WHEN t.nue + t.rea > 0 THEN t.rea / (t.nue + t.rea) END pct_react,
        CASE WHEN t.nue > 0 AND t.n50 > 0 THEN t.n50 / t.nue END a50,
        CASE WHEN u1.ad > 0 THEN u1.sh / u1.ad END hpc,
        CASE WHEN t.sh > 0 THEN t.tr / t.sh END vph,
        CASE WHEN t.sh > 0 THEN t.gmv / t.sh END iph,
        CASE WHEN t.acc_d > 0 THEN t.acc_n / t.acc_d END aceptacion,
        CASE WHEN t.com_d > 0 THEN t.com_n / t.com_d END completados,
        CASE WHEN t.sop_d > 0 THEN t.sop_n / t.sop_d END soporte
      FROM tot t
      JOIN ult u1 ON u1.clid = t.clid AND u1.k = 1
      LEFT JOIN ult u2 ON u2.clid = t.clid AND u2.k = 2
    ),
    -- "tu": los CLIDs de quien llama SUMADOS como un solo partner (misma fórmula).
    yo_per AS (SELECT per, sum(ad) ad, sum(nue) nue, sum(rea) rea, sum(sh) sh FROM porper WHERE clid = ANY($4) GROUP BY per),
    yo_u AS (SELECT *, row_number() OVER (ORDER BY per DESC) k FROM yo_per),
    yo_t AS (SELECT sum(nue) nue, sum(rea) rea, sum(n50) n50, sum(sh) sh, sum(tr) tr, sum(gmv) gmv,
               sum(acc*tr) FILTER (WHERE acc IS NOT NULL) acc_n, sum(tr) FILTER (WHERE acc IS NOT NULL) acc_d,
               sum(com*tr) FILTER (WHERE com IS NOT NULL) com_n, sum(tr) FILTER (WHERE com IS NOT NULL) com_d,
               sum(sop*tr) FILTER (WHERE sop IS NOT NULL) sop_n, sum(tr) FILTER (WHERE sop IS NOT NULL) sop_d
             FROM filas WHERE clid = ANY($4)),
    yo AS (
      SELECT
        CASE WHEN u2.ad > 0 THEN (u1.ad - u1.nue - u1.rea) / u2.ad END retencion,
        CASE WHEN t.nue + t.rea > 0 THEN t.rea / (t.nue + t.rea) END pct_react,
        CASE WHEN t.nue > 0 AND t.n50 > 0 THEN t.n50 / t.nue END a50,
        CASE WHEN u1.ad > 0 THEN u1.sh / u1.ad END hpc,
        CASE WHEN t.sh > 0 THEN t.tr / t.sh END vph,
        CASE WHEN t.sh > 0 THEN t.gmv / t.sh END iph,
        CASE WHEN t.acc_d > 0 THEN t.acc_n / t.acc_d END aceptacion,
        CASE WHEN t.com_d > 0 THEN t.com_n / t.com_d END completados,
        CASE WHEN t.sop_d > 0 THEN t.sop_n / t.sop_d END soporte
      FROM yo_t t LEFT JOIN yo_u u1 ON u1.k = 1 LEFT JOIN yo_u u2 ON u2.k = 2
    ),
    largo AS (
      SELECT m.metrica, m.v FROM porpartner p
      CROSS JOIN LATERAL (VALUES ('retencion', p.retencion), ('pct_react', p.pct_react), ('a50', p.a50), ('hpc', p.hpc),
        ('vph', p.vph), ('iph', p.iph), ('aceptacion', p.aceptacion), ('completados', p.completados), ('soporte', p.soporte)) m(metrica, v)
      WHERE p.ad_ult >= 20 AND m.v IS NOT NULL AND NOT ($5 = 'diario' AND m.metrica = 'retencion')
    ),
    agg AS (
      SELECT l.metrica, count(*)::int n, percentile_cont(0.5) WITHIN GROUP (ORDER BY l.v) prom,
             percentile_cont(0.25) WITHIN GROUP (ORDER BY l.v) q1, percentile_cont(0.75) WITHIN GROUP (ORDER BY l.v) q3
        FROM largo l GROUP BY l.metrica
    ),
    yo_largo AS (
      SELECT m.metrica, m.v FROM yo
      CROSS JOIN LATERAL (VALUES ('retencion', yo.retencion), ('pct_react', yo.pct_react), ('a50', yo.a50), ('hpc', yo.hpc),
        ('vph', yo.vph), ('iph', yo.iph), ('aceptacion', yo.aceptacion), ('completados', yo.completados), ('soporte', yo.soporte)) m(metrica, v)
    )
    SELECT k.metrica,
           y.v::numeric,
           CASE WHEN a.n >= 5  THEN a.prom::numeric END,
           CASE WHEN a.n >= 10 THEN a.q1::numeric END,
           CASE WHEN a.n >= 10 THEN a.q3::numeric END,
           coalesce(a.n, 0)
      FROM (VALUES ('retencion'), ('pct_react'), ('a50'), ('hpc'), ('vph'), ('iph'), ('aceptacion'), ('completados'), ('soporte')) k(metrica)
      LEFT JOIN agg a ON a.metrica = k.metrica
      LEFT JOIN yo_largo y ON y.metrica = k.metrica AND NOT ($5 = 'diario' AND k.metrica = 'retencion')
  $q$, colp, nuevos, n50, tabla)
  USING desde, hasta, ciudad, mios, scale;
END;
$fn$;

REVOKE ALL ON FUNCTION public.portal_mercado(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_mercado(text, text, text, text) TO authenticated;
