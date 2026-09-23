-- ============================================================================
-- DATOS SINTETICOS para el entorno local. NADA de esto es real: los CLID son
-- 9000000000xx (rango inexistente en produccion) y los nombres son inventados.
--
-- "VIVO" (Ola 0, 23-sep-2026): el seed tiene que parecerse a produccion HOY, no
-- a julio. Antes terminaba en jul-2026 con 12 partners y 3 KAMs, sin Seguimiento
-- ni embudo ni mapeo del usuario partner: Metas abria en un mes sin datos, el
-- portal salia vacio por el kill-switch y ningun rediseño se podia verificar
-- "lo mas real posible". Cobertura actual (hoy = 2026-09-23, martes):
--
--   semanal   2026-02-02 → 2026-09-14 (33 semanas; la del 14-sep es la ultima
--             cerrada — la ingesta corre los martes)
--   mensual   2026-02 → 2026-09 (septiembre PARCIAL, 3 semanas, como en prod)
--   diario    2026-06-22 → 2026-09-21 (92 dias; el 22 "falta", igual que un
--             martes real antes de la ingesta)
--   60 partners (60 CLIDs: 58 con fila en `partners` + 2 solo en `flotas`),
--   6 KAMs (Ana, Beto, Carla, Dario, Elena, Fabio) + "No KAM", 3 ciudades
--   metas     JUNIO..SEPTIEMBRE 2026 + DICIEMBRE 2025 / ENERO 2026 (bug B1)
--   seguimiento (25 tareas), proyectos (6), conversion_pais (6 meses),
--   partner_users (partner@local.test → ANDINA MOVILIDAD)
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
--   Tamaño del pais: ~27.000 AD/semana en Combinado entre 6 KAMs, con una cola
--   larga de partners chicos (la mitad por debajo de 250 AD).
--
-- POR QUE IMPORTA QUE LOS RATIOS SEAN REALISTAS. Con la version anterior
-- (aceptacion 0,74-0,95, horas/conductor 36-58) el benchmark del deck comparaba
-- contra medianas que no existen, la hoja de Captacion no tenia con que
-- dibujarse (faltaban las columnas del embudo) y la Trayectoria salia plana.
--
-- REPRODUCIBLE, no arbitrario: setseed() fija la secuencia, asi que dos corridas
-- dan exactamente los mismos numeros. Sin eso, cada reset cambiaria los datos y
-- ninguna verificacion (ni la "huella de numeros") seria repetible. Las fechas
-- son FIJAS (nunca now()): una tarea "vencida" se define contra el 23-sep-2026.
--
-- COHERENTE ENTRE ESCALAS: la semanal es la fuente; mensual y diaria se DERIVAN
-- de ella (flujos se suman, snapshots no). Si cada escala se generara por
-- separado, el dashboard mostraria totales que no cierran entre si y estariamos
-- persiguiendo bugs que solo existen en los datos de prueba.
--
-- SIN RUIDO EN audit_log: los triggers de auditoria se apagan durante la carga
-- (DISABLE TRIGGER USER, dentro de la transaccion). Si no, cada corrida dejaba
-- ~15.000 filas "INSERT por nadie" en audit_log, que es lo que lee Monitoreo.
--
-- Aplicar:  psql "postgresql://postgres:postgres@127.0.0.1:54332/postgres" -f supabase/seed_synthetic.sql
-- (despues de `supabase db reset`, que siembra los 4 usuarios de seed.sql)
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;
SELECT setseed(0.42);

-- Tablas cuyos triggers de auditoria se apagan mientras dura la carga (se
-- re-encienden al final, antes del COMMIT; si algo falla, el ROLLBACK los deja
-- como estaban).
ALTER TABLE public.partners            DISABLE TRIGGER USER;
ALTER TABLE public.fleetrooms          DISABLE TRIGGER USER;
ALTER TABLE public.flotas              DISABLE TRIGGER USER;
ALTER TABLE public.rendimiento         DISABLE TRIGGER USER;
ALTER TABLE public.rendimiento_mensual DISABLE TRIGGER USER;
ALTER TABLE public.rendimiento_diario  DISABLE TRIGGER USER;
ALTER TABLE public.metas               DISABLE TRIGGER USER;
ALTER TABLE public.conversion_pais     DISABLE TRIGGER USER;
ALTER TABLE public.seguimiento         DISABLE TRIGGER USER;
ALTER TABLE public.proyectos           DISABLE TRIGGER USER;
ALTER TABLE public.partner_users       DISABLE TRIGGER USER;

-- CASCADE alcanza a partner_users y partner_logos (FK a partners): por eso el
-- mapeo del usuario partner se vuelve a sembrar mas abajo.
TRUNCATE public.rendimiento_mensual, public.rendimiento, public.rendimiento_diario,
         public.metas, public.fleetrooms, public.partners, public.flotas,
         public.conversion_pais, public.seguimiento, public.proyectos
         RESTART IDENTITY CASCADE;

-- ── PARTNERS ────────────────────────────────────────────────────────────────
-- Los 12 ORIGINALES (CLID ...01 a ...12) se conservan tal cual: la
-- documentacion y varias verificaciones de CLAUDE.md los nombran (ANDINA, RUTA
-- SUR, EXPRESO, MOTOS DEL SUR, VIA RAPIDA, NORTE SEGURO...). Los tres primeros
-- imitan la forma de los grandes de produccion; el resto existe para que las
-- COHORTES tengan contra que compararse: el benchmark del deck exige >=3 pares
-- con 50+ activos EN LAS MISMAS CIUDADES.
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

