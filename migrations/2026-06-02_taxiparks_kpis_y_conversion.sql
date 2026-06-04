-- ============================================================
-- 2026-06-02_taxiparks_kpis_y_conversion.sql
-- Esquema unificado: KPIs taxiparks + tabla de conversion
-- ============================================================
--
-- Que hace:
--   1. Agrega ~41 columnas KPI nuevas (del export ancho de taxiparks)
--      a las 3 tablas de rendimiento (semanal, mensual, diario), SIN
--      tocar las 7 columnas existentes (los graficos actuales siguen
--      linkeados a los mismos nombres). Es ADITIVO: no borra data.
--      - Conteos  -> numeric DEFAULT 0   (igual estilo que las actuales)
--      - Ratios/shares/promedios -> numeric NULL  ("sin dato" != "0%")
--   2. Crea la tabla conversion_pais (funnel por CLID a nivel pais, sin
--      ciudad) con RLS estricto espejo de is_admin().
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS +
--              DROP POLICY IF EXISTS antes de cada CREATE POLICY.
--
-- Tras correr: re-subir los Excel anchos (mensual/semanal/diario) para
--              poblar las columnas nuevas (upsert onConflict ya existe:
--              UNIQUE (clid,city,mes|fecha|date)).
--
-- Como correrla: Supabase Dashboard -> SQL editor -> RUN.
--                (aplicada via MCP apply_migration el 2026-06-02)
-- ============================================================

BEGIN;

-- ── 1. Columnas KPI nuevas en las 3 tablas de rendimiento ──
DO $$
DECLARE
  t text;
  c text;
  -- Conteos / montos -> default 0
  cols_count text[] := ARRAY[
    'gmv','new_drivers','new_from_partner_50t','new_from_service_50t',
    'active_cars','branded_active_cars','owned_fleet_active_cars',
    'owned_fleet_branded_active_cars','internal_fleet_sh','external_fleet_sh',
    'new_profiles','new_profiles_partner','new_profiles_partner_50t',
    'new_profiles_service','new_profiles_service_50t'
  ];
  -- Ratios / shares / promedios -> NULL
  cols_rate text[] := ARRAY[
    'new_drivers_share','acceptance_rate','completion_rate','trips_per_hour',
    'money_per_hour','avg_driver_rating','avg_fare_after_surge',
    'bad_rated_trips_share','fraud_trips_share','driver_subsidies_by_gmv',
    'driver_support_requests_share','internal_fleet_sh_share',
    'internal_fleet_sh_per_active_car','sh_per_active_car','sh_per_active_driver',
    'supply_hours_share','trips_share','commission_share',
    'new_profiles_partner_reg1','new_profiles_partner_reg10',
    'new_profiles_partner_reg50','new_profiles_partner_reg100',
    'new_profiles_service_reg1','new_profiles_service_reg10',
    'new_profiles_service_reg50','new_profiles_service_reg100'
  ];
  tbls text[] := ARRAY['rendimiento','rendimiento_mensual','rendimiento_diario'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    FOREACH c IN ARRAY cols_count LOOP
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I numeric DEFAULT 0', t, c);
    END LOOP;
    FOREACH c IN ARRAY cols_rate LOOP
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I numeric', t, c);
    END LOOP;
  END LOOP;
END$$;

-- ── 2. Tabla de conversion (funnel por CLID, nivel pais) ───
CREATE TABLE IF NOT EXISTS public.conversion_pais (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clid           text NOT NULL,
  partner        text,
  mes            text NOT NULL,
  active_drivers numeric DEFAULT 0,
  new_drivers    numeric DEFAULT 0,
  first_order    numeric,   -- % que hizo su primer viaje (activacion)
  n5_success     numeric,   -- % que llego a 5 viajes
  n10_success    numeric,
  n25_success    numeric,
  n50_success    numeric,
  n100_success   numeric,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT conversion_pais_clid_mes_key UNIQUE (clid, mes)
);

ALTER TABLE public.conversion_pais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversion_pais_select_auth  ON public.conversion_pais;
DROP POLICY IF EXISTS conversion_pais_admin_insert ON public.conversion_pais;
DROP POLICY IF EXISTS conversion_pais_admin_update ON public.conversion_pais;
DROP POLICY IF EXISTS conversion_pais_admin_delete ON public.conversion_pais;

CREATE POLICY conversion_pais_select_auth  ON public.conversion_pais FOR SELECT TO authenticated USING (true);
CREATE POLICY conversion_pais_admin_insert ON public.conversion_pais FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY conversion_pais_admin_update ON public.conversion_pais FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY conversion_pais_admin_delete ON public.conversion_pais FOR DELETE TO authenticated USING (public.is_admin());

COMMIT;

-- ── Verificacion (opcional) ────────────────────────────────
-- SELECT count(*) FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='rendimiento_mensual';   -- ~54
-- SELECT tablename, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='conversion_pais' ORDER BY cmd;
