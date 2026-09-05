-- ============================================================================
-- DATOS SINTETICOS para el entorno local. NADA de esto es real: los CLID son
-- 9000000000xx (rango inexistente en produccion) y los nombres son inventados.
--
-- QUE SE COPIA Y QUE NO (sep 2026). Se copia la FORMA de los tres partners
-- grandes de produccion (Yego, Lizzo, TRANSPOTAXI) — su escala, su volatilidad,
-- sus ratios, su reparto entre ciudades y verticales — medida con consultas
-- agregadas. NO se copia ni una sola fila real: los valores se generan aca. Es
-- la regla del proyecto (ver CLAUDE.md, sesion de agosto 2026) y ademas es lo
-- unico que sirve: lo que hace realista una prueba es el COMPORTAMIENTO
-- (volatilidad, proporciones, huecos), no los digitos.
--
-- FORMA MEDIDA EN PRODUCCION (14 semanas, media por semana):
--   perfil A "muy estable, multi-ciudad, todas las verticales"
--     LIMA 2.351 AD (CV 6,6%) · TRUJILLO 209 (CV 48%) · AREQUIPA 126 (CV 50%)
--     TukTuk 84 · Delivery 2 · Cargo 2 · 86 perfiles propios/sem · activacion 34%
--   perfil B "grande con TukTuk fuerte"
--     LIMA 1.167 (CV 11%) + TukTuk 819 · AREQUIPA 149 · TRUJILLO 65
--     21 perfiles/sem · activacion 42%
--   perfil C "volatil, TukTuk grande, delivery erratico"
--     LIMA 1.710 (CV 35%) + TukTuk 683 + Delivery · TRUJILLO 152 · AREQUIPA 64
--     19 perfiles/sem · activacion 25%
--   ratios comunes: horas/conductor 14-24 por semana · viajes/hora 1,5 taxi /
--   3,9 tuktuk / 2,2 provincias · aceptacion 0,57-0,68 · completion ~0,75 ·
--   mal calificados ~0,059 · USD/hora 5,5-6,4 · rating 4,81-4,85 (no distingue
--   a nadie, por eso NO esta en el benchmark del deck).
--
-- POR QUE IMPORTA QUE LOS RATIOS SEAN REALISTAS. Con la version anterior
-- (aceptacion 0,74-0,95, horas/conductor 36-58) el benchmark del deck comparaba
-- contra medianas que no existen, la hoja de Captacion no tenia con que
-- dibujarse (faltaban las columnas del embudo) y la Trayectoria salia plana.
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
-- 12 partners / 3 KAMs / 3 ciudades. Los tres primeros imitan la forma de los
-- grandes de produccion; el resto existe para que las COHORTES tengan contra
-- que compararse: el benchmark del deck exige >=3 pares con 50+ activos EN LAS
-- MISMAS CIUDADES, asi que sin relleno por ciudad esa tira no se dibuja.
INSERT INTO public.partners (clid, partner, kam, city, is_fleet, is_tuktuk) VALUES
  ('900000000001', 'ANDINA MOVILIDAD', 'Ana',   'LIMA',     true,  false),
  ('900000000002', 'RUTA SUR',         'Ana',   'LIMA',     false, false),
  ('900000000003', 'EXPRESO CAPITAL',  'Beto',  'LIMA',     true,  false),
  ('900000000004', 'TAXI PACIFICO',    'Beto',  'LIMA',     false, false),
  ('900000000005', 'NORTE SEGURO',     'Carla', 'TRUJILLO', false, false),
  ('900000000006', 'MOTOS DEL SUR',    'Ana',   'LIMA',     false, true),
  ('900000000007', 'VIA RAPIDA',       'Carla', 'LIMA',     false, false),
  ('900000000008', 'FLOTA CENTRAL',    'Carla', 'LIMA',     true,  false),
  ('900000000009', 'AREQUIPA GO',      'Beto',  'AREQUIPA', false, false),
  ('900000000010', 'COSTA VERDE',      'Ana',   'TRUJILLO', false, false),
  ('900000000011', 'MISTI TAXI',       'Beto',  'AREQUIPA', false, false),
  ('900000000012', 'CHAN CHAN MOVIL',  'Carla', 'TRUJILLO', false, false);

