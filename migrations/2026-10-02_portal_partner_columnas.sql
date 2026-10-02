-- Portal del partner: el partner lee SUS datos de rendimiento por funciones que
-- devuelven solo sus CLIDs y SIN las columnas internas (2-oct-2026).
-- Pedido de Manuel: el partner no debe ver datos que no sean suyos ni métricas
-- internas. Ocultar en pantalla no alcanza: la tabla llegaba completa al navegador
-- y con su sesión podía pedirla directo a la API. Ahora:
--   1. Las políticas de lectura de rendimiento / _mensual / _diario dejan de
--      incluir al partner (antes: NOT is_partner() OR clid = ANY(my_clids())).
--   2. portal_rendimiento(), portal_rendimiento_mensual(), portal_rendimiento_diario():
--      (RETURNS SETOF de un tipo con nombre: con RETURNS TABLE, PostgREST no puede
--      ordenar el resultado -> "column record.id does not exist").
--      SECURITY DEFINER, solo filas de my_clids() y solo si el rol es partner.
--      Columnas excluidas: kam, created_at, trips_share, supply_hours_share, commission_share, driver_subsidies_by_gmv, fraud_trips_share
--      (participación de mercado, subsidios y fraude: decisión de Manuel; kam:
--      interno). La app las consulta como /rest/v1/rpc/portal_rendimiento con los
--      mismos filtros, orden, paginación y conteo que una tabla.
--   3. dashboard_dates(scale) lee de esas funciones cuando quien llama es partner.
-- Internos (admin/kam/viewer) no cambian: siguen leyendo las tablas.

DROP FUNCTION IF EXISTS public.portal_rendimiento();
DROP TYPE IF EXISTS public.portal_rendimiento_fila;
CREATE TYPE public.portal_rendimiento_fila AS (
  id bigint,
  clid text,
  partner text,
  city text,
  fecha date,
  active_drivers numeric,
  new_from_partner numeric,
  new_from_service numeric,
  reactivated numeric,
  supply_hours numeric,
  commission numeric,
  trips numeric,
  gmv numeric,
  new_drivers numeric,
  new_from_partner_50t numeric,
  new_from_service_50t numeric,
  active_cars numeric,
  branded_active_cars numeric,
  owned_fleet_active_cars numeric,
  owned_fleet_branded_active_cars numeric,
  internal_fleet_sh numeric,
  external_fleet_sh numeric,
  new_profiles numeric,
  new_profiles_partner numeric,
  new_profiles_partner_50t numeric,
  new_profiles_service numeric,
  new_profiles_service_50t numeric,
  new_drivers_share numeric,
  acceptance_rate numeric,
  completion_rate numeric,
  trips_per_hour numeric,
  money_per_hour numeric,
  avg_driver_rating numeric,
  avg_fare_after_surge numeric,
  bad_rated_trips_share numeric,
  driver_support_requests_share numeric,
  internal_fleet_sh_share numeric,
  internal_fleet_sh_per_active_car numeric,
  sh_per_active_car numeric,
  sh_per_active_driver numeric,
  new_profiles_partner_reg1 numeric,
  new_profiles_partner_reg10 numeric,
  new_profiles_partner_reg50 numeric,
  new_profiles_partner_reg100 numeric,
  new_profiles_service_reg1 numeric,
  new_profiles_service_reg10 numeric,
  new_profiles_service_reg50 numeric,
  new_profiles_service_reg100 numeric,
  db_id text,
  fleetroom text
);
CREATE FUNCTION public.portal_rendimiento()
RETURNS SETOF public.portal_rendimiento_fila
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.clid, r.partner, r.city, r.fecha, r.active_drivers, r.new_from_partner, r.new_from_service, r.reactivated, r.supply_hours, r.commission, r.trips, r.gmv, r.new_drivers, r.new_from_partner_50t, r.new_from_service_50t, r.active_cars, r.branded_active_cars, r.owned_fleet_active_cars, r.owned_fleet_branded_active_cars, r.internal_fleet_sh, r.external_fleet_sh, r.new_profiles, r.new_profiles_partner, r.new_profiles_partner_50t, r.new_profiles_service, r.new_profiles_service_50t, r.new_drivers_share, r.acceptance_rate, r.completion_rate, r.trips_per_hour, r.money_per_hour, r.avg_driver_rating, r.avg_fare_after_surge, r.bad_rated_trips_share, r.driver_support_requests_share, r.internal_fleet_sh_share, r.internal_fleet_sh_per_active_car, r.sh_per_active_car, r.sh_per_active_driver, r.new_profiles_partner_reg1, r.new_profiles_partner_reg10, r.new_profiles_partner_reg50, r.new_profiles_partner_reg100, r.new_profiles_service_reg1, r.new_profiles_service_reg10, r.new_profiles_service_reg50, r.new_profiles_service_reg100, r.db_id, r.fleetroom
    FROM public.rendimiento r
   WHERE (SELECT public.is_partner())
     AND r.clid = ANY (public.my_clids());
