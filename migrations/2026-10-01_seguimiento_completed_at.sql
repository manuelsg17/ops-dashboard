-- Seguimiento: fecha REAL de cierre de una tarjeta (1-oct-2026).
-- Manuel aprobó la hoja Kanban del deck con "Logrados" = solo lo cerrado en el
-- período del deck. Para eso hace falta saber CUÁNDO se cerró: hasta ahora solo
-- había `end_date` (vencimiento planeado). La registra la BASE (no el
-- navegador), así no depende de la hora de la máquina de nadie ni se puede
-- olvidar en algún camino de guardado:
--   - pasa a 'hecho' → completed_at = now() (si no venía ya puesta);
--   - sale de 'hecho' → completed_at = NULL.
-- Lo cerrado antes de esta migración queda en NULL y la app usa su end_date.

ALTER TABLE public.seguimiento ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE OR REPLACE FUNCTION public._seguimiento_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'hecho' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'hecho' THEN
      NEW.completed_at := coalesce(NEW.completed_at, now());
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS seguimiento_completed_at ON public.seguimiento;
CREATE TRIGGER seguimiento_completed_at
  BEFORE INSERT OR UPDATE OF status ON public.seguimiento
  FOR EACH ROW EXECUTE FUNCTION public._seguimiento_completed_at();
