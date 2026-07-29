-- access_log — registro de USO del dashboard (quién abrió qué, quién descargó qué).
--
-- POR QUÉ UNA TABLA NUEVA Y NO audit_log:
-- `audit_log` es tamper-evident A PROPÓSITO — no tiene ninguna política de
-- INSERT, solo escribe el trigger `audit_trigger()` (SECURITY DEFINER). Esa es
-- justamente su garantía: ni un admin puede fabricar o borrar historia de
-- cambios vía API. Darle INSERT al cliente para poder loguear descargas
-- destruiría esa propiedad, así que la telemetría de uso vive aparte.
--
-- DIFERENCIA DE CONFIANZA (importante, no es un detalle):
--   audit_log  → lo escribe Postgres. Es evidencia.
--   access_log → lo escribe el NAVEGADOR. Es telemetría: sirve para saber si
--                los partners entran y qué usan, NO para auditoría de
--                seguridad. Un usuario podría no reportar un evento (bloquear
--                la request) o reportar uno falso. Nunca tomar una decisión de
--                seguridad en base a esta tabla.
--
-- APLICAR: SQL editor de Supabase, o `apply_migration` vía MCP.

CREATE TABLE IF NOT EXISTS public.access_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    uuid        NOT NULL DEFAULT auth.uid(),
  user_email text,
  -- 'login' | 'tab' | 'download_pdf' | 'download_csv' | 'upload'
  event      text        NOT NULL,
  -- Detalle libre y CORTO: nombre de tab, del archivo, del partner del deck.
  -- Nada de payloads ni datos personales: esto se consulta en una tabla, no se
  -- usa para reconstruir el estado de la app.
  detail     text,
  CONSTRAINT access_log_event_chk CHECK (event IN
    ('login','tab','download_pdf','download_csv','upload')),
  CONSTRAINT access_log_detail_len CHECK (detail IS NULL OR length(detail) <= 200)
);

CREATE INDEX IF NOT EXISTS access_log_at_idx      ON public.access_log (at DESC);
CREATE INDEX IF NOT EXISTS access_log_user_at_idx ON public.access_log (user_id, at DESC);

ALTER TABLE public.access_log ENABLE ROW LEVEL SECURITY;

-- INSERT: cualquier usuario autenticado registra SUS PROPIOS eventos. El
-- WITH CHECK sobre auth.uid() impide que alguien escriba eventos a nombre de
-- otro (que sería la forma obvia de ensuciar el registro).
DROP POLICY IF EXISTS access_log_insert_own ON public.access_log;
CREATE POLICY access_log_insert_own ON public.access_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

-- SELECT: solo admin. Un partner no tiene por qué ver la actividad de nadie,
-- ni siquiera la propia (no le aporta y expone la existencia de otras cuentas).
DROP POLICY IF EXISTS access_log_select_admin ON public.access_log;
CREATE POLICY access_log_select_admin ON public.access_log
  FOR SELECT TO authenticated
  USING ((select public.is_admin()));

-- Sin políticas de UPDATE/DELETE: nadie edita el registro desde la API. La
-- purga se hace a mano con el comando de abajo.

-- ── RETENCIÓN ───────────────────────────────────────────────────────────────
-- Telemetría de uso: 90 días alcanzan de sobra para responder "¿este partner
-- entra?". Correr de vez en cuando (no hay cron en el plan gratuito):
--
--   DELETE FROM public.access_log WHERE at < now() - interval '90 days';

-- ── VERIFICACIÓN POST-APLICACIÓN ────────────────────────────────────────────
-- 1) Un usuario autenticado puede insertar SU evento y no el de otro:
--      BEGIN;
--        SET LOCAL role authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<uuid-real>","role":"authenticated"}';
--        INSERT INTO public.access_log (event, detail) VALUES ('tab','rend');        -- OK
--        INSERT INTO public.access_log (user_id, event) VALUES (gen_random_uuid(),'tab'); -- 42501
--      ROLLBACK;
-- 2) Un no-admin no lee nada:
--      SELECT count(*) FROM public.access_log;   -- 0 filas con JWT no-admin
