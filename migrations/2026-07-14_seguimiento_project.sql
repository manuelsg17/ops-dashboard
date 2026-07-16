-- Fase 3 (iteración): agrupar tareas de seguimiento dentro de un PROYECTO.
-- Columna nullable → las tareas sin proyecto caen en el grupo "Sin proyecto".
ALTER TABLE public.seguimiento ADD COLUMN IF NOT EXISTS project text;
CREATE INDEX IF NOT EXISTS seguimiento_project_idx ON public.seguimiento (partner, project);
