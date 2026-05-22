-- ============================================================
-- Migracion: normalizar ciudades a UPPERCASE
-- Fecha: 2026-05-22
-- Motivo: hallazgo C3 del audit. Las uploads anteriores no normalizaban
-- la columna `city`, lo que permitia que "Lima", "lima" y "LIMA" coexistieran
-- como ciudades distintas, fragmentando reportes y rompiendo filtros.
--
-- El codigo (data.js normCity() + uploads) ahora normaliza a UPPERCASE,
-- pero los datos historicos en BD pueden seguir teniendo casing mixto.
-- Este script los uniforma de una vez.
--
-- Ejecutar en Supabase SQL Editor. Es idempotente (correr varias veces no
-- hace dano).
-- ============================================================

BEGIN;

-- Verificacion previa: ver cuantos registros se veran afectados
-- (Comentar este SELECT y descomentar los UPDATE despues de revisar).
SELECT 'rendimiento'         AS tabla, city, COUNT(*) AS filas
  FROM rendimiento         WHERE city <> UPPER(city) GROUP BY city
UNION ALL
SELECT 'rendimiento_mensual' AS tabla, city, COUNT(*) AS filas
  FROM rendimiento_mensual WHERE city <> UPPER(city) GROUP BY city
UNION ALL
SELECT 'rendimiento_diario'  AS tabla, city, COUNT(*) AS filas
  FROM rendimiento_diario  WHERE city <> UPPER(city) GROUP BY city
UNION ALL
SELECT 'metas'               AS tabla, city, COUNT(*) AS filas
  FROM metas               WHERE city <> UPPER(city) GROUP BY city;

-- Aplicar normalizacion.
-- Atencion: si existen UNIQUE constraints sobre (clid, city, *) podrian
-- colisionar dos filas que solo difieren en casing. Si eso ocurre, el UPDATE
-- fallara y habra que consolidar manualmente (decidir cual fila se queda).
UPDATE rendimiento         SET city = UPPER(city) WHERE city <> UPPER(city);
UPDATE rendimiento_mensual SET city = UPPER(city) WHERE city <> UPPER(city);
UPDATE rendimiento_diario  SET city = UPPER(city) WHERE city <> UPPER(city);
UPDATE metas               SET city = UPPER(city) WHERE city <> UPPER(city);

-- Verificacion posterior: no deben quedar filas con casing mixto.
SELECT 'rendimiento'         AS tabla, COUNT(*) AS filas_mixtas FROM rendimiento         WHERE city <> UPPER(city)
UNION ALL
SELECT 'rendimiento_mensual' AS tabla, COUNT(*) AS filas_mixtas FROM rendimiento_mensual WHERE city <> UPPER(city)
UNION ALL
SELECT 'rendimiento_diario'  AS tabla, COUNT(*) AS filas_mixtas FROM rendimiento_diario  WHERE city <> UPPER(city)
UNION ALL
SELECT 'metas'               AS tabla, COUNT(*) AS filas_mixtas FROM metas               WHERE city <> UPPER(city);

-- Si todo OK, COMMIT. Si algun UPDATE fallo, ROLLBACK y consolidar manualmente.
COMMIT;
