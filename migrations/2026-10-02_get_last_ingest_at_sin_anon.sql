-- get_last_ingest_at: solo para usuarios con sesión (2-oct-2026).
-- Auditoría del portal del partner: era la única función SECURITY DEFINER que
-- `anon` (sin login, con la clave pública) podía ejecutar. Solo devolvía la hora
-- de la última carga de datos, sin datos de partners, pero no hay motivo para
-- exponerla: la app la llama siempre con sesión (badge de frescura).
REVOKE EXECUTE ON FUNCTION public.get_last_ingest_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_ingest_at() TO authenticated;
