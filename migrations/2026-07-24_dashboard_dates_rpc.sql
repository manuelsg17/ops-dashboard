-- Lista de períodos disponibles por escala (Fase A3: paginación por ventana).
--
-- PROBLEMA que resuelve: hoy el sidebar arma sus selectores "Desde"/"Hasta" con
-- las fechas DISTINCT de los datos ya cargados en memoria. Eso funciona porque
-- se carga la tabla ENTERA. Al pasar a cargar solo una ventana (últimas N
-- semanas), esa lista se recortaría y el usuario perdería la posibilidad de
-- elegir fechas viejas — se quedaría encerrado en la ventana inicial.
--
-- Solución: una función que devuelve SOLO los períodos distintos (37 filas en
-- semanal, 18 en mensual, ~90 en diario) — payload despreciable, una sola
-- request — para poblar los selectores, independiente de qué ventana de DATOS
-- esté cargada.
--
-- SECURITY INVOKER (el default, explícito acá para que se lea la intención):
-- corre con los permisos de QUIEN LLAMA, así que la RLS de las tablas aplica
-- igual. Un usuario 'partner' verá solo los períodos en los que SU CLID tiene
-- datos, no el calendario completo del dashboard. NO usar SECURITY DEFINER acá:
-- filtraría a los partners qué semanas existen para el resto.

CREATE OR REPLACE FUNCTION public.dashboard_dates(scale text)
RETURNS TABLE (periodo text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF scale = 'semanal' THEN
    RETURN QUERY SELECT DISTINCT r.fecha::text FROM public.rendimiento r
                  WHERE r.fecha IS NOT NULL ORDER BY 1;
  ELSIF scale = 'mensual' THEN
    RETURN QUERY SELECT DISTINCT r.mes::text FROM public.rendimiento_mensual r
                  WHERE r.mes IS NOT NULL ORDER BY 1;
  ELSIF scale = 'diario' THEN
    RETURN QUERY SELECT DISTINCT r.date::text FROM public.rendimiento_diario r
                  WHERE r.date IS NOT NULL ORDER BY 1;
  ELSE
    RAISE EXCEPTION 'escala invalida: % (esperado: semanal|mensual|diario)', scale;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_dates(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dashboard_dates(text) FROM PUBLIC, anon;
