-- 2026-07-08 — Metas Fleet + TukTuk
-- Amplía la tabla `metas` (hoy solo agregador AD/N+R/SH) para almacenar metas de
-- Fleet (SH/Auto, Aceptación, Utilización) y TukTuk (AD, N+R, Cars), de modo que la
-- Calculadora pueda guardarlas y Presentación 2.0 / Metas mostrarlas.
--
-- Diseño: columnas ANCHAS y NULLABLE (NULL = el partner no tiene esa línea). Se
-- descarta un discriminador `linea` porque un partner-ciudad puede tener las 3 líneas
-- el mismo mes (multiplicaría filas y rompería getRPC / el match por nombre de mes).
-- Clave (clid,city,mes) intacta. Sin cambios de RLS (mantiene el contrato
-- is_admin() EXECUTE para authenticated — NO revocar, rompe escrituras 42501).
--
-- `mes_year`: el `mes` se guarda como NOMBRE sin año (JUNIO). Con datos multi-año esto
-- causa el bug cross-year (metas.js toma el nombre más reciente sin desambiguar año).
-- Guardar el año aquí permite resolver el período exacto. Ver memoria metas-mes-name-only-cross-year.
--
-- Aplicada vía MCP apply_migration (project oqakoinyzvdgqilxwjjv) el 2026-07-08.

ALTER TABLE public.metas
  ADD COLUMN IF NOT EXISTS meta_sh_car       numeric,
  ADD COLUMN IF NOT EXISTS meta_acceptance   numeric,
  ADD COLUMN IF NOT EXISTS meta_utilization  numeric,
  ADD COLUMN IF NOT EXISTS meta_tk_ad        numeric,
  ADD COLUMN IF NOT EXISTS meta_tk_nr        numeric,
  ADD COLUMN IF NOT EXISTS meta_tk_cars      numeric,
  ADD COLUMN IF NOT EXISTS mes_year          smallint;

COMMENT ON COLUMN public.metas.meta_sh_car      IS 'Fleet: meta SH por auto activo (horas/auto)';
COMMENT ON COLUMN public.metas.meta_acceptance  IS 'Fleet: meta acceptance rate (%)';
COMMENT ON COLUMN public.metas.meta_utilization IS 'Fleet: meta utilización (%)';
COMMENT ON COLUMN public.metas.meta_tk_ad       IS 'TukTuk: meta active drivers';
COMMENT ON COLUMN public.metas.meta_tk_nr       IS 'TukTuk: meta new + reactivated';
COMMENT ON COLUMN public.metas.meta_tk_cars     IS 'TukTuk: meta branded active cars';
COMMENT ON COLUMN public.metas.mes_year         IS 'Año del mes objetivo (desambigua nombre de mes sin año)';
