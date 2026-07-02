-- ============================================================
-- 2026-07-01_fleetrooms.sql
-- Dimension "fleetroom" (sub-flota) por DEBAJO de CLID.
-- ============================================================
-- Un CLID contiene MULTIPLES fleetrooms. Cada fleetroom tiene un id estable
-- `db_id` (ej. CLID 400001043961 -> PERU DRIVE / Arequipa Apps / Premium Drive /
-- TaxiYa, cada uno con sus propias metricas). Hoy el parser colapsa todos los
-- fleetrooms de un CLID en UNA fila (clave clid|city|fecha) y se pierde el
-- detalle. Esta migracion:
--   1. Agrega db_id + fleetroom (nombre) a las 3 tablas de rendimiento.
--   2. Cambia la clave unica para incluir db_id, SIN romper filas legacy
--      (db_id='') ni permitir duplicados-null.
--   3. Crea tabla `fleetrooms` para el tagging por fleetroom (is_fleet,
--      is_tuktuk, exclude_from_taxi, activo) — mismo patron RLS que partners.
--
-- BACKWARD COMPAT: db_id NOT NULL DEFAULT '' -> las filas historicas quedan
-- con db_id='' y siguen funcionando a granularidad CLID (fallback). El detalle
-- por fleetroom se activa cuando se sube el primer Excel con columna db_id.
--
-- Pitfall Postgres: en UNIQUE los NULL son DISTINTOS entre si. Si db_id fuese
-- nullable, (clid,city,fecha,NULL) permitiria N duplicados legacy y romperia el
-- upsert (cada re-upload INSERTA en vez de UPDATE). Por eso NOT NULL DEFAULT ''
-- (no un indice COALESCE, que ademas no es direccionable por onConflict de
-- supabase-js).
--
-- exclude_from_taxi: fleetrooms que NO deben entrar al calculo de Taxi aunque
-- no sean tuktuk (ej. "DeliveryPe Arequipa"). No entran ni a Taxi ni a TukTuk.
--
-- Aplicada via MCP apply_migration el 2026-07-01 (project oqakoinyzvdgqilxwjjv).
-- ============================================================

BEGIN;

-- ── 1. Columnas nuevas en las 3 tablas de rendimiento ──────
ALTER TABLE public.rendimiento
  ADD COLUMN IF NOT EXISTS db_id     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS fleetroom text NOT NULL DEFAULT '';
ALTER TABLE public.rendimiento_mensual
  ADD COLUMN IF NOT EXISTS db_id     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS fleetroom text NOT NULL DEFAULT '';
ALTER TABLE public.rendimiento_diario
  ADD COLUMN IF NOT EXISTS db_id     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS fleetroom text NOT NULL DEFAULT '';

-- Backfill defensivo (por si alguna fila quedo con NULL antes del DEFAULT).
UPDATE public.rendimiento         SET db_id = '' WHERE db_id IS NULL;
UPDATE public.rendimiento_mensual SET db_id = '' WHERE db_id IS NULL;
UPDATE public.rendimiento_diario  SET db_id = '' WHERE db_id IS NULL;

-- ── 2. Swap de la clave unica: agregar db_id ───────────────
-- Se DROPea la constraint vieja (rechazaria el 2do fleetroom del mismo CLID)
-- y se crea la nueva incluyendo db_id. Como todas las filas legacy quedan en
-- db_id='' y la constraint vieja garantizaba unicidad de (clid,city,fecha),
-- el set (clid,city,fecha,'') es automaticamente unico -> el ADD no colisiona.
ALTER TABLE public.rendimiento
  DROP CONSTRAINT IF EXISTS rendimiento_clid_city_fecha_key,
  ADD  CONSTRAINT rendimiento_clid_city_fecha_dbid_key UNIQUE (clid, city, fecha, db_id);

ALTER TABLE public.rendimiento_mensual
  DROP CONSTRAINT IF EXISTS rendimiento_mensual_clid_city_mes_key,
  ADD  CONSTRAINT rendimiento_mensual_clid_city_mes_dbid_key UNIQUE (clid, city, mes, db_id);

ALTER TABLE public.rendimiento_diario
  DROP CONSTRAINT IF EXISTS rendimiento_diario_clid_city_date_key,
  ADD  CONSTRAINT rendimiento_diario_clid_city_date_dbid_key UNIQUE (clid, city, date, db_id);

-- ── 3. Tabla fleetrooms (tagging por sub-flota, keyed by db_id) ──
CREATE TABLE IF NOT EXISTS public.fleetrooms (
  db_id             text PRIMARY KEY,
  clid              text,
  name              text NOT NULL DEFAULT '',
  kam               text,
  city              text,
  is_fleet          boolean NOT NULL DEFAULT false,
  is_tuktuk         boolean NOT NULL DEFAULT false,
  exclude_from_taxi boolean NOT NULL DEFAULT false,
  activo            boolean NOT NULL DEFAULT true,
  creado_en         timestamptz DEFAULT now(),
  actualizado_en    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fleetrooms_clid_idx ON public.fleetrooms(clid) WHERE clid IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleetrooms_kam_idx  ON public.fleetrooms(kam)  WHERE kam  IS NOT NULL;

-- touch actualizado_en en cada UPDATE (mismo patron que flotas)
CREATE OR REPLACE FUNCTION public._fleetrooms_touch() RETURNS trigger AS $$
BEGIN NEW.actualizado_en = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS fleetrooms_touch ON public.fleetrooms;
CREATE TRIGGER fleetrooms_touch BEFORE UPDATE ON public.fleetrooms
  FOR EACH ROW EXECUTE FUNCTION public._fleetrooms_touch();

-- ── 4. RLS: mismo modelo estricto que partners/conversion_pais ──
-- SELECT: cualquier autenticado. INSERT/UPDATE/DELETE: solo is_admin().
-- NO se toca EXECUTE de is_admin() (ver 2026-06-03_revert_is_admin_revoke.sql;
-- revocarlo rompe escrituras admin con 42501).
ALTER TABLE public.fleetrooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fleetrooms_select_auth   ON public.fleetrooms;
DROP POLICY IF EXISTS fleetrooms_admin_insert  ON public.fleetrooms;
DROP POLICY IF EXISTS fleetrooms_admin_update  ON public.fleetrooms;
DROP POLICY IF EXISTS fleetrooms_admin_delete  ON public.fleetrooms;

CREATE POLICY fleetrooms_select_auth  ON public.fleetrooms FOR SELECT TO authenticated USING (true);
CREATE POLICY fleetrooms_admin_insert ON public.fleetrooms FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY fleetrooms_admin_update ON public.fleetrooms FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY fleetrooms_admin_delete ON public.fleetrooms FOR DELETE TO authenticated USING (public.is_admin());

COMMIT;

-- ── Verificacion (opcional, correr despues del COMMIT) ─────
-- 1. Sin duplicados tras el swap:
--    SELECT clid, city, fecha, db_id, count(*)
--      FROM rendimiento GROUP BY 1,2,3,4 HAVING count(*) > 1;
-- 2. Constraint nueva:
--    SELECT conname, pg_get_constraintdef(oid)
--      FROM pg_constraint WHERE conrelid = 'rendimiento'::regclass AND contype='u';