-- ── FLEETROOMS (el tagging que decide la linea de negocio) ──────────────────
-- Un partner grande NO es una fila: es una familia de sub-flotas por ciudad y
-- por vertical bajo el mismo CLID. Reproducirlo importa porque casi todos los
-- bugs de esta app vivieron ahi (doble conteo, solo-TukTuk fuera del sidebar,
-- delivery sumando a Taxi).
INSERT INTO public.fleetrooms (db_id, clid, name, kam, city, is_fleet, is_tuktuk, exclude_from_taxi, is_delivery, is_cargo) VALUES
  -- perfil A: multi-ciudad + las 4 verticales
  ('db-and-lima',  '900000000001', 'Andina Lima',      'Ana',   'LIMA',     true,  false, false, false, false),
  ('db-and-truj',  '900000000001', 'Andina Trujillo',  'Ana',   'TRUJILLO', false, false, false, false, false),
  ('db-and-areq',  '900000000001', 'Andina Arequipa',  'Ana',   'AREQUIPA', false, false, false, false, false),
  ('db-and-tk',    '900000000001', 'Andina TukTuk',    'Ana',   'LIMA',     false, true,  false, false, false),
  ('db-and-dlv',   '900000000001', 'Andina Delivery',  'Ana',   'LIMA',     false, false, true,  true,  false),
  ('db-and-crg',   '900000000001', 'Andina Cargo',     'Ana',   'LIMA',     false, false, true,  false, true),
  -- perfil B: TukTuk fuerte
  ('db-ruta-lima', '900000000002', 'Ruta Sur Lima',    'Ana',   'LIMA',     false, false, false, false, false),
  ('db-ruta-tk',   '900000000002', 'Ruta Sur TukTuk',  'Ana',   'LIMA',     false, true,  false, false, false),
  ('db-ruta-areq', '900000000002', 'Ruta Sur Arequipa','Ana',   'AREQUIPA', false, false, false, false, false),
  ('db-ruta-truj', '900000000002', 'Ruta Sur Golf',    'Ana',   'TRUJILLO', false, false, false, false, false),
  -- perfil C: volatil
  ('db-exp-lima',  '900000000003', 'Expreso Lima',     'Beto',  'LIMA',     true,  false, false, false, false),
  ('db-exp-tk',    '900000000003', 'Expreso TukTuk',   'Beto',  'LIMA',     false, true,  false, false, false),
  ('db-exp-truj',  '900000000003', 'Expreso Trujillo', 'Beto',  'TRUJILLO', false, false, false, false, false),
  ('db-exp-areq',  '900000000003', 'Expreso Arequipa', 'Beto',  'AREQUIPA', false, false, false, false, false),
  ('db-exp-dlv',   '900000000003', 'Expreso Delivery', 'Beto',  'LIMA',     false, false, true,  true,  false),
  -- cohorte
  ('db-pac-lima',  '900000000004', 'Pacifico Lima',    'Beto',  'LIMA',     false, false, false, false, false),
  ('db-nor-truj',  '900000000005', 'Norte Trujillo',   'Carla', 'TRUJILLO', false, false, false, false, false),
  ('db-mot-tk',    '900000000006', 'Motos TukTuk',     'Ana',   'LIMA',     false, true,  false, false, false),
  ('db-via-lima',  '900000000007', 'Via Rapida Lima',  'Carla', 'LIMA',     false, false, false, false, false),
  ('db-cen-lima',  '900000000008', 'Central Lima',     'Carla', 'LIMA',     true,  false, false, false, false),
  ('db-agq-areq',  '900000000009', 'Arequipa Go',      'Beto',  'AREQUIPA', false, false, false, false, false),
  ('db-cos-truj',  '900000000010', 'Costa Verde',      'Ana',   'TRUJILLO', false, false, false, false, false),
  ('db-mis-areq',  '900000000011', 'Misti Arequipa',   'Beto',  'AREQUIPA', false, false, false, false, false),
  ('db-cha-truj',  '900000000012', 'Chan Chan',        'Carla', 'TRUJILLO', false, false, false, false, false);

