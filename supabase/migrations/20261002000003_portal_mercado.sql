-- Portal del partner, FASE 2: comparación con el mercado (2-oct-2026, aprobada por Manuel).
-- portal_mercado(scale, desde, hasta, ciudad) devuelve, por métrica, SOLO agregados:
--   tu        = el valor de quien llama (sus CLIDs; NULL si no es partner o no tiene datos)
--   mediana   = el valor del partner del medio (cada partner pesa 1). Mediana y no
--               promedio: con tasas, un partner atípico arrastra el promedio (en
--               los datos de prueba la retención "promedio" daba 101%).
--   p25 / p75 = "rango típico" (la mitad central de los partners)
--   n         = cuántos partners entran en la comparación
-- Reglas de privacidad:
--   - Solo TASAS. Nunca volúmenes del mercado, participación ni puesto.
--   - mediana solo con n >= 5; p25/p75 solo con n >= 10 (con pocos partners un
--     percentil cae justo sobre el valor exacto de UN partner).
--   - Entra un partner con >= 20 conductores activos en el último período del rango.
--   - Universo = Combinado (Taxi + TukTuk): sin subflotas Delivery/Cargo/excluidas.
-- SECURITY DEFINER (lee el mercado completo) pero solo devuelve esas filas.
-- Definiciones (iguales a las del portal):
--   retencion   = (AD último − nuevos último − reactivados último) / AD penúltimo
--                 (no en diario: de un día al siguiente no mide retención)
--   pct_react   = reactivados / (nuevos + reactivados), en el rango
--   a50         = nuevos que llegaron a 50 viajes / nuevos, en el rango (sin ningún
--                 registro de 50 viajes = la fuente no trae el dato: fuera, no 0)
--   hpc         = horas / AD, último período
--   vph         = viajes / horas, en el rango;  iph = GMV / horas, en el rango
--   aceptacion, completados, soporte = promedio ponderado por viajes, en el rango
--                                      (fila sin dato: fuera de numerador y denominador)

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
