-- ============================================================================
-- DATOS SINTETICOS para el entorno local. NADA de esto es real: los CLID son
-- 9000000000xx (rango inexistente en produccion) y los nombres son inventados.
--
-- POR QUE ESTA VERSION. La primera generaba las metricas escalando AD, horas y
-- viajes con el MISMO factor, asi que los RATIOS (horas/conductor, viajes/hora,
-- viajes/conductor) salian constantes y la seccion Productividad mostraba +0,0%
-- siempre: no probaba nada. Aca cada metrica se mueve con su propio ruido, asi
-- que los ratios varian de verdad y esa vista se puede verificar.
--
-- REPRODUCIBLE, no arbitrario: setseed() fija la secuencia, asi que dos corridas
-- dan exactamente los mismos numeros. Sin eso, cada reset cambiaria los datos y
-- ninguna verificacion seria repetible.
--
-- COHERENTE ENTRE ESCALAS: la semanal es la fuente; mensual y diaria se DERIVAN
-- de ella (flujos se suman, snapshots no). Si cada escala se generara por
-- separado, el dashboard mostraria totales que no cierran entre si y estariamos
-- persiguiendo bugs que solo existen en los datos de prueba.
--
-- Aplicar:  psql "postgresql://postgres:postgres@127.0.0.1:54332/postgres" -f supabase/seed_synthetic.sql
-- ============================================================================

BEGIN;
SELECT setseed(0.42);

TRUNCATE public.rendimiento_mensual, public.rendimiento, public.rendimiento_diario,
         public.metas, public.fleetrooms, public.partners RESTART IDENTITY CASCADE;

-- ── PARTNERS ────────────────────────────────────────────────────────────────
-- 10 partners / 3 KAMs / 3 ciudades. Tamaños deliberadamente dispares para que
-- las cohortes (Top 1 / Top 2-3 / Top 4-5 / Top 6-10) tengan de que agruparse.
INSERT INTO public.partners (clid, partner, kam, city, is_fleet, is_tuktuk) VALUES
  ('900000000001', 'ALFA MOVILIDAD',  'Ana',    'LIMA',     false, false),
  ('900000000002', 'BETA TRANSPORTE', 'Ana',    'LIMA',     false, false),
  ('900000000003', 'GAMMA SUR',       'Ana',    'AREQUIPA', false, false),
  ('900000000004', 'DELTA EXPRESS',   'Beto',   'LIMA',     true,  false),
  ('900000000005', 'EPSILON NORTE',   'Beto',   'TRUJILLO', false, false),
  ('900000000006', 'ZETA TUKTUK',     'Ana',    'LIMA',     false, true),
  ('900000000007', 'ETA GRANDE',      'Carla',  'LIMA',     false, false),
  ('900000000008', 'THETA FLEET',     'Carla',  'LIMA',     true,  false),
  ('900000000009', 'IOTA CHICO',      'Beto',   'AREQUIPA', false, false),
  ('900000000010', 'KAPPA TRUJILLO',  'Carla',  'TRUJILLO', false, false);

-- ── FLEETROOMS (el tagging que decide la linea de negocio) ──────────────────
INSERT INTO public.fleetrooms (db_id, clid, name, kam, city, is_fleet, is_tuktuk, exclude_from_taxi) VALUES
  ('db-alfa-taxi',  '900000000001', 'Alfa Taxi',      'Ana',   'LIMA',     false, false, false),
  ('db-alfa-tk',    '900000000001', 'Alfa TukTuk',    'Ana',   'LIMA',     false, true,  false),
  ('db-beta-taxi',  '900000000002', 'Beta Taxi',      'Ana',   'LIMA',     false, false, false),
  ('db-gamma-taxi', '900000000003', 'Gamma Taxi',     'Ana',   'AREQUIPA', false, false, false),
  ('db-delta-taxi', '900000000004', 'Delta Taxi',     'Beto',  'LIMA',     true,  false, false),
  ('db-delta-tk',   '900000000004', 'Delta TukTuk',   'Beto',  'LIMA',     false, true,  false),
  ('db-delta-dlv',  '900000000004', 'Delta Delivery', 'Beto',  'LIMA',     false, false, true),
  ('db-eps-taxi',   '900000000005', 'Epsilon Taxi',   'Beto',  'TRUJILLO', false, false, false),
  ('db-zeta-tk',    '900000000006', 'Zeta TukTuk',    'Ana',   'LIMA',     false, true,  false),
  ('db-eta-taxi',   '900000000007', 'Eta Taxi',       'Carla', 'LIMA',     false, false, false),
  ('db-theta-taxi', '900000000008', 'Theta Taxi',     'Carla', 'LIMA',     true,  false, false),
  ('db-iota-taxi',  '900000000009', 'Iota Taxi',      'Beto',  'AREQUIPA', false, false, false),
  ('db-kappa-taxi', '900000000010', 'Kappa Taxi',     'Carla', 'TRUJILLO', false, false, false);

