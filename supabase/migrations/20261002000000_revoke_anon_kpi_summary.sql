-- SOLO entorno local (2-oct-2026). La copia local de la estructura no traía el
-- REVOKE de migrations/2026-07-26_performance_rpcs.sql: get_partner_kpi_summary
-- es SECURITY DEFINER y para `anon` is_partner() = false, así que sin sesión
-- devolvía los totales de TODOS los partners. Producción ya lo tiene revocado
-- (verificado: 401 / 42501 con la clave pública). Esto iguala lo local.
REVOKE EXECUTE ON FUNCTION public.get_partner_kpi_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_partner_kpi_summary(date, date) TO authenticated;
