-- 2026-07-26_performance_rpcs.sql
-- Funciones RPC optimizadas para agregaciones server-side de KPIs
-- Evita la transferencia masiva de filas SELECT * hacia el cliente JS.

-- 1. Resumen de KPIs por Partner y Rango de Fechas
CREATE OR REPLACE FUNCTION public.get_partner_kpi_summary(
  p_start_date date DEFAULT NULL,
  p_end_date   date DEFAULT NULL
)
RETURNS TABLE (
  clid text,
  total_trips numeric,
  max_active_drivers numeric,
  total_supply_hours numeric,
  total_gmv numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT 
    r.clid,
    COALESCE(SUM(r.trips), 0) AS total_trips,
    COALESCE(MAX(r.active_drivers), 0) AS max_active_drivers,
    COALESCE(SUM(r.supply_hours), 0) AS total_supply_hours,
    COALESCE(SUM(r.gmv), 0) AS total_gmv
  FROM public.rendimiento r
  WHERE (p_start_date IS NULL OR r.fecha >= p_start_date)
    AND (p_end_date IS NULL OR r.fecha <= p_end_date)
    AND ((NOT (select public.is_partner())) OR (r.clid = ANY (public.my_clids())))
  GROUP BY r.clid;
$$;

GRANT EXECUTE ON FUNCTION public.get_partner_kpi_summary(date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_partner_kpi_summary(date, date) FROM PUBLIC, anon;

-- 2. Asegurar índices compuestos de alto rendimiento para consultas por rango de fecha y clid
CREATE INDEX IF NOT EXISTS rendimiento_fecha_clid_idx ON public.rendimiento (fecha, clid);
CREATE INDEX IF NOT EXISTS rendimiento_mensual_mes_clid_idx ON public.rendimiento_mensual (mes, clid);
CREATE INDEX IF NOT EXISTS metas_clid_mes_idx ON public.metas (clid, mes);