-- ── SEMANAL: la fuente de verdad ────────────────────────────────────────────
-- 16 semanas (abr → jul 2026). Cada sub-flota tiene su AD base, su tendencia
-- propia y ruido; los RATIOS se sortean aparte, asi que horas/conductor y
-- viajes/hora se mueven independientes del volumen. Ese es el punto de esta
-- version: sin eso, Productividad no tiene nada que mostrar.
CREATE TEMP TABLE _sub(clid text, city text, db_id text, fleetroom text, ad_base int, trend numeric) ON COMMIT DROP;
INSERT INTO _sub VALUES
  ('900000000001','LIMA',    'db-alfa-taxi', 'Alfa Taxi',      1000,  0.010),  -- crece leve
  ('900000000001','LIMA',    'db-alfa-tk',   'Alfa TukTuk',     200,  0.020),
  ('900000000002','LIMA',    'db-beta-taxi', 'Beta Taxi',      1000, -0.018),  -- CAE (alertas)
  ('900000000003','AREQUIPA','db-gamma-taxi','Gamma Taxi',      500,  0.004),
  ('900000000004','LIMA',    'db-delta-taxi','Delta Taxi',      800,  0.015),
  ('900000000004','LIMA',    'db-delta-tk',  'Delta TukTuk',    300,  0.012),
  ('900000000004','LIMA',    'db-delta-dlv', 'Delta Delivery',   50,  0.000),  -- delivery: fuera de Taxi
  ('900000000005','TRUJILLO','db-eps-taxi',  'Epsilon Taxi',    400,  0.002),
  ('900000000006','LIMA',    'db-zeta-tk',   'Zeta TukTuk',     100,  0.030),  -- solo-TukTuk, crece
  ('900000000007','LIMA',    'db-eta-taxi',  'Eta Taxi',       2400,  0.006),  -- Top 1
  ('900000000008','LIMA',    'db-theta-taxi','Theta Taxi',      650,  0.008),
  ('900000000009','AREQUIPA','db-iota-taxi', 'Iota Taxi',        90, -0.005),  -- park chico
  ('900000000010','TRUJILLO','db-kappa-taxi','Kappa Taxi',      320,  0.011);

INSERT INTO public.rendimiento
  (clid, partner, kam, city, fecha, db_id, fleetroom, active_drivers, supply_hours,
   new_from_partner, new_from_service, reactivated, trips, gmv, commission,
   acceptance_rate, completion_rate, trips_per_hour, money_per_hour, active_cars,
   branded_active_cars, owned_fleet_active_cars, internal_fleet_sh, external_fleet_sh,
   bad_rated_trips_share, fraud_trips_share, driver_subsidies_by_gmv,
   driver_support_requests_share, new_drivers, avg_driver_rating)
SELECT s.clid, p.partner, p.kam, s.city, w.fecha, s.db_id, s.fleetroom,
       g.ad,
       round(g.ad * g.sh_por_cond, 2)                       AS supply_hours,
       g.np, g.ns, g.re,
       round(g.ad * g.sh_por_cond * g.tph)                  AS trips,
       round(g.ad * g.sh_por_cond * g.tph * g.tarifa, 2)    AS gmv,
       round(g.ad * g.sh_por_cond * g.tph * g.tarifa * 0.032, 2) AS commission,
       g.acc, g.comp, round(g.tph, 4)                       AS trips_per_hour,
       round(g.tph * g.tarifa, 4)                           AS money_per_hour,
       round(g.ad * 0.78)                                   AS active_cars,
       round(g.ad * 0.31)                                   AS branded_active_cars,
       round(g.ad * 0.24)                                   AS owned_fleet_active_cars,
       round(g.ad * g.sh_por_cond * 0.22, 2)                AS internal_fleet_sh,
       round(g.ad * g.sh_por_cond * 0.78, 2)                AS external_fleet_sh,
       g.bad, g.fraude, g.subsidio, g.soporte,
       g.np + g.ns                                          AS new_drivers,
       g.rating