$$;
REVOKE ALL ON FUNCTION public.portal_rendimiento() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_rendimiento() TO authenticated;

ALTER POLICY rendimiento_select ON public.rendimiento USING (NOT (SELECT public.is_partner()));

DROP FUNCTION IF EXISTS public.portal_rendimiento_mensual();
DROP TYPE IF EXISTS public.portal_rendimiento_mensual_fila;
CREATE TYPE public.portal_rendimiento_mensual_fila AS (
  id bigint,
  clid text,
  partner text,
  city text,
  mes text,
  active_drivers numeric,
  new_from_partner numeric,
  new_from_service numeric,
  reactivated numeric,
  supply_hours numeric,
  commission numeric,
  trips numeric,
  gmv numeric,
  new_drivers numeric,
  new_from_partner_50t numeric,
  new_from_service_50t numeric,
  active_cars numeric,
  branded_active_cars numeric,
  owned_fleet_active_cars numeric,
  owned_fleet_branded_active_cars numeric,
  internal_fleet_sh numeric,
  external_fleet_sh numeric,
  new_profiles numeric,
  new_profiles_partner numeric,
  new_profiles_partner_50t numeric,
  new_profiles_service numeric,
  new_profiles_service_50t numeric,
  new_drivers_share numeric,
  acceptance_rate numeric,
  completion_rate numeric,
  trips_per_hour numeric,
  money_per_hour numeric,
  avg_driver_rating numeric,
  avg_fare_after_surge numeric,
  bad_rated_trips_share numeric,
  driver_support_requests_share numeric,
  internal_fleet_sh_share numeric,
  internal_fleet_sh_per_active_car numeric,
  sh_per_active_car numeric,
  sh_per_active_driver numeric,
  new_profiles_partner_reg1 numeric,
  new_profiles_partner_reg10 numeric,
  new_profiles_partner_reg50 numeric,
  new_profiles_partner_reg100 numeric,
  new_profiles_service_reg1 numeric,
  new_profiles_service_reg10 numeric,
  new_profiles_service_reg50 numeric,
  new_profiles_service_reg100 numeric,
  db_id text,
  fleetroom text
);
CREATE FUNCTION public.portal_rendimiento_mensual()
RETURNS SETOF public.portal_rendimiento_mensual_fila
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.clid, r.partner, r.city, r.mes, r.active_drivers, r.new_from_partner, r.new_from_service, r.reactivated, r.supply_hours, r.commission, r.trips, r.gmv, r.new_drivers, r.new_from_partner_50t, r.new_from_service_50t, r.active_cars, r.branded_active_cars, r.owned_fleet_active_cars, r.owned_fleet_branded_active_cars, r.internal_fleet_sh, r.external_fleet_sh, r.new_profiles, r.new_profiles_partner, r.new_profiles_partner_50t, r.new_profiles_service, r.new_profiles_service_50t, r.new_drivers_share, r.acceptance_rate, r.completion_rate, r.trips_per_hour, r.money_per_hour, r.avg_driver_rating, r.avg_fare_after_surge, r.bad_rated_trips_share, r.driver_support_requests_share, r.internal_fleet_sh_share, r.internal_fleet_sh_per_active_car, r.sh_per_active_car, r.sh_per_active_driver, r.new_profiles_partner_reg1, r.new_profiles_partner_reg10, r.new_profiles_partner_reg50, r.new_profiles_partner_reg100, r.new_profiles_service_reg1, r.new_profiles_service_reg10, r.new_profiles_service_reg50, r.new_profiles_service_reg100, r.db_id, r.fleetroom
    FROM public.rendimiento_mensual r
   WHERE (SELECT public.is_partner())
     AND r.clid = ANY (public.my_clids());
$$;
REVOKE ALL ON FUNCTION public.portal_rendimiento_mensual() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_rendimiento_mensual() TO authenticated;

ALTER POLICY rendimiento_mensual_select ON public.rendimiento_mensual USING (NOT (SELECT public.is_partner()));

