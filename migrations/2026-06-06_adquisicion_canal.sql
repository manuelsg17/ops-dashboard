-- ============================================================
-- 2026-06-06_adquisicion_canal.sql
-- Adquisición por canal (2da pestaña del Excel de Conversión)
-- ============================================================
--
-- La pestaña "Adquisition by channel" trae, por CLID, el conteo de nuevos
-- drivers por canal de adquisición (Agency Scouts, Organic Partner, Organic
-- Scouts, Organic Yango, Paid Yango, Partner Scouts, Referral Partner,
-- Referral Yango). Misma granularidad que conversion_pais (clid, mes), así que
-- se agregan como columnas a esa tabla (no tabla aparte) y se upsertan por la
-- misma clave (clid, mes). RLS heredado de conversion_pais.
--
-- Aplicada via MCP apply_migration el 2026-06-06.
-- ============================================================

ALTER TABLE public.conversion_pais
  ADD COLUMN IF NOT EXISTS agency_scouts    numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS organic_partner  numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS organic_scouts   numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS organic_yango    numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_yango       numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_scouts   numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_partner numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_yango   numeric DEFAULT 0;
