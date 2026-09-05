-- ============================================================================
-- partner_logos — logo de cada partner para la carátula de la Presentación.
--
-- POR QUE UNA TABLA APARTE Y NO UNA COLUMNA EN `partners`. `partners` se trae
-- en CADA arranque (en paralelo con el resto). Una columna `logo` viajaria
-- siempre, para todas las cuentas, aunque la sesion no abra la Presentacion:
-- con ~100 partners a ~10 kB son ~1 MB agregados al arranque, justo lo que se
-- estuvo recortando (ver la sesion de agosto sobre payload). Aca se carga
-- DIFERIDO, solo cuando se abre Presentacion o Configuracion.
--
-- POR QUE DATA URL Y NO STORAGE. Un bucket de Storage suma un origen nuevo a la
-- CSP (`img-src`), politicas propias y URLs firmadas que caducan. Para una
-- imagen de <=240 px que se muestra en una caratula, el data URL entra en la
-- misma request que ya hacemos, no toca la CSP (`img-src` ya admite `data:`) y
-- no puede quedar colgado apuntando a un objeto borrado. El limite de 400 kB de
-- abajo es el que hace que esa decision se sostenga en el tiempo.
--
-- RLS: espejo de `fleetrooms`/`partners`.
--   SELECT  — cualquier autenticado interno; un partner solo el suyo (my_clids).
--   ESCRIBE — admin o quien tenga el grant `write:config`, igual que el CRUD de
--             partners que vive al lado en la misma pantalla.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.partner_logos (
  clid        text PRIMARY KEY REFERENCES public.partners(clid) ON DELETE CASCADE,
  mime        text NOT NULL,
  data        text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Solo mapas de bits que el navegador dibuje sin plugins. SVG queda AFUERA a
  -- proposito: es XML ejecutable (puede traer <script>) y se renderiza con los
  -- privilegios de la pagina.
  CONSTRAINT partner_logos_mime_chk CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  -- El cliente redimensiona a 240 px antes de subir, asi que 400 kB es varias
  -- veces lo necesario. El limite existe para que un error de codigo o una
  -- llamada directa a la API no puedan meter un archivo de camara de 8 MB en
  -- una tabla que se lee entera.
  CONSTRAINT partner_logos_size_chk CHECK (length(data) <= 400000),
  CONSTRAINT partner_logos_dataurl_chk CHECK (data LIKE 'data:image/%;base64,%')
);

ALTER TABLE public.partner_logos ENABLE ROW LEVEL SECURITY;

-- GRANT explicito. Las tablas creadas a mano desde el panel heredaron los
-- privilegios por defecto del esquema; una creada por migracion NO, y sin esto
-- PostgREST devuelve "permission denied for table partner_logos" ANTES de
-- evaluar RLS — un error que no menciona ni la tabla nueva ni el grant faltante.
-- El recorte real lo siguen haciendo las politicas de abajo, no el grant.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_logos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_logos TO service_role;

DROP POLICY IF EXISTS partner_logos_select ON public.partner_logos;
CREATE POLICY partner_logos_select ON public.partner_logos
  FOR SELECT TO authenticated
  USING ((NOT (SELECT is_partner())) OR clid = ANY (my_clids()));

DROP POLICY IF EXISTS partner_logos_insert ON public.partner_logos;
CREATE POLICY partner_logos_insert ON public.partner_logos
  FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR (SELECT can('write:config')));

DROP POLICY IF EXISTS partner_logos_update ON public.partner_logos;
CREATE POLICY partner_logos_update ON public.partner_logos
  FOR UPDATE TO authenticated
  USING (is_admin() OR (SELECT can('write:config')))
  WITH CHECK (is_admin() OR (SELECT can('write:config')));

DROP POLICY IF EXISTS partner_logos_delete ON public.partner_logos;
CREATE POLICY partner_logos_delete ON public.partner_logos
  FOR DELETE TO authenticated
  USING (is_admin() OR (SELECT can('write:config')));

-- Auditoria: mismo trigger que las otras 10 tablas. `false` = no guardar el
-- payload viejo/nuevo (seria el base64 entero en cada cambio); alcanza con
-- saber QUIEN cambio el logo de QUE partner y cuando.
DROP TRIGGER IF EXISTS audit_partner_logos ON public.partner_logos;
CREATE TRIGGER audit_partner_logos
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_logos
  FOR EACH ROW EXECUTE FUNCTION audit_trigger('false', 'clid');
