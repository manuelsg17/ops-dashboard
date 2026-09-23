-- 2026-09-23 — metas: la clave única pasa a incluir el AÑO (bug B1 del plan de
-- mejora, docs/plan-mejora-2026-09.md).
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ESTADO: APLICADA SOLO EN EL SUPABASE LOCAL (Docker, puerto 54332).         ║
-- ║ PRODUCCIÓN: NO APLICADA. La aplica la sesión coordinadora ÚNICAMENTE con   ║
-- ║ la confirmación explícita de Manuel, y ANTES de que alguien arme las       ║
-- ║ metas de ENERO 2027.                                                       ║
-- ║                                                                            ║
-- ║ ORDEN DE DESPLIEGUE: migración y código van JUNTOS. El código de la rama   ║
-- ║ `mejora/integracion` hace upsert con onConflict 'clid,city,mes,mes_year',  ║
-- ║ que necesita esta UNIQUE: sin ella PostgREST responde 42P10 ("no unique    ║
-- ║ constraint matching") y el guardado FALLA con error visible (no corrompe). ║
-- ║ Al revés (migración aplicada con el código viejo desplegado) el upsert     ║
-- ║ viejo onConflict 'clid,city,mes' también falla con 42P10. En los dos casos ║
-- ║ el fallo es ruidoso, nunca silencioso — pero conviene que la ventana sea   ║
-- ║ de minutos.                                                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- EL BUG. `metas.mes` es el NOMBRE del mes sin año ("ENERO") y la UNIQUE era
-- (clid, city, mes). Guardar ENERO 2027 para un partner-ciudad que ya tenía
-- ENERO 2026 hacía upsert sobre la fila de 2026: la reescribía (se perdía la
-- meta histórica) y encima heredaba sus columnas Fleet / meta_tk_cars, porque
-- el merge de la Calculadora rellena lo que la fila nueva no trae desde lo
-- existente. `mes_year` existe desde 2026-07-08 pero nunca formó parte de la
-- clave.
--
-- QUÉ HACE, en una sola transacción:
--   1. BACKFILL de `mes_year` NULL (filas de uploads anteriores a 2026-07-08).
--      Regla, documentada y determinista: la tabla no tiene updated_at, solo
--      created_at. Una meta se carga CERCA del mes que planifica (normalmente
--      el mes anterior o el mismo). Entonces el año es el de la ocurrencia de
--      ese mes MÁS CERCANA a created_at (en hora de Lima): entre año-1, año y
--      año+1 del created_at, el que minimiza la distancia en meses; empate →
--      el más tardío (una meta se arma por adelantado, no por detrás).
--      Ej.: ENERO cargada el 20-dic-2026 → 2027; DICIEMBRE cargada el
--      03-ene-2027 → 2026; JUNIO cargada el 28-may-2026 → 2026.
--      Si `mes` viene como ISO "YYYY-MM", el año sale del propio texto.
--      Sin created_at → el año actual de Lima (último recurso).
--      Un `mes` que no es un mes reconocible ABORTA la migración (no se
--      inventa un año para algo que no se entiende).
--   2. `mes_year` pasa a NOT NULL: nunca más una fila sin año. SIN default a
--      propósito: un default elegiría un año en silencio, que es justo el bug.
--   3. Chequeo previo de duplicados bajo la clave nueva (no debería haber:
--      la vieja era más estricta) — si los hubiera, aborta con el detalle.
--   4. DROP de metas_clid_city_mes_key y CREATE de
--      metas_clid_city_mes_year_key UNIQUE (clid, city, mes, mes_year).
--   5. El trigger de auditoría incluye mes_year en el row_key (sin esto,
--      "ENERO" 2026 y 2027 quedaban indistinguibles en audit_log).
--
-- Lo que NO hace: normalizar el casing de `mes` ("Septiembre" vs
-- "SEPTIEMBRE"). La UNIQUE sigue siendo case-sensitive, como antes; el código
-- ya conserva el casing existente al guardar. Sin cambios de RLS.
--
-- Rollback (solo si todavía no hay dos años del mismo mes para un mismo
-- clid/city; si los hay, el ADD CONSTRAINT viejo fallará, que es lo correcto):
--   ALTER TABLE public.metas DROP CONSTRAINT metas_clid_city_mes_year_key;
--   ALTER TABLE public.metas ALTER COLUMN mes_year DROP NOT NULL;
--   ALTER TABLE public.metas ADD CONSTRAINT metas_clid_city_mes_key UNIQUE (clid, city, mes);

BEGIN;

-- 1. Backfill ----------------------------------------------------------------
-- Número de mes a partir del nombre (español, "SETIEMBRE" peruano, inglés).
-- Función temporal en pg_temp: no queda nada en el esquema al terminar.
CREATE FUNCTION pg_temp._mes_num(t text) RETURNS int LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE upper(trim(t))
    WHEN 'ENERO' THEN 1 WHEN 'FEBRERO' THEN 2 WHEN 'MARZO' THEN 3 WHEN 'ABRIL' THEN 4
    WHEN 'MAYO' THEN 5 WHEN 'JUNIO' THEN 6 WHEN 'JULIO' THEN 7 WHEN 'AGOSTO' THEN 8
    WHEN 'SEPTIEMBRE' THEN 9 WHEN 'SETIEMBRE' THEN 9 WHEN 'OCTUBRE' THEN 10
    WHEN 'NOVIEMBRE' THEN 11 WHEN 'DICIEMBRE' THEN 12
    WHEN 'JANUARY' THEN 1 WHEN 'FEBRUARY' THEN 2 WHEN 'MARCH' THEN 3 WHEN 'APRIL' THEN 4
    WHEN 'MAY' THEN 5 WHEN 'JUNE' THEN 6 WHEN 'JULY' THEN 7 WHEN 'AUGUST' THEN 8
    WHEN 'SEPTEMBER' THEN 9 WHEN 'OCTOBER' THEN 10 WHEN 'NOVEMBER' THEN 11 WHEN 'DECEMBER' THEN 12
  END
$f$;

DO $$
DECLARE
  malos text;
BEGIN
  SELECT string_agg(DISTINCT m.mes, ', ') INTO malos
    FROM public.metas m
   WHERE m.mes_year IS NULL
     AND upper(trim(m.mes)) !~ '^\d{4}-\d{1,2}'
     AND pg_temp._mes_num(m.mes) IS NULL;
  IF malos IS NOT NULL THEN
    RAISE EXCEPTION 'metas: valores de mes no reconocibles con mes_year NULL: %. Corregirlos a mano antes de migrar.', malos;
  END IF;
END $$;

-- ISO "YYYY-MM": el año está en el texto.
UPDATE public.metas
   SET mes_year = substring(trim(mes) from '^(\d{4})')::smallint
 WHERE mes_year IS NULL AND trim(mes) ~ '^\d{4}-\d{1,2}';

-- Nombre de mes: ocurrencia más cercana a created_at (Lima); empate → la más tardía.
UPDATE public.metas m
   SET mes_year = sub.anio
  FROM (
    SELECT mm.id,
           (SELECT c.anio
              FROM (VALUES (r.y - 1), (r.y), (r.y + 1)) AS c(anio)
             ORDER BY abs((c.anio * 12 + pg_temp._mes_num(mm.mes)) - (r.y * 12 + r.cm)), c.anio DESC
             LIMIT 1)::smallint AS anio
      FROM public.metas mm
      CROSS JOIN LATERAL (
        SELECT extract(year  FROM coalesce(mm.created_at, now()) AT TIME ZONE 'America/Lima')::int AS y,
               extract(month FROM coalesce(mm.created_at, now()) AT TIME ZONE 'America/Lima')::int AS cm
      ) r
     WHERE mm.mes_year IS NULL AND pg_temp._mes_num(mm.mes) IS NOT NULL
  ) sub
 WHERE m.id = sub.id;

-- 2. NOT NULL ----------------------------------------------------------------
ALTER TABLE public.metas ALTER COLUMN mes_year SET NOT NULL;

-- 3. Duplicados bajo la clave nueva -------------------------------------------
DO $$
DECLARE
  dup text;
BEGIN
  SELECT string_agg(format('%s/%s/%s/%s (x%s)', clid, city, mes, mes_year, n), '; ') INTO dup
    FROM (SELECT clid, city, mes, mes_year, count(*) AS n
            FROM public.metas GROUP BY 1, 2, 3, 4 HAVING count(*) > 1) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'metas: duplicados bajo (clid, city, mes, mes_year): %', dup;
  END IF;
END $$;

-- 4. Clave única con año ------------------------------------------------------
ALTER TABLE public.metas DROP CONSTRAINT IF EXISTS metas_clid_city_mes_key;
ALTER TABLE public.metas ADD CONSTRAINT metas_clid_city_mes_year_key
  UNIQUE (clid, city, mes, mes_year);

COMMENT ON COLUMN public.metas.mes_year IS
  'Año del mes objetivo. NOT NULL y parte de la UNIQUE (clid, city, mes, mes_year) desde 2026-09-23: ENERO 2026 y ENERO 2027 son filas distintas.';

-- 5. Auditoría con el año en el row_key -----------------------------------------
DROP TRIGGER IF EXISTS audit_metas ON public.metas;
CREATE TRIGGER audit_metas AFTER INSERT OR DELETE OR UPDATE ON public.metas
  FOR EACH ROW EXECUTE FUNCTION audit_trigger('true', 'clid', 'city', 'mes', 'mes_year');

COMMIT;
