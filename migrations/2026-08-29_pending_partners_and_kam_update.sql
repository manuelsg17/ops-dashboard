-- Actualizacion masiva de KAM desde "KAMS ACTUALIZADO.xlsx" (Manuel, 2026-08-29).
-- 19 CLID donde el excel difiere de partners.kam, verificados 1:1 por CLID.
-- kam es NOT NULL: "sin KAM" se representa con '' (mismo patron que
-- config.ts:169 y que flotas.kam para las verticales Delivery/Cargo).
UPDATE partners SET kam = CASE clid
  WHEN '400001044975' THEN 'Andrea'   -- Líderes
  WHEN '400001100869' THEN 'Andrea'   -- PRO DRIVERS
  WHEN '400001105113' THEN ''         -- Taxigo
  WHEN '400001150258' THEN 'Andrea'   -- Velotaxi
  WHEN '400002148684' THEN ''         -- Empresa de Servicios La Libertad E.I.R.L
  WHEN '400005135120' THEN 'Rodolfo'  -- YevoGo
  WHEN '400005493591' THEN ''         -- Taxi Las Américas
  WHEN '400005811022' THEN ''         -- Quick Service
  WHEN '400006560265' THEN ''         -- Driver Trux
  WHEN '400006969095' THEN ''         -- GIAL WAY
  WHEN '400007509458' THEN ''         -- BROTHER DRIVER
  WHEN '400007890926' THEN 'Andrea'   -- AXIS
  WHEN '400008232743' THEN ''         -- CUMPA
  WHEN '400008726549' THEN ''         -- Loyale Transporte SAC
  WHEN '400010135383' THEN ''         -- FENIX DRIVE EIRL
  WHEN '400010294895' THEN 'Andrea'   -- Taxi Driver Perú
  WHEN '400010415568' THEN 'Andrea'   -- DET Logistic
  WHEN '400011359458' THEN ''         -- TRACKER MOBILITY SAC
  WHEN '400012046457' THEN 'Andrea'   -- FLOTA GBC AUTOMOTRIZ
  ELSE kam END,
  updated_at = now()
WHERE clid IN (
  '400001044975','400001100869','400001105113','400001150258','400002148684','400005135120',
  '400005493591','400005811022','400006560265','400006969095','400007509458','400007890926',
  '400008232743','400008726549','400010135383','400010294895','400010415568','400011359458','400012046457'
);

-- 4 CLIDs del excel sin fila en partners, confirmados con Manuel:
--   Piaggio: ya tenia fleetroom con kam Matias (coincide con el excel) -> alta formal.
--   FLEET RUN SAC: vertical Delivery, kam Andrea.
--   FLET1 CARGO: vertical Cargo, kam Andrea.
--   TuTaxi: sin KAM a proposito ("no ha crecido y lo mataremos").
INSERT INTO partners (clid, partner, kam, is_fleet, is_tuktuk, activo) VALUES
  ('400011321576', 'PIAGGIO',      'Matías', false, true,  true),
  ('400002004529', 'FLEET RUN SAC','Andrea', false, false, true),
  ('400001734795', 'FLET1 CARGO',  'Andrea', false, false, true),
  ('400007351353', 'TuTaxi',       '',       false, false, true)
ON CONFLICT (clid) DO NOTHING;

-- FLEET RUN SAC y FLET1 CARGO nunca tuvieron fila en fleetrooms (solo existian
-- como db_id crudo en rendimiento). Alta con su vertical marcada. Piaggio no
-- se toca: su fleetroom ya estaba correcto.
INSERT INTO fleetrooms (db_id, clid, name, kam, city, is_delivery, is_cargo, activo) VALUES
  ('75c482d3914c46af8eae33ca20b81b34', '400002004529', 'FLEET RUN SAC', 'Andrea', 'LIMA', true,  false, true),
  ('11caafdb37ef4779ad30d994828f1199', '400001734795', 'FLET1 CARGO',   'Andrea', 'LIMA', false, true,  true)
ON CONFLICT (db_id) DO UPDATE SET is_delivery = EXCLUDED.is_delivery, is_cargo = EXCLUDED.is_cargo;