FROM _sub s
JOIN public.partners p ON p.clid = s.clid
-- ::date explicito: generate_series sobre fechas devuelve TIMESTAMP, y entonces
-- (fecha - date) da un interval en vez de un entero de dias — el calculo de la
-- tendencia falla con "operator does not exist: integer + interval".
CROSS JOIN LATERAL (SELECT generate_series('2026-04-06'::date, '2026-07-27'::date, '7 days')::date AS fecha) w
CROSS JOIN LATERAL (
  SELECT
    -- VOLUMEN: base × tendencia acumulada × ruido propio
    greatest(1, round(s.ad_base
       * (1 + s.trend * ((w.fecha - '2026-04-06'::date) / 7))
       * (0.94 + random() * 0.12)))::numeric                       AS ad,
    -- RATIOS SORTEADOS APARTE (la clave de esta version): no derivan del volumen
    (36 + random() * 22)::numeric                                   AS sh_por_cond,  -- 36–58 h/cond
    (1.55 + random() * 0.85)::numeric                               AS tph,          -- 1,55–2,40 viajes/h
    (11.5 + random() * 5.0)::numeric                                AS tarifa,       -- money/trip
    round((0.74 + random() * 0.21)::numeric, 4)                     AS acc,          -- 0,74–0,95
    round((0.88 + random() * 0.10)::numeric, 4)                     AS comp,
    round((0.005 + random() * 0.045)::numeric, 4)                   AS bad,
    round((0.001 + random() * 0.012)::numeric, 4)                   AS fraude,
    round((0.01 + random() * 0.06)::numeric, 4)                     AS subsidio,
    round((0.02 + random() * 0.09)::numeric, 4)                     AS soporte,
    round((3.9 + random() * 1.0)::numeric, 2)                       AS rating,
    greatest(0, round(s.ad_base * (0.020 + random() * 0.045)))::numeric AS np,       -- propios
    greatest(0, round(s.ad_base * (0.008 + random() * 0.022)))::numeric AS ns,       -- self-reg
    greatest(0, round(s.ad_base * (0.003 + random() * 0.010)))::numeric AS re
) g;

-- ── MENSUAL: DERIVADO del semanal ───────────────────────────────────────────
-- Flujos se SUMAN; los snapshots (AD, autos) NO: se toma el maximo de las
-- semanas del mes y se le suma un 12% por los conductores que aparecen en unas
-- semanas y no en otras — un mes siempre tiene mas conductores distintos que
-- cualquiera de sus semanas. Las TASAS se re-ponderan por viajes, nunca se
-- promedian planas (promediar ratios ya calculados pierde precision).
INSERT INTO public.rendimiento_mensual
  (clid, partner, kam, city, mes, db_id, fleetroom, active_drivers, supply_hours,
   new_from_partner, new_from_service, reactivated, trips, gmv, commission,
   acceptance_rate, completion_rate, trips_per_hour, money_per_hour, active_cars,
   branded_active_cars, owned_fleet_active_cars, internal_fleet_sh, external_fleet_sh,
   bad_rated_trips_share, fraud_trips_share, driver_subsidies_by_gmv,
   driver_support_requests_share, new_drivers, avg_driver_rating)
SELECT clid, partner, kam, city,
       to_char(fecha + 3, 'YYYY-MM')                AS mes,   -- mes del jueves (= p2ReportYM)
       db_id, max(fleetroom),
       round(max(active_drivers) * 1.12)            AS active_drivers,
       round(sum(supply_hours), 2),
       sum(new_from_partner), sum(new_from_service), sum(reactivated),
       sum(trips), round(sum(gmv), 2), round(sum(commission), 2),
       round(sum(acceptance_rate * trips) / nullif(sum(trips), 0), 4),
       round(sum(completion_rate * trips) / nullif(sum(trips), 0), 4),
       round(sum(trips) / nullif(sum(supply_hours), 0), 4),
       round(sum(gmv)   / nullif(sum(supply_hours), 0), 4),
       round(max(active_cars) * 1.12), round(max(branded_active_cars) * 1.12),
       round(max(owned_fleet_active_cars) * 1.12),
       round(sum(internal_fleet_sh), 2), round(sum(external_fleet_sh), 2),
       round(sum(bad_rated_trips_share * trips) / nullif(sum(trips), 0), 4),
       round(sum(fraud_trips_share * trips) / nullif(sum(trips), 0), 4),
       round(sum(driver_subsidies_by_gmv * gmv) / nullif(sum(gmv), 0), 4),
       round(sum(driver_support_requests_share * trips) / nullif(sum(trips), 0), 4),
       sum(new_drivers),
       round(sum(avg_driver_rating * trips) / nullif(sum(trips), 0), 2)
  FROM public.rendimiento
 GROUP BY clid, partner, kam, city, to_char(fecha + 3, 'YYYY-MM'), db_id;

