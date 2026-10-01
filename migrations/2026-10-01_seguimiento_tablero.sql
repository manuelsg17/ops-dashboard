-- Seguimiento tipo Trello (1-oct-2026). Manuel eligió la propuesta "A · Clásico"
-- de la maqueta ?ui=tablero y pidió "da los permisos necesarios".
--
-- 1. Columnas nuevas de la tarjeta:
--    - checklist   jsonb  [{ "t": texto, "ok": bool }]
--    - comentarios jsonb  [{ "quien": email, "at": timestamptz, "txt": texto }]
--    El título sigue en `task`, la lista en `status`, la descripción en
--    `expected_result`, el responsable en `owner` y el orden en `sort_order`:
--    así la hoja de Seguimiento del deck (Gantt) no cambia.
-- 2. Permisos de escritura: los KAMs se suman a admin y al grant
--    `write:seguimiento` (antes: solo admin o el grant). La lectura no cambia
--    (internos sí, rol partner no: `seguimiento_select_internal`).
-- 3. `seguimiento_comentar(id, texto)`: agrega un comentario de forma ATÓMICA
--    (sin leer-modificar-escribir el arreglo desde el navegador, que pisaría el
--    comentario de otra persona escrito al mismo tiempo) y toma el autor del
--    JWT. SECURITY INVOKER: corre con las políticas de UPDATE de arriba.
--
-- La tabla estaba vacía en producción (0 filas al 1-oct): no hay datos que migrar.
-- NO toca is_admin() ni su EXECUTE (memoria is-admin-execute-required-for-rls).

ALTER TABLE public.seguimiento
  ADD COLUMN IF NOT EXISTS checklist   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS comentarios jsonb NOT NULL DEFAULT '[]'::jsonb;

DROP POLICY IF EXISTS seguimiento_admin_insert ON public.seguimiento;
DROP POLICY IF EXISTS seguimiento_admin_update ON public.seguimiento;
DROP POLICY IF EXISTS seguimiento_admin_delete ON public.seguimiento;
DROP POLICY IF EXISTS seguimiento_write_insert ON public.seguimiento;
DROP POLICY IF EXISTS seguimiento_write_update ON public.seguimiento;
DROP POLICY IF EXISTS seguimiento_write_delete ON public.seguimiento;

CREATE POLICY seguimiento_write_insert ON public.seguimiento FOR INSERT TO authenticated
  WITH CHECK (public.is_kam_or_admin() OR (SELECT public.can('write:seguimiento')));
CREATE POLICY seguimiento_write_update ON public.seguimiento FOR UPDATE TO authenticated
  USING (public.is_kam_or_admin() OR (SELECT public.can('write:seguimiento')))
  WITH CHECK (public.is_kam_or_admin() OR (SELECT public.can('write:seguimiento')));
CREATE POLICY seguimiento_write_delete ON public.seguimiento FOR DELETE TO authenticated
  USING (public.is_kam_or_admin() OR (SELECT public.can('write:seguimiento')));

CREATE OR REPLACE FUNCTION public.seguimiento_comentar(p_id uuid, p_texto text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.seguimiento
     SET comentarios = comentarios || jsonb_build_array(jsonb_build_object(
           'quien', coalesce(auth.jwt() ->> 'email', ''),
           'at',    now(),
           'txt',   left(btrim(p_texto), 2000))),
         updated_at = now()
   WHERE id = p_id AND btrim(coalesce(p_texto, '')) <> ''
  RETURNING comentarios;
$$;
REVOKE ALL ON FUNCTION public.seguimiento_comentar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seguimiento_comentar(uuid, text) TO authenticated;