-- ── SEMANAL: la fuente de verdad ────────────────────────────────────────────
-- 16 semanas (abr → jul 2026). Cada sub-flota lleva su AD base, su tendencia y
-- su VOLATILIDAD PROPIA (`cv`), que es lo que la version anterior no tenia: en
-- produccion la dispersion va de 6,6% (un partner que no se mueve) a 35% (uno
-- que salta de 1.366 a 3.326 entre semanas). Con un ruido unico para todos, ni
-- las alertas de caida ni la hoja de Trayectoria prueban nada.
CREATE TEMP TABLE _sub(
  clid text, city text, db_id text, fleetroom text,
  ad_base int, trend numeric, cv numeric, tipo text, act_base numeric
) ON COMMIT DROP;
INSERT INTO _sub VALUES
  ('900000000001','LIMA',    'db-and-lima', 'Andina Lima',      2350,  0.004, 0.07, 'taxi', 0.34),
  ('900000000001','TRUJILLO','db-and-truj', 'Andina Trujillo',   210, -0.012, 0.30, 'prov', 0.42),
  ('900000000001','AREQUIPA','db-and-areq', 'Andina Arequipa',   126,  0.006, 0.32, 'prov', 0.3),
  ('900000000001','LIMA',    'db-and-tk',   'Andina TukTuk',      84,  0.018, 0.12, 'tuktuk', 0.86),
  ('900000000001','LIMA',    'db-and-dlv',  'Andina Delivery',     3,  0.050, 0.60, 'delivery', 0.25),
  ('900000000001','LIMA',    'db-and-crg',  'Andina Cargo',        2,  0.030, 0.60, 'cargo', 0.2),
  ('900000000002','LIMA',    'db-ruta-lima','Ruta Sur Lima',     1167,  0.008, 0.11, 'taxi', 0.42),
  ('900000000002','LIMA',    'db-ruta-tk',  'Ruta Sur TukTuk',    819,  0.014, 0.12, 'tuktuk', 0.39),
  ('900000000002','AREQUIPA','db-ruta-areq','Ruta Sur Arequipa',  149,  0.002, 0.11, 'prov', 0.12),
  ('900000000002','TRUJILLO','db-ruta-truj','Ruta Sur Golf',       65, -0.008, 0.28, 'prov', 0.61),
  -- El volatil: ademas CAE, que es lo que dispara las alertas de declive.
  ('900000000003','LIMA',    'db-exp-lima', 'Expreso Lima',      1710, -0.020, 0.35, 'taxi', 0.25),
  ('900000000003','LIMA',    'db-exp-tk',   'Expreso TukTuk',     683,  0.010, 0.16, 'tuktuk', 0.58),
  ('900000000003','TRUJILLO','db-exp-truj', 'Expreso Trujillo',   152, -0.005, 0.26, 'prov', 0.24),
  ('900000000003','AREQUIPA','db-exp-areq', 'Expreso Arequipa',    64,  0.004, 0.30, 'prov', 0.22),
  ('900000000003','LIMA',    'db-exp-dlv',  'Expreso Delivery',    18,  0.000, 0.90, 'delivery', 0.44),
  ('900000000004','LIMA',    'db-pac-lima', 'Pacifico Lima',      940,  0.006, 0.09, 'taxi', 0.36),
  ('900000000005','TRUJILLO','db-nor-truj', 'Norte Trujillo',     380,  0.003, 0.14, 'prov', 0.28),
  ('900000000006','LIMA',    'db-mot-tk',   'Motos TukTuk',       240,  0.026, 0.13, 'tuktuk', 0.5),
  ('900000000007','LIMA',    'db-via-lima', 'Via Rapida Lima',    620, -0.004, 0.10, 'taxi', 0.21),
  ('900000000008','LIMA',    'db-cen-lima', 'Central Lima',       410,  0.009, 0.12, 'taxi', 0.55),
  ('900000000009','AREQUIPA','db-agq-areq', 'Arequipa Go',        300,  0.005, 0.13, 'prov', 0.31),
  ('900000000010','TRUJILLO','db-cos-truj', 'Costa Verde',        175,  0.011, 0.18, 'prov', 0.47),
  ('900000000011','AREQUIPA','db-mis-areq', 'Misti Arequipa',     130, -0.007, 0.16, 'prov', 0.19),
  ('900000000012','TRUJILLO','db-cha-truj', 'Chan Chan',           95,  0.002, 0.20, 'prov', 0.63);