-- Los 48 NUEVOS (CLID ...13 a ...60). Una fila por partner con su forma; las
-- sub-flotas (fleetrooms) se derivan de `extra`:
--   ''       una sola sub-flota (taxi en Lima, "prov" en provincia)
--   fleet    la sub-flota principal es Fleet (is_fleet)
--   tk       + sub-flota TukTuk en la MISMA ciudad (Taxi y TukTuk bajo el
--            mismo partner-ciudad: el caso Lizzo/ArequipaGo/YEGO de prod)
--   tkonly   solo TukTuk (caso PIAGGIO: fuera de rawData, dentro del sidebar)
--   dlv      + sub-flota Delivery (exclude_from_taxi)
--   cargo    + sub-flota Cargo (exclude_from_taxi)
--   multi    + segunda ciudad (Trujillo)
-- `desde`/`hasta`: partners que ENTRAN a mitad de la serie (sin base previa:
-- "Quien se movio" no debe listarlos como caida) o que SE VAN (meta sin
-- actividad, el caso "Flota Pe" de prod).
CREATE TEMP TABLE _np(
  n int, partner text, kam text, city text, ad_base int, trend numeric,
  cv numeric, act numeric, extra text, desde date, hasta date
) ON COMMIT DROP;
INSERT INTO _np VALUES
  -- Dario: la cartera mas grande (el "Miguel" de prod)
  (13, 'LIMA TAXI EJECUTIVO',   'Dario', 'LIMA',     1450,  0.006, 0.08, 0.38, 'fleet',  NULL, NULL),
  (14, 'SOL DE LIMA',           'Dario', 'LIMA',      980,  0.010, 0.10, 0.33, 'tk',     NULL, NULL),
  (15, 'MOVIL NORTE',           'Dario', 'TRUJILLO',  420,  0.004, 0.15, 0.41, '',       NULL, NULL),
  (16, 'AUTOS DEL MISTI',       'Dario', 'AREQUIPA',  360,  0.008, 0.14, 0.29, 'tk',     NULL, NULL),
  (17, 'RIMAC CONDUCE',         'Dario', 'LIMA',      760, -0.006, 0.12, 0.27, '',       NULL, NULL),
  (18, 'TUKTUK EXPRESS',        'Dario', 'LIMA',      310,  0.020, 0.14, 0.55, 'tkonly', NULL, NULL),
  (19, 'FLOTA MIRAFLORES',      'Dario', 'LIMA',      540,  0.012, 0.10, 0.48, 'fleet',  NULL, NULL),
  (20, 'CALLAO MOVIL',          'Dario', 'LIMA',      280,  0.003, 0.16, 0.35, '',       NULL, NULL),
  (21, 'HUANCHACO RIDE',        'Dario', 'TRUJILLO',  140,  0.015, 0.22, 0.52, '',       NULL, NULL),
  (22, 'CONDOR TAXI',           'Dario', 'AREQUIPA',  190, -0.004, 0.18, 0.24, '',       NULL, NULL),
  (52, 'CERCADO EXPRESS',       'Dario', 'LIMA',       60,  0.025, 0.35, 0.60, '',       '2026-07-06', NULL),
  -- Elena
  (23, 'SAN ISIDRO PREMIUM',    'Elena', 'LIMA',     1120,  0.005, 0.09, 0.36, 'dlv',    NULL, NULL),
  (24, 'PACHACAMAC MOVIL',      'Elena', 'LIMA',      650,  0.009, 0.11, 0.31, 'multi',  NULL, NULL),
  (25, 'SURCO DRIVERS',         'Elena', 'LIMA',      430, -0.010, 0.20, 0.22, '',       NULL, NULL),
  (26, 'LA MOLINA RIDE',        'Elena', 'LIMA',      250,  0.007, 0.13, 0.44, '',       NULL, NULL),
  (27, 'CHICLAYO NORTE',        'Elena', 'TRUJILLO',  210,  0.006, 0.19, 0.37, '',       NULL, NULL),
  (28, 'VALLE SAGRADO',         'Elena', 'AREQUIPA',  175,  0.010, 0.21, 0.30, '',       NULL, NULL),
  (29, 'YANAHUARA MOVIL',       'Elena', 'AREQUIPA',  120,  0.002, 0.24, 0.26, '',       NULL, NULL),
  (30, 'BARRANCO TAXI',         'Elena', 'LIMA',       95,  0.012, 0.28, 0.58, '',       NULL, NULL),
  (31, 'SANTA ANITA FLOTA',     'Elena', 'LIMA',      360,  0.004, 0.12, 0.40, 'fleet',  NULL, NULL),
  (32, 'MOTOTAXI ANDES',        'Elena', 'AREQUIPA',  150,  0.018, 0.15, 0.62, 'tkonly', NULL, NULL),
  (53, 'MIRAMAR TAXI',          'Elena', 'TRUJILLO',   70,  0.004, 0.30, 0.40, '',       NULL, NULL),
  -- Fabio: la cartera mas chica (el "Alvaro" de prod)
  (33, 'LOS OLIVOS RIDE',       'Fabio', 'LIMA',      880,  0.007, 0.10, 0.34, '',       NULL, NULL),
  (34, 'COMAS CONDUCE',         'Fabio', 'LIMA',      520, -0.015, 0.25, 0.23, '',       NULL, NULL),
  (35, 'TRUJILLO CENTRO',       'Fabio', 'TRUJILLO',  260,  0.005, 0.17, 0.39, 'tk',     NULL, NULL),
  (36, 'CAYMA TAXI',            'Fabio', 'AREQUIPA',  110,  0.004, 0.23, 0.27, '',       NULL, NULL),
  (37, 'ATE MOVILIDAD',         'Fabio', 'LIMA',      205,  0.011, 0.18, 0.46, 'cargo',  NULL, NULL),
  (54, 'CHILINA MOVIL',         'Fabio', 'AREQUIPA',   65,  0.008, 0.32, 0.34, '',       NULL, NULL),
  (55, 'VILLA EL SALVADOR RIDE','Fabio', 'LIMA',      330,  0.009, 0.14, 0.38, 'tk',     NULL, NULL),
  (60, 'JESUS MARIA TAXI',      'Fabio', 'LIMA',      240,  0.002, 0.16, 0.33, '',       NULL, NULL),
  -- Ana / Beto / Carla completan su cartera
  (38, 'NUEVO AMANECER',        'Ana',   'LIMA',      340,  0.006, 0.14, 0.35, '',       NULL, NULL),
  (39, 'LAS DUNAS',             'Ana',   'TRUJILLO',  130,  0.009, 0.20, 0.45, '',       NULL, NULL),
  (40, 'SELVA RIDE',            'Ana',   'AREQUIPA',   85,  0.000, 0.30, 0.20, '',       NULL, NULL),
  (41, 'CHORRILLOS MOVIL',      'Ana',   'LIMA',      190,  0.013, 0.19, 0.50, '',       NULL, NULL),
  (42, 'MAGDALENA TAXI',        'Beto',  'LIMA',      610,  0.003, 0.11, 0.32, '',       NULL, NULL),
  (43, 'SACHACA RIDE',          'Beto',  'AREQUIPA',  145,  0.006, 0.20, 0.28, '',       NULL, NULL),
  (44, 'EL PORVENIR',           'Beto',  'TRUJILLO',  115, -0.008, 0.26, 0.33, '',       NULL, NULL),
  (45, 'LINCE CONDUCE',         'Beto',  'LIMA',       75,  0.020, 0.30, 0.55, '',       '2026-06-01', NULL),
  (58, 'TAXI BELLAVISTA',       'Beto',  'LIMA',      120,  0.000, 0.18, 0.30, '',       NULL, NULL),
  (46, 'MOCHE MOVIL',           'Carla', 'TRUJILLO',  230,  0.005, 0.16, 0.42, '',       NULL, NULL),
  (47, 'INDEPENDENCIA FLOTA',   'Carla', 'LIMA',      480,  0.008, 0.12, 0.37, 'fleet',  NULL, NULL),
  (48, 'PAUCARPATA TAXI',       'Carla', 'AREQUIPA',  160,  0.004, 0.19, 0.31, '',       NULL, NULL),
  (49, 'SAN BORJA RIDE',        'Carla', 'LIMA',      300, -0.005, 0.15, 0.29, '',       NULL, NULL),
  (50, 'VICTOR LARCO',          'Carla', 'TRUJILLO',   90,  0.010, 0.27, 0.48, '',       NULL, NULL),
  (51, 'PUENTE PIEDRA MOVIL',   'Carla', 'LIMA',      140,  0.000, 0.22, 0.36, '',       NULL, '2026-08-10'),
  -- Futuros "No KAM" (se vacia/borra su KAM al final, ver el bloque SIN KAM)
  (56, 'ALTO SELVA ALEGRE',     '',      'AREQUIPA',  150,  0.006, 0.20, 0.31, '',       NULL, NULL),
  (57, 'RUTA DEL SILLAR',       'Beto',  'AREQUIPA',   80,  0.004, 0.25, 0.27, '',       NULL, NULL),
  (59, 'GRUPO MANCORA',         'Elena', 'TRUJILLO',   55,  0.010, 0.30, 0.44, '',       NULL, NULL);

