-- Seguimiento: 3 campos por tarjeta para la presentación al partner (2-oct-2026).
-- Pedido de Manuel (maqueta ?ui=segmejoras, aprobada):
--   depende_partner  → la tarjeta necesita algo del partner. Reemplaza la
--                      heurística sobre `owner` ("¿dice partner?") que decidía
--                      el aviso "Necesitamos de ti" de la hoja del deck.
--   motivo_bloqueo   → por qué está bloqueada (texto libre, opcional).
--   visible_partner  → false = tarjeta INTERNA: no sale en la hoja del deck ni
--                      en sus conteos. Por defecto true (lo existente sigue igual).
-- Aditiva: sin cambios de RLS (mismas políticas de la tabla) ni de triggers.
-- El trigger de auditoría de `seguimiento` ya registra la fila completa.

ALTER TABLE public.seguimiento
  ADD COLUMN IF NOT EXISTS depende_partner boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_bloqueo  text,
  ADD COLUMN IF NOT EXISTS visible_partner boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.seguimiento.depende_partner IS 'La tarjeta necesita una acción del partner (aviso "Necesitamos de ti" en la hoja del deck).';
COMMENT ON COLUMN public.seguimiento.motivo_bloqueo  IS 'Por qué está bloqueada; se muestra en la hoja del partner mientras status = bloqueado.';
COMMENT ON COLUMN public.seguimiento.visible_partner IS 'false = interna: no aparece en la presentación al partner ni en sus conteos.';
