-- Fase 3 — Tracker de seguimiento de reuniones (Gantt por partner).
-- Cada fila = una tarea/next-step: Owner, Task, inicio, fin, resultado esperado, status.
-- RLS espejo del Sprint 0 (migrations/2026-05-27_strict_rls.sql):
--   SELECT  → cualquier authenticated (true)
--   INSERT/UPDATE/DELETE → solo is_admin()
-- NO se toca is_admin() ni su EXECUTE (ver memoria is-admin-execute-required-for-rls).

CREATE TABLE IF NOT EXISTS public.seguimiento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kam             text,
  partner         text NOT NULL,
  clid            text,
  city            text,
  owner           text,
  task            text NOT NULL,
  start_date      date,
  end_date        date,
  expected_result text,
  status          text DEFAULT 'pendiente',   -- pendiente | en_curso | hecho | bloqueado
  sort_order      integer DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seguimiento_partner_idx ON public.seguimiento (partner);
CREATE INDEX IF NOT EXISTS seguimiento_kam_idx     ON public.seguimiento (kam);

ALTER TABLE public.seguimiento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seguimiento_select_auth  ON public.seguimiento;
DROP POLICY IF EXISTS seguimiento_admin_insert ON public.seguimiento;
DROP POLICY IF EXISTS seguimiento_admin_update ON public.seguimiento;
DROP POLICY IF EXISTS seguimiento_admin_delete ON public.seguimiento;

CREATE POLICY seguimiento_select_auth  ON public.seguimiento FOR SELECT TO authenticated USING (true);
CREATE POLICY seguimiento_admin_insert ON public.seguimiento FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY seguimiento_admin_update ON public.seguimiento FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY seguimiento_admin_delete ON public.seguimiento FOR DELETE TO authenticated USING (public.is_admin());