INSERT INTO public.partners (clid, partner, kam, city, is_fleet, is_tuktuk)
SELECT '9000000000' || lpad(n::text, 2, '0'), partner, kam, city,
       extra = 'fleet', extra = 'tkonly'
  FROM _np;

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

-- Sub-flotas de los 48 nuevos, derivadas de `extra`. Queda en una tabla aparte
-- porque las mismas filas alimentan `fleetrooms` y la generacion semanal.
CREATE TEMP TABLE _nsub ON COMMIT DROP AS
SELECT '9000000000' || lpad(n::text, 2, '0') AS clid, x.* , np.kam, np.partner
  FROM _np np
  CROSS JOIN LATERAL (
    -- sub-flota principal
    SELECT np.city AS city, 'db-p' || np.n || '-main' AS db_id,
           initcap(np.partner) AS fleetroom, np.ad_base AS ad_base, np.trend, np.cv,
           CASE WHEN np.extra = 'tkonly' THEN 'tuktuk'
                WHEN np.city = 'LIMA'    THEN 'taxi' ELSE 'prov' END AS tipo,
           np.act AS act_base, np.desde, np.hasta,
           np.extra = 'fleet' AS is_fleet, np.extra = 'tkonly' AS is_tuktuk,
           false AS is_delivery, false AS is_cargo
    UNION ALL
    SELECT np.city, 'db-p' || np.n || '-tk', initcap(np.partner) || ' TukTuk',
           greatest(8, round(np.ad_base * 0.40))::int, np.trend + 0.004, np.cv + 0.03,
           'tuktuk', least(0.9, np.act + 0.15), np.desde, np.hasta, false, true, false, false
     WHERE np.extra = 'tk'
    UNION ALL
    SELECT np.city, 'db-p' || np.n || '-dlv', initcap(np.partner) || ' Delivery',
           12, 0.020, 0.70, 'delivery', 0.30, np.desde, np.hasta, false, false, true, false
     WHERE np.extra = 'dlv'
    UNION ALL
    SELECT np.city, 'db-p' || np.n || '-crg', initcap(np.partner) || ' Cargo',
           4, 0.010, 0.60, 'cargo', 0.20, np.desde, np.hasta, false, false, false, true
     WHERE np.extra = 'cargo'
    UNION ALL
    SELECT 'TRUJILLO', 'db-p' || np.n || '-truj', initcap(np.partner) || ' Trujillo',
           greatest(10, round(np.ad_base * 0.20))::int, np.trend - 0.004, np.cv + 0.10,
           'prov', np.act, np.desde, np.hasta, false, false, false, false
     WHERE np.extra = 'multi'
  ) x;

INSERT INTO public.fleetrooms (db_id, clid, name, kam, city, is_fleet, is_tuktuk, exclude_from_taxi, is_delivery, is_cargo)
SELECT db_id, clid, fleetroom, kam, city, is_fleet, is_tuktuk,
       is_delivery OR is_cargo, is_delivery, is_cargo
  FROM _nsub;

-- ── SEMANAL: la fuente de verdad ────────────────────────────────────────────
-- 33 semanas (2-feb → 14-sep-2026). Cada sub-flota lleva su AD base, su
-- tendencia y su VOLATILIDAD PROPIA (`cv`): en produccion la dispersion va de
-- 6,6% (un partner que no se mueve) a 35% (uno que salta de 1.366 a 3.326
-- entre semanas). Con un ruido unico para todos, ni las alertas de caida ni la
-- hoja de Trayectoria prueban nada.
--
-- La TENDENCIA se centra en la semana 16 (fines de mayo): `ad_base` es el
-- nivel a mitad de la serie. Sin centrar, con 33 semanas un -2%/sem llevaba a
-- EXPRESO a un tercio de su tamaño y un +2,6% casi duplicaba a MOTOS DEL SUR.
CREATE TEMP TABLE _sub(
  clid text, city text, db_id text, fleetroom text,
  ad_base int, trend numeric, cv numeric, tipo text, act_base numeric,
  desde date, hasta date
) ON COMMIT DROP;
INSERT INTO _sub VALUES
  ('900000000001','LIMA',    'db-and-lima', 'Andina Lima',      2350,  0.004, 0.07, 'taxi', 0.34, NULL, NULL),
  ('900000000001','TRUJILLO','db-and-truj', 'Andina Trujillo',   210, -0.012, 0.30, 'prov', 0.42, NULL, NULL),
  ('900000000001','AREQUIPA','db-and-areq', 'Andina Arequipa',   126,  0.006, 0.32, 'prov', 0.3,  NULL, NULL),
  ('900000000001','LIMA',    'db-and-tk',   'Andina TukTuk',      84,  0.018, 0.12, 'tuktuk', 0.86, NULL, NULL),
  ('900000000001','LIMA',    'db-and-dlv',  'Andina Delivery',     3,  0.050, 0.60, 'delivery', 0.25, NULL, NULL),
  ('900000000001','LIMA',    'db-and-crg',  'Andina Cargo',        2,  0.030, 0.60, 'cargo', 0.2, NULL, NULL),
  ('900000000002','LIMA',    'db-ruta-lima','Ruta Sur Lima',     1167,  0.008, 0.11, 'taxi', 0.42, NULL, NULL),
  ('900000000002','LIMA',    'db-ruta-tk',  'Ruta Sur TukTuk',    819,  0.014, 0.12, 'tuktuk', 0.39, NULL, NULL),
  ('900000000002','AREQUIPA','db-ruta-areq','Ruta Sur Arequipa',  149,  0.002, 0.11, 'prov', 0.12, NULL, NULL),
  ('900000000002','TRUJILLO','db-ruta-truj','Ruta Sur Golf',       65, -0.008, 0.28, 'prov', 0.61, NULL, NULL),
  -- El volatil: ademas CAE, que es lo que dispara las alertas de declive.
  ('900000000003','LIMA',    'db-exp-lima', 'Expreso Lima',      1710, -0.020, 0.35, 'taxi', 0.25, NULL, NULL),
  ('900000000003','LIMA',    'db-exp-tk',   'Expreso TukTuk',     683,  0.010, 0.16, 'tuktuk', 0.58, NULL, NULL),
  ('900000000003','TRUJILLO','db-exp-truj', 'Expreso Trujillo',   152, -0.005, 0.26, 'prov', 0.24, NULL, NULL),
  ('900000000003','AREQUIPA','db-exp-areq', 'Expreso Arequipa',    64,  0.004, 0.30, 'prov', 0.22, NULL, NULL),
  ('900000000003','LIMA',    'db-exp-dlv',  'Expreso Delivery',    18,  0.000, 0.90, 'delivery', 0.44, NULL, NULL),
  ('900000000004','LIMA',    'db-pac-lima', 'Pacifico Lima',      940,  0.006, 0.09, 'taxi', 0.36, NULL, NULL),
  ('900000000005','TRUJILLO','db-nor-truj', 'Norte Trujillo',     380,  0.003, 0.14, 'prov', 0.28, NULL, NULL),
  ('900000000006','LIMA',    'db-mot-tk',   'Motos TukTuk',       240,  0.026, 0.13, 'tuktuk', 0.5, NULL, NULL),
  ('900000000007','LIMA',    'db-via-lima', 'Via Rapida Lima',    620, -0.004, 0.10, 'taxi', 0.21, NULL, NULL),
  ('900000000008','LIMA',    'db-cen-lima', 'Central Lima',       410,  0.009, 0.12, 'taxi', 0.55, NULL, NULL),
  ('900000000009','AREQUIPA','db-agq-areq', 'Arequipa Go',        300,  0.005, 0.13, 'prov', 0.31, NULL, NULL),
  ('900000000010','TRUJILLO','db-cos-truj', 'Costa Verde',        175,  0.011, 0.18, 'prov', 0.47, NULL, NULL),
  ('900000000011','AREQUIPA','db-mis-areq', 'Misti Arequipa',     130, -0.007, 0.16, 'prov', 0.19, NULL, NULL),
  ('900000000012','TRUJILLO','db-cha-truj', 'Chan Chan',           95,  0.002, 0.20, 'prov', 0.63, NULL, NULL);