INSERT INTO public.rendimiento
  (clid, partner, kam, city, fecha, db_id, fleetroom, active_drivers, supply_hours,
   new_from_partner, new_from_service, reactivated, trips, gmv, commission,
   acceptance_rate, completion_rate, trips_per_hour, money_per_hour, active_cars,
   branded_active_cars, owned_fleet_active_cars, internal_fleet_sh, external_fleet_sh,
   bad_rated_trips_share, fraud_trips_share, driver_subsidies_by_gmv,
   driver_support_requests_share, new_drivers, avg_driver_rating,
   avg_fare_after_surge, sh_per_active_driver, new_drivers_share,
   new_profiles, new_profiles_partner, new_profiles_service,
   new_profiles_partner_reg1, new_profiles_partner_reg10,
   new_profiles_partner_reg50, new_profiles_partner_reg100)
SELECT s.clid, p.partner, p.kam, s.city, w.fecha, s.db_id, s.fleetroom,
       g.ad,
       round(g.ad * g.sh_por_cond, 2)                            AS supply_hours,
       g.np, g.ns, g.re,
       round(g.ad * g.sh_por_cond * g.tph)                       AS trips,
       round(g.ad * g.sh_por_cond * g.tph * g.tarifa, 2)         AS gmv,
       round(g.ad * g.sh_por_cond * g.tph * g.tarifa * 0.032, 2) AS commission,
       g.acc, g.comp, round(g.tph, 4)                            AS trips_per_hour,
       round(g.tph * g.tarifa, 4)                                AS money_per_hour,
       round(g.ad * 0.78)                                        AS active_cars,
       round(g.ad * 0.31)                                        AS branded_active_cars,
       round(g.ad * 0.24)                                        AS owned_fleet_active_cars,
       round(g.ad * g.sh_por_cond * 0.22, 2)                     AS internal_fleet_sh,
       round(g.ad * g.sh_por_cond * 0.78, 2)                     AS external_fleet_sh,
       g.bad, g.fraude, g.subsidio, g.soporte,
       g.np + g.ns                                               AS new_drivers,
       g.rating,
       round(g.tarifa, 4)                                        AS avg_fare_after_surge,
       round(g.sh_por_cond, 4)                                   AS sh_per_active_driver,
       round(((g.np + g.ns) / greatest(g.ad, 1))::numeric, 4)     AS new_drivers_share,
       -- EMBUDO: perfiles propios + los que trae el servicio. Las columnas reg*
       -- son PROPORCIONES (no conteos), tal como llegan del reporte real — el
       -- bloque de Captacion las pondera por new_profiles_partner.
       g.perf_p + g.perf_s                                       AS new_profiles,
       g.perf_p, g.perf_s,
       g.act1,
       round((g.act1 * 0.67)::numeric, 4),
       round((g.act1 * 0.22)::numeric, 4),
       round((g.act1 * 0.10)::numeric, 4)
