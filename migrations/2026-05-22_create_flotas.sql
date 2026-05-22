-- ============================================================
-- Migracion: tabla `flotas` para sistema de mapeo CLID -> nombre custom
-- Fecha: 2026-05-22
--
-- Motivo: hoy los nombres de partner vienen del Excel de rendimiento, mezclados
-- entre flotas reales y partners particulares. Con esta tabla, el usuario puede:
--   1. Subir un Excel de "Flotas" con CLID + Ciudad + Nombre Asignado.
--   2. El dashboard renderiza el `nombre_asignado` en lugar del que vino en el
--      Excel original.
--   3. Asignar KAM por flota (override del KAM de la tabla `partners`).
--   4. Marcar una flota como `activo=false` para excluirla del dashboard sin
--      perderla.
--
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS flotas (
  clid              TEXT PRIMARY KEY,
  ciudad            TEXT,
  nombre_original   TEXT,              -- nombre tal como llega del Excel de rendimiento
  nombre_asignado   TEXT NOT NULL,     -- nombre custom decidido por el equipo
  kam               TEXT,              -- KAM asignado (puede sobreescribir el de `partners`)
  activo            BOOLEAN DEFAULT TRUE,
  creado_en         TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en    TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update de actualizado_en en cada UPDATE
CREATE OR REPLACE FUNCTION _flotas_touch_actualizado() RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS flotas_touch_actualizado ON flotas;
CREATE TRIGGER flotas_touch_actualizado
  BEFORE UPDATE ON flotas
  FOR EACH ROW EXECUTE FUNCTION _flotas_touch_actualizado();

-- Indice por KAM para queries del tipo "flotas de KAM X"
CREATE INDEX IF NOT EXISTS flotas_kam_idx ON flotas(kam) WHERE kam IS NOT NULL;
CREATE INDEX IF NOT EXISTS flotas_ciudad_idx ON flotas(ciudad) WHERE ciudad IS NOT NULL;

-- RLS: habilitar y permitir lectura/escritura a usuarios autenticados.
-- AJUSTAR las policies segun el modelo de auth de la cuenta.
ALTER TABLE flotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flotas_select_auth ON flotas;
CREATE POLICY flotas_select_auth ON flotas
  FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS flotas_write_auth ON flotas;
CREATE POLICY flotas_write_auth ON flotas
  FOR ALL TO authenticated
  USING (TRUE) WITH CHECK (TRUE);

COMMIT;

-- Verificacion
SELECT 'flotas' AS tabla, COUNT(*) AS filas FROM flotas;
