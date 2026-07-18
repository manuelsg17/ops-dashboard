-- 2026-07-18 — Meta TukTuk: Horas de Conexión
-- TukTuk ya reporta supply_hours como actual (columna genérica de taxiparks, poblada
-- para cualquier fleetroom incluido TukTuk vía STATE.rawDataTuktuk/rawDataMensualTuktuk),
-- pero `metas` no tenía una meta_tk_* para esa métrica (solo meta_tk_ad/nr/cars).
-- Prerequisito para la slide "Avance vs Meta Combinado" (Taxi+TukTuk) de Presentación 2.0,
-- que necesita sumar meta_supply_hours + meta_tk_sh para el objetivo combinado de Horas
-- de Conexión.
--
-- Mismo patrón que 2026-07-08_metas_fleet_tuktuk.sql: columna ANCHA y NULLABLE (NULL =
-- el KAM aún no cargó esa meta para ese partner-ciudad-mes). Sin cambios de RLS.
--
-- Aplicada vía MCP apply_migration (project oqakoinyzvdgqilxwjjv) el 2026-07-18.

ALTER TABLE public.metas
  ADD COLUMN IF NOT EXISTS meta_tk_sh numeric;

COMMENT ON COLUMN public.metas.meta_tk_sh IS 'TukTuk: meta horas de conexión (supply hours)';