FROM _sub s
JOIN public.partners p ON p.clid = s.clid
-- ::date explicito: generate_series sobre fechas devuelve TIMESTAMP, y entonces
-- (fecha - date) da un interval en vez de un entero de dias — el calculo de la
-- tendencia falla con "operator does not exist: integer + interval".
CROSS JOIN LATERAL (SELECT generate_series('2026-04-06'::date, '2026-07-27'::date, '7 days')::date AS fecha) w
CROSS JOIN LATERAL (
  SELECT
    -- VOLUMEN: base × tendencia acumulada × ruido con la volatilidad de la flota
    greatest(1, round(s.ad_base
       * (1 + s.trend * ((w.fecha - '2026-04-06'::date) / 7))
       -- ×1.73: el ruido es UNIFORME, y su desvio estandar es amplitud/sqrt(3).
       -- Sin el factor, un cv de 0,35 producia una dispersion medida de 20% y el
       -- partner "volatil" salia tan plano como los demas.
       * (1 + (random() - 0.5) * 2 * s.cv * 1.73)))::numeric         AS ad,
    -- RATIOS por tipo de operacion, en el rango medido en produccion. Se
    -- sortean APARTE del volumen: si derivaran de el, horas/conductor y
    -- viajes/hora serian constantes y la seccion Productividad no probaria nada.
    (CASE s.tipo WHEN 'tuktuk' THEN 21.5 + random() * 3.5
                 WHEN 'prov'   THEN 13.5 + random() * 3.5
                 ELSE               18.5 + random() * 5.0 END)::numeric AS sh_por_cond,
    (CASE s.tipo WHEN 'tuktuk' THEN 3.75 + random() * 0.40
                 WHEN 'prov'   THEN 1.90 + random() * 0.55
                 WHEN 'delivery' THEN 2.10 + random() * 0.40
                 WHEN 'cargo'  THEN 0.65 + random() * 0.30
                 ELSE               1.42 + random() * 0.25 END)::numeric AS tph,
    -- tarifa: mph / tph, calibrada para caer en USD/hora 5,4-6,6
    (CASE s.tipo WHEN 'tuktuk' THEN 1.45 + random() * 0.25
                 WHEN 'prov'   THEN 2.55 + random() * 0.45
                 ELSE               3.70 + random() * 0.60 END)::numeric AS tarifa,
    round((CASE s.city WHEN 'AREQUIPA' THEN 0.625 + random() * 0.075
                       WHEN 'TRUJILLO' THEN 0.615 + random() * 0.075
                       ELSE                 0.555 + random() * 0.105 END)::numeric, 4) AS acc,
    round((0.725 + random() * 0.050)::numeric, 4)                   AS comp,
    round((0.048 + random() * 0.020)::numeric, 4)                   AS bad,
    round((0.0018 + random() * 0.0035)::numeric, 4)                 AS fraude,
    round((0.008 + random() * 0.014)::numeric, 4)                   AS subsidio,
    round((0.0038 + random() * 0.0030)::numeric, 4)                 AS soporte,
    -- rating: casi identico entre partners, tal como es en produccion (4,816 a
    -- 4,842 entre 86 partners). Sirve para verificar que NO se use como
    -- comparador: no distingue a nadie.
    round((4.810 + random() * 0.035)::numeric, 3)                   AS rating,
    greatest(0, round(s.ad_base * (0.008 + random() * 0.020)))::numeric AS np,
    greatest(0, round(s.ad_base * (0.004 + random() * 0.010)))::numeric AS ns,
    greatest(0, round(s.ad_base * (0.030 + random() * 0.045)))::numeric AS re,
    greatest(0, round(s.ad_base * (0.010 + random() * 0.030)))::numeric AS perf_p,
    greatest(0, round(s.ad_base * (0.015 + random() * 0.040)))::numeric AS perf_s,
    -- Activacion a 1 viaje: la tasa es una PROPIEDAD DE LA FLOTA (act_base), no
    -- un sorteo por semana. Sorteandola por fila, al promediar 16 semanas todas
    -- las flotas convergian al centro y el cohorte quedaba entre 0,40 y 0,44 —
    -- justo lo contrario del dato real, donde el paso 1 del embudo va de 21,8%
    -- (p25) a 62,1% (p75) y es el KPI que MAS separa a un partner de otro.
    round(least(0.95, greatest(0.02, s.act_base * (0.85 + random() * 0.30)))::numeric, 4) AS act1
) g;

