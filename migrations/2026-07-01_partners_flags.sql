-- ============================================================
-- 2026-07-01_partners_flags.sql
-- Flags manuales por partner: is_fleet, is_tuktuk
-- ============================================================
-- Presentación 2.0 necesita distinguir:
--  - Fleet: partners con flota propia (KPIs de lealtad: SH/carro activo,
--    Acceptance, Carros Fleet activos). NO se auto-detecta (72/78 CLIDs
--    tienen active_cars>0 → auto daría falso positivo); flag manual editable
--    en Configuración.
--  - TukTuk: operaciones tuktuk. Hoy no hay forma de identificarlas (ningún
--    partner en rendimiento tiene "tuktuk" en el nombre; los 2 reales viven
--    en flotas pero en partners figuran con nombres de taxi normal) → flag
--    manual, mismo patrón que is_fleet.
--
-- Aplicada via MCP apply_migration el 2026-07-01.
-- ============================================================

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS is_fleet   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_tuktuk  boolean NOT NULL DEFAULT false;
