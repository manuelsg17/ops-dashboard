-- Nueva vertical (Delivery/Cargo), pedido de Manuel 29-ago-2026: marcar
-- sub-flotas como Delivery o Cargo para que Presentacion pueda extraer su data
-- por separado. Mismo patron que exclude_from_taxi: SOLO en fleetrooms (nivel
-- sub-flota, no CLID) — un mismo CLID puede tener una sub-flota Taxi normal y
-- otra Cargo (ej. "Alo Taxi" / "Alo Taxi Lima Cargo", mismo CLID 400006466224).
-- NO implica exclude_from_taxi automaticamente: ese checkbox sigue siendo
-- manual e independiente, como ya se usa hoy para excluir cargo/delivery.
ALTER TABLE fleetrooms
  ADD COLUMN is_delivery boolean NOT NULL DEFAULT false,
  ADD COLUMN is_cargo    boolean NOT NULL DEFAULT false;