-- ── MENSUAL: DERIVADO del semanal ───────────────────────────────────────────
-- Flujos se SUMAN; los snapshots (AD, autos) NO: se toma el maximo de las
-- semanas del mes y se le suma un 12% por los conductores que aparecen en unas
-- semanas y no en otras — un mes siempre tiene mas conductores distintos que
-- cualquiera de sus semanas. Las TASAS se re-ponderan por su denominador real,
-- nunca se promedian planas (promediar ratios ya calculados pierde precision).
-- El mes es el del JUEVES, igual que p2ReportYM: la semana del 29-jun cuenta en
-- julio, y si el seed no lo respetara el deck y la BD discreparian por diseño.
INSERT INTO public.rendimiento_mensual
  (clid, partner, kam, city, mes, db_id, fleetroom, active_drivers, supply_hours,
   new_from_partner, new_from_service, reactivated, trips, gmv, commission,
   acceptance_rate, completion_rate, trips_per_hour, money_per_hour, active_cars,
   branded_active_cars, owned_fleet_active_cars, internal_fleet_sh, external_fleet_sh,
   bad_rated_trips_share, fraud_trips_share, driver_subsidies_by_gmv,
   driver_support_requests_share, new_drivers, avg_driver_rating,
   avg_fare_after_surge, sh_per_active_driver, new_drivers_share,
   new_profiles, new_profiles_partner, new_profiles_service,
   new_profiles_partner_reg1, new_profiles_partner_reg10,
   new_profiles_partner_reg50, new_profiles_partner_reg100)
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
       round(sum(avg_driver_rating * trips) / nullif(sum(trips), 0), 3),
       round(sum(avg_fare_after_surge * trips) / nullif(sum(trips), 0), 4),
       round(sum(supply_hours) / nullif(round(max(active_drivers) * 1.12), 0), 4),
       round(sum(new_drivers) / nullif(round(max(active_drivers) * 1.12), 0), 4),
       sum(new_profiles), sum(new_profiles_partner), sum(new_profiles_service),
       -- Las tasas del embudo se re-ponderan por perfiles propios, que es su
       -- denominador real. Promediarlas daria el mismo peso a una semana de 2
       -- perfiles que a una de 90.
       round(sum(new_profiles_partner_reg1   * new_profiles_partner) / nullif(sum(new_profiles_partner), 0), 4),
       round(sum(new_profiles_partner_reg10  * new_profiles_partner) / nullif(sum(new_profiles_partner), 0), 4),
       round(sum(new_profiles_partner_reg50  * new_profiles_partner) / nullif(sum(new_profiles_partner), 0), 4),
       round(sum(new_profiles_partner_reg100 * new_profiles_partner) / nullif(sum(new_profiles_partner), 0), 4)
  FROM public.rendimiento
 GROUP BY clid, partner, kam, city, to_char(fecha + 3, 'YYYY-MM'), db_id;

-- ── DIARIO: DERIVADO del semanal (desde junio) ──────────────────────────────
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
   bad_rated_trips_share, fraud_trips_share, new_drivers, avg_driver_rating,
   avg_fare_after_surge, new_profiles, new_profiles_partner, new_profiles_service,
   new_profiles_partner_reg1, new_profiles_partner_reg10,
   new_profiles_partner_reg50, new_profiles_partner_reg100)
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
       r.avg_driver_rating, r.avg_fare_after_surge,
       round(r.new_profiles / 7.0), round(r.new_profiles_partner / 7.0), round(r.new_profiles_service / 7.0),
       r.new_profiles_partner_reg1, r.new_profiles_partner_reg10,
       r.new_profiles_partner_reg50, r.new_profiles_partner_reg100
  FROM public.rendimiento r
  CROSS JOIN LATERAL (VALUES (0,1.02),(1,1.00),(2,1.01),(3,1.06),(4,1.18),(5,1.10),(6,0.83)) AS d(n, dow)
 WHERE r.fecha >= '2026-06-01';

-- ── METAS ───────────────────────────────────────────────────────────────────
-- Derivadas del propio mes para que el cumplimiento caiga en una banda
-- CREIBLE y VARIADA: sin variedad, el deck muestra siempre el mismo color y no
-- se puede verificar ni el semaforo ni las frases de la lectura. El factor sale
-- del CLID, asi que es estable entre corridas.
--   ...01 → 0,92 (sobre-cumple)   ...02 → 1,05 (justo abajo)
--   ...03 → 1,35 (lejos)          resto → 1,00 ± segun digito
--
-- La meta es PARAGUAS (Taxi + TukTuk juntos): se calcula sobre las dos lineas y
-- NO se le suma meta_tk_*. meta_tk_nr existe aparte, como meta del CRITERIO
-- TukTuk, que es lo unico para lo que sigue viva esa columna.
INSERT INTO public.metas
  (clid, partner, kam, city, mes, mes_year,
   meta_active_drivers, meta_nr, meta_supply_hours,
   meta_sh_car, meta_acceptance, meta_utilization, meta_tk_nr)