DROP FUNCTION IF EXISTS public.portal_rendimiento_diario();
DROP TYPE IF EXISTS public.portal_rendimiento_diario_fila;
CREATE TYPE public.portal_rendimiento_diario_fila AS (
  id bigint,
  clid text,
  city text,
  date date,
  active_drivers numeric,
  new_partner numeric,
  new_service numeric,
  reactivated numeric,
  supply_hours numeric,
  commission numeric,
  trips numeric,
  gmv numeric,
  new_drivers numeric,
  new_from_partner_50t numeric,
  new_from_service_50t numeric,
  active_cars numeric,
  branded_active_cars numeric,
  owned_fleet_active_cars numeric,
  owned_fleet_branded_active_cars numeric,
  internal_fleet_sh numeric,
  external_fleet_sh numeric,
  new_profiles numeric,
  new_profiles_partner numeric,
  new_profiles_partner_50t numeric,
  new_profiles_service numeric,
  new_profiles_service_50t numeric,
  new_drivers_share numeric,
  acceptance_rate numeric,
  completion_rate numeric,
  trips_per_hour numeric,
  money_per_hour numeric,
  avg_driver_rating numeric,
  avg_fare_after_surge numeric,
  bad_rated_trips_share numeric,
  driver_support_requests_share numeric,
  internal_fleet_sh_share numeric,
  internal_fleet_sh_per_active_car numeric,
  sh_per_active_car numeric,
  sh_per_active_driver numeric,
  new_profiles_partner_reg1 numeric,
  new_profiles_partner_reg10 numeric,
  new_profiles_partner_reg50 numeric,
  new_profiles_partner_reg100 numeric,
  new_profiles_service_reg1 numeric,
  new_profiles_service_reg10 numeric,
  new_profiles_service_reg50 numeric,
  new_profiles_service_reg100 numeric,
  db_id text,
  fleetroom text
);
CREATE FUNCTION public.portal_rendimiento_diario()
RETURNS SETOF public.portal_rendimiento_diario_fila
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.clid, r.city, r.date, r.active_drivers, r.new_partner, r.new_service, r.reactivated, r.supply_hours, r.commission, r.trips, r.gmv, r.new_drivers, r.new_from_partner_50t, r.new_from_service_50t, r.active_cars, r.branded_active_cars, r.owned_fleet_active_cars, r.owned_fleet_branded_active_cars, r.internal_fleet_sh, r.external_fleet_sh, r.new_profiles, r.new_profiles_partner, r.new_profiles_partner_50t, r.new_profiles_service, r.new_profiles_service_50t, r.new_drivers_share, r.acceptance_rate, r.completion_rate, r.trips_per_hour, r.money_per_hour, r.avg_driver_rating, r.avg_fare_after_surge, r.bad_rated_trips_share, r.driver_support_requests_share, r.internal_fleet_sh_share, r.internal_fleet_sh_per_active_car, r.sh_per_active_car, r.sh_per_active_driver, r.new_profiles_partner_reg1, r.new_profiles_partner_reg10, r.new_profiles_partner_reg50, r.new_profiles_partner_reg100, r.new_profiles_service_reg1, r.new_profiles_service_reg10, r.new_profiles_service_reg50, r.new_profiles_service_reg100, r.db_id, r.fleetroom
    FROM public.rendimiento_diario r
   WHERE (SELECT public.is_partner())
     AND r.clid = ANY (public.my_clids());
$$;
REVOKE ALL ON FUNCTION public.portal_rendimiento_diario() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_rendimiento_diario() TO authenticated;

ALTER POLICY rendimiento_diario_select ON public.rendimiento_diario USING (NOT (SELECT public.is_partner()));

CREATE OR REPLACE FUNCTION public.dashboard_dates(scale text)
 RETURNS TABLE(periodo text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE es_partner boolean := (SELECT public.is_partner());
BEGIN
  IF scale = 'semanal' THEN
    IF es_partner THEN
      RETURN QUERY SELECT DISTINCT r.fecha::text FROM public.portal_rendimiento() r WHERE r.fecha IS NOT NULL ORDER BY 1;
    ELSE
      RETURN QUERY SELECT DISTINCT r.fecha::text FROM public.rendimiento r WHERE r.fecha IS NOT NULL ORDER BY 1;
    END IF;
  ELSIF scale = 'mensual' THEN
    IF es_partner THEN
      RETURN QUERY SELECT DISTINCT r.mes::text FROM public.portal_rendimiento_mensual() r WHERE r.mes IS NOT NULL ORDER BY 1;
    ELSE
      RETURN QUERY SELECT DISTINCT r.mes::text FROM public.rendimiento_mensual r WHERE r.mes IS NOT NULL ORDER BY 1;
    END IF;
  ELSIF scale = 'diario' THEN
    IF es_partner THEN
      RETURN QUERY SELECT DISTINCT r.date::text FROM public.portal_rendimiento_diario() r WHERE r.date IS NOT NULL ORDER BY 1;
    ELSE
      RETURN QUERY SELECT DISTINCT r.date::text FROM public.rendimiento_diario r WHERE r.date IS NOT NULL ORDER BY 1;
    END IF;
  ELSE
    RAISE EXCEPTION 'escala invalida: % (esperado: semanal|mensual|diario)', scale;
  END IF;
END;
$function$;
