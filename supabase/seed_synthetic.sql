-- ============================================================================
-- DATOS SINTETICOS para el entorno local. NADA de esto es real: los CLID son
-- 9000000000xx (rango inexistente en produccion) y los nombres son inventados.
--
-- DISEÑADO PARA VERIFICAR A OJO. Los volumenes son redondos y la relacion entre
-- ellos es exacta, asi que cualquier desvio en el reparto se ve sin calculadora.
--
-- El caso que reproduce: TukTuk concentrado en LIMA (igual que produccion, donde
-- Arequipa y Trujillo tienen cero), un partner solo-TukTuk sin operacion de taxi
-- (el caso PIAGGIO), y un partner sin TukTuk que sirve de control.
--
-- Aplicar:  psql "postgresql://postgres:postgres@127.0.0.1:54332/postgres" -f supabase/seed_synthetic.sql
-- ============================================================================

BEGIN;

TRUNCATE public.rendimiento_mensual, public.rendimiento, public.metas,
         public.fleetrooms, public.partners RESTART IDENTITY CASCADE;

-- ── PARTNERS ────────────────────────────────────────────────────────────────
INSERT INTO public.partners (clid, partner, kam, city, is_fleet, is_tuktuk) VALUES
  ('900000000001', 'ALFA MOVILIDAD',  'Ana',  'LIMA',     false, false),
  ('900000000002', 'BETA TRANSPORTE', 'Ana',  'LIMA',     false, false),
  ('900000000003', 'GAMMA SUR',       'Ana',  'AREQUIPA', false, false),
  ('900000000004', 'DELTA EXPRESS',   'Beto', 'LIMA',     true,  false),
  ('900000000005', 'EPSILON NORTE',   'Beto', 'TRUJILLO', false, false),
  ('900000000006', 'ZETA TUKTUK',     'Ana',  'LIMA',     false, true);

-- ── FLEETROOMS (el tagging que decide la linea de negocio) ──────────────────
-- Un db_id sin fila aca cae al flag del CLID (partners.is_tuktuk).
INSERT INTO public.fleetrooms (db_id, clid, name, kam, city, is_fleet, is_tuktuk, exclude_from_taxi) VALUES
  ('db-alfa-taxi',  '900000000001', 'Alfa Taxi',      'Ana',  'LIMA',     false, false, false),
  ('db-alfa-tk',    '900000000001', 'Alfa TukTuk',    'Ana',  'LIMA',     false, true,  false),
  ('db-beta-taxi',  '900000000002', 'Beta Taxi',      'Ana',  'LIMA',     false, false, false),
  ('db-gamma-taxi', '900000000003', 'Gamma Taxi',     'Ana',  'AREQUIPA', false, false, false),
  ('db-delta-taxi', '900000000004', 'Delta Taxi',     'Beto', 'LIMA',     true,  false, false),
  ('db-delta-tk',   '900000000004', 'Delta TukTuk',   'Beto', 'LIMA',     false, true,  false),
  ('db-delta-dlv',  '900000000004', 'Delta Delivery', 'Beto', 'LIMA',     false, false, true),
  ('db-eps-taxi',   '900000000005', 'Epsilon Taxi',   'Beto', 'TRUJILLO', false, false, false),
  ('db-zeta-tk',    '900000000006', 'Zeta TukTuk',    'Ana',  'LIMA',     false, true,  false);

-- ── RENDIMIENTO MENSUAL ─────────────────────────────────────────────────────
-- 3 meses para que funcione el promedio 3M; el reparto usa SOLO 2026-07.
-- Convenciones: SH = AD × 50, N+R = AD ÷ 10 (repartido entre las 3 fuentes).
INSERT INTO public.rendimiento_mensual
  (clid, partner, kam, city, mes, db_id, fleetroom, active_drivers, supply_hours,
   new_from_partner, new_from_service, reactivated, trips, gmv, acceptance_rate)
SELECT d.clid, p.partner, p.kam, d.city, m.mes, d.db_id, d.fleetroom,
       (d.ad * m.factor)::numeric,
       (d.ad * m.factor * 50)::numeric,
       (d.ad * m.factor * 0.06)::numeric,
       (d.ad * m.factor * 0.03)::numeric,
       (d.ad * m.factor * 0.01)::numeric,
       (d.ad * m.factor * 20)::numeric,
       (d.ad * m.factor * 300)::numeric,
       0.85
FROM (VALUES
  -- clid,           city,       db_id,          fleetroom,        AD en 2026-07
  ('900000000001', 'LIMA',     'db-alfa-taxi',  'Alfa Taxi',      1000),
  ('900000000001', 'LIMA',     'db-alfa-tk',    'Alfa TukTuk',     200),
  ('900000000002', 'LIMA',     'db-beta-taxi',  'Beta Taxi',      1000),
  ('900000000003', 'AREQUIPA', 'db-gamma-taxi', 'Gamma Taxi',      500),
  ('900000000004', 'LIMA',     'db-delta-taxi', 'Delta Taxi',      800),
  ('900000000004', 'LIMA',     'db-delta-tk',   'Delta TukTuk',    300),
  ('900000000004', 'LIMA',     'db-delta-dlv',  'Delta Delivery',   50),
  ('900000000005', 'TRUJILLO', 'db-eps-taxi',   'Epsilon Taxi',    400),
  ('900000000006', 'LIMA',     'db-zeta-tk',    'Zeta TukTuk',     100)
) AS d(clid, city, db_id, fleetroom, ad)
CROSS JOIN (VALUES ('2026-05', 0.8), ('2026-06', 0.9), ('2026-07', 1.0)) AS m(mes, factor)
JOIN public.partners p ON p.clid = d.clid;

-- Espejo semanal (4 semanas de julio) para que la escala semanal no quede vacia.
INSERT INTO public.rendimiento
  (clid, partner, kam, city, fecha, db_id, fleetroom, active_drivers, supply_hours,
   new_from_partner, new_from_service, reactivated, trips, gmv, acceptance_rate)
SELECT r.clid, r.partner, r.kam, r.city, w.fecha, r.db_id, r.fleetroom,
       (r.active_drivers * 0.25)::numeric, (r.supply_hours * 0.25)::numeric,
       (r.new_from_partner * 0.25)::numeric, (r.new_from_service * 0.25)::numeric,
       (r.reactivated * 0.25)::numeric, (r.trips * 0.25)::numeric,
       (r.gmv * 0.25)::numeric, 0.85
FROM public.rendimiento_mensual r
CROSS JOIN (VALUES ('2026-07-06'::date), ('2026-07-13'), ('2026-07-20'), ('2026-07-27')) AS w(fecha)
WHERE r.mes = '2026-07';

COMMIT;

-- ── LO QUE TIENE QUE DAR (verificacion) ─────────────────────────────────────
--
-- KAM Ana, julio, AD:
--   base TAXI  (modelo viejo) = 1000 + 1000 + 500              = 2.500
--   base COMBINADA (nueva)    = 1200 + 1000 + 500 + 100        = 2.800
--   → el goal de Ana tiene que subir 12,0%
--
-- KAM Beto, julio, AD (delivery NO entra, ni antes ni ahora):
--   base TAXI      = 800 + 400        = 1.200
--   base COMBINADA = 1100 + 400       = 1.500
--   → +25,0%
--
-- INVARIANTE FUERTE: si se carga goal AD = 2800 para Ana, la cuota de cada
-- partner debe salir EXACTAMENTE igual a su volumen actual (ALFA 1200,
-- BETA 1000, GAMMA 500, ZETA 100). Cualquier otro numero es un bug de reparto.