-- ── DIARIO: DERIVADO del semanal (ultimas 8 semanas) ────────────────────────
-- OJO: rendimiento_diario NO tiene partner ni kam, y usa new_partner/new_service
-- en vez de new_from_*. Es la diferencia que rompio la ingesta automatica en jul
-- 2026; el seed la respeta a proposito para que el entorno local la reproduzca.
-- Los dias no son la semana/7 exacta: llevan su propio ruido y un factor de dia
-- de semana (domingo flojo, viernes fuerte), si no las tendencias diarias serian
-- una linea recta y no probarian nada.
INSERT INTO public.rendimiento_diario
  (clid, city, date, db_id, fleetroom, active_drivers, supply_hours,
   new_partner, new_service, reactivated, trips, gmv, commission,
   acceptance_rate, completion_rate, trips_per_hour, money_per_hour, active_cars,
   branded_active_cars, owned_fleet_active_cars, internal_fleet_sh, external_fleet_sh,
   bad_rated_trips_share, fraud_trips_share, new_drivers, avg_driver_rating)
SELECT r.clid, r.city, r.fecha + d.n, r.db_id, r.fleetroom,
       greatest(1, round(r.active_drivers * 0.42 * d.dow * (0.9 + random() * 0.2))),
       round((r.supply_hours / 7 * d.dow * (0.9 + random() * 0.2))::numeric, 2),
       round(r.new_from_partner / 7.0 * (0.7 + random() * 0.6)),
       round(r.new_from_service / 7.0 * (0.7 + random() * 0.6)),
       round(r.reactivated      / 7.0 * (0.7 + random() * 0.6)),
       round(r.trips / 7 * d.dow * (0.9 + random() * 0.2)),
       round((r.gmv   / 7 * d.dow * (0.9 + random() * 0.2))::numeric, 2),
       round((r.commission / 7 * d.dow * (0.9 + random() * 0.2))::numeric, 2),
       round(least(1, r.acceptance_rate * (0.97 + random() * 0.06))::numeric, 4),
       round(least(1, r.completion_rate * (0.98 + random() * 0.04))::numeric, 4),
       round((r.trips_per_hour * (0.93 + random() * 0.14))::numeric, 4),
       round((r.money_per_hour * (0.93 + random() * 0.14))::numeric, 4),
       round(r.active_cars * 0.42 * d.dow), round(r.branded_active_cars * 0.42 * d.dow),
       round(r.owned_fleet_active_cars * 0.42 * d.dow),
       round((r.internal_fleet_sh / 7 * d.dow)::numeric, 2), round((r.external_fleet_sh / 7 * d.dow)::numeric, 2),
       r.bad_rated_trips_share, r.fraud_trips_share,
       round(r.new_drivers / 7.0 * (0.7 + random() * 0.6)),
       r.avg_driver_rating
  FROM public.rendimiento r
  CROSS JOIN LATERAL (VALUES (0,1.02),(1,1.00),(2,1.01),(3,1.06),(4,1.18),(5,1.10),(6,0.83)) AS d(n, dow)
 WHERE r.fecha >= '2026-06-01';

COMMIT;

-- ── QUE TIENE QUE DAR (invariantes, no numeros fijos) ───────────────────────
--
-- Los numeros concretos cambian si se toca el setseed o los parametros, asi que
-- lo que se verifica son INVARIANTES — valen para cualquier corrida:
--
-- 1. REPARTO. Con un KAM elegido y goal = base del reparto, la cuota de cada
--    partner debe salir EXACTAMENTE igual a su propio volumen, y la suma = goal.
--    Cualquier otra cosa es un bug de reparto. (La base la muestra la propia
--    calculadora arriba del formulario.)
--
-- 2. PRODUCTIVIDAD. horas/conductor, viajes/hora y viajes/conductor tienen que
--    MOVERSE entre periodos. Si alguno da +0,0% constante, o el dato no llegó o
--    el ratio se esta calculando sobre numerador y denominador acoplados.
--
-- 3. ESCALAS COHERENTES. Los flujos del mes = suma de sus semanas (mismo
--    partner, mismo mes). Los snapshots NO: el AD mensual es mayor que el de
--    cualquiera de sus semanas, nunca la suma.
--
-- 4. TASAS EN FRACCION. Ninguna columna de tasa puede superar 1 en ninguna
--    escala. Si aparece un 65,6 en vez de 0,656, es el bug de escala 0-100.
--
-- 5. DELIVERY AFUERA. La sub-flota db-delta-dlv (exclude_from_taxi) no puede
--    aparecer en ninguna base de reparto ni en los totales de Agregador.
--
-- 6. SOLO-TUKTUK PRESENTE. ZETA TUKTUK no tiene operacion Taxi y aun asi debe
--    aparecer en el sidebar y recibir cuota (caso PIAGGIO).
--
-- Chequeo rapido de los invariantes 2, 3 y 4:
--
--   SELECT mes, round(sum(supply_hours)/sum(active_drivers),2) sh_cond,
--          round(sum(trips)/sum(supply_hours),3) viajes_hora,
--          round(max(acceptance_rate),3) acc_max
--     FROM rendimiento_mensual GROUP BY mes ORDER BY mes;
--   -- sh_cond y viajes_hora tienen que variar entre meses; acc_max <= 1.
