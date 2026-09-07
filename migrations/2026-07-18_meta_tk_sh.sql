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

-- ⚠️ CORRECCIÓN (sep 2026) — LA JUSTIFICACIÓN DE ARRIBA QUEDÓ OBSOLETA Y ERA EL BUG.
--
-- Donde dice "necesita SUMAR meta_supply_hours + meta_tk_sh para el objetivo
-- combinado": eso es DOBLE CONTEO y se corrigió. La meta paraguas
-- (meta_active_drivers / meta_nr / meta_supply_hours) YA cubre Taxi + TukTuk
-- juntos; las meta_tk_* son un DESGLOSE de ella, no un agregado.
--
-- El daño real, medido en producción: seis partners con el plan de agosto 2026
-- inflado —TRANSPOTAXI Lima pasó de AD 2.661 a 3.785 (+42%) y N+R de 651 a 1.015
-- (+56%)—. Por eso existe `src/domain/metasGuard.ts` con tests.
--
-- El DDL de abajo NO cambia (la columna hace falta igual); lo que cambia es para
-- qué se usa. Se deja el texto original a la vista, tachado por esta nota, para
-- que quede el registro de cómo se razonó mal.

ALTER TABLE public.metas
  ADD COLUMN IF NOT EXISTS meta_tk_sh numeric;

COMMENT ON COLUMN public.metas.meta_tk_sh IS
  'Desglose TukTuk de meta_supply_hours — NO se suma a ella. NULL = sin % TukTuk declarado.';