SELECT m.clid, max(m.partner), max(m.kam), m.city,
       -- Nombre del mes en ESPANOL y en mayusculas, tal como lo guarda
       -- produccion. Con to_char(...,'TMMonth') sale en el locale del contenedor
       -- ('July') y el deck lo mostraba tal cual, porque p2MesLabel deja pasar
       -- lo que no reconoce en vez de inventar una traduccion.
       (ARRAY['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO',
              'SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'])
         [split_part(m.mes, '-', 2)::int]                     AS mes,
       split_part(m.mes, '-', 1)::int                        AS mes_year,
       round(max(m.active_drivers) * f.fac),
       round(sum(m.new_from_partner + m.new_from_service + m.reactivated) * f.fac),
       round(sum(m.supply_hours) * f.fac),
       CASE WHEN bool_or(fr.is_fleet) THEN round((48 + random() * 14)::numeric, 1) END,
       CASE WHEN bool_or(fr.is_fleet) THEN round((62 + random() * 8)::numeric, 1) END,
       CASE WHEN bool_or(fr.is_fleet) THEN round((80 + random() * 12)::numeric, 1) END,
       CASE WHEN bool_or(fr.is_tuktuk)
            THEN round(sum(m.new_from_partner + m.new_from_service + m.reactivated)
                       FILTER (WHERE fr.is_tuktuk) * f.fac) END
  FROM public.rendimiento_mensual m
  JOIN public.fleetrooms fr ON fr.db_id = m.db_id
  CROSS JOIN LATERAL (SELECT CASE right(m.clid, 2)
                               WHEN '01' THEN 0.92 WHEN '02' THEN 1.05
                               WHEN '03' THEN 1.35 WHEN '06' THEN 0.88
                               ELSE 0.97 + (right(m.clid, 1)::int % 5) * 0.04 END AS fac) f
 WHERE NOT fr.exclude_from_taxi          -- Delivery/Cargo aun no tienen meta
   AND m.mes >= '2026-06'
 GROUP BY m.clid, m.city, m.mes, f.fac;

COMMIT;

-- ── QUE TIENE QUE DAR (invariantes, no numeros fijos) ───────────────────────
--
-- Los numeros concretos cambian si se toca el setseed o los parametros, asi que
-- lo que se verifica son INVARIANTES — valen para cualquier corrida:
--
-- 1. REPARTO. Con un KAM elegido y goal = base del reparto, la cuota de cada
--    partner debe salir EXACTAMENTE igual a su propio volumen, y la suma = goal.
--
-- 2. PRODUCTIVIDAD. horas/conductor, viajes/hora y viajes/conductor tienen que
--    MOVERSE entre periodos. Si alguno da +0,0% constante, o el dato no llego o
--    el ratio se esta calculando sobre numerador y denominador acoplados.
--
-- 3. ESCALAS COHERENTES. Los flujos del mes = suma de sus semanas (mismo
--    partner, mismo mes). Los snapshots NO: el AD mensual es mayor que el de
--    cualquiera de sus semanas, nunca la suma.
--
-- 4. TASAS EN FRACCION. Ninguna columna de tasa puede superar 1 en ninguna
--    escala. Si aparece un 65,6 en vez de 0,656, es el bug de escala 0-100.
--
-- 5. DELIVERY Y CARGO AFUERA. Las sub-flotas con exclude_from_taxi no pueden
--    aparecer en ninguna base de reparto ni en los totales de Agregador.
--
-- 6. SOLO-TUKTUK PRESENTE. MOTOS DEL SUR no tiene operacion Taxi y aun asi debe
--    aparecer en el sidebar y recibir cuota (caso PIAGGIO).
--
-- 7. BENCHMARK POR CIUDAD. La tira del Ejecutivo exige >=3 pares con 50+
--    activos en las mismas ciudades del partner; con este seed, Lima tiene 6,
--    Arequipa 4 y Trujillo 5. Si alguna cae por debajo de 3, la tira desaparece
--    (comportamiento correcto, pero deja de probarse).
--
-- Chequeo rapido de los invariantes 2, 3 y 4:
--
--   SELECT mes, round(sum(supply_hours)/sum(active_drivers),2) sh_cond,
--          round(sum(trips)/sum(supply_hours),3) viajes_hora,
--          round(max(acceptance_rate),3) acc_max
--     FROM rendimiento_mensual GROUP BY mes ORDER BY mes;
--   -- sh_cond y viajes_hora tienen que variar entre meses; acc_max <= 1.