INSERT INTO _sub
SELECT clid, city, db_id, fleetroom, ad_base, trend, cv, tipo, act_base, desde, hasta
  FROM _nsub ORDER BY clid, db_id;

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
CROSS JOIN LATERAL (SELECT generate_series('2026-02-02'::date, '2026-09-14'::date, '7 days')::date AS fecha) w
CROSS JOIN LATERAL (
  SELECT
    -- VOLUMEN: base × tendencia (centrada en la semana 16) × ruido con la
    -- volatilidad de la flota
    greatest(1, round(s.ad_base
       * greatest(0.25, 1 + s.trend * ((w.fecha - '2026-02-02'::date) / 7 - 16))
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
) g
WHERE w.fecha >= coalesce(s.desde, '2026-02-02'::date)
  AND w.fecha <= coalesce(s.hasta, '2026-09-14'::date);

-- ── MENSUAL: DERIVADO del semanal ───────────────────────────────────────────
-- Flujos se SUMAN; los snapshots (AD, autos) NO: se toma el maximo de las
-- semanas del mes y se le suma un 12% por los conductores que aparecen en unas
-- semanas y no en otras — un mes siempre tiene mas conductores distintos que
-- cualquiera de sus semanas. Las TASAS se re-ponderan por su denominador real,
-- nunca se promedian planas (promediar ratios ya calculados pierde precision).
-- El mes es el del JUEVES, igual que p2ReportYM: la semana del 29-jun cuenta en
-- julio, y si el seed no lo respetara el deck y la BD discreparian por diseño.
-- Septiembre queda PARCIAL (semanas del 31-ago, 7-sep y 14-sep), como en prod.
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

-- ── DIARIO: DERIVADO del semanal (ultimos 92 dias) ──────────────────────────
-- OJO: rendimiento_diario NO tiene partner ni kam, y usa new_partner/new_service
-- en vez de new_from_*. Es la diferencia que rompio la ingesta automatica en jul
-- 2026; el seed la respeta a proposito para que el entorno local la reproduzca.
-- Los dias no son la semana/7 exacta: llevan su propio ruido y un factor de dia
-- de semana (domingo flojo, viernes fuerte), si no las tendencias diarias serian
-- una linea recta y no probarian nada.
--
-- La diaria va ADELANTE de la semanal, como en prod (se ingesta a diario): el
-- 21-sep (lunes) no tiene semana cerrada, asi que se deriva de la ultima semana
-- (14-sep). Un partner que se fue (hasta) no tiene dias despues de su ultima
-- semana, y uno que entro tarde no tiene dias antes.
INSERT INTO public.rendimiento_diario
  (clid, city, date, db_id, fleetroom, active_drivers, supply_hours,
   new_partner, new_service, reactivated, trips, gmv, commission,
   acceptance_rate, completion_rate, trips_per_hour, money_per_hour, active_cars,
   branded_active_cars, owned_fleet_active_cars, internal_fleet_sh, external_fleet_sh,
   bad_rated_trips_share, fraud_trips_share, new_drivers, avg_driver_rating,
   avg_fare_after_surge, new_profiles, new_profiles_partner, new_profiles_service,
   new_profiles_partner_reg1, new_profiles_partner_reg10,
   new_profiles_partner_reg50, new_profiles_partner_reg100)
SELECT r.clid, r.city, d.dia, r.db_id, r.fleetroom,
       greatest(1, round(r.active_drivers * 0.42 * f.dow * (0.9 + random() * 0.2))),
       round((r.supply_hours / 7 * f.dow * (0.9 + random() * 0.2))::numeric, 2),
       round(r.new_from_partner / 7.0 * (0.7 + random() * 0.6)),
       round(r.new_from_service / 7.0 * (0.7 + random() * 0.6)),
       round(r.reactivated      / 7.0 * (0.7 + random() * 0.6)),
       round(r.trips / 7 * f.dow * (0.9 + random() * 0.2)),
       round((r.gmv   / 7 * f.dow * (0.9 + random() * 0.2))::numeric, 2),
       round((r.commission / 7 * f.dow * (0.9 + random() * 0.2))::numeric, 2),
       round(least(1, r.acceptance_rate * (0.97 + random() * 0.06))::numeric, 4),
       round(least(1, r.completion_rate * (0.98 + random() * 0.04))::numeric, 4),
       round((r.trips_per_hour * (0.93 + random() * 0.14))::numeric, 4),
       round((r.money_per_hour * (0.93 + random() * 0.14))::numeric, 4),
       round(r.active_cars * 0.42 * f.dow), round(r.branded_active_cars * 0.42 * f.dow),
       round(r.owned_fleet_active_cars * 0.42 * f.dow),
       round((r.internal_fleet_sh / 7 * f.dow)::numeric, 2), round((r.external_fleet_sh / 7 * f.dow)::numeric, 2),
       r.bad_rated_trips_share, r.fraud_trips_share,
       round(r.new_drivers / 7.0 * (0.7 + random() * 0.6)),
       r.avg_driver_rating, r.avg_fare_after_surge,
       round(r.new_profiles / 7.0), round(r.new_profiles_partner / 7.0), round(r.new_profiles_service / 7.0),
       r.new_profiles_partner_reg1, r.new_profiles_partner_reg10,
       r.new_profiles_partner_reg50, r.new_profiles_partner_reg100
  FROM (SELECT generate_series('2026-06-22'::date, '2026-09-21'::date, '1 day')::date AS dia) d
  JOIN public.rendimiento r
    ON r.fecha = least(d.dia - (extract(isodow FROM d.dia)::int - 1), '2026-09-14'::date)
   AND (d.dia <= r.fecha + 6 OR r.fecha = '2026-09-14'::date)
  CROSS JOIN LATERAL (SELECT (ARRAY[1.02, 1.00, 1.01, 1.06, 1.18, 1.10, 0.83])
                              [extract(isodow FROM d.dia)::int] AS dow) f
 ORDER BY d.dia, r.clid, r.db_id;

-- ── METAS ───────────────────────────────────────────────────────────────────
-- Una meta es un PLAN: se arma con el mes ANTERIOR (normalizado por semanas) ×
-- un factor por CLID, estable entre corridas. Asi el cumplimiento cae en una
-- banda CREIBLE y VARIADA (sin variedad, el deck muestra siempre el mismo color
-- y no se puede verificar ni el semaforo ni las frases de la lectura), y
-- septiembre — mes en curso, 3 de 4 semanas — sale a ~75% de avance, como en
-- prod a esta altura del mes.
--   ...01 → 0,92 (sobre-cumple)   ...02 → 1,05 (justo abajo)
--   ...03 → 1,35 (lejos)          ...06 → 0,88   resto → 0,94..1,14 segun CLID
-- Los FLUJOS (N+R, horas) se normalizan por cantidad de semanas (jueves) de
-- cada mes: sin eso, un plan armado sobre un mes de 5 semanas le exige +25% a
-- uno de 4 y el cumplimiento sale roto por diseño.
--
-- La meta es PARAGUAS (Taxi + TukTuk juntos, SUMA de las sub-flotas de esa
-- ciudad). `meta_tk_*` es un DESGLOSE de ese paraguas (nunca se le suma) y solo
-- existe donde el KAM declaro el % de PnL: aca, Ana en AGOSTO (las 3 filas que
-- usa la verificacion del aviso de desglose) y Dario en SEPTIEMBRE. En el resto
-- queda NULL — NULL ≠ 0.
--
-- Casos que se siembran a proposito:
--   · sin ninguna meta: CALLAO MOVIL, YANAHUARA, CAYMA, VICTOR LARCO, ALTO
--     SELVA ALEGRE, GRUPO MANCORA (cuentas con actividad y sin plan → Metas
--     las cuenta en el actual con "· sin meta")
--   · fila en CERO (cuenta como "sin meta" para hasLineMeta): SURCO DRIVERS y
--     EL PORVENIR en SEPTIEMBRE; fila con todo NULL: MIRAMAR TAXI en AGOSTO
--   · meta SIN actividad: PUENTE PIEDRA se fue el 10-ago → su plan de
--     septiembre (armado con agosto) no tiene actual (el caso "Flota Pe")
--   · CRUCE DE AÑO (bug B1): DICIEMBRE 2025 y ENERO 2026 para 4 partners. La
--     UNIQUE (clid, city, mes) impide sembrar ENERO de dos años para la misma
--     cuenta — ese es justamente el bug —, asi que hay UN año por clave.
CREATE TEMP TABLE _thu ON COMMIT DROP AS
SELECT to_char(g, 'YYYY-MM') AS ym, count(*) FILTER (WHERE extract(isodow FROM g) = 4)::numeric AS jueves
  FROM generate_series('2025-12-01'::date, '2026-09-30'::date, '1 day') g
 GROUP BY 1;

CREATE TEMP TABLE _base_meta ON COMMIT DROP AS
SELECT m.clid, m.city, m.mes AS ym,
       max(m.partner) AS partner, max(m.kam) AS kam,
       sum(m.active_drivers)                                              AS ad,
       sum(m.new_from_partner + m.new_from_service + m.reactivated)       AS nr,
       sum(m.supply_hours)                                                AS sh,
       sum(m.active_drivers) FILTER (WHERE fr.is_tuktuk)                  AS ad_tk,
       sum(m.new_from_partner + m.new_from_service + m.reactivated)
         FILTER (WHERE fr.is_tuktuk)                                      AS nr_tk,
       sum(m.supply_hours) FILTER (WHERE fr.is_tuktuk)                    AS sh_tk,
       sum(m.branded_active_cars) FILTER (WHERE fr.is_tuktuk)             AS cars_tk,
       bool_or(fr.is_fleet)                                               AS is_fleet
  FROM public.rendimiento_mensual m
  JOIN public.fleetrooms fr ON fr.db_id = m.db_id
 WHERE NOT fr.exclude_from_taxi          -- Delivery/Cargo aun no tienen meta
 GROUP BY m.clid, m.city, m.mes;

CREATE TEMP TABLE _obj(mes text, anio int, ym text, ym_base text, ajuste numeric) ON COMMIT DROP;
INSERT INTO _obj VALUES
  ('JUNIO',      2026, '2026-06', '2026-05', 1.00),
  ('JULIO',      2026, '2026-07', '2026-06', 1.00),
  ('AGOSTO',     2026, '2026-08', '2026-07', 1.00),
  ('SEPTIEMBRE', 2026, '2026-09', '2026-08', 1.00),
  -- cruce de año: no hay datos antes de feb-2026, se arman con febrero
  ('DICIEMBRE',  2025, '2025-12', '2026-02', 0.93),
  ('ENERO',      2026, '2026-01', '2026-02', 0.96);

INSERT INTO public.metas
  (clid, partner, kam, city, mes, mes_year,
   meta_active_drivers, meta_nr, meta_supply_hours,
   meta_sh_car, meta_acceptance, meta_utilization,
   meta_tk_ad, meta_tk_nr, meta_tk_sh, meta_tk_cars)
SELECT b.clid, b.partner, b.kam, b.city,
       -- Nombre del mes en ESPANOL y en mayusculas, tal como lo guarda
       -- produccion (con to_char(...,'TMMonth') saldria en el locale del
       -- contenedor, 'July', y el deck lo mostraba tal cual).
       o.mes, o.anio,
       round(b.ad * k.fac),
       round(b.nr / tb.jueves * tt.jueves * k.fac),
       round(b.sh / tb.jueves * tt.jueves * k.fac),
       -- Fleet: metas de TASA (0-100 en aceptacion/utilizacion, como en prod)
       CASE WHEN b.is_fleet THEN round((48 + random() * 14)::numeric, 1) END,
       CASE WHEN b.is_fleet THEN round((62 + random() * 8)::numeric, 1) END,
       CASE WHEN b.is_fleet THEN round((80 + random() * 12)::numeric, 1) END,
       -- Desglose TukTuk: MISMO factor y MISMA normalizacion que el paraguas, y
       -- round() es monotono → el desglose nunca supera a su total.
       CASE WHEN k.desglose AND b.ad_tk > 0 THEN round(b.ad_tk * k.fac) END,
       CASE WHEN k.desglose AND b.ad_tk > 0 THEN round(b.nr_tk / tb.jueves * tt.jueves * k.fac) END,
       CASE WHEN k.desglose AND b.ad_tk > 0 THEN round(b.sh_tk / tb.jueves * tt.jueves * k.fac) END,
       CASE WHEN k.desglose AND b.ad_tk > 0 THEN round(b.cars_tk * k.fac) END
  FROM _obj o
  JOIN _base_meta b ON b.ym = o.ym_base
  JOIN _thu tb ON tb.ym = o.ym_base
  JOIN _thu tt ON tt.ym = o.ym
  CROSS JOIN LATERAL (
    SELECT o.ajuste * CASE right(b.clid, 2)
                        WHEN '01' THEN 0.92 WHEN '02' THEN 1.05
                        WHEN '03' THEN 1.35 WHEN '06' THEN 0.88
                        ELSE 0.94 + ((right(b.clid, 2)::int * 37) % 21) / 100.0 END AS fac,
           (b.kam = 'Ana' AND o.ym = '2026-08') OR (b.kam = 'Dario' AND o.ym = '2026-09') AS desglose
  ) k
 WHERE right(b.clid, 2) NOT IN ('20', '29', '36', '50', '56', '59')
   AND (o.anio = 2026 AND o.ym >= '2026-06'
        OR right(b.clid, 2) IN ('01', '02', '04', '13'))
 ORDER BY o.ym, b.clid, b.city;

-- Filas "con meta" que en realidad no tienen plan (hasLineMeta las descarta).
UPDATE public.metas
   SET meta_active_drivers = 0, meta_nr = 0, meta_supply_hours = 0
 WHERE mes = 'SEPTIEMBRE' AND right(clid, 2) IN ('25', '44');
UPDATE public.metas
   SET meta_active_drivers = NULL, meta_nr = NULL, meta_supply_hours = NULL
 WHERE mes = 'AGOSTO' AND right(clid, 2) = '53';

-- ── CONVERSION (embudo + adquisicion por canal) ─────────────────────────────
-- Grano (clid, mes 'YYYY-MM'), nivel pais. El embudo va en escala 0-100 (asi lo
-- guarda uploadConversion) y es DECRECIENTE por construccion: first_order >=
-- n5 >= n10 >= n25 >= n50 >= n100. Cada partner tiene su propia "calidad" de
-- activacion (estable) mas ruido mensual: es el KPI que mas separa a uno de
-- otro. Los 8 canales son CONTEOS de conductores nuevos y suman new_drivers.
-- 6 meses (mar → ago), para casi todos: quedan afuera los que entraron tarde o
-- no tienen fila en partners.
INSERT INTO public.conversion_pais
  (clid, partner, mes, active_drivers, new_drivers,
   first_order, n5_success, n10_success, n25_success, n50_success, n100_success,
   agency_scouts, organic_partner, organic_scouts, organic_yango, paid_yango,
   partner_scouts, referral_partner, referral_yango)
SELECT c.clid, c.partner, c.mes, c.ad, c.nd,
       round(f.fo, 1), round(f.fo * f.r5, 1), round(f.fo * f.r5 * f.r10, 1),
       round(f.fo * f.r5 * f.r10 * f.r25, 1),
       round(f.fo * f.r5 * f.r10 * f.r25 * f.r50, 1),
       round(f.fo * f.r5 * f.r10 * f.r25 * f.r50 * f.r100, 1),
       -- canales: pesos por partner; el ultimo absorbe el redondeo
       round(c.nd * w.w1), round(c.nd * w.w2), round(c.nd * w.w3), round(c.nd * w.w4),
       round(c.nd * w.w5), round(c.nd * w.w6), round(c.nd * w.w7),
       c.nd - round(c.nd * w.w1) - round(c.nd * w.w2) - round(c.nd * w.w3) - round(c.nd * w.w4)
            - round(c.nd * w.w5) - round(c.nd * w.w6) - round(c.nd * w.w7)
  FROM (
    SELECT m.clid, p.partner, m.mes,
           sum(m.active_drivers) AS ad, sum(m.new_drivers) AS nd
      FROM public.rendimiento_mensual m
      JOIN public.partners p ON p.clid = m.clid
      JOIN public.fleetrooms fr ON fr.db_id = m.db_id
     WHERE NOT fr.exclude_from_taxi
       AND m.mes BETWEEN '2026-03' AND '2026-08'
       AND right(m.clid, 2) NOT IN ('45', '52', '58')
     GROUP BY m.clid, p.partner, m.mes
  ) c
  CROSS JOIN LATERAL (
    SELECT (38 + ((right(c.clid, 2)::int * 53) % 37) + random() * 6)::numeric AS fo,
           (0.72 + random() * 0.12)::numeric AS r5,
           (0.80 + random() * 0.10)::numeric AS r10,
           (0.65 + random() * 0.15)::numeric AS r25,
           (0.62 + random() * 0.15)::numeric AS r50,
           (0.52 + random() * 0.18)::numeric AS r100
  ) f
  CROSS JOIN LATERAL (
    -- 7 pesos + el resto; varian por partner (unos viven de scouts, otros de
    -- lo organico) pero no por mes.
    SELECT 0.06 + (right(c.clid, 2)::int % 5) * 0.02  AS w1,   -- agency_scouts
           0.14 + (right(c.clid, 2)::int % 7) * 0.02  AS w2,   -- organic_partner
           0.05                                        AS w3,   -- organic_scouts
           0.12 + (right(c.clid, 2)::int % 3) * 0.03  AS w4,   -- organic_yango
           0.08                                        AS w5,   -- paid_yango
           0.10 + (right(c.clid, 2)::int % 4) * 0.02  AS w6,   -- partner_scouts
           0.07                                        AS w7    -- referral_partner
  ) w
 ORDER BY c.mes, c.clid;

-- ── SEGUIMIENTO (tablero de proyecto) ───────────────────────────────────────
-- 25 tareas en 6 partners, con los cuatro estados. Fechas FIJAS contra el
-- 23-sep-2026: las "vencidas" (fin pasado y no hechas) y las bloqueadas son las
-- que ordenan el Resumen por urgencia, asi que tienen que existir las dos.
INSERT INTO public.seguimiento
  (kam, partner, clid, city, owner, project, task, start_date, end_date, expected_result, status, sort_order)
VALUES
  -- ANDINA MOVILIDAD (Ana): 2 vencidas + 1 bloqueada
  ('Ana','ANDINA MOVILIDAD','900000000001','LIMA','Ana','Captacion Q3','Activar campaña de scouts en SJL','2026-08-01','2026-08-31','+120 conductores nuevos','hecho',1),
  ('Ana','ANDINA MOVILIDAD','900000000001','LIMA','Partner','Captacion Q3','Onboarding presencial semanal','2026-08-15','2026-09-15','Activacion a 1 viaje > 40%','en_curso',2),
  ('Ana','ANDINA MOVILIDAD','900000000001','LIMA','Ana','Brandeo','Brandear 80 autos de la flota propia','2026-08-10','2026-09-10','80 autos brandeados','en_curso',3),
  ('Ana','ANDINA MOVILIDAD','900000000001','TRUJILLO','Partner','Brandeo','Conseguir proveedor de vinilos en Trujillo','2026-09-01','2026-09-20','Proveedor contratado','bloqueado',4),
  ('Ana','ANDINA MOVILIDAD','900000000001','LIMA','Ana','Reactivacion','Llamar a conductores inactivos 30+ dias','2026-09-15','2026-10-15','+60 reactivados','pendiente',5),
  -- EXPRESO CAPITAL (Beto): el volatil, con un plan de recuperacion
  ('Beto','EXPRESO CAPITAL','900000000003','LIMA','Beto','Plan de recuperacion','Diagnostico de la caida de AD en Lima','2026-08-05','2026-08-20','Causas identificadas','hecho',1),
  ('Beto','EXPRESO CAPITAL','900000000003','LIMA','Partner','Plan de recuperacion','Bono de retorno para conductores perdidos','2026-08-20','2026-09-05','Recuperar 150 AD','en_curso',2),
  ('Beto','EXPRESO CAPITAL','900000000003','LIMA','Beto','Plan de recuperacion','Revisar tarifas del turno noche','2026-09-01','2026-09-12','Propuesta aprobada','bloqueado',3),
  ('Beto','EXPRESO CAPITAL','900000000003','LIMA','Partner','TukTuk','Sumar 40 TukTuk en Lima Norte','2026-09-10','2026-10-31','40 unidades activas','pendiente',4),
  ('Beto','EXPRESO CAPITAL','900000000003','AREQUIPA','Beto','','Visita a la oficina de Arequipa','2026-09-22','2026-09-26','Acta de la visita','pendiente',5),
  -- SOL DE LIMA (Dario)
  ('Dario','SOL DE LIMA','900000000014','LIMA','Dario','TukTuk','Taggear las sub-flotas TukTuk','2026-07-01','2026-07-10','Tagging completo','hecho',1),
  ('Dario','SOL DE LIMA','900000000014','LIMA','Partner','TukTuk','Capacitacion de conductores TukTuk','2026-08-15','2026-09-18','90% capacitados','en_curso',2),
  ('Dario','SOL DE LIMA','900000000014','LIMA','Dario','Loyalty','Inscribir al partner en el Loyalty Program','2026-09-01','2026-09-30','Inscripcion confirmada','en_curso',3),
  ('Dario','SOL DE LIMA','900000000014','LIMA','Partner','Loyalty','Enviar documentacion tributaria','2026-09-05','2026-09-15','Documentos recibidos','bloqueado',4),
  -- SAN ISIDRO PREMIUM (Elena)
  ('Elena','SAN ISIDRO PREMIUM','900000000023','LIMA','Elena','Delivery','Piloto de delivery en San Isidro','2026-07-15','2026-08-15','20 repartidores activos','hecho',1),
  ('Elena','SAN ISIDRO PREMIUM','900000000023','LIMA','Partner','Delivery','Ampliar delivery a Miraflores','2026-09-01','2026-10-15','40 repartidores activos','en_curso',2),
  ('Elena','SAN ISIDRO PREMIUM','900000000023','LIMA','Elena','Calidad','Bajar viajes mal calificados bajo 5%','2026-08-01','2026-09-01','< 5% mal calificados','en_curso',3),
  ('Elena','SAN ISIDRO PREMIUM','900000000023','LIMA','Partner','Calidad','Taller de atencion al cliente','2026-10-01','2026-10-10','2 talleres dictados','pendiente',4),
  -- LOS OLIVOS RIDE (Fabio)
  ('Fabio','LOS OLIVOS RIDE','900000000033','LIMA','Fabio','Captacion Q3','Stand de reclutamiento en Mega Plaza','2026-08-20','2026-09-20','+50 perfiles','hecho',1),
  ('Fabio','LOS OLIVOS RIDE','900000000033','LIMA','Partner','Captacion Q3','Referidos con premio doble','2026-09-01','2026-09-30','+30 referidos','en_curso',2),
  ('Fabio','LOS OLIVOS RIDE','900000000033','LIMA','Fabio','Captacion Q3','Aprobar presupuesto de volanteo','2026-09-08','2026-09-19','Presupuesto aprobado','pendiente',3),
  -- FLOTA CENTRAL (Carla)
  ('Carla','FLOTA CENTRAL','900000000008','LIMA','Carla','Fleet','Medir utilizacion de la flota propia','2026-08-01','2026-08-15','Reporte de utilizacion','hecho',1),
  ('Carla','FLOTA CENTRAL','900000000008','LIMA','Partner','Fleet','Reasignar autos ociosos al turno tarde','2026-08-15','2026-09-12','Utilizacion > 85%','en_curso',2),
  ('Carla','FLOTA CENTRAL','900000000008','LIMA','Carla','Fleet','Renovar convenio de GNV','2026-09-01','2026-09-25','Convenio firmado','bloqueado',3),
  ('Carla','FLOTA CENTRAL','900000000008','LIMA','Partner','','Actualizar datos de contacto','2026-09-20','2026-10-05','Ficha al dia','pendiente',4);

-- ── PROYECTOS ───────────────────────────────────────────────────────────────
-- Tabla legada (ya ninguna vista la dibuja; data.ts solo la carga). Unas pocas
-- filas de cada tipo que usaba el formulario viejo, para que la carga no pase
-- siempre por el camino "tabla vacia".
INSERT INTO public.proyectos
  (semana, partner, clid, city, tipo, scouts_count, scouts_new_drivers, scouts_conv_pct,
   cc_calls, cc_conv_1trip_act, cc_conv_50trip_act, cc_conv_1trip_react, cc_conv_50trip_react,
   off_drivers_attracted, off_conv_1trip, off_conv_50trip,
   online_registrations, online_conv_1trip, online_conv_50trip)
VALUES
  ('2026-08-24','ANDINA MOVILIDAD','900000000001','LIMA','scouts',        12, 96, 38.5,   0, 0, 0, 0, 0,    0, 0, 0,     0, 0, 0),
  ('2026-08-31','EXPRESO CAPITAL', '900000000003','LIMA','contact_center', 0,  0,  0,   840, 22.4, 9.1, 17.8, 6.2, 0, 0, 0,  0, 0, 0),
  ('2026-09-07','SOL DE LIMA',     '900000000014','LIMA','offline',        0,  0,  0,     0, 0, 0, 0, 0,   45, 41.0, 17.5,   0, 0, 0),
  ('2026-09-07','LOS OLIVOS RIDE', '900000000033','LIMA','online',         0,  0,  0,     0, 0, 0, 0, 0,    0, 0, 0,   310, 28.7, 11.3),
  ('2026-09-14','ANDINA MOVILIDAD','900000000001','TRUJILLO','scouts',     5, 31, 33.0,   0, 0, 0, 0, 0,    0, 0, 0,     0, 0, 0),
  ('2026-09-14','FLOTA CENTRAL',   '900000000008','LIMA','contact_center', 0,  0,  0,   260, 18.9, 7.4, 14.2, 5.0, 0, 0, 0,  0, 0, 0);

-- ── PARTNERS SIN KAM (fixture del bucket "No KAM") ──────────────────────────
-- VA AL FINAL A PROPOSITO: la generacion de datos de arriba hace JOIN contra
-- `partners`, asi que borrar una fila antes dejaria a ese CLID sin ninguna fila
-- de rendimiento — y el caso B necesita justamente lo contrario, un CLID CON
-- datos y SIN fila en `partners`.
--
-- Produccion tiene DOS poblaciones de partners huerfanos, distintas entre si, y
-- las dos tienen que existir aca o el bucket "No KAM" queda sin probar:
--
--   Caso A (12 en produccion, sep 2026): fila en `partners` con `kam` VACIO.
--          VIA RAPIDA y RUTA DEL SILLAR conservan en sus FILAS de rendimiento
--          el KAM viejo del Excel (Carla / Beto) — el escenario del BUG 2 de
--          precedencia (partners → flotas → fila). ALTO SELVA ALEGRE nacio sin
--          KAM tambien en las filas.
--   Caso B (16 en produccion): CLID con datos y SIN fila en `partners`. El
--          nombre sale de `flotas.nombre_asignado`; sin eso la UI mostraria el
--          numero crudo de CLID (pasa hoy con dos CLIDs reales).
--
-- Antes del bucket, ninguno de los dos aparecia bajo ningun KAM del filtro:
-- eran invisibles justo para la persona que tenia que asignarles uno.
UPDATE public.partners SET kam = '' WHERE clid IN ('900000000007', '900000000057');  -- Caso A

INSERT INTO public.flotas (clid, nombre_asignado, kam, ciudad, activo) VALUES
  ('900000000005', 'NORTE SEGURO',    '',     'TRUJILLO', true),   -- Caso B
  ('900000000059', 'GRUPO MANCORA',   '',     'TRUJILLO', true),   -- Caso B
  -- Flota INACTIVA: tiene datos, pero `activo=false` la saca del dashboard
  -- (applyFlotasOverride). Sirve para verificar que no sume en ninguna vista.
  ('900000000058', 'TAXI BELLAVISTA', 'Beto', 'LIMA',     false);
DELETE FROM public.partners WHERE clid IN ('900000000005', '900000000059');  -- Caso B

-- ── PORTAL DEL PARTNER ──────────────────────────────────────────────────────
-- partner@local.test ve ANDINA MOVILIDAD. Sin esta fila el portal sale vacio
-- (kill-switch de my_clids(), que es lo CORRECTO para un partner sin mapeo).
-- Va aca y no en seed.sql porque la FK exige que el CLID ya exista en
-- `partners`; el SELECT evita fallar si seed.sql todavia no creo al usuario.
INSERT INTO public.partner_users (user_id, clid)
SELECT id, '900000000001' FROM auth.users WHERE id = '44444444-4444-4444-4444-444444444444';

ALTER TABLE public.partners            ENABLE TRIGGER USER;
ALTER TABLE public.fleetrooms          ENABLE TRIGGER USER;
ALTER TABLE public.flotas              ENABLE TRIGGER USER;
ALTER TABLE public.rendimiento         ENABLE TRIGGER USER;
ALTER TABLE public.rendimiento_mensual ENABLE TRIGGER USER;
ALTER TABLE public.rendimiento_diario  ENABLE TRIGGER USER;
ALTER TABLE public.metas               ENABLE TRIGGER USER;
ALTER TABLE public.conversion_pais     ENABLE TRIGGER USER;
ALTER TABLE public.seguimiento         ENABLE TRIGGER USER;
ALTER TABLE public.proyectos           ENABLE TRIGGER USER;
ALTER TABLE public.partner_users       ENABLE TRIGGER USER;

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
-- 6. SOLO-TUKTUK PRESENTE. MOTOS DEL SUR, TUKTUK EXPRESS y MOTOTAXI ANDES no
--    tienen operacion Taxi y aun asi deben aparecer en el sidebar y recibir
--    cuota (caso PIAGGIO).
--
-- 7. BENCHMARK POR CIUDAD. La tira del Ejecutivo exige >=3 pares con 50+
--    activos en las mismas ciudades del partner. Si alguna ciudad cae por
--    debajo de 3, la tira desaparece (correcto, pero deja de probarse).
--
-- 8. DESGLOSE ≤ PARAGUAS. meta_tk_ad/nr/sh <= meta_active_drivers/nr/sh en
--    toda fila, y NULL (no 0) donde no hay porcion TukTuk.
--
-- 9. EMBUDO DECRECIENTE. first_order >= n5 >= n10 >= n25 >= n50 >= n100, todo
--    en 0-100; y la suma de los 8 canales = new_drivers.
--
-- Chequeo rapido de los invariantes 2, 3 y 4:
--
--   SELECT mes, round(sum(supply_hours)/sum(active_drivers),2) sh_cond,
--          round(sum(trips)/sum(supply_hours),3) viajes_hora,
--          round(max(acceptance_rate),3) acc_max
--     FROM rendimiento_mensual GROUP BY mes ORDER BY mes;
--   -- sh_cond y viajes_hora tienen que variar entre meses; acc_max <= 1.
--
-- Y del 3 contra la semanal (debe dar 0 filas):
--
--   SELECT m.clid, m.db_id, m.mes FROM rendimiento_mensual m
--     JOIN (SELECT clid, db_id, to_char(fecha + 3, 'YYYY-MM') mes,
--                  sum(trips) tr, sum(supply_hours) sh, max(active_drivers) ad
--             FROM rendimiento GROUP BY 1, 2, 3) w USING (clid, db_id, mes)
--    WHERE m.trips <> w.tr OR abs(m.supply_hours - w.sh) > 0.01
--       OR m.active_drivers < w.ad;
