-- Índice de ventana para rendimiento_diario.
--
-- PROBLEMA: la tabla se consulta SIEMPRE por ventana de fecha
-- (WHERE date >= X ORDER BY date, ver LOAD_WINDOW.diario = 90 días en data.ts),
-- pero su único índice aprovechable era el UNIQUE (clid, city, date, db_id).
-- Ese índice LIDERA con `clid`, así que Postgres no puede usarlo para un rango
-- sobre `date` y caía en Seq Scan + Sort.
--
-- MEDIDO en producción, 19.231 filas:
--   antes  → Seq Scan on rendimiento_diario + top-N heapsort ... 644 ms
--   después→ Index Scan using rendimiento_diario_date_clid_idx ...  57 ms
--
-- (date, clid) espeja a rendimiento_mensual_mes_clid_idx, que ya existía — y es
-- exactamente por eso que la escala mensual nunca dio problemas y la diaria sí.
--
-- APLICADA el 2026-07-29 vía MCP apply_migration.
CREATE INDEX IF NOT EXISTS rendimiento_diario_date_clid_idx
  ON public.rendimiento_diario USING btree (date, clid);

-- Verificación:
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT clid, city, date, db_id, active_drivers
--     FROM rendimiento_diario
--    WHERE date >= (SELECT max(date) - 90 FROM rendimiento_diario)
--    ORDER BY date ASC LIMIT 1000;
--   -> debe decir "Index Scan using rendimiento_diario_date_clid_idx", sin Sort.
